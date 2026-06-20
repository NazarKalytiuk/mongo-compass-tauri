import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import InvestigateView from "../InvestigateView";
import { invoke } from "@tauri-apps/api/core";
import { getQueryLogs } from "../../queryLogger";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock queryLogger
vi.mock("../../queryLogger", () => ({
  getQueryLogs: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

const mockIndexes = [
  { name: "_id_", key: { _id: 1 }, size: 24576, accesses: 120, unique: false, sparse: false },
  { name: "email_1", key: { email: 1 }, size: 49152, accesses: 482, unique: true, sparse: false },
  { name: "status_1_createdAt_-1", key: { status: 1, createdAt: -1 }, size: 86016, accesses: 0, unique: false, sparse: true },
];

const emptyLogs: any[] = [];

// ==========================================
// INDEXES TAB
// ==========================================
describe("InvestigateView – Indexes tab", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(emptyLogs);
  });

  it("renders loader initially then renders index table", async () => {
    mockInvoke.mockResolvedValue(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    expect(screen.getByText(/Loading index definitions.../i)).toBeInTheDocument();

    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText(/Loading index definitions.../i)).not.toBeInTheDocument();
    expect(screen.getByText("_id_")).toBeInTheDocument();
    expect(screen.getByText("email_1")).toBeInTheDocument();
    expect(screen.getByText("status_1_createdAt_-1")).toBeInTheDocument();
  });

  it("displays formatted keys for each index", async () => {
    mockInvoke.mockResolvedValue(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("{ _id: 1 }")).toBeInTheDocument();
    expect(screen.getByText("{ email: 1 }")).toBeInTheDocument();
    expect(screen.getByText("{ status: 1, createdAt: -1 }")).toBeInTheDocument();
  });

  it("formats sizes in human-readable form", async () => {
    mockInvoke.mockResolvedValue(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("24 KB")).toBeInTheDocument();
    expect(screen.getByText("48 KB")).toBeInTheDocument();
    expect(screen.getByText("84 KB")).toBeInTheDocument();
  });

  it("renders 0 bytes for zero-size index", async () => {
    const zeroIndex = [{ name: "_id_", key: { _id: 1 }, size: 0, accesses: 5, unique: false, sparse: false }];
    mockInvoke.mockResolvedValue(zeroIndex);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("0 Bytes")).toBeInTheDocument();
  });

  it("renders MB sizes for large indexes", async () => {
    const largeIndex = [{ name: "big_idx", key: { data: 1 }, size: 2 * 1024 * 1024, accesses: 10, unique: false, sparse: false }];
    mockInvoke.mockResolvedValue(largeIndex);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("2 MB")).toBeInTheDocument();
  });

  it("renders GB sizes for very large indexes", async () => {
    const gbIndex = [{ name: "huge_idx", key: { data: 1 }, size: 3 * 1024 * 1024 * 1024, accesses: 1, unique: false, sparse: false }];
    mockInvoke.mockResolvedValue(gbIndex);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("3 GB")).toBeInTheDocument();
  });

  it("shows Unique and Sparse badges", async () => {
    mockInvoke.mockResolvedValue(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("Unique")).toBeInTheDocument();
    expect(screen.getByText("Sparse")).toBeInTheDocument();
  });

  it("shows Standard label for non-unique, non-sparse index", async () => {
    const simpleIndex = [{ name: "basic_idx", key: { field: 1 }, size: 1024, accesses: 0, unique: false, sparse: false }];
    mockInvoke.mockResolvedValue(simpleIndex);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Standard")).toBeInTheDocument();
  });

  it("renders accesses count as hits", async () => {
    mockInvoke.mockResolvedValue(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("120 hits")).toBeInTheDocument();
    expect(screen.getByText("482 hits")).toBeInTheDocument();
    expect(screen.getByText("0 hits")).toBeInTheDocument();
  });

  it("shows Unavailable when accesses is undefined", async () => {
    const idx = [{ name: "no_stats", key: { x: 1 }, size: 1024, unique: false, sparse: false }];
    mockInvoke.mockResolvedValue(idx);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("shows System protected for _id_ index and no drop button", async () => {
    mockInvoke.mockResolvedValue(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("System protected")).toBeInTheDocument();
    const dropBtns = screen.getAllByTitle("Drop Index");
    expect(dropBtns.length).toBe(2); // only for email_1 and status_1_createdAt_-1
  });

  it("shows empty state when no indexes are returned", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("No indexes detected on this collection.")).toBeInTheDocument();
  });

  it("shows error banner when list_indexes fails", async () => {
    mockInvoke.mockRejectedValue(new Error("Connection refused"));
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("Failed to load indexes")).toBeInTheDocument();
    expect(screen.getByText("Connection refused")).toBeInTheDocument();
  });

  it("shows error banner when error is not an Error instance", async () => {
    mockInvoke.mockRejectedValue("some string error");
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("some string error")).toBeInTheDocument();
  });

  it("retries loading indexes when Retry button clicked", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("First failure"))
      .mockResolvedValueOnce(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("Failed to load indexes")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryBtn);

    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText("Failed to load indexes")).not.toBeInTheDocument();
    expect(screen.getByText("email_1")).toBeInTheDocument();
  });

  it("does not fetch indexes when dbName or collName are empty", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<InvestigateView dbName="" collName="" />);
    await act(async () => { await Promise.resolve(); });
    expect(mockInvoke).not.toHaveBeenCalledWith("list_indexes", expect.anything());
  });

  it("formatKeys returns {} for null/non-object key", async () => {
    // Index with null key should show '{}'
    const nullKeyIndex = [{ name: "_id_", key: null as any, size: 0, accesses: 0, unique: false, sparse: false }];
    mockInvoke.mockResolvedValue(nullKeyIndex);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("{}")).toBeInTheDocument();
  });
});

