import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import ValidationView from "../ValidationView";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const sampleDocs = {
  documents: [
    { _id: { $oid: "1" }, name: "Alice", age: 30 },
    { _id: { $oid: "2" }, name: "Bob", age: 25 },
  ],
  total_count: 2,
};

describe("ValidationView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("loads existing validator on mount", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_collection_validator") return { $jsonSchema: { bsonType: "object" } };
      return null;
    });

    render(<ValidationView dbName="db" collName="users" />);

    expect(await screen.findByText("Schema Validation")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByDisplayValue(/\$jsonSchema/)).toBeInTheDocument()
    );
  });

  it("generates rules from a document sample", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_collection_validator") return null;
      if (cmd === "find_documents") return sampleDocs;
      return null;
    });

    render(<ValidationView dbName="db" collName="users" />);
    await screen.findByText("Schema Validation");

    await act(async () => {
      fireEvent.click(screen.getByText("Generate Rules from Sample"));
    });

    await waitFor(() =>
      expect(screen.getByDisplayValue(/"bsonType": "object"/)).toBeInTheDocument()
    );
  });

  it("applies validation rules with level and action", async () => {
    const calls: any[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "get_collection_validator") return null;
      if (cmd === "set_collection_validator") { calls.push(args); return null; }
      return null;
    });

    render(<ValidationView dbName="db" collName="users" />);
    await screen.findByText("Schema Validation");

    await act(async () => {
      fireEvent.click(screen.getByText("Apply Validation Rules"));
    });

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toMatchObject({ dbName: "db", collName: "users", validationLevel: "strict", validationAction: "error" });
    expect(await screen.findByText(/applied successfully/i)).toBeInTheDocument();
  });

  it("previews passing and failing documents against the validator", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "get_collection_validator") return { $jsonSchema: { bsonType: "object", required: ["email"] } };
      if (cmd === "find_documents") return sampleDocs; // neither doc has `email`
      return null;
    });

    render(<ValidationView dbName="db" collName="users" />);
    await screen.findByText("Schema Validation");

    await act(async () => {
      fireEvent.click(screen.getByText("Test Against Sample"));
    });

    // Both sample docs miss the required `email` field -> 2 failing
    await waitFor(() => expect(screen.getByText("Failing")).toBeInTheDocument());
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });
});
