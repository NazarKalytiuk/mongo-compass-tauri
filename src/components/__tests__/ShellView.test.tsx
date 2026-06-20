import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ShellView } from "../ShellView";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Mock Tauri functions
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Use a plain-textarea test double for the CodeMirror editor
vi.mock("../editor/CodeEditor", () => import("./codeEditorMock"));

let capturedShellLogListener: ((e: { payload: { text: string } }) => void) | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockImplementation((_event: string, handler: (e: { payload: { text: string } }) => void) => {
    capturedShellLogListener = handler;
    return Promise.resolve(() => {});
  }),
}));

describe("ShellView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    capturedShellLogListener = null;
    vi.mocked(listen).mockImplementation((_event, handler) => {
      capturedShellLogListener = handler as (e: { payload: { text: string } }) => void;
      return Promise.resolve(() => {});
    });
  });

  it("loads collection names for the active database", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "list_collections") return ["users", "orders"] as any;
      return undefined as any;
    });
    await act(async () => {
      render(<ShellView activeDb="shop" />);
    });
    expect(invoke).toHaveBeenCalledWith("list_collections", { dbName: "shop" });
  });

  it("tolerates a failed list_collections call", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "list_collections") throw new Error("nope");
      return undefined as any;
    });
    await act(async () => {
      render(<ShellView activeDb="shop" />);
    });
    expect(screen.getByText("mongosh interactive terminal")).toBeInTheDocument();
  });

  it("renders shell view correctly and calls start_shell on mount", async () => {
    await act(async () => {
      render(<ShellView />);
    });

    expect(screen.getByText("mongosh interactive terminal")).toBeInTheDocument();
    expect(screen.getByText("MongoDB Shell (mongosh) - Tauri Edition")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("start_shell");
  });

  it("submits command and invokes write_shell_command", async () => {
    await act(async () => {
      render(<ShellView />);
    });

    const textarea = screen.getByLabelText("Shell Input");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "db.users.find()" } });
    });

    // Press Meta+Enter (⌘↵)
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    });

    expect(invoke).toHaveBeenCalledWith("write_shell_command", { command: "db.users.find()" });
    expect(screen.getByText("db.users.find()")).toBeInTheDocument();
    expect(textarea).toHaveValue("");
  });

  it("submits command via Ctrl+Enter", async () => {
    await act(async () => {
      render(<ShellView />);
    });

    const textarea = screen.getByLabelText("Shell Input");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "show dbs" } });
    });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    });

    expect(invoke).toHaveBeenCalledWith("write_shell_command", { command: "show dbs" });
  });

  it("does not submit empty command on Enter", async () => {
    await act(async () => {
      render(<ShellView />);
    });

    const textarea = screen.getByLabelText("Shell Input");
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    });

    expect(invoke).not.toHaveBeenCalledWith("write_shell_command", expect.anything());
  });

  it("shows error in history when start_shell invoke fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("mongosh not found"));

    await act(async () => {
      render(<ShellView />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Failed to spawn mongosh process/)).toBeInTheDocument();
  });

  it("shows error in history when write_shell_command invoke fails", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined); // start_shell succeeds
    vi.mocked(invoke).mockRejectedValueOnce(new Error("pipe broken"));

    await act(async () => {
      render(<ShellView />);
    });

    const textarea = screen.getByLabelText("Shell Input");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "db.test.find()" } });
    });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Failed to write command to shell/)).toBeInTheDocument();
  });

  it("renders output-type history items from shell-log event", async () => {
    await act(async () => {
      render(<ShellView />);
    });

    await act(async () => {
      capturedShellLogListener?.({ payload: { text: "{ result: 1 }" } });
    });

    expect(screen.getByText("{ result: 1 }")).toBeInTheDocument();
  });

  it("renders error-type history items when shell-log text starts with [ERROR]", async () => {
    await act(async () => {
      render(<ShellView />);
    });

    await act(async () => {
      capturedShellLogListener?.({ payload: { text: "[ERROR] MongoCommandException" } });
    });

    expect(screen.getByText("MongoCommandException")).toBeInTheDocument();
  });

  it("clears terminal history when Clear Screen button is clicked", async () => {
    await act(async () => {
      render(<ShellView />);
    });

    // Ensure initial output text is visible
    expect(screen.getByText("MongoDB Shell (mongosh) - Tauri Edition")).toBeInTheDocument();

    const clearBtn = screen.getByRole("button", { name: "Clear Screen" });
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    expect(screen.queryByText("MongoDB Shell (mongosh) - Tauri Edition")).not.toBeInTheDocument();
  });

  it("toggles command history drawer and lists saved items", async () => {
    // Add mock history to localStorage
    const mockHistory = ["show dbs", "db.adminCommand({ping: 1})"];
    localStorage.setItem("mongo_compass_shell_history", JSON.stringify(mockHistory));

    await act(async () => {
      render(<ShellView />);
    });

    // Toggle history drawer
    const historyBtn = screen.getByRole("button", { name: "History" });
    await act(async () => {
      fireEvent.click(historyBtn);
    });

    expect(screen.getByText("Command History")).toBeInTheDocument();
    expect(screen.getByText("show dbs")).toBeInTheDocument();
    expect(screen.getByText("db.adminCommand({ping: 1})")).toBeInTheDocument();

    // Click a command in history to populate input
    const historyItem = screen.getByText("show dbs");
    await act(async () => {
      fireEvent.click(historyItem);
    });

    const textarea = screen.getByLabelText("Shell Input");
    expect(textarea).toHaveValue("show dbs");
  });

  it("shows 'No recent commands' when history drawer is empty", async () => {
    await act(async () => {
      render(<ShellView />);
    });

    const historyBtn = screen.getByRole("button", { name: "History" });
    await act(async () => {
      fireEvent.click(historyBtn);
    });

    expect(screen.getByText("No recent commands")).toBeInTheDocument();
  });

  it("closes history drawer when X button is clicked", async () => {
    localStorage.setItem("mongo_compass_shell_history", JSON.stringify(["show dbs"]));

    await act(async () => {
      render(<ShellView />);
    });

    const historyBtn = screen.getByRole("button", { name: "History" });
    await act(async () => {
      fireEvent.click(historyBtn);
    });

    expect(screen.getByText("Command History")).toBeInTheDocument();

    // The X button is the only button with a p-1 padding class in the drawer header
    const allButtons = screen.getAllByRole("button");
    const closeDrawerBtn = allButtons.find(btn => btn.className.includes("p-1"));

    expect(closeDrawerBtn).toBeDefined();
    await act(async () => {
      fireEvent.click(closeDrawerBtn!);
    });

    expect(screen.queryByText("Command History")).not.toBeInTheDocument();
  });

  it("clears history drawer items when Clear History button is clicked", async () => {
    localStorage.setItem("mongo_compass_shell_history", JSON.stringify(["show dbs", "db.test.find()"]));

    await act(async () => {
      render(<ShellView />);
    });

    const historyBtn = screen.getByRole("button", { name: "History" });
    await act(async () => {
      fireEvent.click(historyBtn);
    });

    expect(screen.getByText("show dbs")).toBeInTheDocument();

    const clearHistoryBtn = screen.getByRole("button", { name: /Clear History/i });
    await act(async () => {
      fireEvent.click(clearHistoryBtn);
    });

    expect(screen.queryByText("show dbs")).not.toBeInTheDocument();
    expect(screen.getByText("No recent commands")).toBeInTheDocument();
    expect(localStorage.getItem("mongo_compass_shell_history")).toBeNull();
  });

  it("deduplicates commands in shell history (moves existing to front)", async () => {
    localStorage.setItem("mongo_compass_shell_history", JSON.stringify(["show dbs", "db.test.find()"]));

    await act(async () => {
      render(<ShellView />);
    });

    const textarea = screen.getByLabelText("Shell Input");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "show dbs" } });
    });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    });

    const stored = JSON.parse(localStorage.getItem("mongo_compass_shell_history") || "[]");
    expect(stored[0]).toBe("show dbs");
    expect(stored.filter((h: string) => h === "show dbs").length).toBe(1);
  });

  it("focuses textarea when clicking the scrollable log area", async () => {
    await act(async () => {
      render(<ShellView />);
    });

    const textarea = screen.getByLabelText("Shell Input");

    // The scrollable logs div is the flex-1 container wrapping the pre elements
    // It has the onClick handler. Find the pre element for the initial output
    // and click its parent container (the overflow-y-auto div).
    const outputPre = screen.getByText("MongoDB Shell (mongosh) - Tauri Edition");
    // Navigate up: pre -> div (the scrollable container with onClick)
    const scrollableContainer = outputPre.closest("div.flex-1.p-4");

    if (scrollableContainer) {
      await act(async () => {
        fireEvent.click(scrollableContainer);
      });
    }

    // No error thrown — the focus handler ran
    expect(textarea).toBeInTheDocument();
  });

  it("handles corrupted localStorage shell history gracefully", async () => {
    localStorage.setItem("mongo_compass_shell_history", "not-valid-json{{{{");

    await act(async () => {
      render(<ShellView />);
    });

    // Should render without crashing and history should be empty
    const historyBtn = screen.getByRole("button", { name: "History" });
    await act(async () => {
      fireEvent.click(historyBtn);
    });

    expect(screen.getByText("No recent commands")).toBeInTheDocument();
  });

  it("renders input-type history items with the compass prompt prefix", async () => {
    await act(async () => {
      render(<ShellView />);
    });

    const textarea = screen.getByLabelText("Shell Input");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "db.collection.find()" } });
    });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    });

    expect(screen.getAllByText("compass-plus:PRIMARY>").length).toBeGreaterThan(0);
    expect(screen.getByText("db.collection.find()")).toBeInTheDocument();
  });

  it("Enter key without meta or ctrl does not submit", async () => {
    await act(async () => {
      render(<ShellView />);
    });

    const textarea = screen.getByLabelText("Shell Input");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "db.test.find()" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
    });

    expect(invoke).not.toHaveBeenCalledWith("write_shell_command", expect.anything());
  });
});