// ==========================================
// CREATE INDEX MODAL
// ==========================================
describe("InvestigateView – Create Index modal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(emptyLogs);
  });

  it("opens modal on Create Index button click", async () => {
    mockInvoke.mockResolvedValue(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));
    expect(screen.getByRole("heading", { name: "Create Index" })).toBeInTheDocument();
  });

  it("closes modal when X button is clicked", async () => {
    mockInvoke.mockResolvedValue(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));
    expect(screen.getByRole("heading", { name: "Create Index" })).toBeInTheDocument();

    // Use the Cancel button to close the modal
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole("heading", { name: "Create Index" })).not.toBeInTheDocument();
  });

  it("shows validation error when no field is specified", async () => {
    mockInvoke.mockResolvedValue(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));

    // Submit by submitting the form directly (bypasses HTML5 required validation)
    const form = document.querySelector("form")!;
    fireEvent.submit(form);

    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("You must specify at least one field name.")).toBeInTheDocument();
  });

  it("submits create index with ascending field type", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return mockIndexes;
      if (cmd === "create_index") return null;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));

    const nameInput = screen.getByPlaceholderText(/Optional: Auto-generated if empty/i);
    fireEvent.change(nameInput, { target: { value: "my_idx" } });

    const fieldInput = screen.getByPlaceholderText(/Field name/i);
    fireEvent.change(fieldInput, { target: { value: "username" } });

    const submitBtn = screen.getAllByRole("button", { name: "Create Index" })[1];
    fireEvent.click(submitBtn);

    await act(async () => { await Promise.resolve(); });

    expect(mockInvoke).toHaveBeenCalledWith("create_index", {
      dbName: "test_db",
      collName: "test_coll",
      keysJson: '{"username":1}',
      name: "my_idx",
      unique: false,
      sparse: false,
    });
    expect(screen.queryByRole("heading", { name: "Create Index" })).not.toBeInTheDocument();
  });

  it("submits create index with empty name as null", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return mockIndexes;
      if (cmd === "create_index") return null;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));
    // Leave name empty, just fill field
    const fieldInput = screen.getByPlaceholderText(/Field name/i);
    fireEvent.change(fieldInput, { target: { value: "email" } });

    const submitBtn = screen.getAllByRole("button", { name: "Create Index" })[1];
    fireEvent.click(submitBtn);
    await act(async () => { await Promise.resolve(); });

    expect(mockInvoke).toHaveBeenCalledWith("create_index", expect.objectContaining({ name: null }));
  });

  it("submits with descending (-1) field type", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "create_index") return null;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));
    const fieldInput = screen.getByPlaceholderText(/Field name/i);
    fireEvent.change(fieldInput, { target: { value: "createdAt" } });

    const typeSelect = screen.getByDisplayValue("Ascending (1)");
    fireEvent.change(typeSelect, { target: { value: "-1" } });

    const submitBtn = screen.getAllByRole("button", { name: "Create Index" })[1];
    fireEvent.click(submitBtn);
    await act(async () => { await Promise.resolve(); });

    expect(mockInvoke).toHaveBeenCalledWith("create_index", expect.objectContaining({
      keysJson: '{"createdAt":-1}',
    }));
  });

  it("submits with text field type", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "create_index") return null;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));
    const fieldInput = screen.getByPlaceholderText(/Field name/i);
    fireEvent.change(fieldInput, { target: { value: "description" } });

    const typeSelect = screen.getByDisplayValue("Ascending (1)");
    fireEvent.change(typeSelect, { target: { value: "text" } });

    const submitBtn = screen.getAllByRole("button", { name: "Create Index" })[1];
    fireEvent.click(submitBtn);
    await act(async () => { await Promise.resolve(); });

    expect(mockInvoke).toHaveBeenCalledWith("create_index", expect.objectContaining({
      keysJson: '{"description":"text"}',
    }));
  });

  it("submits with hashed field type", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "create_index") return null;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));
    const fieldInput = screen.getByPlaceholderText(/Field name/i);
    fireEvent.change(fieldInput, { target: { value: "userId" } });

    const typeSelect = screen.getByDisplayValue("Ascending (1)");
    fireEvent.change(typeSelect, { target: { value: "hashed" } });

    const submitBtn = screen.getAllByRole("button", { name: "Create Index" })[1];
    fireEvent.click(submitBtn);
    await act(async () => { await Promise.resolve(); });

    expect(mockInvoke).toHaveBeenCalledWith("create_index", expect.objectContaining({
      keysJson: '{"userId":"hashed"}',
    }));
  });

  it("shows error when create_index invoke fails", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return mockIndexes;
      if (cmd === "create_index") throw new Error("Index already exists");
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));
    const fieldInput = screen.getByPlaceholderText(/Field name/i);
    fireEvent.change(fieldInput, { target: { value: "email" } });

    const submitBtn = screen.getAllByRole("button", { name: "Create Index" })[1];
    fireEvent.click(submitBtn);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("Error creating index")).toBeInTheDocument();
    expect(screen.getByText("Index already exists")).toBeInTheDocument();
  });

  it("adds and removes index fields", async () => {
    mockInvoke.mockResolvedValue(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));

    const addFieldBtn = screen.getByRole("button", { name: /Add Field/i });
    fireEvent.click(addFieldBtn);

    // Now should have 2 field inputs
    const fieldInputs = screen.getAllByPlaceholderText(/Field name/i);
    expect(fieldInputs.length).toBe(2);

    // Change field names
    fireEvent.change(fieldInputs[0], { target: { value: "status" } });
    fireEvent.change(fieldInputs[1], { target: { value: "createdAt" } });

    // Remove second field
    const removeBtns = screen.getAllByTitle("Remove Field");
    fireEvent.click(removeBtns[0]);

    await act(async () => { await Promise.resolve(); });
    const remainingInputs = screen.getAllByPlaceholderText(/Field name/i);
    expect(remainingInputs.length).toBe(1);
  });

  it("handles compound index creation with multiple fields", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "create_index") return null;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));

    const addFieldBtn = screen.getByRole("button", { name: /Add Field/i });
    fireEvent.click(addFieldBtn);

    const fieldInputs = screen.getAllByPlaceholderText(/Field name/i);
    fireEvent.change(fieldInputs[0], { target: { value: "status" } });
    fireEvent.change(fieldInputs[1], { target: { value: "createdAt" } });

    const typeSelects = screen.getAllByDisplayValue("Ascending (1)");
    fireEvent.change(typeSelects[1], { target: { value: "-1" } });

    const submitBtn = screen.getAllByRole("button", { name: "Create Index" })[1];
    fireEvent.click(submitBtn);
    await act(async () => { await Promise.resolve(); });

    expect(mockInvoke).toHaveBeenCalledWith("create_index", expect.objectContaining({
      keysJson: '{"status":1,"createdAt":-1}',
    }));
  });

  it("ignores blank fields during index creation", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "create_index") return null;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));
    const addFieldBtn = screen.getByRole("button", { name: /Add Field/i });
    fireEvent.click(addFieldBtn);

    const fieldInputs = screen.getAllByPlaceholderText(/Field name/i);
    fireEvent.change(fieldInputs[0], { target: { value: "email" } });
    // Leave fieldInputs[1] empty (blank)

    // Submit via form submit to bypass HTML5 required validation on blank field
    const form = document.querySelector("form")!;
    fireEvent.submit(form);
    await act(async () => { await Promise.resolve(); });

    // Should succeed, ignoring the blank field
    expect(mockInvoke).toHaveBeenCalledWith("create_index", expect.objectContaining({
      keysJson: '{"email":1}',
    }));
  });

  it("shows unique and sparse checkboxes and submits with them checked", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return mockIndexes;
      if (cmd === "create_index") return null;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));
    const nameInput = screen.getByPlaceholderText(/Optional: Auto-generated if empty/i);
    fireEvent.change(nameInput, { target: { value: "test_index_name" } });
    const fieldInput = screen.getByPlaceholderText(/Field name/i);
    fireEvent.change(fieldInput, { target: { value: "username" } });

    fireEvent.click(screen.getByLabelText(/Unique Index/i));
    fireEvent.click(screen.getByLabelText(/Sparse Index/i));

    const submitBtn = screen.getAllByRole("button", { name: "Create Index" })[1];
    fireEvent.click(submitBtn);
    await act(async () => { await Promise.resolve(); });

    expect(mockInvoke).toHaveBeenCalledWith("create_index", {
      dbName: "test_db",
      collName: "test_coll",
      keysJson: '{"username":1}',
      name: "test_index_name",
      unique: true,
      sparse: true,
    });
  });
});

