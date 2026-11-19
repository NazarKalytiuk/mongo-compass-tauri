import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ImportExportModal from "../ImportExportModal";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri functions
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  dbName: "test_db",
  collName: "users",
  queryFilter: "{}",
  querySort: "{}",
  queryProjection: "{}",
  currentPageDocs: [{ _id: "1", name: "Alice" }] as any[],
  onRefresh: vi.fn(),
};

function renderModal(overrides: Partial<typeof defaultProps> = {}) {
  return render(<ImportExportModal {...defaultProps} {...overrides} />);
}

function getFileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector("input[type='file']") as HTMLInputElement;
}

function changeFile(container: HTMLElement, file: File) {
  fireEvent.change(getFileInput(container), { target: { files: [file] } });
}

// Spy helpers for export-side DOM effects. Must be called AFTER renderModal().
function mockExportDom() {
  const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
  const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
  const appendChild = vi.spyOn(document.body, "appendChild").mockImplementation((n) => n);
  const removeChild = vi.spyOn(document.body, "removeChild").mockImplementation((n) => n);
  return { createObjectURL, revokeObjectURL, appendChild, removeChild };
}

function restoreExportDom(spies: ReturnType<typeof mockExportDom>) {
  spies.createObjectURL.mockRestore();
  spies.revokeObjectURL.mockRestore();
  spies.appendChild.mockRestore();
  spies.removeChild.mockRestore();
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("ImportExportModal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Visibility ─────────────────────────────────────────────────────────────

  it("does not render when isOpen is false", () => {
    render(<ImportExportModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText("Import / Export Data")).not.toBeInTheDocument();
  });

  it("renders modal header and active-target when isOpen is true", () => {
    renderModal();
    expect(screen.getByText("Import / Export Data")).toBeInTheDocument();
    expect(screen.getByText("Active target: test_db.users")).toBeInTheDocument();
  });

  // ─── Tabs ───────────────────────────────────────────────────────────────────

  it("defaults to Import tab with file-drop zone visible", () => {
    renderModal();
    expect(screen.getByText("Select Import File")).toBeInTheDocument();
    expect(screen.queryByText("Export Format")).not.toBeInTheDocument();
  });

  it("switches to Export tab and shows format + scope selects", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));
    expect(screen.getByText("Export Format")).toBeInTheDocument();
    expect(screen.getByText("Export Range Scope")).toBeInTheDocument();
    expect(screen.queryByText("Select Import File")).not.toBeInTheDocument();
  });

  it("switching to Export tab clears any visible error message", async () => {
    renderModal();
    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => { fireEvent.submit(form); });
    expect(screen.getByText("Please select a file to import.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));
    expect(screen.queryByText("Please select a file to import.")).not.toBeInTheDocument();
  });

  it("switching back to Import tab clears any visible success message", async () => {
    renderModal({ currentPageDocs: [{ a: 1 }] });
    const spies = mockExportDom();
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Export/i }));
    });
    expect(await screen.findByText("Exported 1 document(s) successfully!")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Import Files/i }));
    expect(screen.queryByText("Exported 1 document(s) successfully!")).not.toBeInTheDocument();
    restoreExportDom(spies);
  });

  // ─── onClose / Cancel ───────────────────────────────────────────────────────

  it("calls onClose when the X button (header) is clicked", () => {
    const onClose = vi.fn();
    const { container } = renderModal({ onClose });
    const headerDiv = container.querySelector(".bg-\\[\\#F4F1EC\\]") as HTMLElement;
    const xBtn = headerDiv.querySelector("button") as HTMLButtonElement;
    fireEvent.click(xBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Cancel button is clicked on Import tab", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Cancel button is clicked on Export tab", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ─── File selection & format detection ──────────────────────────────────────

  it("shows placeholder text when no file is selected", () => {
    renderModal();
    expect(screen.getByText("Click to select a data file")).toBeInTheDocument();
    expect(screen.getByText("Supports .json, .ndjson, .jsonl, .csv")).toBeInTheDocument();
  });

  it("detects JSON format from .json extension and shows file info", async () => {
    const { container } = renderModal();
    const file = new File(["[]"], "data.json", { type: "application/json" });
    await act(async () => { changeFile(container, file); });

    expect(screen.getByText("data.json")).toBeInTheDocument();
    expect(screen.getByText(/Format:/i).textContent?.toUpperCase()).toContain("JSON");
  });

  it("detects NDJSON format from .ndjson extension", async () => {
    const { container } = renderModal();
    const file = new File(['{"a":1}'], "data.ndjson", { type: "application/x-ndjson" });
    await act(async () => { changeFile(container, file); });
    expect(screen.getByText(/Format:/i).textContent?.toUpperCase()).toContain("NDJSON");
  });

  it("detects NDJSON format from .jsonl extension", async () => {
    const { container } = renderModal();
    const file = new File(['{"a":1}'], "data.jsonl", { type: "text/plain" });
    await act(async () => { changeFile(container, file); });
    expect(screen.getByText(/Format:/i).textContent?.toUpperCase()).toContain("NDJSON");
  });

  it("detects CSV format from .csv extension", async () => {
    const { container } = renderModal();
    const file = new File(["name,age\nAlice,30"], "data.csv", { type: "text/csv" });
    await act(async () => { changeFile(container, file); });
    expect(screen.getByText(/Format:/i).textContent?.toUpperCase()).toContain("CSV");
  });

  it("sets detectedFormat to unknown for an unrecognised extension", async () => {
    const { container } = renderModal();
    const file = new File(["data"], "data.xml", { type: "text/xml" });
    await act(async () => { changeFile(container, file); });
    expect(screen.getByText(/Format:/i).textContent?.toUpperCase()).toContain("UNKNOWN");
  });

  it("clears file selection when file input produces no file", async () => {
    const { container } = renderModal();
    const file = new File(["[]"], "data.json", { type: "application/json" });
    await act(async () => { changeFile(container, file); });
    expect(screen.getByText("data.json")).toBeInTheDocument();

    const input = getFileInput(container);
    await act(async () => {
      fireEvent.change(input, { target: { files: [] } });
    });
    expect(screen.queryByText("data.json")).not.toBeInTheDocument();
    expect(screen.getByText("Click to select a data file")).toBeInTheDocument();
  });

  it("shows file size in KB after file selection", async () => {
    const { container } = renderModal();
    const content = '{"a":1}';
    const file = new File([content], "test.json", { type: "application/json" });
    await act(async () => { changeFile(container, file); });
    const sizeEl = screen.getByText(/KB \| Format:/i);
    expect(sizeEl.textContent).toContain((file.size / 1024).toFixed(1));
  });

  it("clicking the drop zone triggers the hidden file input click()", () => {
    const { container } = renderModal();
    const input = getFileInput(container);
    const clickSpy = vi.spyOn(input, "click").mockImplementation(() => {});
    const dropZone = container.querySelector(".border-dashed") as HTMLElement;
    fireEvent.click(dropZone);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  // ─── Import tab: validation ──────────────────────────────────────────────────

  it("Run Import button is disabled when no file is selected", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /Run Import/i })).toBeDisabled();
  });

  it("Run Import button is disabled when detectedFormat is unknown", async () => {
    const { container } = renderModal();
    const file = new File(["data"], "data.xml", { type: "text/xml" });
    await act(async () => { changeFile(container, file); });
    expect(screen.getByRole("button", { name: /Run Import/i })).toBeDisabled();
  });

  it("shows error when form is submitted with no file via form submit event", async () => {
    renderModal();
    const form = document.querySelector("form") as HTMLFormElement;
    await act(async () => { fireEvent.submit(form); });
    expect(screen.getByText("Please select a file to import.")).toBeInTheDocument();
  });

  // ─── Import: JSON ────────────────────────────────────────────────────────────

  it("imports a JSON array file and calls insert_many with correct args", async () => {
    const onRefresh = vi.fn();
    vi.mocked(invoke).mockResolvedValueOnce(["id1", "id2"]);
    const { container } = renderModal({ onRefresh });

    const file = new File(['[{"name":"Alice"},{"name":"Bob"}]'], "data.json", { type: "application/json" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });

    expect(await screen.findByText("Successfully imported 2 document(s) into test_db.users!")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("insert_many", {
      dbName: "test_db",
      collName: "users",
      docs: [{ name: "Alice" }, { name: "Bob" }],
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("imports a single JSON object (not array) file and wraps it in array", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["id1"]);
    const { container } = renderModal();

    const file = new File(['{"name":"Carol"}'], "single.json", { type: "application/json" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });

    expect(await screen.findByText("Successfully imported 1 document(s) into test_db.users!")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("insert_many", {
      dbName: "test_db",
      collName: "users",
      docs: [{ name: "Carol" }],
    });
  });

  it("resets selectedFile and file input after a successful import", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["id1"]);
    const { container } = renderModal();

    const file = new File(['[{"x":1}]'], "data.json", { type: "application/json" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });

    await screen.findByText("Successfully imported 1 document(s) into test_db.users!");
    expect(screen.queryByText("data.json")).not.toBeInTheDocument();
    expect(screen.getByText("Click to select a data file")).toBeInTheDocument();
  });

  it("shows error banner when insert_many invoke rejects", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("DB write failed"));
    const { container } = renderModal();

    const file = new File(['[{"x":1}]'], "data.json", { type: "application/json" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });

    expect(await screen.findByText("DB write failed")).toBeInTheDocument();
  });

  it("shows error for malformed JSON file content", async () => {
    const { container } = renderModal();
    const file = new File(["NOT JSON"], "bad.json", { type: "application/json" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });
    expect(await screen.findByText(/Unexpected token|JSON Parse error|Expected/i)).toBeInTheDocument();
  });

  it("shows error when JSON file contains empty array", async () => {
    const { container } = renderModal();
    const file = new File(["[]"], "empty.json", { type: "application/json" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });
    expect(await screen.findByText("No valid documents found in file.")).toBeInTheDocument();
  });

  it("renders red error banner div when import fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Insert error"));
    const { container } = renderModal();

    const file = new File(['[{"x":1}]'], "data.json", { type: "application/json" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });

    await screen.findByText("Insert error");
    expect(container.querySelector(".bg-\\[\\#FEE2E2\\]")).toBeInTheDocument();
  });

  it("renders green success banner div after successful import", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["id1"]);
    const { container } = renderModal();

    const file = new File(['[{"x":1}]'], "data.json", { type: "application/json" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });

    await screen.findByText("Successfully imported 1 document(s) into test_db.users!");
    expect(container.querySelector(".bg-\\[\\#DCFCE7\\]")).toBeInTheDocument();
  });

  // ─── Import: NDJSON ─────────────────────────────────────────────────────────

  it("imports NDJSON file and calls insert_many", async () => {
    const onRefresh = vi.fn();
    vi.mocked(invoke).mockResolvedValueOnce(["id1", "id2"]);
    const { container } = renderModal({ onRefresh });

    const content = '{"name":"Alice","age":25}\n{"name":"Bob","age":30}';
    const file = new File([content], "users.ndjson", { type: "application/x-ndjson" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });

    expect(await screen.findByText("Successfully imported 2 document(s) into test_db.users!", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("insert_many", {
      dbName: "test_db",
      collName: "users",
      docs: [{ name: "Alice", age: 25 }, { name: "Bob", age: 30 }],
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows error with line number for malformed NDJSON", async () => {
    const { container } = renderModal();

    const content = '{"name":"Alice"}\nBAD_JSON_LINE';
    const file = new File([content], "bad.ndjson", { type: "application/x-ndjson" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });

    expect(await screen.findByText(/Syntax error at NDJSON line 2/i)).toBeInTheDocument();
  });

  it("imports NDJSON via .jsonl extension", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["id1"]);
    const { container } = renderModal();

    const file = new File(['{"val":42}'], "data.jsonl", { type: "text/plain" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });
    expect(await screen.findByText("Successfully imported 1 document(s) into test_db.users!", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  // ─── Import: CSV ─────────────────────────────────────────────────────────────

  it("imports CSV file with typed values (bool, null, number, string)", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["id1", "id2"]);
    const { container } = renderModal();

    const csv = "name,age,active,deleted\nAlice,30,true,null\nBob,25,false,null";
    const file = new File([csv], "data.csv", { type: "text/csv" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });

    expect(await screen.findByText("Successfully imported 2 document(s) into test_db.users!")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("insert_many", {
      dbName: "test_db",
      collName: "users",
      docs: [
        { name: "Alice", age: 30, active: true, deleted: null },
        { name: "Bob", age: 25, active: false, deleted: null },
      ],
    });
  });

  it("shows error for CSV with only a header row (no data rows)", async () => {
    const { container } = renderModal();
    const file = new File(["name,age\n"], "empty.csv", { type: "text/csv" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });
    expect(await screen.findByText("No valid documents found in file.")).toBeInTheDocument();
  });

  it("parseCSV handles quoted fields containing commas", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["id1"]);
    const { container } = renderModal();

    const csv = 'name,address\n"Alice","123 Main St, Apt 4"';
    const file = new File([csv], "data.csv", { type: "text/csv" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });

    await screen.findByText("Successfully imported 1 document(s) into test_db.users!");
    expect(invoke).toHaveBeenCalledWith("insert_many", expect.objectContaining({
      docs: [{ name: "Alice", address: "123 Main St, Apt 4" }],
    }));
  });

  it("parseCSV handles Windows CRLF line endings", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["id1", "id2"]);
    const { container } = renderModal();

    const csv = "name,age\r\nAlice,30\r\nBob,25";
    const file = new File([csv], "data.csv", { type: "text/csv" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });
    expect(await screen.findByText("Successfully imported 2 document(s) into test_db.users!")).toBeInTheDocument();
  });

  it("parseCSV pads missing columns with empty string", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["id1"]);
    const { container } = renderModal();

    const csv = "name,age,city\nAlice,30";
    const file = new File([csv], "data.csv", { type: "text/csv" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
    });

    await screen.findByText("Successfully imported 1 document(s) into test_db.users!");
    expect(invoke).toHaveBeenCalledWith("insert_many", expect.objectContaining({
      docs: [{ name: "Alice", age: 30, city: "" }],
    }));
  });

  // ─── Import: FileReader onerror ──────────────────────────────────────────────

  it("shows 'Failed to read file.' when FileReader fires onerror", async () => {
    const { container } = renderModal();
    const file = new File(['[{"x":1}]'], "data.json", { type: "application/json" });
    await act(async () => { changeFile(container, file); });

    class MockFileReader {
      onload: ((e: any) => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText(_f: File) {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    const OriginalFileReader = globalThis.FileReader;
    globalThis.FileReader = MockFileReader as any;

    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(screen.getByText("Failed to read file.")).toBeInTheDocument();
    } finally {
      globalThis.FileReader = OriginalFileReader;
    }
  });

  // ─── Export: page scope ──────────────────────────────────────────────────────

  it("exports page docs as JSON and triggers browser download", async () => {
    renderModal({ currentPageDocs: [{ _id: "1", name: "Alice" }] });
    const spies = mockExportDom();
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Export/i }));
    });

    expect(await screen.findByText("Exported 1 document(s) successfully!")).toBeInTheDocument();
    expect(spies.createObjectURL).toHaveBeenCalledTimes(1);
    expect(spies.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
    restoreExportDom(spies);
  });

  it("exports page docs as NDJSON when format is ndjson", async () => {
    renderModal({ currentPageDocs: [{ a: 1 }, { b: 2 }] });
    const spies = mockExportDom();
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));

    const allSelects = screen.getAllByRole("combobox");
    fireEvent.change(allSelects[0], { target: { value: "ndjson" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Export/i }));
    });

    expect(await screen.findByText("Exported 2 document(s) successfully!")).toBeInTheDocument();
    restoreExportDom(spies);
  });

  it("exports page docs as CSV when format is csv", async () => {
    renderModal({ currentPageDocs: [{ name: "Alice", age: 30 }] });
    const spies = mockExportDom();
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));

    const allSelects = screen.getAllByRole("combobox");
    fireEvent.change(allSelects[0], { target: { value: "csv" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Export/i }));
    });

    expect(await screen.findByText("Exported 1 document(s) successfully!")).toBeInTheDocument();
    restoreExportDom(spies);
  });

  it("CSV export: encodes object values as embedded JSON strings", async () => {
    let capturedBlob: Blob | null = null;
    const docs = [{ name: "Alice", meta: { tag: "vip" } }];
    renderModal({ currentPageDocs: docs });
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return "blob:mock";
    });
    vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    vi.spyOn(document.body, "appendChild").mockImplementation((n) => n);
    vi.spyOn(document.body, "removeChild").mockImplementation((n) => n);
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));

    const allSelects = screen.getAllByRole("combobox");
    fireEvent.change(allSelects[0], { target: { value: "csv" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Export/i }));
    });

    await screen.findByText("Exported 1 document(s) successfully!");
    const blobText = await capturedBlob!.text();
    expect(blobText).toContain('"meta"');
    expect(blobText).toContain("vip");
  });

  it("CSV export: Extended JSON numbers are written as their exact digits", async () => {
    let capturedBlob: Blob | null = null;
    const docs = [{ count: 5, views: { $numberLong: "9007199254740993" }, ratio: { $numberDouble: "3.0" }, price: { $numberDecimal: "19.90" } }];
    renderModal({ currentPageDocs: docs });
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return "blob:mock";
    });
    vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    vi.spyOn(document.body, "appendChild").mockImplementation((n) => n);
    vi.spyOn(document.body, "removeChild").mockImplementation((n) => n);
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "csv" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Export/i }));
    });

    await screen.findByText("Exported 1 document(s) successfully!");
    expect((await capturedBlob!.text()).split("\n")[1]).toBe('"5","9007199254740993","3.0","19.90"');
  });

  it("CSV export: null/undefined fields appear as empty strings in output", async () => {
    let capturedBlob: Blob | null = null;
    const docs = [{ name: "Alice", age: null }, { name: "Bob" }];
    renderModal({ currentPageDocs: docs });
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return "blob:mock";
    });
    vi.spyOn(URL, "revokeObjectURL").mockReturnValue(undefined);
    vi.spyOn(document.body, "appendChild").mockImplementation((n) => n);
    vi.spyOn(document.body, "removeChild").mockImplementation((n) => n);
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));

    const allSelects = screen.getAllByRole("combobox");
    fireEvent.change(allSelects[0], { target: { value: "csv" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Export/i }));
    });

    await screen.findByText("Exported 2 document(s) successfully!");
    const blobText = await capturedBlob!.text();
    expect(blobText).toContain('"name"');
    expect(blobText).toContain('"Alice"');
    expect(blobText).toContain('"Bob"');
  });

  // ─── Export: query scope ─────────────────────────────────────────────────────

  it("calls find_documents with correct args when exportScope is 'query'", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      documents: [{ _id: "x", val: 42 }, { _id: "y", val: 99 }],
    });

    renderModal({ currentPageDocs: [] });
    const spies = mockExportDom();
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));

    const allSelects = screen.getAllByRole("combobox");
    fireEvent.change(allSelects[1], { target: { value: "query" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Export/i }));
    });

    expect(invoke).toHaveBeenCalledWith("find_documents", {
      dbName: "test_db",
      collName: "users",
      filterStr: "{}",
      sortStr: "{}",
      projectionStr: "{}",
      limit: 0,
      skip: 0,
    });
    expect(await screen.findByText("Exported 2 document(s) successfully!")).toBeInTheDocument();
    restoreExportDom(spies);
  });

  it("shows error when find_documents returns empty documents", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ documents: [] });

    renderModal({ currentPageDocs: [] });
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));

    const allSelects = screen.getAllByRole("combobox");
    fireEvent.change(allSelects[1], { target: { value: "query" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Export/i }));
    });

    expect(await screen.findByText("No documents found to export.")).toBeInTheDocument();
  });

  it("shows error when page docs are empty (scope: page)", async () => {
    renderModal({ currentPageDocs: [] });
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Export/i }));
    });

    expect(await screen.findByText("No documents found to export.")).toBeInTheDocument();
  });

  it("shows error when find_documents invoke rejects", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Network error"));

    renderModal({ currentPageDocs: [] });
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));

    const allSelects = screen.getAllByRole("combobox");
    fireEvent.change(allSelects[1], { target: { value: "query" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Export/i }));
    });

    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  // ─── Format & scope select changes ───────────────────────────────────────────

  it("updates exportFormat through all three options", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));

    const allSelects = screen.getAllByRole("combobox");
    const formatSelect = allSelects[0] as HTMLSelectElement;

    fireEvent.change(formatSelect, { target: { value: "ndjson" } });
    expect(formatSelect.value).toBe("ndjson");

    fireEvent.change(formatSelect, { target: { value: "csv" } });
    expect(formatSelect.value).toBe("csv");

    fireEvent.change(formatSelect, { target: { value: "json" } });
    expect(formatSelect.value).toBe("json");
  });

  it("updates exportScope between page and query", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));

    const allSelects = screen.getAllByRole("combobox");
    const scopeSelect = allSelects[1] as HTMLSelectElement;

    fireEvent.change(scopeSelect, { target: { value: "query" } });
    expect(scopeSelect.value).toBe("query");

    fireEvent.change(scopeSelect, { target: { value: "page" } });
    expect(scopeSelect.value).toBe("page");
  });

  // ─── Import: unknown-format fallback paths (lines 163-168) ─────────────────
  // The UI disables the Run Import button when format is "unknown", but the
  // onSubmit handler still runs when the form is submitted programmatically.

  it("unknown-format fallback: tries JSON.parse first and succeeds", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["id1"]);
    const { container } = renderModal();

    // Pick a file with unknown extension so detectedFormat = "unknown"
    const file = new File(['[{"a":1}]'], "data.bak", { type: "application/octet-stream" });
    await act(async () => { changeFile(container, file); });

    // Button is disabled but form submit still triggers handleImportSubmit
    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => { fireEvent.submit(form); });

    expect(await screen.findByText("Successfully imported 1 document(s) into test_db.users!")).toBeInTheDocument();
  });

  it("unknown-format fallback: falls back to NDJSON line-by-line when JSON.parse fails", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(["id1", "id2"]);
    const { container } = renderModal();

    const content = '{"x":1}\n{"y":2}';
    const file = new File([content], "data.bak", { type: "application/octet-stream" });
    await act(async () => { changeFile(container, file); });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => { fireEvent.submit(form); });

    expect(await screen.findByText("Successfully imported 2 document(s) into test_db.users!")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("insert_many", expect.objectContaining({
      docs: [{ x: 1 }, { y: 2 }],
    }));
  });

  // ─── Loading states (placed last to avoid promise pollution) ─────────────────

  it("shows 'Importing...' while import is in progress", async () => {
    vi.mocked(invoke).mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderModal();

    const file = new File(['[{"x":1}]'], "data.json", { type: "application/json" });
    await act(async () => { changeFile(container, file); });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Import/i }));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByText("Importing...")).toBeInTheDocument();
  });

  it("shows 'Exporting...' while export is in progress", async () => {
    vi.mocked(invoke).mockReturnValue(new Promise(() => {})); // never resolves

    renderModal({ currentPageDocs: [] });
    fireEvent.click(screen.getByRole("button", { name: /Export Collection/i }));

    const allSelects = screen.getAllByRole("combobox");
    fireEvent.change(allSelects[1], { target: { value: "query" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Export/i }));
    });

    expect(screen.getByText("Exporting...")).toBeInTheDocument();
  });
});
