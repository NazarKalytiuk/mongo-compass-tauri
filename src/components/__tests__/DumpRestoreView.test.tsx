import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DumpRestoreView } from "../DumpRestoreView";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Capture event listeners so tests can fire them manually
type LogHandler = (e: { payload: { text: string } }) => void;
type ToolsProgressHandler = (e: {
  payload: {
    phase: "checking" | "downloading" | "verifying" | "extracting" | "ready" | "error";
    message: string;
    downloadedBytes?: number;
    totalBytes?: number;
  };
}) => void;
let capturedDumpLogHandler: LogHandler | null = null;
let capturedRestoreLogHandler: LogHandler | null = null;
let capturedToolsProgressHandler: ToolsProgressHandler | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockImplementation(
    (event: string, handler: LogHandler) => {
      if (event === "dump-log") capturedDumpLogHandler = handler;
      if (event === "restore-log") capturedRestoreLogHandler = handler;
      if (event === "database-tools-progress") {
        capturedToolsProgressHandler = handler as unknown as ToolsProgressHandler;
      }
      return Promise.resolve(() => {});
    }
  ),
}));

const defaultProps = {
  activeDb: "",
  activeColl: "",
  databases: ["store_db", "users_db", "admin"],
};

/** Flush all pending microtasks and state updates */
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("DumpRestoreView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    capturedDumpLogHandler = null;
    capturedRestoreLogHandler = null;
    capturedToolsProgressHandler = null;

    vi.mocked(listen).mockImplementation((event, handler) => {
      if (event === "dump-log") capturedDumpLogHandler = handler as LogHandler;
      if (event === "restore-log") capturedRestoreLogHandler = handler as LogHandler;
      if (event === "database-tools-progress") {
        capturedToolsProgressHandler = handler as unknown as ToolsProgressHandler;
      }
      return Promise.resolve(() => {});
    });

    // Default: invoke resolves to empty values
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "get_collection_size") return 0;
      if (cmd === "ensure_database_tools") {
        return {
          version: "100.17.0",
          platform: "macos",
          arch: "arm64",
          binDir: "/app-data/mongodb-database-tools/100.17.0/bin",
          downloaded: false,
        };
      }
      return null;
    });
  });

  it("prepares app-managed MongoDB Database Tools when opened", async () => {
    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });
    await flush();

    expect(invoke).toHaveBeenCalledWith("ensure_database_tools");
    expect(screen.getByText("MongoDB Database Tools 100.17.0 are ready.")).toBeInTheDocument();
    expect(screen.getByText("App-managed installation · macos/arm64")).toBeInTheDocument();
  });

  it("shows MongoDB Database Tools download progress", async () => {
    let resolveTools: ((value: unknown) => void) | null = null;
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "get_collection_size") return 0;
      if (cmd === "ensure_database_tools") {
        return new Promise((resolve) => {
          resolveTools = resolve;
        });
      }
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });
    await flush();

    await act(async () => {
      capturedToolsProgressHandler?.({
        payload: {
          phase: "downloading",
          message: "Downloading MongoDB Database Tools…",
          downloadedBytes: 1024,
          totalBytes: 4096,
        },
      });
    });

    expect(screen.getByText("Downloading MongoDB Database Tools…")).toBeInTheDocument();
    expect(screen.getByText("1 KB / 4 KB")).toBeInTheDocument();

    await act(async () => {
      resolveTools?.({
        version: "100.17.0",
        platform: "macos",
        arch: "arm64",
        binDir: "/app-data/tools/bin",
        downloaded: true,
      });
    });
  });

  it("renders dump pane by default with correct heading and fields", async () => {
    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    expect(screen.getByText("Configure Dump Parameters")).toBeInTheDocument();
    expect(screen.getByText("mongodump (Export Database)")).toBeInTheDocument();
    expect(screen.getByLabelText("Output Path Directory")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run mongodump" })).toBeInTheDocument();
  });

  it("switches to restore pane when mongorestore tab is clicked", async () => {
    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    const restoreTab = screen.getByRole("button", { name: /mongorestore/i });
    await act(async () => {
      fireEvent.click(restoreTab);
    });

    expect(screen.getByText("Configure Restore Parameters")).toBeInTheDocument();
    expect(screen.getByLabelText("Source BSON / GZ Archive Path")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run mongorestore" })).toBeInTheDocument();
  });

  it("switches back to dump pane and clears error/logs on tab switch", async () => {
    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    // Switch to restore
    const restoreTab = screen.getByRole("button", { name: /mongorestore/i });
    await act(async () => {
      fireEvent.click(restoreTab);
    });

    expect(screen.getByText("Configure Restore Parameters")).toBeInTheDocument();

    // Switch back to dump
    const dumpTab = screen.getByRole("button", { name: /mongodump/i });
    await act(async () => {
      fireEvent.click(dumpTab);
    });

    expect(screen.getByText("Configure Dump Parameters")).toBeInTheDocument();
  });

  it("populates activeDb from props (collection value synced after collections load)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products", "orders"];
      if (cmd === "get_collection_size") return 1024;
      return null;
    });

    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          activeColl="products"
          databases={["store_db", "users_db"]}
        />
      );
    });

    await flush();

    const dbSelect = screen.getByLabelText("Database (Optional)") as HTMLSelectElement;
    expect(dbSelect.value).toBe("store_db");

    // The collection dropdown should contain the products option loaded from list_collections
    const collSelect = screen.getByLabelText("Collection (Optional)") as HTMLSelectElement;
    // The prop sets selectedColl to "products" — the option exists in the select
    expect(collSelect.querySelector('option[value="products"]')).not.toBeNull();
    expect(collSelect.value).toBe("products");
  });

  it("syncs db/coll when activeDb/activeColl props change", async () => {
    const { rerender } = render(
      <DumpRestoreView activeDb="" activeColl="" databases={["store_db"]} />
    );

    await flush();

    rerender(
      <DumpRestoreView activeDb="store_db" activeColl="users" databases={["store_db"]} />
    );

    await flush();

    const dbSelect = screen.getByLabelText("Database (Optional)") as HTMLSelectElement;
    expect(dbSelect.value).toBe("store_db");
  });

  it("fetches collections list when database is selected from the dropdown", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["orders", "products", "users"];
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    const dbSelect = screen.getByLabelText("Database (Optional)");
    await act(async () => {
      fireEvent.change(dbSelect, { target: { value: "store_db" } });
    });

    await flush();

    expect(invoke).toHaveBeenCalledWith("list_collections", { dbName: "store_db" });

    // Collections now populate the dropdown options
    const collSelect = screen.getByLabelText("Collection (Optional)") as HTMLSelectElement;
    expect(collSelect.querySelector('option[value="orders"]')).not.toBeNull();
  });

  it("clears collection and disables dropdown when db is changed to empty", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "get_collection_size") return 1024;
      return null;
    });

    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          activeColl="products"
          databases={["store_db"]}
        />
      );
    });

    await flush();

    const dbSelect = screen.getByLabelText("Database (Optional)");
    await act(async () => {
      fireEvent.change(dbSelect, { target: { value: "" } });
    });

    const collSelect = screen.getByLabelText("Collection (Optional)") as HTMLSelectElement;
    expect(collSelect.value).toBe("");
    expect(collSelect).toBeDisabled();
  });

  it("shows estimated size when both db and collection are selected", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "get_collection_size") return 2 * 1024 * 1024; // 2 MB
      return null;
    });

    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          activeColl="products"
          databases={["store_db"]}
        />
      );
    });

    await flush();

    expect(screen.getByText(/Estimated Size:/)).toBeInTheDocument();
    expect(screen.getByText(/2 MB/)).toBeInTheDocument();
  });

  it("shows compressed size estimate when gzip is enabled", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "get_collection_size") return 4 * 1024 * 1024; // 4 MB
      return null;
    });

    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          activeColl="products"
          databases={["store_db"]}
        />
      );
    });

    await flush();

    // gzip is enabled by default
    expect(screen.getByText(/Compressed:/)).toBeInTheDocument();
  });

  it("hides compressed size estimate when gzip is disabled", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "get_collection_size") return 4 * 1024 * 1024;
      return null;
    });

    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          activeColl="products"
          databases={["store_db"]}
        />
      );
    });

    await flush();

    // Disable gzip
    const gzipCheckbox = screen.getByLabelText("Enable Gzip Compression");
    await act(async () => {
      fireEvent.click(gzipCheckbox);
    });

    expect(screen.queryByText(/Compressed:/)).not.toBeInTheDocument();
  });

  it("clears estimated size when collection is deselected (db changed to empty)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "get_collection_size") return 2 * 1024 * 1024;
      return null;
    });

    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          activeColl="products"
          databases={["store_db"]}
        />
      );
    });

    await flush();

    expect(screen.getByText(/Estimated Size:/)).toBeInTheDocument();

    // Change db to empty → clears both db and coll
    const dbSelect = screen.getByLabelText("Database (Optional)");
    await act(async () => {
      fireEvent.change(dbSelect, { target: { value: "" } });
    });

    expect(screen.queryByText(/Estimated Size:/)).not.toBeInTheDocument();
  });

  it("runs mongodump successfully and shows success banner with log output", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "run_mongodump") return null;
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    // Set output path
    const outPathInput = screen.getByLabelText("Output Path Directory");
    fireEvent.change(outPathInput, { target: { value: "/tmp/test_dump" } });

    const submitBtn = screen.getByRole("button", { name: "Run mongodump" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await flush();

    expect(invoke).toHaveBeenCalledWith("run_mongodump", expect.objectContaining({
      outPath: "/tmp/test_dump",
      gzip: true,
      oplog: false,
      dryRun: false,
    }));

    expect(screen.getByText("Database dump finished!")).toBeInTheDocument();
    expect(screen.getByText(/Database dump completed successfully!/)).toBeInTheDocument();
  });

  it("runs mongodump with all db/collection/dry-run options", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["orders"];
      if (cmd === "run_mongodump") return null;
      if (cmd === "get_collection_size") return 1024;
      return null;
    });

    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          activeColl="orders"
          databases={["store_db"]}
        />
      );
    });

    await flush();

    // Enable oplog
    const oplogCheckbox = screen.getByLabelText("Dump Oplog (--oplog)");
    fireEvent.click(oplogCheckbox);

    // Enable dry run
    const dryRunCheckbox = screen.getByLabelText("Dry Run Only");
    fireEvent.click(dryRunCheckbox);

    // Change parallel collections to 8
    const parallelInput = screen.getByDisplayValue("4");
    fireEvent.change(parallelInput, { target: { value: "8" } });

    const submitBtn = screen.getByRole("button", { name: "Run mongodump" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await flush();

    expect(invoke).toHaveBeenCalledWith("run_mongodump", expect.objectContaining({
      db: "store_db",
      collection: "orders",
      oplog: true,
      dryRun: true,
      numParallelCollections: 8,
    }));
  });

  it("shows error banner when mongodump fails with an Error object", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "run_mongodump") throw new Error("mongodump binary not found");
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    const submitBtn = screen.getByRole("button", { name: "Run mongodump" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await flush();

    expect(screen.getByText("Process execution failed")).toBeInTheDocument();
    // error text shown in the error panel
    const errorParagraph = screen.getAllByText(/mongodump binary not found/);
    expect(errorParagraph.length).toBeGreaterThanOrEqual(1);
  });

  it("shows error when mongodump fails with a non-Error string rejection", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "run_mongodump") throw "Permission denied";
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    const submitBtn = screen.getByRole("button", { name: "Run mongodump" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await flush();

    expect(screen.getByText("Process execution failed")).toBeInTheDocument();
    // String errors are passed through String(err)
    const errorEntries = screen.getAllByText(/Permission denied/);
    expect(errorEntries.length).toBeGreaterThanOrEqual(1);
  });

  it("runs mongorestore successfully with required path", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "run_mongorestore") return null;
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    // Switch to restore pane
    const restoreTab = screen.getByRole("button", { name: /mongorestore/i });
    await act(async () => {
      fireEvent.click(restoreTab);
    });

    // Set source path
    const inPathInput = screen.getByLabelText("Source BSON / GZ Archive Path");
    fireEvent.change(inPathInput, { target: { value: "/tmp/backup/store_db" } });

    const submitBtn = screen.getByRole("button", { name: "Run mongorestore" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await flush();

    expect(invoke).toHaveBeenCalledWith("run_mongorestore", expect.objectContaining({
      inPath: "/tmp/backup/store_db",
      drop: false,
      noIndexRestore: false,
      maintainInsertionOrder: true,
      stopOnError: false,
      dryRun: false,
    }));

    expect(screen.getByText("Database restore finished!")).toBeInTheDocument();
    expect(screen.getByText(/Database restore completed successfully!/)).toBeInTheDocument();
  });

  it("shows error when mongorestore is submitted without inPath (empty path guard)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    // Switch to restore pane
    const restoreTab = screen.getByRole("button", { name: /mongorestore/i });
    await act(async () => {
      fireEvent.click(restoreTab);
    });

    // Submit the form with empty inPath via direct form submit (bypasses HTML5 required validation)
    const form = document.querySelector("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });

    await flush();

    expect(screen.getByText("Process execution failed")).toBeInTheDocument();
    const errorEntries = screen.getAllByText(/Source archive\/directory path is required\./);
    expect(errorEntries.length).toBeGreaterThanOrEqual(1);
  });

  it("runs mongorestore with all optional restore flags enabled", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "run_mongorestore") return null;
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    // Switch to restore pane
    const restoreTab = screen.getByRole("button", { name: /mongorestore/i });
    await act(async () => {
      fireEvent.click(restoreTab);
    });

    const inPathInput = screen.getByLabelText("Source BSON / GZ Archive Path");
    fireEvent.change(inPathInput, { target: { value: "/tmp/backup" } });

    // Enable all restore flags
    const dropCheckbox = screen.getByLabelText("Drop collection before restore (--drop)");
    fireEvent.click(dropCheckbox);

    const noIndexCheckbox = screen.getByLabelText("Skip indexes restoring (--noIndexRestore)");
    fireEvent.click(noIndexCheckbox);

    const stopOnErrorCheckbox = screen.getByLabelText("Stop on error (--stopOnError)");
    fireEvent.click(stopOnErrorCheckbox);

    // Disable maintainInsertionOrder (it starts checked)
    const maintainOrderCheckbox = screen.getByLabelText("Maintain insertion order");
    fireEvent.click(maintainOrderCheckbox);

    const dryRunCheckbox = screen.getByLabelText("Dry Run Only");
    fireEvent.click(dryRunCheckbox);

    const submitBtn = screen.getByRole("button", { name: "Run mongorestore" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await flush();

    expect(invoke).toHaveBeenCalledWith("run_mongorestore", expect.objectContaining({
      inPath: "/tmp/backup",
      drop: true,
      noIndexRestore: true,
      maintainInsertionOrder: false,
      stopOnError: true,
      dryRun: true,
    }));
  });

  it("shows error when mongorestore fails", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "run_mongorestore") throw new Error("mongorestore failed: auth error");
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    const restoreTab = screen.getByRole("button", { name: /mongorestore/i });
    await act(async () => {
      fireEvent.click(restoreTab);
    });

    const inPathInput = screen.getByLabelText("Source BSON / GZ Archive Path");
    fireEvent.change(inPathInput, { target: { value: "/tmp/backup" } });

    const submitBtn = screen.getByRole("button", { name: "Run mongorestore" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await flush();

    const errorEntries = screen.getAllByText(/mongorestore failed: auth error/);
    expect(errorEntries.length).toBeGreaterThanOrEqual(1);
  });

  it("streams dump-log events into the log panel", async () => {
    let resolveDump: (() => void) | null = null;
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "run_mongodump") {
        return new Promise<null>((resolve) => {
          resolveDump = () => resolve(null);
        });
      }
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    // Allow listen to register handlers
    await flush();

    const submitBtn = screen.getByRole("button", { name: "Run mongodump" });
    act(() => {
      fireEvent.click(submitBtn);
    });

    // Fire a dump-log event
    await act(async () => {
      capturedDumpLogHandler?.({ payload: { text: "writing store_db.orders" } });
    });

    expect(screen.getByText("writing store_db.orders")).toBeInTheDocument();

    // Resolve the dump
    await act(async () => {
      resolveDump?.();
      await Promise.resolve();
    });
  });

  it("streams restore-log events into the log panel", async () => {
    let resolveRestore: (() => void) | null = null;
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "run_mongorestore") {
        return new Promise<null>((resolve) => {
          resolveRestore = () => resolve(null);
        });
      }
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    await flush();

    const restoreTab = screen.getByRole("button", { name: /mongorestore/i });
    await act(async () => {
      fireEvent.click(restoreTab);
    });

    const inPathInput = screen.getByLabelText("Source BSON / GZ Archive Path");
    fireEvent.change(inPathInput, { target: { value: "/tmp/backup" } });

    const submitBtn = screen.getByRole("button", { name: "Run mongorestore" });
    act(() => {
      fireEvent.click(submitBtn);
    });

    // Simulate restore-log event
    await act(async () => {
      capturedRestoreLogHandler?.({ payload: { text: "restoring store_db.orders" } });
    });

    expect(screen.getByText("restoring store_db.orders")).toBeInTheDocument();

    // Resolve restore
    await act(async () => {
      resolveRestore?.();
      await Promise.resolve();
    });
  });

  it("saves a new dump preset to localStorage", async () => {
    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    const presetNameInput = screen.getByPlaceholderText("e.g. My Backup Preset");
    fireEvent.change(presetNameInput, { target: { value: "Weekly Backup" } });

    const saveBtn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveBtn);

    const stored = JSON.parse(localStorage.getItem("mongo_compass_dump_presets") || "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Weekly Backup");
    expect(stored[0].pane).toBe("dump");
  });

  it("does not save preset when preset name is empty (Save button disabled)", async () => {
    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    const saveBtn = screen.getByRole("button", { name: "Save" });
    // name is empty — Save button is disabled
    expect(saveBtn).toBeDisabled();

    expect(localStorage.getItem("mongo_compass_dump_presets")).toBeNull();
  });

  it("handleSavePreset guard: whitespace-only name returns early", async () => {
    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    const presetNameInput = screen.getByPlaceholderText("e.g. My Backup Preset");
    fireEvent.change(presetNameInput, { target: { value: "   " } });

    // The save button is disabled when name is whitespace only (disabled={!newPresetName.trim()})
    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn).toBeDisabled();
  });

  it("updates existing preset when a preset is selected and saved again", async () => {
    // Seed one preset
    const existingPreset = {
      id: "preset-abc",
      name: "Old Name",
      pane: "dump",
      db: "",
      collection: "",
      outPath: "/old/path",
      gzip: false,
      oplog: false,
      numParallelCollections: 4,
    };
    localStorage.setItem("mongo_compass_dump_presets", JSON.stringify([existingPreset]));

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    // Load the preset
    const presetSelect = screen.getByLabelText("Load Preset");
    await act(async () => {
      fireEvent.change(presetSelect, { target: { value: "preset-abc" } });
    });

    // Change the name
    const presetNameInput = screen.getByPlaceholderText("e.g. My Backup Preset");
    fireEvent.change(presetNameInput, { target: { value: "Updated Name" } });

    const saveBtn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveBtn);

    const stored = JSON.parse(localStorage.getItem("mongo_compass_dump_presets") || "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Updated Name");
    expect(stored[0].id).toBe("preset-abc");
  });

  it("loads a dump preset from the select dropdown and populates fields", async () => {
    const dumpPreset = {
      id: "dump-preset-1",
      name: "Nightly Dump",
      pane: "dump" as const,
      db: "store_db",
      collection: "orders",
      outPath: "/backups/nightly",
      gzip: false,
      oplog: true,
      numParallelCollections: 8,
    };
    localStorage.setItem("mongo_compass_dump_presets", JSON.stringify([dumpPreset]));

    await act(async () => {
      render(<DumpRestoreView databases={["store_db"]} />);
    });

    const presetSelect = screen.getByLabelText("Load Preset");
    await act(async () => {
      fireEvent.change(presetSelect, { target: { value: "dump-preset-1" } });
    });

    const outPathInput = screen.getByLabelText("Output Path Directory") as HTMLInputElement;
    expect(outPathInput.value).toBe("/backups/nightly");

    const dbSelect = screen.getByLabelText("Database (Optional)") as HTMLSelectElement;
    expect(dbSelect.value).toBe("store_db");
  });

  it("loads a restore preset from the select dropdown and switches to restore pane", async () => {
    const restorePreset = {
      id: "restore-preset-1",
      name: "Restore From Archive",
      pane: "restore" as const,
      db: "users_db",
      collection: "",
      inPath: "/backups/archive.bson",
      drop: true,
      noIndexRestore: false,
      maintainInsertionOrder: true,
      stopOnError: true,
    };
    localStorage.setItem("mongo_compass_dump_presets", JSON.stringify([restorePreset]));

    await act(async () => {
      render(<DumpRestoreView databases={["users_db"]} />);
    });

    const presetSelect = screen.getByLabelText("Load Preset");
    await act(async () => {
      fireEvent.change(presetSelect, { target: { value: "restore-preset-1" } });
    });

    // Should switch to restore pane
    expect(screen.getByText("Configure Restore Parameters")).toBeInTheDocument();

    const inPathInput = screen.getByLabelText("Source BSON / GZ Archive Path") as HTMLInputElement;
    expect(inPathInput.value).toBe("/backups/archive.bson");
  });

  it("loading a preset in the same pane (dump→dump) does not switch pane", async () => {
    // Preset with pane matching current active pane — covers the branch where preset.pane === activePane
    const dumpPreset = {
      id: "same-pane-preset",
      name: "Same Pane",
      pane: "dump" as const,
      db: "admin",
      collection: "",
      outPath: "/same-pane-output",
      gzip: true,
      oplog: false,
      numParallelCollections: 2,
    };
    localStorage.setItem("mongo_compass_dump_presets", JSON.stringify([dumpPreset]));

    await act(async () => {
      render(<DumpRestoreView databases={["admin"]} />);
    });

    // Already on dump pane
    expect(screen.getByText("Configure Dump Parameters")).toBeInTheDocument();

    const presetSelect = screen.getByLabelText("Load Preset");
    await act(async () => {
      fireEvent.change(presetSelect, { target: { value: "same-pane-preset" } });
    });

    // Should still be on dump pane
    expect(screen.getByText("Configure Dump Parameters")).toBeInTheDocument();

    const outPathInput = screen.getByLabelText("Output Path Directory") as HTMLInputElement;
    expect(outPathInput.value).toBe("/same-pane-output");
  });

  it("clears preset selection when empty option is selected", async () => {
    const preset = {
      id: "some-preset",
      name: "My Preset",
      pane: "dump" as const,
      db: "store_db",
      collection: "",
      outPath: "/backups",
      gzip: true,
      oplog: false,
      numParallelCollections: 4,
    };
    localStorage.setItem("mongo_compass_dump_presets", JSON.stringify([preset]));

    await act(async () => {
      render(<DumpRestoreView databases={["store_db"]} />);
    });

    const presetSelect = screen.getByLabelText("Load Preset");
    await act(async () => {
      fireEvent.change(presetSelect, { target: { value: "some-preset" } });
    });

    expect(screen.getByPlaceholderText("e.g. My Backup Preset")).toHaveValue("My Preset");

    // Clear selection
    await act(async () => {
      fireEvent.change(presetSelect, { target: { value: "" } });
    });

    expect(screen.getByPlaceholderText("e.g. My Backup Preset")).toHaveValue("");
  });

  it("deletes a preset from the list and localStorage", async () => {
    const presets = [
      {
        id: "preset-del",
        name: "Delete Me",
        pane: "dump" as const,
        db: "",
        collection: "",
        outPath: "/tmp",
        gzip: true,
        oplog: false,
        numParallelCollections: 4,
      },
    ];
    localStorage.setItem("mongo_compass_dump_presets", JSON.stringify(presets));

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    // Load it first
    const presetSelect = screen.getByLabelText("Load Preset");
    await act(async () => {
      fireEvent.change(presetSelect, { target: { value: "preset-del" } });
    });

    // Delete button appears only when a preset is selected
    const deleteBtn = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(deleteBtn);

    const stored = JSON.parse(localStorage.getItem("mongo_compass_dump_presets") || "[]");
    expect(stored).toHaveLength(0);
  });

  it("Delete button is not shown when no preset is selected", async () => {
    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    // No Delete button visible since no preset is selected
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("loads presets from localStorage on mount and shows them in the select", async () => {
    const savedPresets = [
      {
        id: "loaded-preset",
        name: "Loaded Preset",
        pane: "dump" as const,
        db: "admin",
        collection: "",
        outPath: "/stored",
        gzip: true,
        oplog: false,
        numParallelCollections: 4,
      },
    ];
    localStorage.setItem("mongo_compass_dump_presets", JSON.stringify(savedPresets));

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    const presetSelect = screen.getByLabelText("Load Preset") as HTMLSelectElement;
    const options = Array.from(presetSelect.options).map((o) => o.text);
    expect(options.some((o) => o.includes("Loaded Preset"))).toBe(true);
  });

  it("handles malformed JSON in localStorage without crashing", async () => {
    localStorage.setItem("mongo_compass_dump_presets", "{invalid json}");

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    // Should render without error, presets list empty
    expect(screen.getByText("Configure Dump Parameters")).toBeInTheDocument();
  });

  it("handles list_collections invoke failure gracefully (empty collections)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") throw new Error("Network error");
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView activeDb="store_db" databases={["store_db"]} />);
    });

    await flush();

    // Collection dropdown should still be present but empty (no extra options)
    const collSelect = screen.getByLabelText("Collection (Optional)") as HTMLSelectElement;
    expect(collSelect.options.length).toBe(1); // Just "-- All Collections --"
  });

  it("handles get_collection_size failure gracefully (no estimated size shown)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "get_collection_size") throw new Error("Size query failed");
      return null;
    });

    await act(async () => {
      render(
        <DumpRestoreView
          activeDb="store_db"
          activeColl="products"
          databases={["store_db"]}
        />
      );
    });

    await flush();

    // No crash — estimatedSize is null
    expect(screen.queryByText(/Estimated Size:/)).not.toBeInTheDocument();
  });

  it("shows 'Processing...' text while operation is in progress and disables submit", async () => {
    let resolveDump: (() => void) | null = null;
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "run_mongodump") {
        return new Promise<null>((resolve) => {
          resolveDump = () => resolve(null);
        });
      }
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    const submitBtn = screen.getByRole("button", { name: "Run mongodump" });
    act(() => {
      fireEvent.click(submitBtn);
    });

    expect(screen.getByText("Processing...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Processing.../ })).toBeDisabled();

    await act(async () => {
      resolveDump?.();
      await Promise.resolve();
    });
  });

  it("shows correct footer note for dump vs restore pane", async () => {
    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    expect(screen.getByText("Parallel dump enabled")).toBeInTheDocument();

    const restoreTab = screen.getByRole("button", { name: /mongorestore/i });
    await act(async () => {
      fireEvent.click(restoreTab);
    });

    expect(screen.getByText("Restores collections, indexes, and BSON data")).toBeInTheDocument();
  });

  it("sends null for db and collection when they are empty during dump", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "run_mongodump") return null;
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView databases={["store_db"]} />);
    });

    // Leave db/collection empty
    const submitBtn = screen.getByRole("button", { name: "Run mongodump" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await flush();

    expect(invoke).toHaveBeenCalledWith("run_mongodump", expect.objectContaining({
      db: null,
      collection: null,
    }));
  });

  it("log entries for [Compass+] prefix are shown in the log panel after dump", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "run_mongodump") return null;
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    const submitBtn = screen.getByRole("button", { name: "Run mongodump" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await flush();

    // "[Compass+] Starting..." log
    const startLog = screen.getByText(/\[Compass\+\] Starting database dump/);
    expect(startLog).toBeInTheDocument();

    // "[Compass+] Database dump completed..." log
    const doneLog = screen.getByText(/\[Compass\+\] Database dump completed successfully!/);
    expect(doneLog).toBeInTheDocument();
  });

  it("log panel shows error-prefixed entry when dump fails", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "run_mongodump") throw new Error("disk full");
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    const submitBtn = screen.getByRole("button", { name: "Run mongodump" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await flush();

    // The log panel appends [Compass+] Error: ... entry
    const errorLog = screen.getByText(/\[Compass\+\] Error:.*disk full/);
    expect(errorLog).toBeInTheDocument();
  });

  it("log panel shows starting restore log entry", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return [];
      if (cmd === "run_mongorestore") return null;
      return null;
    });

    await act(async () => {
      render(<DumpRestoreView {...defaultProps} />);
    });

    const restoreTab = screen.getByRole("button", { name: /mongorestore/i });
    await act(async () => {
      fireEvent.click(restoreTab);
    });

    const inPathInput = screen.getByLabelText("Source BSON / GZ Archive Path");
    fireEvent.change(inPathInput, { target: { value: "/myarchive" } });

    const submitBtn = screen.getByRole("button", { name: "Run mongorestore" });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await flush();

    expect(screen.getByText(/\[Compass\+\] Starting database restore from: \/myarchive/)).toBeInTheDocument();
    expect(screen.getByText(/\[Compass\+\] Database restore completed successfully!/)).toBeInTheDocument();
  });

  it("formatBytes renders 0 Bytes for size 0 in estimated size display", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["tiny"];
      if (cmd === "get_collection_size") return 0;
      return null;
    });

    await act(async () => {
      render(
        <DumpRestoreView activeDb="store_db" activeColl="tiny" databases={["store_db"]} />
      );
    });

    await flush();

    // 0 bytes renders "0 Bytes" (may appear in both estimated and compressed spans)
    const zeroByteEntries = screen.getAllByText(/0 Bytes/);
    expect(zeroByteEntries.length).toBeGreaterThanOrEqual(1);
  });

  it("formatBytes renders KB unit for small sizes", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["small"];
      if (cmd === "get_collection_size") return 2048; // 2 KB
      return null;
    });

    await act(async () => {
      render(
        <DumpRestoreView activeDb="store_db" activeColl="small" databases={["store_db"]} />
      );
    });

    await flush();

    expect(screen.getByText(/2 KB/)).toBeInTheDocument();
  });

  it("selecting a collection from the dropdown fires onChange and updates selectedColl", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["orders", "products"];
      if (cmd === "get_collection_size") return 4096;
      return null;
    });

    await act(async () => {
      render(
        <DumpRestoreView activeDb="store_db" databases={["store_db"]} />
      );
    });

    await flush();

    // The collection dropdown should have collections loaded
    const collSelect = screen.getByLabelText("Collection (Optional)") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(collSelect, { target: { value: "products" } });
    });

    expect(collSelect.value).toBe("products");
  });

  it("loads a dump preset that has undefined optional fields (false branches for each undefined check)", async () => {
    // Preset with minimal fields — no outPath, gzip, oplog, numParallelCollections defined
    const minimalDumpPreset = {
      id: "minimal-dump",
      name: "Minimal Dump",
      pane: "dump" as const,
      db: "store_db",
      collection: "orders",
      // outPath, gzip, oplog, numParallelCollections are all undefined
    };
    localStorage.setItem("mongo_compass_dump_presets", JSON.stringify([minimalDumpPreset]));

    await act(async () => {
      render(<DumpRestoreView databases={["store_db"]} />);
    });

    const presetSelect = screen.getByLabelText("Load Preset");
    await act(async () => {
      fireEvent.change(presetSelect, { target: { value: "minimal-dump" } });
    });

    // Should not crash; pane stays dump, fields keep defaults
    expect(screen.getByText("Configure Dump Parameters")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. My Backup Preset")).toHaveValue("Minimal Dump");
  });

  it("loads a restore preset that has undefined optional fields (false branches for each undefined check)", async () => {
    // Restore preset with no inPath, drop, noIndexRestore, maintainInsertionOrder, stopOnError
    const minimalRestorePreset = {
      id: "minimal-restore",
      name: "Minimal Restore",
      pane: "restore" as const,
      db: "users_db",
      collection: "",
      // inPath, drop, noIndexRestore, maintainInsertionOrder, stopOnError all undefined
    };
    localStorage.setItem("mongo_compass_dump_presets", JSON.stringify([minimalRestorePreset]));

    await act(async () => {
      render(<DumpRestoreView databases={["users_db"]} />);
    });

    const presetSelect = screen.getByLabelText("Load Preset");
    await act(async () => {
      fireEvent.change(presetSelect, { target: { value: "minimal-restore" } });
    });

    // Should switch to restore pane but keep defaults for optional fields
    expect(screen.getByText("Configure Restore Parameters")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. My Backup Preset")).toHaveValue("Minimal Restore");
  });

  it("handleLoadPreset returns early when preset id is not found in presets list", async () => {
    // Seed presets list with one entry
    const existingPreset = {
      id: "real-preset",
      name: "Real Preset",
      pane: "dump" as const,
      db: "store_db",
      collection: "",
      outPath: "/real",
      gzip: true,
      oplog: false,
      numParallelCollections: 4,
    };
    localStorage.setItem("mongo_compass_dump_presets", JSON.stringify([existingPreset]));

    await act(async () => {
      render(<DumpRestoreView databases={["store_db"]} />);
    });

    // Programmatically call handleLoadPreset with a non-existent ID by changing the select
    // to a value that doesn't match any preset — this triggers `if (!preset) return`
    // We can't do this via UI (select only has valid options), but we can reach it by
    // modifying the select value directly via fireEvent with a fake id
    const presetSelect = screen.getByLabelText("Load Preset");
    await act(async () => {
      // Temporarily fire with an invalid id — the onChange handler will set selectedPresetId
      // then call find() which returns undefined, then hit `if (!preset) return`
      Object.defineProperty(presetSelect, "value", { writable: true, value: "nonexistent-id" });
      fireEvent.change(presetSelect, { target: { value: "nonexistent-id" } });
    });

    // The component shouldn't crash and should stay on dump pane with no name change
    expect(screen.getByText("Configure Dump Parameters")).toBeInTheDocument();
  });

  it("event listeners are unregistered on component unmount", async () => {
    const unlistenMock = vi.fn();
    vi.mocked(listen).mockImplementation((_event, _handler) => {
      return Promise.resolve(unlistenMock);
    });

    const { unmount } = await act(async () => {
      return render(<DumpRestoreView {...defaultProps} />);
    });

    await flush();

    // Unmount — the cleanup function should call unlisten
    unmount();

    // unlisten should have been called for both dump-log and restore-log listeners
    expect(unlistenMock).toHaveBeenCalled();
  });
});