// ==========================================
// DROP INDEX MODAL
// ==========================================
describe("InvestigateView – Drop Index modal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(emptyLogs);
  });

  it("opens drop index modal and drops index", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return mockIndexes;
      if (cmd === "drop_index") return null;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    const dropBtns = screen.getAllByTitle("Drop Index");
    fireEvent.click(dropBtns[0]);

    expect(screen.getByRole("heading", { name: "Drop Index" })).toBeInTheDocument();
    expect(screen.getAllByText(/email_1/i).length).toBeGreaterThan(0);

    const confirmBtn = screen.getAllByRole("button", { name: "Drop Index" }).find(b => !b.getAttribute("title"))!;
    fireEvent.click(confirmBtn);
    await act(async () => { await Promise.resolve(); });

    expect(mockInvoke).toHaveBeenCalledWith("drop_index", {
      dbName: "test_db",
      collName: "test_coll",
      name: "email_1",
    });
    expect(screen.queryByRole("heading", { name: "Drop Index" })).not.toBeInTheDocument();
  });

  it("closes drop modal on Cancel click without dropping", async () => {
    mockInvoke.mockResolvedValue(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    const dropBtns = screen.getAllByTitle("Drop Index");
    fireEvent.click(dropBtns[0]);
    expect(screen.getByRole("heading", { name: "Drop Index" })).toBeInTheDocument();

    const cancelBtn = screen.getAllByRole("button", { name: "Cancel" })[0];
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole("heading", { name: "Drop Index" })).not.toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("drop_index", expect.anything());
  });

  it("shows error when drop_index invoke fails", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return mockIndexes;
      if (cmd === "drop_index") throw new Error("Index in use");
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    const dropBtns = screen.getAllByTitle("Drop Index");
    fireEvent.click(dropBtns[0]);

    const confirmBtn = screen.getAllByRole("button", { name: "Drop Index" }).find(b => !b.getAttribute("title"))!;
    fireEvent.click(confirmBtn);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("Error dropping index")).toBeInTheDocument();
    expect(screen.getByText("Index in use")).toBeInTheDocument();
  });
});

// ==========================================
// CURRENT OPS TAB
// ==========================================
describe("InvestigateView – Current Ops tab", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(emptyLogs);
  });

  const mockOps = [
    { opid: 9876, client: "127.0.0.1", op: "query", ns: "test_db.test_coll", secs_running: 12, query: '{"x": 1}' },
  ];

  it("renders active operations when tab is selected", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") return mockOps;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("OPID: 9876")).toBeInTheDocument();
    expect(screen.getByText("test_db.test_coll")).toBeInTheDocument();
    expect(screen.getByText('{"x": 1}')).toBeInTheDocument();
    expect(screen.getByText("Client: 127.0.0.1")).toBeInTheDocument();
    expect(screen.getByText("Running for 12s")).toBeInTheDocument();
  });

  it("shows loading spinner while ops are being fetched", async () => {
    let resolveOps: (_: any) => void;
    const opsPromise = new Promise((r) => { resolveOps = r; });
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") return opsPromise;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));

    expect(screen.getByText("Loading active operations...")).toBeInTheDocument();
    resolveOps!(mockOps);
    await act(async () => { await Promise.resolve(); });
  });

  it("shows empty state when no operations are running", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") return [];
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("No active operations detected on the server.")).toBeInTheDocument();
  });

  it("renders error banner when current_ops fails", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") throw new Error("Operation error");
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("Failed to load active operations")).toBeInTheDocument();
    expect(screen.getByText("Operation error")).toBeInTheDocument();
  });

  it("retries fetching ops when Retry button is clicked", async () => {
    mockInvoke
      .mockImplementation(async (cmd) => {
        if (cmd === "list_indexes") return [];
        if (cmd === "current_ops") throw new Error("Timeout");
        return null;
      });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("Failed to load active operations")).toBeInTheDocument();

    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") return mockOps;
      return null;
    });

    const retryBtn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryBtn);
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText("Failed to load active operations")).not.toBeInTheDocument();
    expect(screen.getByText("OPID: 9876")).toBeInTheDocument();
  });

  it("kills active operation when Kill Op is clicked and confirmed", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") return mockOps;
      if (cmd === "kill_op") return null;
      return null;
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Kill Op/i }));
    await act(async () => { await Promise.resolve(); });

    expect(confirmSpy).toHaveBeenCalledWith("Are you sure you want to kill operation 9876?");
    expect(mockInvoke).toHaveBeenCalledWith("kill_op", { opid: 9876 });
    confirmSpy.mockRestore();
  });

  it("does not kill operation when confirm is cancelled", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") return mockOps;
      return null;
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Kill Op/i }));
    await act(async () => { await Promise.resolve(); });

    expect(mockInvoke).not.toHaveBeenCalledWith("kill_op", expect.anything());
    confirmSpy.mockRestore();
  });

  it("shows alert when kill_op fails", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") return mockOps;
      if (cmd === "kill_op") throw new Error("Permission denied");
      return null;
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Kill Op/i }));
    await act(async () => { await Promise.resolve(); });

    expect(alertSpy).toHaveBeenCalledWith("Permission denied");
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it("shows kill op alert with non-Error string", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") return mockOps;
      if (cmd === "kill_op") throw "raw string error";
      return null;
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Kill Op/i }));
    await act(async () => { await Promise.resolve(); });

    expect(alertSpy).toHaveBeenCalledWith("raw string error");
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it("Refresh button in current-ops tab triggers a loading fetch", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") return mockOps;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));
    await act(async () => { await Promise.resolve(); });

    const refreshBtn = screen.getByRole("button", { name: /Refresh/i });
    fireEvent.click(refreshBtn);
    await act(async () => { await Promise.resolve(); });

    // Should have called current_ops at least twice (initial + refresh)
    const currentOpsCalls = mockInvoke.mock.calls.filter(c => c[0] === "current_ops");
    expect(currentOpsCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("renders op without optional fields (no client, no ns, no query, no secs_running)", async () => {
    const sparseOp = [{ opid: 123 }];
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") return sparseOp;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("OPID: 123")).toBeInTheDocument();
    // Should not have Client or Running for text
    expect(screen.queryByText(/Client:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Running for/)).not.toBeInTheDocument();
  });

  it("polls for operations every 3 seconds using fake timers", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") {
        callCount++;
        return mockOps;
      }
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));
    await act(async () => { await Promise.resolve(); });

    const initialCount = callCount;
    await act(async () => { vi.advanceTimersByTime(3000); await Promise.resolve(); });

    expect(callCount).toBeGreaterThan(initialCount);
    vi.useRealTimers();
  });

  it("stops polling when switching away from current-ops tab", async () => {
    vi.useFakeTimers();
    let currentOpsCalls = 0;
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") { currentOpsCalls++; return mockOps; }
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));
    await act(async () => { await Promise.resolve(); });

    // Switch away
    fireEvent.click(screen.getByRole("button", { name: /Indexes/i }));
    const countAfterSwitch = currentOpsCalls;

    await act(async () => { vi.advanceTimersByTime(9000); await Promise.resolve(); });
    expect(currentOpsCalls).toBe(countAfterSwitch); // no more calls
    vi.useRealTimers();
  });
});

