import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DumpRestoreView } from "../SectionStubs";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri functions
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

describe("DumpRestoreView", () => {
  const mockDatabases = ["admin", "local", "store_db"];
  const mockCollections = ["products", "orders"];

  beforeEach(() => {
    vi.resetAllMocks();
    // Default implementation for list_collections invoke
    vi.mocked(invoke).mockImplementation(async (cmd, args: any) => {
      if (cmd === "list_collections" && args.dbName === "store_db") {
        return mockCollections;
      }
      return [];
    });
  });

  it("renders dump form with active database and collection", async () => {
    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          activeColl="products"
          databases={mockDatabases}
        />
      );
    });

    expect(screen.getByText("Configure Dump Parameters")).toBeInTheDocument();
    expect(screen.getByLabelText("Database (Optional)")).toHaveValue("store_db");
    
    // Verify collection select has the value
    expect(screen.getByLabelText("Collection (Optional)")).toHaveValue("products");
    
    // Verify common options exist
    expect(screen.getByLabelText("Output Path Directory")).toHaveValue("/Users/nazarkalituk/Desktop/dumps");
    expect(screen.getByLabelText("Enable Gzip Compression")).toBeChecked();
    expect(screen.getByLabelText("Dump Oplog (--oplog)")).not.toBeChecked();
  });

  it("triggers run_mongodump when the dump form is submitted", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args: any) => {
      if (cmd === "list_collections") return mockCollections;
      if (cmd === "run_mongodump") return true;
      return [];
    });

    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          activeColl="products"
          databases={mockDatabases}
        />
      );
    });

    const runBtn = screen.getByRole("button", { name: "Run mongodump" });
    await act(async () => {
      fireEvent.click(runBtn);
    });

    expect(invoke).toHaveBeenCalledWith("run_mongodump", {
      db: "store_db",
      collection: "products",
      outPath: "/Users/nazarkalituk/Desktop/dumps",
      gzip: true,
      oplog: false,
      numParallelCollections: 4,
      dryRun: false,
    });
    
    // Verify success banner is displayed after successful promise resolution
    expect(screen.getByText("Database dump finished!")).toBeInTheDocument();
  });

  it("switches to restore tab and triggers run_mongorestore on submit", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args: any) => {
      if (cmd === "list_collections") return mockCollections;
      if (cmd === "run_mongorestore") return true;
      return [];
    });

    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          activeColl="products"
          databases={mockDatabases}
        />
      );
    });

    // Click on mongorestore tab
    const restoreTab = screen.getByRole("button", { name: "mongorestore (Import Archive)" });
    fireEvent.click(restoreTab);

    expect(screen.getByText("Configure Restore Parameters")).toBeInTheDocument();

    // Fill the source archive path
    const pathInput = screen.getByLabelText("Source BSON / GZ Archive Path");
    fireEvent.change(pathInput, { target: { value: "/Users/nazarkalituk/Desktop/dumps/store_db" } });

    // Tick some options
    const dropCheckbox = screen.getByLabelText("Drop collection before restore (--drop)");
    fireEvent.click(dropCheckbox);

    const runBtn = screen.getByRole("button", { name: "Run mongorestore" });
    await act(async () => {
      fireEvent.click(runBtn);
    });

    expect(invoke).toHaveBeenCalledWith("run_mongorestore", {
      inPath: "/Users/nazarkalituk/Desktop/dumps/store_db",
      db: "store_db",
      collection: "products",
      drop: true,
      noIndexRestore: false,
      maintainInsertionOrder: true,
      stopOnError: false,
      dryRun: false,
    });

    expect(screen.getByText("Database restore finished!")).toBeInTheDocument();
  });

  it("handles dry run option in dump", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args: any) => {
      if (cmd === "list_collections") return mockCollections;
      if (cmd === "run_mongodump") return true;
      return [];
    });

    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          activeColl="products"
          databases={mockDatabases}
        />
      );
    });

    // Check Dry Run Only checkbox
    const dryRunCheckbox = screen.getByLabelText("Dry Run Only");
    fireEvent.click(dryRunCheckbox);

    const runBtn = screen.getByRole("button", { name: "Run mongodump" });
    await act(async () => {
      fireEvent.click(runBtn);
    });

    expect(invoke).toHaveBeenCalledWith("run_mongodump", {
      db: "store_db",
      collection: "products",
      outPath: "/Users/nazarkalituk/Desktop/dumps",
      gzip: true,
      oplog: false,
      numParallelCollections: 4,
      dryRun: true,
    });
  });

  it("allows saving and loading a preset", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args: any) => {
      if (cmd === "list_collections") return mockCollections;
      return [];
    });

    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          activeColl="products"
          databases={mockDatabases}
        />
      );
    });

    // Preset name input
    const presetNameInput = screen.getByLabelText("Preset Name");
    await act(async () => {
      fireEvent.change(presetNameInput, { target: { value: "Test Backup Preset" } });
    });

    // Click Save
    const saveBtn = screen.getByRole("button", { name: "Save" });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    // Verify it is saved in localStorage
    const savedPresets = JSON.parse(localStorage.getItem("mongo_compass_dump_presets") || "[]");
    expect(savedPresets).toHaveLength(1);
    expect(savedPresets[0].name).toBe("Test Backup Preset");

    // Clear form DB selection to test loading
    const dbSelect = screen.getByLabelText("Database (Optional)");
    await act(async () => {
      fireEvent.change(dbSelect, { target: { value: "" } });
    });
    expect(dbSelect).toHaveValue("");

    // Load the preset back
    const loadSelect = screen.getByLabelText("Load Preset");
    await act(async () => {
      fireEvent.change(loadSelect, { target: { value: savedPresets[0].id } });
    });

    // Verify form gets repopulated
    expect(dbSelect).toHaveValue("store_db");
  });

  it("displays error messages if the Tauri command fails", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args: any) => {
      if (cmd === "list_collections") return mockCollections;
      if (cmd === "run_mongodump") throw new Error("mongodump not found on host");
      return [];
    });

    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          databases={mockDatabases}
        />
      );
    });

    const runBtn = screen.getByRole("button", { name: "Run mongodump" });
    await act(async () => {
      fireEvent.click(runBtn);
    });

    expect(screen.getByText("Process execution failed")).toBeInTheDocument();
    expect(screen.getByText("mongodump not found on host")).toBeInTheDocument();
  });
});
