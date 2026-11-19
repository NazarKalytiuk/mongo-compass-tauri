import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import DocumentEditorModal from "../DocumentEditorModal";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri functions
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("DocumentEditorModal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Visibility ───────────────────────────────────────────────────────────────

  it("does not render when isOpen is false", () => {
    render(
      <DocumentEditorModal
        isOpen={false}
        onClose={() => {}}
        onSave={async () => {}}
      />
    );

    expect(screen.queryByText("Insert Document")).not.toBeInTheDocument();
  });

  // ── Insert mode ───────────────────────────────────────────────────────────────

  it("renders default template in insert mode (no documentData)", () => {
    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={async () => {}}
      />
    );

    expect(screen.getByText("Insert Document")).toBeInTheDocument();
    expect(screen.getByText("Document Buffer (JSON)")).toBeInTheDocument();

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toContain('"name": "Sample Document"');
  });

  it("shows Insert & Clone button in insert mode", () => {
    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={async () => {}}
      />
    );

    expect(screen.getByRole("button", { name: "Insert & Clone" })).toBeInTheDocument();
  });

  // ── Edit mode ─────────────────────────────────────────────────────────────────

  it("renders pre-filled document in edit mode", () => {
    const mockDoc = { _id: { $oid: "123" }, name: "Custom Name" };
    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={async () => {}}
        documentData={mockDoc}
      />
    );

    expect(screen.getByText("Edit Document")).toBeInTheDocument();
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toContain('"name": "Custom Name"');
  });

  it("hides Insert & Clone button in edit mode", () => {
    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={async () => {}}
        documentData={{ name: "Existing" }}
      />
    );

    expect(screen.queryByRole("button", { name: "Insert & Clone" })).not.toBeInTheDocument();
  });

  // ── documentData stringify fallback ──────────────────────────────────────────

  it("handles non-serialisable documentData gracefully via String() fallback", () => {
    // Circular reference: JSON.stringify will throw
    const circular: any = {};
    circular.self = circular;

    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={async () => {}}
        documentData={circular}
      />
    );

    // Should render without crashing; textarea should contain the String() fallback
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("[object Object]");
  });

  // ── Re-open / reset ───────────────────────────────────────────────────────────

  it("resets state when modal is closed and reopened", () => {
    const { rerender } = render(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={async () => {}}
      />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"custom": true}' } });

    // Close modal
    rerender(
      <DocumentEditorModal
        isOpen={false}
        onClose={() => {}}
        onSave={async () => {}}
      />
    );

    // Reopen – should show fresh default template
    rerender(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={async () => {}}
      />
    );

    const freshTextarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(freshTextarea.value).toContain('"name": "Sample Document"');
  });

  // ── Format Document ───────────────────────────────────────────────────────────

  it("prettifies JSON when clicking Format Document", () => {
    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={async () => {}}
      />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"a":1,"b":2}' } });

    const formatBtn = screen.getByRole("button", { name: "Format Document" });
    fireEvent.click(formatBtn);

    expect(textarea.value).toBe(JSON.stringify({ a: 1, b: 2 }, null, 2));
  });

  it("shows format error banner when Format is clicked with invalid JSON", () => {
    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={async () => {}}
      />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "not-json" } });

    const formatBtn = screen.getByRole("button", { name: "Format Document" });
    fireEvent.click(formatBtn);

    expect(screen.getByText(/Format failed:/)).toBeInTheDocument();
  });

  // ── Cancel ────────────────────────────────────────────────────────────────────

  it("calls onClose when Cancel is clicked", () => {
    const mockOnClose = vi.fn();
    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={async () => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the X icon button is clicked", () => {
    const mockOnClose = vi.fn();
    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={async () => {}}
      />
    );

    // The X button has no text label; locate by the SVG wrapper
    const allButtons = screen.getAllByRole("button");
    const xBtn = allButtons.find((b) => b.querySelector("svg") && b.className.includes("hover:bg-[#EBE7DF]"));
    expect(xBtn).toBeDefined();
    fireEvent.click(xBtn!);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  // ── Save: invalid JSON blocks submission ──────────────────────────────────────

  it("shows syntax validation error and blocks saving for invalid JSON", async () => {
    const mockOnSave = vi.fn();
    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={mockOnSave}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: '{"name": "broken"' } });

    const saveBtn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveBtn);

    expect(screen.getByText(/Invalid JSON syntax:/)).toBeInTheDocument();
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  // ── Save: success path ────────────────────────────────────────────────────────

  it("invokes onSave and closes modal when submitting valid JSON", async () => {
    const mockOnSave = vi.fn().mockResolvedValue(undefined);
    const mockOnClose = vi.fn();

    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />
    );

    const saveBtn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveBtn);

    expect(screen.getByText("Saving...")).toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockOnSave).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  // ── Save: onSave rejects ──────────────────────────────────────────────────────

  it("shows error banner when onSave rejects", async () => {
    const mockOnSave = vi.fn().mockRejectedValue("Save failed: duplicate key");
    const mockOnClose = vi.fn();

    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />
    );

    const saveBtn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveBtn);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Save failed: duplicate key")).toBeInTheDocument();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  // ── Insert & Clone: invalid JSON blocks action ────────────────────────────────

  it("shows error and blocks Insert & Clone for invalid JSON", async () => {
    const mockOnSave = vi.fn();
    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={mockOnSave}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "{bad json" } });

    const cloneBtn = screen.getByRole("button", { name: "Insert & Clone" });
    fireEvent.click(cloneBtn);

    expect(screen.getByText(/Invalid JSON syntax:/)).toBeInTheDocument();
    expect(mockOnSave).not.toHaveBeenCalled();
  });

  // ── Insert & Clone: success, removes _id and stays open ──────────────────────

  it("supports Insert & Clone by calling onSave, clearing the _id property, and remaining open", async () => {
    const mockOnSave = vi.fn().mockResolvedValue(undefined);
    const mockOnClose = vi.fn();

    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
      />
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"_id": "123", "name": "Document To Clone"}' } });

    const insertCloneBtn = screen.getByRole("button", { name: "Insert & Clone" });
    fireEvent.click(insertCloneBtn);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockOnSave).toHaveBeenCalledWith('{"_id": "123", "name": "Document To Clone"}');
    expect(mockOnClose).not.toHaveBeenCalled();
    expect(textarea.value).not.toContain('"_id"');
    expect(textarea.value).toContain('"name": "Document To Clone"');
  });

  // ── Insert & Clone: onSave rejects ───────────────────────────────────────────

  it("shows error banner when Insert & Clone onSave rejects", async () => {
    const mockOnSave = vi.fn().mockRejectedValue("Insert failed: network error");

    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={mockOnSave}
      />
    );

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: '{"name": "test"}' } });

    const cloneBtn = screen.getByRole("button", { name: "Insert & Clone" });
    fireEvent.click(cloneBtn);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Insert failed: network error")).toBeInTheDocument();
  });

  // ── UTF-8 / line-ending pills ─────────────────────────────────────────────────

  it("displays UTF-8 and CRLF/LF pills dynamically based on textarea content line endings", () => {
    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={async () => {}}
      />
    );

    expect(screen.getByText("UTF-8")).toBeInTheDocument();
    expect(screen.getByText("LF")).toBeInTheDocument();

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

    Object.defineProperty(textarea, "value", {
      get() {
        return "line1\r\nline2";
      },
      configurable: true,
    });
    fireEvent.change(textarea);

    expect(screen.getByText("CRLF")).toBeInTheDocument();
  });

  // ── Schema validation linter ─────────────────────────────────────────────────

  it("fetches and validates input against jsonSchema validator dynamically", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        required: ["name", "age"],
        properties: {
          name: { bsonType: "string" },
          age: { bsonType: "number", minimum: 18 },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="test_db"
          collName="users"
        />
      );
    });

    expect(invoke).toHaveBeenCalledWith("get_collection_validator", {
      dbName: "test_db",
      collName: "users",
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Schema Validation Linter")).toBeInTheDocument();
    expect(screen.getByText("Field is required")).toBeInTheDocument();

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

    // age below minimum
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"name": "Alice", "age": 15}' } });
    });
    expect(screen.getByText("Must be at least 18")).toBeInTheDocument();

    // valid values
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"name": "Alice", "age": 20}' } });
    });
    expect(screen.getByText("✓ Valid")).toBeInTheDocument();
  });

  it("hides Schema Validation Linter when invoke fails to load validator", async () => {
    vi.mocked(invoke).mockRejectedValue("no validator found");

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="test_db"
          collName="users"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText("Schema Validation Linter")).not.toBeInTheDocument();
  });

  it("shows valid indicator when schema is loaded and document is valid", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          name: { bsonType: "string" },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"name": "Alice"}' } });
    });

    expect(screen.getByText("✓ Valid")).toBeInTheDocument();
  });

  // ── Schema: type mismatch ─────────────────────────────────────────────────────

  it("shows type mismatch error when bsonType does not match", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          age: { bsonType: "number" },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"age": "not-a-number"}' } });
    });

    expect(screen.getByText(/Expected type/)).toBeInTheDocument();
  });

  // ── Schema: enum validation ───────────────────────────────────────────────────

  it("shows enum error when value is not in allowed list", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          status: { enum: ["active", "inactive"] },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"status": "pending"}' } });
    });

    expect(screen.getByText(/enum/)).toBeInTheDocument();
  });

  // ── Schema: maximum ───────────────────────────────────────────────────────────

  it("shows maximum violation error for number field", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          score: { bsonType: "number", maximum: 100 },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"score": 150}' } });
    });

    expect(screen.getByText(/Must be at most 100/)).toBeInTheDocument();
  });

  // ── Schema: minLength / maxLength ─────────────────────────────────────────────

  it("shows minLength violation for string field", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          username: { bsonType: "string", minLength: 3 },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"username": "ab"}' } });
    });

    expect(screen.getByText(/Must be at least 3 characters long/)).toBeInTheDocument();
  });

  it("shows maxLength violation for string field", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          username: { bsonType: "string", maxLength: 5 },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"username": "toolongname"}' } });
    });

    expect(screen.getByText(/Must be at most 5 characters long/)).toBeInTheDocument();
  });

  // ── Schema: pattern ───────────────────────────────────────────────────────────

  it("shows pattern violation for string field", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          email: { bsonType: "string", pattern: "^[^@]+@[^@]+\\.[^@]+$" },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"email": "not-an-email"}' } });
    });

    expect(screen.getByText(/Must match pattern/)).toBeInTheDocument();
  });

  // ── Schema: array items validation ───────────────────────────────────────────

  it("validates array items against the items sub-schema", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          tags: {
            bsonType: "array",
            items: { bsonType: "string" },
          },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    // Second element is a number, not a string — should trigger a type error
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"tags": ["good", 42]}' } });
    });

    expect(screen.getByText(/Expected type/)).toBeInTheDocument();
  });

  // ── Schema: type array (union types) ─────────────────────────────────────────

  it("accepts any of the union types in bsonType array", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          value: { bsonType: ["string", "number"] },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    // string is valid for ["string","number"]
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"value": "hello"}' } });
    });

    expect(screen.getByText("✓ Valid")).toBeInTheDocument();
  });

  // ── Schema: linter clears when JSON becomes invalid ──────────────────────────

  it("clears schema validation errors when JSON text becomes unparseable", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        required: ["name"],
        properties: {
          name: { bsonType: "string" },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    // Make it invalid JSON
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "{bad}" } });
    });

    // Validation errors should be hidden (no Issues shown, just the linter header remains)
    expect(screen.queryByText(/Issue\(s\)/)).not.toBeInTheDocument();
  });

  // ── Schema: no dbName/collName suppresses invoke ─────────────────────────────

  it("does not call invoke when dbName or collName is missing", () => {
    render(
      <DocumentEditorModal
        isOpen={true}
        onClose={() => {}}
        onSave={async () => {}}
      />
    );

    expect(invoke).not.toHaveBeenCalled();
  });

  // ── Schema: validation path display ──────────────────────────────────────────

  it("renders the field path pill for nested validation errors", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          address: {
            bsonType: "object",
            properties: {
              zip: { bsonType: "string", minLength: 5 },
            },
          },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"address": {"zip": "12"}}' } });
    });

    // The path pill should show "address.zip"
    expect(screen.getByText("address.zip")).toBeInTheDocument();
    expect(screen.getByText(/Must be at least 5 characters long/)).toBeInTheDocument();
  });

  // ── Schema: raw schema (no $jsonSchema wrapper) ───────────────────────────────

  it("handles schema without $jsonSchema wrapper (bare schema object)", async () => {
    const mockSchema = {
      bsonType: "object",
      required: ["title"],
      properties: {
        title: { bsonType: "string" },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    // The default insert template does not contain "title", so required check fires
    expect(screen.getByText("Schema Validation Linter")).toBeInTheDocument();
    expect(screen.getByText("Field is required")).toBeInTheDocument();
  });

  // ── Schema: pattern with invalid regex doesn't throw ─────────────────────────

  it("silently ignores invalid regex in pattern field", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          code: { bsonType: "string", pattern: "[invalid regex(" },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"code": "ABC"}' } });
    });

    // Should not throw; no pattern error rendered because regex is invalid
    expect(screen.queryByText(/Must match pattern/)).not.toBeInTheDocument();
  });

  // ── Schema: bool / boolean bsonType ─────────────────────────────────────────

  it("reports type error when bsonType is 'bool' and value is not boolean", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          active: { bsonType: "bool" },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"active": "yes"}' } });
    });

    expect(screen.getByText(/Expected type 'bool'/)).toBeInTheDocument();
  });

  it("accepts boolean value for bsonType 'boolean'", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          active: { bsonType: "boolean" },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"active": true}' } });
    });

    expect(screen.getByText("✓ Valid")).toBeInTheDocument();
  });

  // ── Schema: objectId bsonType ─────────────────────────────────────────────────

  it("accepts objectId bsonType for an $oid value", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          ref: { bsonType: "objectId" },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: '{"ref": {"$oid": "507f1f77bcf86cd799439011"}}' },
      });
    });

    expect(screen.getByText("✓ Valid")).toBeInTheDocument();
  });

  it("reports type error when bsonType is 'objectId' but value is plain string", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          ref: { bsonType: "objectId" },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"ref": "not-an-oid"}' } });
    });

    expect(screen.getByText(/Expected type 'objectId'/)).toBeInTheDocument();
  });

  // ── Schema: date bsonType ─────────────────────────────────────────────────────

  it("accepts date bsonType for a $date value", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          createdAt: { bsonType: "date" },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, {
        target: { value: '{"createdAt": {"$date": "2024-01-01T00:00:00.000Z"}}' },
      });
    });

    expect(screen.getByText("✓ Valid")).toBeInTheDocument();
  });

  it("reports type error when bsonType is 'date' and value is a plain string", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          createdAt: { bsonType: "date" },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"createdAt": "2024-01-01"}' } });
    });

    expect(screen.getByText(/Expected type 'date'/)).toBeInTheDocument();
  });

  // ── Schema: null bsonType ─────────────────────────────────────────────────────

  it("accepts null bsonType for a null value", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          deletedAt: { bsonType: "null" },
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"deletedAt": null}' } });
    });

    expect(screen.getByText("✓ Valid")).toBeInTheDocument();
  });

  // ── Schema: unknown bsonType falls through to default (returns true) ──────────

  it("accepts any value when bsonType is an unrecognised/custom type", async () => {
    const mockSchema = {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          data: { bsonType: "binData" }, // unknown type → default → return true
        },
      },
    };

    vi.mocked(invoke).mockResolvedValue(mockSchema);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"data": "anything"}' } });
    });

    // Default branch returns true → no type error
    expect(screen.queryByText(/Expected type 'binData'/)).not.toBeInTheDocument();
    expect(screen.getByText("✓ Valid")).toBeInTheDocument();
  });

  // ── Schema: validateAgainstSchema with non-object schema returns [] ───────────

  it("returns no validation errors when validator schema is null/primitive", async () => {
    // Returning null from invoke causes setValidator(null) → no linter shown
    vi.mocked(invoke).mockResolvedValue(null);

    await act(async () => {
      render(
        <DocumentEditorModal
          isOpen={true}
          onClose={() => {}}
          onSave={async () => {}}
          dbName="db"
          collName="coll"
        />
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    // validator is null → linter block not shown
    expect(screen.queryByText("Schema Validation Linter")).not.toBeInTheDocument();
  });

  // ── Field editor: BSON number types ─────────────────────────────────────────

  describe("field editor keeps BSON number types", () => {
    const doc = {
      _id: { $oid: "65a1b2c3d4e5f60718293a4b" },
      count: 5,
      views: { $numberLong: "9007199254740993" },
      ratio: { $numberDouble: "3.0" },
      price: { $numberDecimal: "19.90" },
    };

    const openFields = (onSave: (json: string) => Promise<void>) => {
      vi.mocked(invoke).mockResolvedValue(null);
      render(<DocumentEditorModal isOpen={true} onClose={() => {}} onSave={onSave} documentData={doc} />);
      fireEvent.click(screen.getByTitle("Field-by-field editor"));
    };

    it("shows each number with its exact type and digits", () => {
      openFields(async () => {});
      const types = screen.getAllByRole("combobox").map((el) => (el as HTMLSelectElement).value);
      expect(types).toEqual(["objectId", "int32", "int64", "double", "decimal128"]);
      expect(screen.getByLabelText("views value")).toHaveValue("9007199254740993");
      expect(screen.getByLabelText("ratio value")).toHaveValue("3.0");
    });

    it("saves numbers in their original types after an edit", async () => {
      const onSave = vi.fn(async (_json: string) => {});
      openFields(onSave);
      fireEvent.change(screen.getByLabelText("views value"), { target: { value: "9007199254740995" } });
      fireEvent.change(screen.getByLabelText("ratio value"), { target: { value: "4" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      expect(JSON.parse(onSave.mock.calls[0]![0])).toEqual({
        ...doc,
        views: { $numberLong: "9007199254740995" },
        ratio: { $numberDouble: "4" },
      });
    });

    it("blocks saving a value that does not fit its type", async () => {
      const onSave = vi.fn(async (_json: string) => {});
      openFields(onSave);
      fireEvent.change(screen.getByLabelText("count value"), { target: { value: "1.5" } });
      expect(screen.getByLabelText("count value")).toHaveAttribute("aria-invalid", "true");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByText(/Field "count": Int32 must be a whole number/)).toBeInTheDocument();
    });

    it("keeps the digits when switching between number types", () => {
      openFields(async () => {});
      const countType = screen.getAllByRole("combobox")[1]!;
      fireEvent.change(countType, { target: { value: "int64" } });
      expect(screen.getByLabelText("count value")).toHaveValue("5");
    });
  });
});