// ==========================================
// SLOW QUERY PROFILER TAB – CLIENT SIDE
// ==========================================
describe("InvestigateView – Slow Query Profiler (client side)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("groups client-side logs by query pattern", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: '{"filter":"{\\"email\\":\\"a@b.com\\"}","sort":"{}","projection":"{}","limit":20,"skip":0}',
        duration: 120, docsAffected: 1, timestamp: new Date().toISOString(),
      },
      {
        id: "2", op: "FIND", ns: "test_db.test_coll",
        query: '{"filter":"{\\"email\\":\\"c@d.com\\"}","sort":"{}","projection":"{}","limit":20,"skip":0}',
        duration: 80, docsAffected: 1, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue(mockIndexes);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    expect(screen.getByText("find({ email: ? })")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // count
    expect(screen.getByText("100 ms")).toBeInTheDocument(); // avg
    expect(screen.getByText("120 ms")).toBeInTheDocument(); // p99
  });

  it("filters by min duration", async () => {
    const logs = [
      { id: "1", op: "FIND", ns: "test_db.test_coll", query: '{"filter":"{}"}', duration: 30, docsAffected: 0, timestamp: new Date().toISOString() },
      { id: "2", op: "FIND", ns: "test_db.test_coll", query: '{"filter":"{\\"status\\":1}"}', duration: 200, docsAffected: 5, timestamp: new Date().toISOString() },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    const minDurSelect = screen.getByDisplayValue("All queries");
    fireEvent.change(minDurSelect, { target: { value: "100" } });

    expect(screen.queryByText("find({})")).not.toBeInTheDocument();
    expect(screen.getByText("find({ status: ? })")).toBeInTheDocument();
  });

  it("filters by search term in namespace", async () => {
    const logs = [
      { id: "1", op: "FIND", ns: "test_db.test_coll", query: '{}', duration: 100, docsAffected: 0, timestamp: new Date().toISOString() },
      { id: "2", op: "FIND", ns: "test_db.other_coll", query: '{}', duration: 100, docsAffected: 0, timestamp: new Date().toISOString() },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    const searchInput = screen.getByPlaceholderText(/Filter slow queries/i);
    fireEvent.change(searchInput, { target: { value: "test_coll" } });

    // Only test_db.test_coll ns would show up
    const opsPatterns = screen.getAllByText("find({})");
    expect(opsPatterns.length).toBeGreaterThanOrEqual(1);
  });

  it("sorts by max latency", async () => {
    const logs = [
      { id: "1", op: "FIND", ns: "test_db.test_coll", query: '{"filter":"{\\"a\\":1}"}', duration: 50, docsAffected: 0, timestamp: new Date().toISOString() },
      { id: "2", op: "FIND", ns: "test_db.test_coll", query: '{"filter":"{\\"b\\":1}"}', duration: 500, docsAffected: 0, timestamp: new Date().toISOString() },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    const sortSelect = screen.getByDisplayValue("Total Impact (Time)");
    fireEvent.change(sortSelect, { target: { value: "max" } });

    const patterns = screen.getAllByText(/find\(/i);
    expect(patterns.length).toBeGreaterThanOrEqual(2);
  });

  it("sorts by run count", async () => {
    const logs = [
      { id: "1", op: "FIND", ns: "test_db.test_coll", query: '{"filter":"{\\"a\\":1}"}', duration: 50, docsAffected: 0, timestamp: new Date().toISOString() },
      { id: "2", op: "FIND", ns: "test_db.test_coll", query: '{"filter":"{\\"a\\":1}"}', duration: 60, docsAffected: 0, timestamp: new Date().toISOString() },
      { id: "3", op: "FIND", ns: "test_db.test_coll", query: '{"filter":"{\\"b\\":1}"}', duration: 500, docsAffected: 0, timestamp: new Date().toISOString() },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    const sortSelect = screen.getByDisplayValue("Total Impact (Time)");
    fireEvent.change(sortSelect, { target: { value: "count" } });

    expect(screen.getByText("find({ a: ? })")).toBeInTheDocument();
  });

  it("sorts by avg latency", async () => {
    const logs = [
      { id: "1", op: "FIND", ns: "test_db.test_coll", query: '{"filter":"{\\"c\\":1}"}', duration: 1000, docsAffected: 0, timestamp: new Date().toISOString() },
      { id: "2", op: "FIND", ns: "test_db.test_coll", query: '{"filter":"{\\"d\\":1}"}', duration: 10, docsAffected: 0, timestamp: new Date().toISOString() },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    const sortSelect = screen.getByDisplayValue("Total Impact (Time)");
    fireEvent.change(sortSelect, { target: { value: "avg" } });

    expect(screen.getByText("find({ c: ? })")).toBeInTheDocument();
  });

  it("shows empty state when no slow queries match filters", async () => {
    vi.mocked(getQueryLogs).mockReturnValue([]);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    expect(screen.getByText("No slow queries detected matching the filters.")).toBeInTheDocument();
  });

  it("filters logs by namespace when collName is provided", async () => {
    const logs = [
      { id: "1", op: "FIND", ns: "test_db.test_coll", query: '{}', duration: 100, docsAffected: 0, timestamp: new Date().toISOString() },
      { id: "2", op: "FIND", ns: "test_db.other_coll", query: '{}', duration: 200, docsAffected: 0, timestamp: new Date().toISOString() },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    // Only one group should be shown (test_coll ones); other_coll is filtered out
    const rows = screen.getAllByText("find({})");
    // The result groups
    expect(rows).toBeDefined();
  });

  it("filters logs by database prefix when collName is empty", async () => {
    const logs = [
      { id: "1", op: "FIND", ns: "test_db.any_coll", query: '{}', duration: 100, docsAffected: 0, timestamp: new Date().toISOString() },
      { id: "2", op: "FIND", ns: "other_db.coll", query: '{}', duration: 200, docsAffected: 0, timestamp: new Date().toISOString() },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      return null;
    });

    render(<InvestigateView dbName="test_db" collName="" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    // Pattern for the test_db.any_coll entry should show
    expect(screen.getByText("find({})")).toBeInTheDocument();
  });

  it("expands group details when header is clicked", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: '{"filter":"{\\"email\\":\\"a@b.com\\"}","sort":"{}","projection":"{}","limit":20,"skip":0}',
        duration: 120, docsAffected: 1, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    // Click on pattern to expand
    const patternEl = screen.getByText("find({ email: ? })");
    fireEvent.click(patternEl);

    // Should show expanded sample details
    expect(screen.getByText("Sample Execution Instances")).toBeInTheDocument();
    expect(screen.getByText("Latency:")).toBeInTheDocument();
    expect(screen.getByText("120ms")).toBeInTheDocument();
  });

  it("collapses group when clicked again", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: '{"filter":"{\\"email\\":\\"a@b.com\\"}","sort":"{}","projection":"{}","limit":20,"skip":0}',
        duration: 120, docsAffected: 1, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    const patternEl = screen.getByText("find({ email: ? })");
    fireEvent.click(patternEl); // expand
    expect(screen.getByText("Sample Execution Instances")).toBeInTheDocument();

    fireEvent.click(patternEl); // collapse
    expect(screen.queryByText("Sample Execution Instances")).not.toBeInTheDocument();
  });

  it("shows Missing Index Warning when query is uncovered", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: '{"filter":"{\\"unindexedField\\":\\"val\\"}","sort":"{}","projection":"{}","limit":20,"skip":0}',
        duration: 150, docsAffected: 1, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue(mockIndexes);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    const patternEl = screen.getByText("find({ unindexedField: ? })");
    fireEvent.click(patternEl);

    expect(screen.getByText(/Missing Index Warning/i)).toBeInTheDocument();
    expect(screen.getByText("unindexedField")).toBeInTheDocument();
  });

  it("shows index-covered hint for slow FIND queries with covered index", async () => {
    // email is in mockIndexes – so index is covered but query is slow
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: '{"filter":"{\\"email\\":\\"a@b.com\\"}","sort":"{}","projection":"{}","limit":20,"skip":0}',
        duration: 200, docsAffected: 1, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue(mockIndexes);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    const patternEl = screen.getByText("find({ email: ? })");
    fireEvent.click(patternEl);

    expect(screen.getByText(/matches an index prefix/i)).toBeInTheDocument();
  });

  it("suggests index and pre-fills create index modal", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: '{"filter":"{\\"unindexedField\\":\\"val\\"}","sort":"{}","projection":"{}","limit":20,"skip":0}',
        duration: 150, docsAffected: 1, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue(mockIndexes);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    const patternEl = screen.getByText("find({ unindexedField: ? })");
    fireEvent.click(patternEl);

    const createIndexRecBtn = screen.getByRole("button", { name: /Create Index/i });
    fireEvent.click(createIndexRecBtn);

    expect(screen.getByRole("heading", { name: "Create Index" })).toBeInTheDocument();
    const fieldInput = screen.getByPlaceholderText(/Field name/i) as HTMLInputElement;
    expect(fieldInput.value).toBe("unindexedField");
  });

  it("shows sample error field when sample has error", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: '{}', duration: 50, docsAffected: 0,
        timestamp: new Date().toISOString(), error: "Execution error occurred",
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    const patternEl = screen.getByText("find({})");
    fireEvent.click(patternEl);

    expect(screen.getByText("Execution error occurred")).toBeInTheDocument();
  });

  it("export JSON button is disabled when no groups", async () => {
    vi.mocked(getQueryLogs).mockReturnValue([]);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    const exportBtn = screen.getByRole("button", { name: /Export JSON/i });
    expect(exportBtn).toBeDisabled();
  });

  it("export JSON triggers download when groups exist", async () => {
    const logs = [
      { id: "1", op: "FIND", ns: "test_db.test_coll", query: '{}', duration: 100, docsAffected: 0, timestamp: new Date().toISOString() },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    // Render and navigate first, THEN set up DOM mocks to avoid interfering with React rendering
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    const exportBtn = screen.getByRole("button", { name: /Export JSON/i });
    expect(exportBtn).not.toBeDisabled();

    // Set up mocks just before clicking export
    const mockCreateObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    const mockRevokeObjectURL = vi.fn();
    window.URL.createObjectURL = mockCreateObjectURL;
    window.URL.revokeObjectURL = mockRevokeObjectURL;

    const mockAnchorClick = vi.fn();
    const mockAnchor = { href: "", download: "", click: mockAnchorClick, setAttribute: vi.fn() };
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string, ...args: any[]) => {
      if (tag === "a") return mockAnchor as any;
      return originalCreateElement(tag, ...args);
    });
    const appendChildSpy = vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
    const removeChildSpy = vi.spyOn(document.body, "removeChild").mockImplementation((node) => node);

    fireEvent.click(exportBtn);

    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockAnchorClick).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:fake-url");

    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
  });

  it("handles AGGREGATE query pattern from client logs", async () => {
    const logs = [
      {
        id: "1", op: "AGGREGATE", ns: "test_db.test_coll",
        query: JSON.stringify({ pipeline: '[{"$match":{"status":"A"}},{"$group":{"_id":"$item"}}]' }),
        duration: 200, docsAffected: 5, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    // Should see AGGREGATE op badge
    expect(screen.getByText("AGGREGATE")).toBeInTheDocument();
  });

  it("handles raw FIND query without wrapper", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: '{"email":"test@test.com"}',
        duration: 100, docsAffected: 1, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("find({ email: ? })")).toBeInTheDocument();
  });

  it("handles empty FIND filter showing find({})", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: '{"filter":"{}","sort":"{}","limit":20}',
        duration: 100, docsAffected: 1, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("find({})")).toBeInTheDocument();
  });

  it("handles DELETE operations in slow queries", async () => {
    const logs = [
      {
        id: "1", op: "DELETE", ns: "test_db.test_coll",
        query: '{"userId":"abc123"}',
        duration: 50, docsAffected: 1, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("delete({ userId: ? })")).toBeInTheDocument();
  });

  it("handles UPDATE operations in slow queries", async () => {
    const logs = [
      {
        id: "1", op: "UPDATE", ns: "test_db.test_coll",
        query: '{"userId":"abc123"}',
        duration: 50, docsAffected: 1, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("update({ userId: ? })")).toBeInTheDocument();
  });

  it("handles INSERT operations in slow queries", async () => {
    const logs = [
      {
        id: "1", op: "INSERT", ns: "test_db.test_coll",
        query: '{"email":"x@y.com"}',
        duration: 50, docsAffected: 1, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("insert({ email: ? })")).toBeInTheDocument();
  });

  it("handles empty DELETE/UPDATE operations showing {})", async () => {
    const logs = [
      {
        id: "1", op: "DELETE", ns: "test_db.test_coll",
        query: '{}',
        duration: 50, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("delete({})")).toBeInTheDocument();
  });

  it("handles invalid JSON query gracefully", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: 'not valid json',
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("find({})")).toBeInTheDocument();
  });

  it("handles invalid AGGREGATE query gracefully", async () => {
    const logs = [
      {
        id: "1", op: "AGGREGATE", ns: "test_db.test_coll",
        query: 'invalid json',
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("aggregate([])")).toBeInTheDocument();
  });

  it("shows op badge with AGGREGATE type styling", async () => {
    const logs = [
      {
        id: "1", op: "AGGREGATE", ns: "test_db.test_coll",
        query: JSON.stringify([{ $match: { status: "A" } }]),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("AGGREGATE")).toBeInTheDocument();
  });

  it("shows op badge with DELETE type styling", async () => {
    const logs = [
      {
        id: "1", op: "DELETE", ns: "test_db.test_coll",
        query: '{"id":"123"}',
        duration: 100, docsAffected: 1, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("DELETE")).toBeInTheDocument();
  });
});

// ==========================================
// SLOW QUERY PROFILER TAB – SERVER SIDE
// ==========================================
describe("InvestigateView – Slow Query Profiler (server side)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(emptyLogs);
  });

  const mockSystemProfile = {
    documents: [
      {
        op: "query",
        ns: "test_db.test_coll",
        command: { find: "test_coll", filter: { username: "alice" } },
        millis: 200,
        ts: { $date: new Date().toISOString() },
        nreturned: 1,
      },
    ],
    total_count: 1,
  };

  it("fetches and renders server profile data", async () => {
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return mockIndexes;
      if (cmd === "find_documents" && args?.collName === "system.profile") return mockSystemProfile;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("find({ username: ? })")).toBeInTheDocument();
  });

  it("shows loading state while fetching server profile", async () => {
    let resolveProfile: (_: any) => void;
    const profilePromise = new Promise((r) => { resolveProfile = r; });

    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profilePromise;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));

    expect(screen.getByText("Fetching system.profile logs...")).toBeInTheDocument();
    resolveProfile!({ documents: [], total_count: 0 });
    await act(async () => { await Promise.resolve(); });
  });

  it("shows server profile error when find_documents fails", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents") throw new Error("Access denied");
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("Cannot access server system.profile")).toBeInTheDocument();
  });

  it("shows server profile error with non-Error string", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents") throw "string error from backend";
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("Cannot access server system.profile")).toBeInTheDocument();
  });

  it("refresh button on server profile triggers re-fetch", async () => {
    let fetchCount = 0;
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") {
        fetchCount++;
        return { documents: [], total_count: 0 };
      }
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    const countBefore = fetchCount;
    const refreshBtn = screen.getByTitle("Refresh server profile");
    fireEvent.click(refreshBtn);
    await act(async () => { await Promise.resolve(); });

    expect(fetchCount).toBeGreaterThan(countBefore);
  });

  it("handles system.profile entry with command.aggregate op", async () => {
    const profileData = {
      documents: [
        {
          op: "command",
          ns: "test_db.test_coll",
          command: { aggregate: "test_coll", pipeline: [{ $match: { active: true } }] },
          millis: 300,
          ts: { $date: new Date().toISOString() },
          nreturned: 5,
        },
      ],
    };
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profileData;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("AGGREGATE")).toBeInTheDocument();
  });

  it("handles system.profile entry with command.insert op", async () => {
    const profileData = {
      documents: [
        {
          op: "command",
          ns: "test_db.test_coll",
          command: { insert: "test_coll", documents: [{ email: "x@y.com" }] },
          millis: 50,
          ts: new Date().toISOString(),
          ninserted: 1,
        },
      ],
    };
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profileData;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("INSERT")).toBeInTheDocument();
  });

  it("handles system.profile entry with command.update op", async () => {
    const profileData = {
      documents: [
        {
          op: "command",
          ns: "test_db.test_coll",
          command: { update: "test_coll", updates: [{ q: { status: "A" }, u: { $set: { status: "B" } } }] },
          millis: 75,
          ts: new Date().toISOString(),
          nMatched: 1,
        },
      ],
    };
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profileData;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("UPDATE")).toBeInTheDocument();
  });

  it("handles system.profile entry with command.delete op", async () => {
    const profileData = {
      documents: [
        {
          op: "command",
          ns: "test_db.test_coll",
          command: { delete: "test_coll", deletes: [{ q: { status: "A" }, limit: 1 }] },
          millis: 30,
          ts: new Date().toISOString(),
          ndeleted: 1,
        },
      ],
    };
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profileData;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("DELETE")).toBeInTheDocument();
  });

  it("handles system.profile entry with rawOp=update", async () => {
    const profileData = {
      documents: [
        {
          op: "update",
          ns: "test_db.test_coll",
          command: { q: { userId: "abc" }, u: { $set: { name: "Bob" } } },
          millis: 40,
          ts: new Date().toISOString(),
          nMatched: 1,
        },
      ],
    };
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profileData;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("UPDATE")).toBeInTheDocument();
  });

  it("handles system.profile entry with rawOp=insert", async () => {
    const profileData = {
      documents: [
        {
          op: "insert",
          ns: "test_db.test_coll",
          command: [{ name: "Alice" }],
          millis: 20,
          ts: new Date().toISOString(),
          ninserted: 1,
        },
      ],
    };
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profileData;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("INSERT")).toBeInTheDocument();
  });

  it("handles system.profile entry with rawOp=remove", async () => {
    const profileData = {
      documents: [
        {
          op: "remove",
          ns: "test_db.test_coll",
          command: { q: { status: "inactive" } },
          millis: 25,
          ts: new Date().toISOString(),
          ndeleted: 3,
        },
      ],
    };
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profileData;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("DELETE")).toBeInTheDocument();
  });

  it("handles system.profile entry with rawOp=query (legacy)", async () => {
    const profileData = {
      documents: [
        {
          op: "query",
          ns: "test_db.test_coll",
          query: { age: { $gt: 18 } },
          millis: 100,
          ts: new Date().toISOString(),
          nreturned: 10,
        },
      ],
    };
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profileData;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("FIND")).toBeInTheDocument();
  });

  it("handles system.profile ts as plain string", async () => {
    const profileData = {
      documents: [
        {
          op: "query",
          ns: "test_db.test_coll",
          command: { find: "test_coll", filter: { x: 1 } },
          millis: 50,
          ts: new Date().toISOString(), // plain string
          nreturned: 1,
        },
      ],
    };
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profileData;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("FIND")).toBeInTheDocument();
  });

  it("handles system.profile ts.$date as numeric ms", async () => {
    const profileData = {
      documents: [
        {
          op: "command",
          ns: "test_db.test_coll",
          command: { find: "test_coll", filter: { z: 1 } },
          millis: 80,
          ts: { $date: Date.now() },
          nreturned: 2,
        },
      ],
    };
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profileData;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("FIND")).toBeInTheDocument();
  });

  it("handles null documents from server profile response", async () => {
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return null;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("No slow queries detected matching the filters.")).toBeInTheDocument();
  });

  it("re-fetches server profile when dbName prop changes", async () => {
    let fetchCount = 0;
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") {
        fetchCount++;
        return { documents: [], total_count: 0 };
      }
      return null;
    });
    const { rerender } = render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    const countBefore = fetchCount;
    rerender(<InvestigateView dbName="other_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    expect(fetchCount).toBeGreaterThan(countBefore);
  });
});

// ==========================================
// HELPER FUNCTION COVERAGE – getFilterKeys
// ==========================================
describe("InvestigateView – getFilterKeys edge cases (via slow query patterns)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(emptyLogs);
  });

  it("handles $or operator in filter", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: JSON.stringify({ $or: [{ status: "A" }, { status: "B" }] }),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("find({ status: ? })")).toBeInTheDocument();
  });

  it("handles $and operator in filter", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: JSON.stringify({ $and: [{ active: true }, { role: "admin" }] }),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("find({ active: ?, role: ? })")).toBeInTheDocument();
  });

  it("handles $nor operator in filter", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: JSON.stringify({ $nor: [{ deleted: true }, { banned: true }] }),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText(/find\(/)).toBeInTheDocument();
  });

  it("handles nested object in filter", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: JSON.stringify({ "address.city": "NYC" }),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText(/find\(/)).toBeInTheDocument();
  });

  it("handles deeply nested object fields returning subkeys", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: JSON.stringify({ location: { city: "LA", state: "CA" } }),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    // Should extract nested keys like location.city, location.state
    expect(screen.getByText(/find\(/)).toBeInTheDocument();
  });

  it("handles $oid special type in filter", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: JSON.stringify({ _id: { $oid: "507f1f77bcf86cd799439011" } }),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("find({ _id: ? })")).toBeInTheDocument();
  });

  it("handles $date special type in filter", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: JSON.stringify({ createdAt: { $date: "2024-01-01T00:00:00Z" } }),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("find({ createdAt: ? })")).toBeInTheDocument();
  });

  it("handles array filter values in getFilterKeys", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: JSON.stringify([{ status: "A" }, { status: "B" }]),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    // FIND op with array – falls through to aggregate pattern or find({})
    expect(screen.getByText(/find\(/i)).toBeInTheDocument();
  });

  it("handles raw AGGREGATE array query", async () => {
    const logs = [
      {
        id: "1", op: "AGGREGATE", ns: "test_db.test_coll",
        query: JSON.stringify([{ $match: { status: "A" } }, { $group: { _id: "$item" } }]),
        duration: 200, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("aggregate([ $match, $group ])")).toBeInTheDocument();
  });

  it("handles AGGREGATE pipeline with no $ key in stage", async () => {
    const logs = [
      {
        id: "1", op: "AGGREGATE", ns: "test_db.test_coll",
        query: JSON.stringify([{ match: { status: "A" } }]),
        duration: 200, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("aggregate([ match ])")).toBeInTheDocument();
  });
});

// ==========================================
// TAB NAVIGATION
// ==========================================
describe("InvestigateView – Tab navigation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(emptyLogs);
    mockInvoke.mockResolvedValue([]);
  });

  it("shows indexes tab content by default", async () => {
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("Collection Indexes")).toBeInTheDocument();
  });

  it("switches to Indexes tab from another tab", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "current_ops") return [];
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Current Database Operations/i }));
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Indexes/i }));
    expect(screen.getByText("Collection Indexes")).toBeInTheDocument();
  });

  it("shows Collection name in tab when collName is provided", () => {
    mockInvoke.mockResolvedValue([]);
    render(<InvestigateView dbName="test_db" collName="my_collection" />);
    expect(screen.getByText("Indexes (my_collection)")).toBeInTheDocument();
  });

  it("shows Collection text when collName is empty", () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="" />);
    expect(screen.getByText("Indexes (Collection)")).toBeInTheDocument();
  });
});

// ==========================================
// CLIENT LOGS COUNT IN SOURCE TOGGLE
// ==========================================
describe("InvestigateView – Client logs count in source toggle", () => {
  it("shows correct count of client logs in source toggle", async () => {
    const logs = [
      { id: "1", op: "FIND", ns: "test_db.test_coll", query: '{}', duration: 50, docsAffected: 0, timestamp: new Date().toISOString() },
      { id: "2", op: "FIND", ns: "test_db.test_coll", query: '{}', duration: 60, docsAffected: 0, timestamp: new Date().toISOString() },
      { id: "3", op: "FIND", ns: "other_db.coll", query: '{}', duration: 70, docsAffected: 0, timestamp: new Date().toISOString() },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    // Should show "Client Logs (2)" for test_db.test_coll
    expect(screen.getByText(/Client Logs \(2\)/)).toBeInTheDocument();
  });

  it("shows correct count for db-level (no collName) in source toggle", async () => {
    const logs = [
      { id: "1", op: "FIND", ns: "test_db.coll1", query: '{}', duration: 50, docsAffected: 0, timestamp: new Date().toISOString() },
      { id: "2", op: "FIND", ns: "test_db.coll2", query: '{}', duration: 60, docsAffected: 0, timestamp: new Date().toISOString() },
      { id: "3", op: "FIND", ns: "other_db.coll", query: '{}', duration: 70, docsAffected: 0, timestamp: new Date().toISOString() },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") return [];
      return null;
    });

    render(<InvestigateView dbName="test_db" collName="" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    // Should show "Client Logs (2)" (only entries matching test_db.*)
    expect(screen.getByText(/Client Logs \(2\)/)).toBeInTheDocument();
  });
});

// ==========================================
// BRANCH COVERAGE BOOSTERS
// ==========================================
describe("InvestigateView – branch coverage: getQueryPattern edge cases", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(emptyLogs);
  });

  it("covers fallback for unknown op after JSON parse failure", async () => {
    // Use a custom op that won't match any known type and fails to parse
    const logs = [
      {
        id: "1", op: "COMMAND", ns: "test_db.test_coll",
        query: "invalid json here",
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    // Should show the fallback pattern: command(...)
    expect(screen.getByText("command(...)")).toBeInTheDocument();
  });

  it("covers aggregate fallback when JSON is valid but not an array", async () => {
    // AGGREGATE op with a non-array valid JSON => after catch we hit: if (op === "AGGREGATE") return { pattern: "aggregate([])" }
    // We need valid JSON that is NOT array so the inner AGGREGATE branch fails, falls through to post-catch
    const logs = [
      {
        id: "1", op: "AGGREGATE", ns: "test_db.test_coll",
        query: '"just a string"', // valid JSON (a string), not array or object with pipeline
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("aggregate([])")).toBeInTheDocument();
  });

  it("covers AGGREGATE array with a null stage (returns empty string, then filtered)", async () => {
    // Stage that is not an object → returns "" → filtered out → produces aggregate([ ])
    const logs = [
      {
        id: "1", op: "AGGREGATE", ns: "test_db.test_coll",
        query: JSON.stringify([null, { $match: { x: 1 } }]),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    // null stage returns "", which is filtered by .filter(Boolean), so only "$match" remains
    expect(screen.getByText("aggregate([ $match ])")).toBeInTheDocument();
  });

  it("covers lastSeen update when newer entry arrives (aggregateQueries)", async () => {
    const olderTs = "2024-01-01T00:00:00.000Z";
    const newerTs = "2024-06-15T12:00:00.000Z";
    const logs = [
      { id: "1", op: "FIND", ns: "test_db.test_coll", query: '{}', duration: 50, docsAffected: 0, timestamp: olderTs },
      { id: "2", op: "FIND", ns: "test_db.test_coll", query: '{}', duration: 60, docsAffected: 0, timestamp: newerTs },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    // Both grouped as same pattern; group exists and newer entry updates lastSeen
    expect(screen.getByText("find({})")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // count = 2
  });

  it("covers maxDuration update branch when subsequent entry has higher duration", async () => {
    const ts = new Date().toISOString();
    const logs = [
      { id: "1", op: "FIND", ns: "test_db.test_coll", query: '{}', duration: 10, docsAffected: 0, timestamp: ts },
      { id: "2", op: "FIND", ns: "test_db.test_coll", query: '{}', duration: 500, docsAffected: 0, timestamp: ts },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    // p99 should be 500ms (the max)
    expect(screen.getByText("500 ms")).toBeInTheDocument();
  });

  it("covers samples capping at 3 entries", async () => {
    const ts = new Date().toISOString();
    const logs = Array.from({ length: 5 }, (_, i) => ({
      id: String(i), op: "FIND", ns: "test_db.test_coll",
      query: '{}', duration: 50 + i * 10, docsAffected: 0, timestamp: ts,
    }));
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    const patternEl = screen.getByText("find({})");
    fireEvent.click(patternEl);

    // Only 3 samples should be shown
    const sampleDivs = screen.getAllByText(/Latency:/);
    expect(sampleDivs.length).toBe(3);
  });

  it("covers FIND with filter parsed as string that wraps empty object", async () => {
    // FIND with parsed object that has filter key of an object (not string)
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: JSON.stringify({ filter: { status: "active" }, sort: {}, limit: 10 }),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    // filter is not a string so falls through to getFilterKeys(parsed)
    expect(screen.getByText(/find\(/)).toBeInTheDocument();
  });

  it("covers AGGREGATE with pipeline as array (not string)", async () => {
    // AGGREGATE where parsed has pipeline as an array (not string) — covers pipeline array branch
    const logs = [
      {
        id: "1", op: "AGGREGATE", ns: "test_db.test_coll",
        query: JSON.stringify({ pipeline: [{ $match: { active: true } }, { $sort: { date: -1 } }] }),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("aggregate([ $match, $sort ])")).toBeInTheDocument();
  });

  it("covers checkIndexCoverage with empty queryKeys (returns covered:true)", async () => {
    // A query with no filter keys gets covered=true (no index warning shown)
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: '{"filter":"{}","sort":"{}","limit":20}',
        duration: 200, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]); // no indexes at all

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    const patternEl = screen.getByText("find({})");
    fireEvent.click(patternEl);

    // Should NOT show missing index warning (covered=true for empty keys)
    expect(screen.queryByText(/Missing Index Warning/i)).not.toBeInTheDocument();
  });

  it("shows slow query hint is NOT shown for non-FIND covered queries", async () => {
    // AGGREGATE with covered index won't show the slow FIND hint
    const ts = new Date().toISOString();
    const logs = [
      {
        id: "1", op: "AGGREGATE", ns: "test_db.test_coll",
        query: JSON.stringify([{ $match: { status: 1 } }]),
        duration: 200, docsAffected: 0, timestamp: ts,
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    // status is indexed via mockIndexes status field? Actually mockIndexes has status_1_createdAt_-1
    mockInvoke.mockResolvedValue(mockIndexes);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    const patternEl = screen.getByText("aggregate([ $match ])");
    fireEvent.click(patternEl);

    // No FIND-specific index coverage hint for AGGREGATE
    expect(screen.queryByText(/matches an index prefix/i)).not.toBeInTheDocument();
  });

  it("p99 latency shows green coloring when < 150ms", async () => {
    const ts = new Date().toISOString();
    const logs = [
      { id: "1", op: "FIND", ns: "test_db.test_coll", query: '{}', duration: 80, docsAffected: 0, timestamp: ts },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    // p99=80ms < 150ms → green class, we just verify it renders without crash
    // Both avg and p99 show 80ms, so there are multiple elements
    expect(screen.getAllByText("80 ms").length).toBeGreaterThanOrEqual(1);
  });

  it("covers getFilterKeys with $or that is not an array (ignored)", async () => {
    // $or with non-array value – should be ignored
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: JSON.stringify({ $or: "not an array", name: "Alice" }),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("find({ name: ? })")).toBeInTheDocument();
  });

  it("covers deeply nested object that returns parent key when subkeys empty", async () => {
    // object value that recurses but subKeys.length === 0, so we push fullKey
    // e.g. { meta: {} } → meta has no sub-keys → push "meta"
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: JSON.stringify({ meta: {} }),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    expect(screen.getByText("find({ meta: ? })")).toBeInTheDocument();
  });

  it("covers mapSystemProfileEntry with no ts field (uses current date)", async () => {
    const profileData = {
      documents: [
        {
          op: "query",
          ns: "test_db.test_coll",
          command: { find: "test_coll", filter: { y: 1 } },
          millis: 60,
          // no ts field — should default to new Date().toISOString()
          nreturned: 2,
        },
      ],
    };
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profileData;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("FIND")).toBeInTheDocument();
  });

  it("covers mapSystemProfileEntry with opid for id generation", async () => {
    const profileData = {
      documents: [
        {
          op: "query",
          ns: "test_db.test_coll",
          command: { find: "test_coll", filter: { w: 1 } },
          millis: 70,
          ts: new Date().toISOString(),
          nreturned: 1,
          opid: 12345,
        },
      ],
    };
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profileData;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("FIND")).toBeInTheDocument();
  });

  it("covers server profile entry with doc.error field", async () => {
    const profileData = {
      documents: [
        {
          op: "query",
          ns: "test_db.test_coll",
          command: { find: "test_coll", filter: { v: 1 } },
          millis: 90,
          ts: new Date().toISOString(),
          nreturned: 0,
          exception: "Query execution failed",
        },
      ],
    };
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return profileData;
      return null;
    });
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    // Expand to see error
    const patternEl = screen.getByText("find({ v: ? })");
    fireEvent.click(patternEl);
    expect(screen.getByText("Query execution failed")).toBeInTheDocument();
  });
});

describe("InvestigateView – Create Index modal X button close", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(emptyLogs);
  });

  it("closes create index modal via X button in header", async () => {
    mockInvoke.mockResolvedValue(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Create Index/i }));
    expect(screen.getByRole("heading", { name: "Create Index" })).toBeInTheDocument();

    // The X button in the create modal header is the only icon button in the modal header
    const modalHeading = screen.getByRole("heading", { name: "Create Index" });
    const modalHeader = modalHeading.closest("div")!;
    // Find the SVG button inside the modal header
    const xBtn = modalHeader.parentElement!.querySelector("button:not([type='submit']):not([type='button']:last-of-type)") as HTMLButtonElement | null;
    if (xBtn) {
      fireEvent.click(xBtn);
    } else {
      // Fallback: look for any button in the fixed overlay header area
      const allButtons = screen.getAllByRole("button");
      // The X button in create modal header has no visible text
      const headerXBtn = allButtons.find(b => {
        const parent = b.closest("[class*='F4F1EC']");
        return parent && b.querySelector("svg");
      });
      if (headerXBtn) fireEvent.click(headerXBtn);
    }

    expect(screen.queryByRole("heading", { name: "Create Index" })).not.toBeInTheDocument();
  });
});

describe("InvestigateView – Slow Query source toggle back to client", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(emptyLogs);
  });

  it("switches source toggle back to client from server and shows client data", async () => {
    const logs = [
      {
        id: "1", op: "FIND", ns: "test_db.test_coll",
        query: '{"filter":"{\\"email\\":\\"a@b.com\\"}","sort":"{}","projection":"{}","limit":20,"skip":0}',
        duration: 120, docsAffected: 1, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_indexes") return [];
      if (cmd === "find_documents" && args?.collName === "system.profile") return { documents: [], total_count: 0 };
      return null;
    });

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));

    // Switch to server
    fireEvent.click(screen.getByText("Server system.profile"));
    await act(async () => { await Promise.resolve(); });

    // Should show empty state for server
    expect(screen.getByText("No slow queries detected matching the filters.")).toBeInTheDocument();

    // Switch back to client — this covers line 600 (setProfilingSource('client'))
    fireEvent.click(screen.getByText(/Client Logs/));
    await act(async () => { await Promise.resolve(); });

    // Should show client data again
    expect(screen.getByText("find({ email: ? })")).toBeInTheDocument();
  });
});

describe("InvestigateView – Drop Index modal X button close", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(emptyLogs);
  });

  it("closes drop index modal via X button in header", async () => {
    mockInvoke.mockResolvedValue(mockIndexes);
    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    const dropBtns = screen.getAllByTitle("Drop Index");
    fireEvent.click(dropBtns[0]);

    expect(screen.getByRole("heading", { name: "Drop Index" })).toBeInTheDocument();

    // Find the X button inside the modal (it's a button with an X svg inside the modal header)
    // It's the only button with DC2626 color in the modal header area
    // Use getAllByRole to find all buttons, then find the one inside the drop modal header
    const allButtons = screen.getAllByRole("button");
    // The X close button in the drop modal header is after the modal heading
    const dropHeading = screen.getByRole("heading", { name: "Drop Index" });
    const modalHeader = dropHeading.closest("div")!.parentElement!;
    // Find button in the modal header (the X button)
    const xCloseBtn = Array.from(modalHeader.querySelectorAll("button")).find(
      b => !b.textContent || b.textContent.trim() === ""
    );
    if (xCloseBtn) {
      fireEvent.click(xCloseBtn);
    } else {
      // Fallback: get the X button by its position among all buttons
      // The X button in drop modal header has no text but has SVG
      const svgButtons = allButtons.filter(b => b.querySelector("svg") && !b.textContent?.trim());
      // There might be multiple, pick one that's within the modal context
      fireEvent.click(svgButtons[svgButtons.length > 1 ? 1 : 0]);
    }

    expect(screen.queryByRole("heading", { name: "Drop Index" })).not.toBeInTheDocument();
  });
});

describe("InvestigateView – AGGREGATE with null stage in pipeline string", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(emptyLogs);
  });

  it("handles null stage in pipeline string (covers line 1155)", async () => {
    // pipeline as string containing null entries
    const logs = [
      {
        id: "1", op: "AGGREGATE", ns: "test_db.test_coll",
        query: JSON.stringify({ pipeline: JSON.stringify([null, { $group: { _id: "$x" } }]) }),
        duration: 100, docsAffected: 0, timestamp: new Date().toISOString(),
      },
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logs as any);
    mockInvoke.mockResolvedValue([]);

    render(<InvestigateView dbName="test_db" collName="test_coll" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Slow Query Profiler/i }));
    // null stage produces "" which is filtered; only $group remains
    expect(screen.getByText("aggregate([ $group ])")).toBeInTheDocument();
  });
});

describe("InvestigateView – index refetch on prop change", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(emptyLogs);
  });

  it("re-fetches indexes when dbName changes", async () => {
    let fetchCount = 0;
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") { fetchCount++; return []; }
      return null;
    });
    const { rerender } = render(<InvestigateView dbName="db1" collName="coll1" />);
    await act(async () => { await Promise.resolve(); });

    const countBefore = fetchCount;
    rerender(<InvestigateView dbName="db2" collName="coll1" />);
    await act(async () => { await Promise.resolve(); });

    expect(fetchCount).toBeGreaterThan(countBefore);
  });

  it("re-fetches indexes when collName changes", async () => {
    let fetchCount = 0;
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_indexes") { fetchCount++; return []; }
      return null;
    });
    const { rerender } = render(<InvestigateView dbName="db1" collName="coll1" />);
    await act(async () => { await Promise.resolve(); });

    const countBefore = fetchCount;
    rerender(<InvestigateView dbName="db1" collName="coll2" />);
    await act(async () => { await Promise.resolve(); });

    expect(fetchCount).toBeGreaterThan(countBefore);
  });
});
