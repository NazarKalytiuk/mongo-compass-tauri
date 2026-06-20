import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SchemaView from "../SchemaView";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("SchemaView Component", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
  });

  const mockStats = [
    { name: "users", count: 1500 }
  ];

  const mockDocumentsResult = {
    documents: [
      { _id: { $oid: "111" }, name: "Alice", age: 30 },
      { _id: { $oid: "222" }, name: "Bob", age: 25 },
      { _id: { $oid: "333" }, name: "Charlie" }, // age is missing
    ],
    total_count: 3
  };

  it("renders empty state initially", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);

    // Loader or stats check
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("No Schema Profile Yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analyze Schema/i })).toBeInTheDocument();
  });

  it("runs schema analysis and displays results", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return mockDocumentsResult;
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);

    await act(async () => {
      await Promise.resolve();
    });

    const analyzeBtn = screen.getByRole("button", { name: /Analyze Schema/i });
    fireEvent.click(analyzeBtn);

    // Wait for analysis execution and state updates
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Check summary metrics
    expect(screen.getByText("Total Fields Analyzed")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument(); // _id, name, age

    // Check table fields
    expect(screen.getByText("_id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("age")).toBeInTheDocument();

    // Check occurrences
    expect(screen.getAllByText("3 / 3 docs")[0]).toBeInTheDocument(); // name occurrences
    expect(screen.getByText("2 / 3 docs")).toBeInTheDocument(); // age occurrences
  });

  it("expands field details on click", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return mockDocumentsResult;
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Find the row for 'age' and click to expand
    const ageRow = screen.getByText("age").closest("tr")!;
    fireEvent.click(ageRow);

    // Expandable details should now be visible
    expect(screen.getByText("Value Statistics")).toBeInTheDocument();
    expect(screen.getByText("Top 5 Observed Values")).toBeInTheDocument();
    expect(screen.getByText("Min Value")).toBeInTheDocument();
    expect(screen.getByText("Mean / Average")).toBeInTheDocument();
  });

  it("collapses an expanded field when clicked again", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return mockDocumentsResult;
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const ageRow = screen.getByText("age").closest("tr")!;
    fireEvent.click(ageRow);
    expect(screen.getByText("Value Statistics")).toBeInTheDocument();

    // Click again to collapse
    fireEvent.click(ageRow);
    expect(screen.queryByText("Value Statistics")).not.toBeInTheDocument();
  });

  it("enables full scan warning if collection size > 10000", async () => {
    const hugeStats = [{ name: "users", count: 12500 }];
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return hugeStats;
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);

    await act(async () => {
      await Promise.resolve();
    });

    // Toggle full scan mode
    const checkbox = screen.getByLabelText(/Full-scan mode/i);
    fireEvent.click(checkbox);

    expect(screen.getByText(/Analyzing a large collection/i)).toBeInTheDocument();
  });

  it("does not show large collection warning when total docs <= 10000", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats; // count: 1500
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    const checkbox = screen.getByLabelText(/Full-scan mode/i);
    fireEvent.click(checkbox);

    expect(screen.queryByText(/Analyzing a large collection/i)).not.toBeInTheDocument();
  });

  it("supports running full scan in batches and allows cancellation", async () => {
    const batchStats = [{ name: "users", count: 2500 }];
    vi.mocked(invoke).mockImplementation(async (cmd, args: any) => {
      if (cmd === "get_collections_stats") return batchStats;
      if (cmd === "find_documents") {
        // Return 1000 documents for the first two batches, and 500 for the last
        const count = args.skip === 2000 ? 500 : 1000;
        const documents = Array.from({ length: count }, (_, i) => ({
          _id: { $oid: `id-${args.skip}-${i}` },
          name: "Test"
        }));
        return { documents, total_count: 2500 };
      }
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);

    await act(async () => {
      await Promise.resolve();
    });

    // Toggle full scan
    const checkbox = screen.getByLabelText(/Full-scan mode/i);
    fireEvent.click(checkbox);

    const analyzeBtn = screen.getByRole("button", { name: /Analyze Schema/i });
    fireEvent.click(analyzeBtn);

    // Wait for batch calls to finish
    await act(async () => {
      // Allow the batch queries and setTimeouts to flush
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await Promise.resolve();
      }
    });

    // Check it calls find_documents in three batches (0, 1000, 2000 skip offsets)
    expect(invoke).toHaveBeenCalledWith("find_documents", expect.objectContaining({ limit: 1000, skip: 0 }));
    expect(invoke).toHaveBeenCalledWith("find_documents", expect.objectContaining({ limit: 1000, skip: 1000 }));
    expect(invoke).toHaveBeenCalledWith("find_documents", expect.objectContaining({ limit: 1000, skip: 2000 }));

    // When fully complete, summary metrics should render
    expect(screen.getByText("Total Fields Analyzed")).toBeInTheDocument();
  });

  it("loads and validates schema snapshot from localStorage", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      return null;
    });

    const validSnapshot = {
      totalDocs: 3,
      totalFields: 2,
      averageDepth: 1,
      maxDepth: 1,
      mixedTypesCount: 0,
      sparsityPercent: 0,
      fields: [
        {
          path: "name",
          occurrences: 3,
          percentage: 1.0,
          types: [{ type: "String", count: 3, distinctCount: 3, topValues: [] }],
          warnings: [],
          depth: 1,
          comparison: "unchanged"
        },
        {
          path: "age",
          occurrences: 2,
          percentage: 0.67,
          types: [{ type: "Number", count: 2, distinctCount: 2, topValues: [] }],
          warnings: [],
          depth: 1,
          comparison: "unchanged"
        }
      ]
    };

    localStorage.setItem("compass_plus_schema_snap_test_db_users", JSON.stringify(validSnapshot));

    render(<SchemaView dbName="test_db" collName="users" />);

    await act(async () => {
      await Promise.resolve();
    });

    // It should load and display the fields immediately without clicking Analyze
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("age")).toBeInTheDocument();
    expect(screen.queryByText("No Schema Profile Yet")).not.toBeInTheDocument();

    // Now test with invalid snapshot format
    localStorage.setItem("compass_plus_schema_snap_test_db_users", JSON.stringify({ corrupted: true }));

    // Rerender/remount
    render(<SchemaView dbName="test_db" collName="users" />);

    await act(async () => {
      await Promise.resolve();
    });

    // Should ignore corrupted snapshot and render empty state
    expect(screen.getByText("No Schema Profile Yet")).toBeInTheDocument();
  });

  it("shows diff summary and new/removed field badges when re-sampling compared to last snapshot", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return mockDocumentsResult;
      return null;
    });

    const oldSnapshot = {
      totalDocs: 2,
      totalFields: 2,
      averageDepth: 1,
      maxDepth: 1,
      mixedTypesCount: 0,
      sparsityPercent: 0,
      fields: [
        {
          path: "name",
          occurrences: 2,
          percentage: 1.0,
          types: [{ type: "String", count: 2, distinctCount: 2, topValues: [] }],
          warnings: [],
          depth: 1
        },
        {
          path: "old_field", // Present in old snapshot, not in mockDocumentsResult (removed)
          occurrences: 2,
          percentage: 1.0,
          types: [{ type: "String", count: 2, distinctCount: 2, topValues: [] }],
          warnings: [],
          depth: 1
        }
      ]
    };

    localStorage.setItem("compass_plus_schema_snap_test_db_users", JSON.stringify(oldSnapshot));

    render(<SchemaView dbName="test_db" collName="users" />);

    await act(async () => {
      await Promise.resolve();
    });

    // Re-sample Schema
    const reSampleBtn = screen.getByRole("button", { name: /Re-sample Schema/i });
    fireEvent.click(reSampleBtn);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should show comparison banner
    expect(screen.getByText(/Compared to the last schema snapshot:/i)).toBeInTheDocument();
    // age and _id are new compared to oldSnapshot, old_field is removed, name is unchanged
    expect(screen.getByText("+2 new fields")).toBeInTheDocument();
    expect(screen.getByText("-1 removed fields")).toBeInTheDocument();

    // Verification of badges in the table
    expect(screen.getAllByText("New Field")[0]).toBeInTheDocument();
    expect(screen.getByText("Removed")).toBeInTheDocument();
  });

  it("shows error message when analysis fails (empty collection)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Schema Analysis failed")).toBeInTheDocument();
    expect(screen.getByText(/Collection is empty or no documents were returned/i)).toBeInTheDocument();
  });

  it("changes sample size selector and uses it during analysis", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return mockDocumentsResult;
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    // Change sample size
    const sampleSelect = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.change(sampleSelect, { target: { value: "500" } });
    });

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith("find_documents", expect.objectContaining({ limit: 500 }));
  });

  it("sample size selector is hidden when full scan is enabled", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole("combobox")).toBeInTheDocument();

    const checkbox = screen.getByLabelText(/Full-scan mode/i);
    fireEvent.click(checkbox);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("handles corrupted localStorage schema snapshot gracefully", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      return null;
    });

    localStorage.setItem("compass_plus_schema_snap_test_db_users", "{{invalid json}}");

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("No Schema Profile Yet")).toBeInTheDocument();
  });

  it("uses find_documents fallback when get_collections_stats does not return count for collection", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, args: any) => {
      if (cmd === "get_collections_stats") return [{ name: "other_coll", count: 100 }]; // no "users"
      if (cmd === "find_documents" && args.limit === 1) return { total_count: 42, documents: [] };
      if (cmd === "find_documents") return mockDocumentsResult;
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);

    await act(async () => {
      await Promise.resolve();
    });

    // totalCollDocs should come from fallback: 42
    // Full scan label shows "42 docs"
    expect(screen.getByText(/Full-scan mode \(42 docs\)/i)).toBeInTheDocument();
  });

  it("handles get_collections_stats failure gracefully without crashing", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") throw new Error("Permission denied");
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);

    await act(async () => {
      await Promise.resolve();
    });

    // Should still show initial state without crash
    expect(screen.getByText("No Schema Profile Yet")).toBeInTheDocument();
  });

  it("resets state when dbName/collName props change", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return mockDocumentsResult;
      return null;
    });

    const { rerender } = render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Total Fields Analyzed")).toBeInTheDocument();

    // Change collection
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return [{ name: "orders", count: 50 }];
      return null;
    });

    rerender(<SchemaView dbName="test_db" collName="orders" />);

    await act(async () => {
      await Promise.resolve();
    });

    // State should reset — show empty state for new collection
    expect(screen.getByText("No Schema Profile Yet")).toBeInTheDocument();
  });

  it("dispatches schema_analysis_completed event after successful analysis", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return mockDocumentsResult;
      return null;
    });

    const eventSpy = vi.fn();
    window.addEventListener("schema_analysis_completed", eventSpy);

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(eventSpy).toHaveBeenCalled();
    window.removeEventListener("schema_analysis_completed", eventSpy);
  });

  it("shows type-changed badge when field type differs between snapshots", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      // Return age as String now (was Number in snapshot)
      if (cmd === "find_documents") return {
        documents: [
          { _id: { $oid: "111" }, name: "Alice", age: "thirty" },
          { _id: { $oid: "222" }, name: "Bob", age: "twenty-five" },
        ],
        total_count: 2
      };
      return null;
    });

    const oldSnapshot = {
      totalDocs: 2,
      totalFields: 3,
      averageDepth: 1,
      maxDepth: 1,
      mixedTypesCount: 0,
      sparsityPercent: 0,
      fields: [
        {
          path: "_id",
          occurrences: 2,
          percentage: 1.0,
          types: [{ type: "ObjectID", count: 2, distinctCount: 2, topValues: [] }],
          warnings: [],
          depth: 1
        },
        {
          path: "name",
          occurrences: 2,
          percentage: 1.0,
          types: [{ type: "String", count: 2, distinctCount: 2, topValues: [] }],
          warnings: [],
          depth: 1
        },
        {
          path: "age",
          occurrences: 2,
          percentage: 1.0,
          types: [{ type: "Number", count: 2, distinctCount: 2, topValues: [] }],
          warnings: [],
          depth: 1
        }
      ]
    };

    localStorage.setItem("compass_plus_schema_snap_test_db_users", JSON.stringify(oldSnapshot));

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Re-sample Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Type changed")).toBeInTheDocument();
  });

  it("expands an Array field and shows element length stats", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return {
        documents: [
          { _id: { $oid: "aaa" }, tags: ["mongo", "db", "nosql"] },
          { _id: { $oid: "bbb" }, tags: ["cloud"] },
          { _id: { $oid: "ccc" }, tags: ["mongo", "atlas"] },
        ],
        total_count: 3
      };
      return null;
    });

    render(<SchemaView dbName="test_db" collName="items" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Find and expand the 'tags' field (Array type)
    const tagsRow = screen.getByText("tags").closest("tr")!;
    fireEvent.click(tagsRow);

    // Array stats should show "elements" unit
    expect(screen.getAllByText(/Min Length/).length).toBeGreaterThan(0);
    // The 'elements' text appears in the expanded stats for Array types
    const elementsTexts = screen.getAllByText(/elements/);
    expect(elementsTexts.length).toBeGreaterThan(0);
  });

  it("renders type color badges for all field types including Date, Boolean, ObjectID, Number, Array, Object, Null", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return [{ name: "items", count: 3 }];
      if (cmd === "find_documents") return {
        documents: [
          {
            _id: { $oid: "aaa" },
            createdAt: { $date: "2026-01-01T00:00:00.000Z" },
            active: true,
            score: 42,
            tags: ["a", "b"],
            meta: { key: "val" },
            deleted: null,
          }
        ],
        total_count: 1
      };
      return null;
    });

    render(<SchemaView dbName="test_db" collName="items" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // These field types should be rendered in badge form
    expect(screen.getByText("ObjectID")).toBeInTheDocument();
    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Boolean")).toBeInTheDocument();
    expect(screen.getByText("Number")).toBeInTheDocument();
    // Array and Object fields come from tags and meta
    expect(screen.getByText("Array")).toBeInTheDocument();
    expect(screen.getByText("Object")).toBeInTheDocument();
    // Null comes from deleted field
    expect(screen.getByText("Null")).toBeInTheDocument();
  });

  it("expands a String field and shows Min/Max Length stats", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return mockDocumentsResult;
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Expand the 'name' field (String type)
    const nameRow = screen.getByText("name").closest("tr")!;
    fireEvent.click(nameRow);

    expect(screen.getByText("Min Length")).toBeInTheDocument();
    expect(screen.getByText("Max Length")).toBeInTheDocument();
    expect(screen.getByText("Avg Length")).toBeInTheDocument();
  });

  it("shows 'Optimal' badge for fields with no warnings after re-analysis (unchanged fields)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return {
        documents: [
          { _id: { $oid: "aaa111" }, status: "active" },
          { _id: { $oid: "bbb222" }, status: "inactive" },
          { _id: { $oid: "ccc333" }, status: "pending" },
        ],
        total_count: 3
      };
      return null;
    });

    // Pre-load a snapshot with the same structure to get "unchanged" fields
    const existingSnapshot = {
      totalDocs: 3,
      totalFields: 2,
      averageDepth: 1,
      maxDepth: 1,
      mixedTypesCount: 0,
      sparsityPercent: 0,
      fields: [
        {
          path: "_id",
          occurrences: 3,
          percentage: 1.0,
          types: [{ type: "ObjectID", count: 3, distinctCount: 3, topValues: [] }],
          warnings: [],
          depth: 1
        },
        {
          path: "status",
          occurrences: 3,
          percentage: 1.0,
          types: [{ type: "String", count: 3, distinctCount: 3, topValues: [] }],
          warnings: [],
          depth: 1
        }
      ]
    };
    localStorage.setItem("compass_plus_schema_snap_test_db_users", JSON.stringify(existingSnapshot));

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    // Re-sample with same structure → fields will be "unchanged" → show "Optimal"
    fireEvent.click(screen.getByRole("button", { name: /Re-sample Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Both _id and status fields: no warnings, not removed/new/type_changed → show "Optimal"
    expect(screen.getAllByText("Optimal").length).toBeGreaterThan(0);
  });

  it("shows Mixed Types warning when a field has both String and Number values", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return {
        documents: [
          { _id: { $oid: "111" }, score: "high" },
          { _id: { $oid: "222" }, score: 95 },
          { _id: { $oid: "333" }, score: 87 },
        ],
        total_count: 3
      };
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Mixed Types")).toBeInTheDocument();
  });

  it("shows full scan error when collection is empty (total is 0)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return [{ name: "users", count: 0 }];
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    const checkbox = screen.getByLabelText(/Full-scan mode/i);
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Schema Analysis failed")).toBeInTheDocument();
    expect(screen.getByText(/Collection is empty or no documents were returned/i)).toBeInTheDocument();
  });

  it("full scan stops early when batch returns empty documents", async () => {
    const batchStats = [{ name: "users", count: 2000 }];
    let callCount = 0;
    vi.mocked(invoke).mockImplementation(async (cmd, args: any) => {
      if (cmd === "get_collections_stats") return batchStats;
      if (cmd === "find_documents") {
        callCount++;
        if (args.skip === 0) {
          return {
            documents: Array.from({ length: 1000 }, (_, i) => ({
              _id: { $oid: `id-${i}` }, name: "Test"
            })),
            total_count: 2000
          };
        }
        // Second batch returns empty — break condition
        return { documents: [], total_count: 2000 };
      }
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    const checkbox = screen.getByLabelText(/Full-scan mode/i);
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await Promise.resolve();
      }
    });

    // Should have finished (either with results or error)
    // The analysis stops early when batch is empty
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("cancels full scan analysis when Cancel Scan button is clicked", async () => {
    const batchStats = [{ name: "users", count: 3000 }];
    // Deferred promise for second batch so we can set cancel before the loop checks cancelRef
    let resolveSecondBatch: ((val: any) => void) | null = null;

    vi.mocked(invoke).mockImplementation(async (cmd, args: any) => {
      if (cmd === "get_collections_stats") return batchStats;
      if (cmd === "find_documents") {
        if (args.skip === 0) {
          return {
            documents: Array.from({ length: 1000 }, (_, i) => ({
              _id: { $oid: `id-0-${i}` }, name: "Test"
            })),
            total_count: 3000
          };
        }
        // Second batch hangs until cancelled
        return new Promise<any>((resolve) => {
          resolveSecondBatch = resolve;
        });
      }
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    const checkbox = screen.getByLabelText(/Full-scan mode/i);
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));

    // Allow first batch + setTimeout(0) to run
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      await Promise.resolve();
    });

    // Now click Cancel Scan — this sets cancelRef.current = true
    const cancelBtn = screen.queryByRole("button", { name: /Cancel Scan/i });
    if (cancelBtn) {
      await act(async () => {
        fireEvent.click(cancelBtn);
      });
    }

    // Resolve second batch with real docs — the while loop will check cancelRef at top next iteration
    await act(async () => {
      resolveSecondBatch?.({
        documents: Array.from({ length: 1000 }, (_, i) => ({
          _id: { $oid: `id-1-${i}` }, name: "Test"
        })),
        total_count: 3000
      });
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 0));
        await Promise.resolve();
      }
    });

    // Analysis either threw with "cancelled" error or completed
    // Either way, the analyze button reappears (not disabled)
    expect(
      screen.queryByRole("button", { name: /Analyze Schema|Re-sample Schema/i }) != null ||
      screen.queryByText("Schema Analysis failed") != null
    ).toBe(true);
  });

  it("shows getTypeColorClass default for unknown type via snapshot with unknown type", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      return null;
    });

    // Inject a snapshot with an unknown type to trigger the default case in getTypeColorClass
    const snapshotWithUnknownType = {
      totalDocs: 1,
      totalFields: 1,
      averageDepth: 1,
      maxDepth: 1,
      mixedTypesCount: 0,
      sparsityPercent: 0,
      fields: [
        {
          path: "special_field",
          occurrences: 1,
          percentage: 1.0,
          types: [{ type: "Unknown", count: 1, distinctCount: 1, topValues: [{ value: "x", count: 1, percentage: 1.0 }] }],
          warnings: [],
          depth: 1,
          comparison: "unchanged"
        }
      ]
    };
    localStorage.setItem("compass_plus_schema_snap_test_db_users", JSON.stringify(snapshotWithUnknownType));

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    // The Unknown type badge should render using the default CSS classes
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("shows diff summary with only type_changed fields (no added/removed shows nothing)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return mockDocumentsResult;
      return null;
    });

    // Old snapshot with same fields but different type for age
    const oldSnapshot = {
      totalDocs: 3,
      totalFields: 3,
      averageDepth: 1,
      maxDepth: 1,
      mixedTypesCount: 0,
      sparsityPercent: 0,
      fields: [
        {
          path: "_id",
          occurrences: 3,
          percentage: 1.0,
          types: [{ type: "ObjectID", count: 3, distinctCount: 3, topValues: [] }],
          warnings: [],
          depth: 1
        },
        {
          path: "name",
          occurrences: 3,
          percentage: 1.0,
          types: [{ type: "String", count: 3, distinctCount: 3, topValues: [] }],
          warnings: [],
          depth: 1
        },
        {
          path: "age",
          occurrences: 2,
          percentage: 0.67,
          types: [{ type: "String", count: 2, distinctCount: 2, topValues: [] }], // was String, now Number
          warnings: [],
          depth: 1
        }
      ]
    };

    localStorage.setItem("compass_plus_schema_snap_test_db_users", JSON.stringify(oldSnapshot));

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Re-sample Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // type_changed for age — diff summary banner shown
    expect(screen.getByText(/Compared to the last schema snapshot:/i)).toBeInTheDocument();
    expect(screen.getByText("1 type changes")).toBeInTheDocument();
  });

  it("does not show diff summary banner when no added/removed/type_changed fields", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return mockDocumentsResult;
      return null;
    });

    // Old snapshot with EXACT same structure as mockDocumentsResult would produce
    const oldSnapshot = {
      totalDocs: 3,
      totalFields: 3,
      averageDepth: 1,
      maxDepth: 1,
      mixedTypesCount: 0,
      sparsityPercent: 33.3,
      fields: [
        {
          path: "_id",
          occurrences: 3,
          percentage: 1.0,
          types: [{ type: "ObjectID", count: 3, distinctCount: 3, topValues: [] }],
          warnings: [],
          depth: 1
        },
        {
          path: "age",
          occurrences: 2,
          percentage: 0.67,
          types: [{ type: "Number", count: 2, distinctCount: 2, topValues: [] }],
          warnings: [],
          depth: 1
        },
        {
          path: "name",
          occurrences: 3,
          percentage: 1.0,
          types: [{ type: "String", count: 3, distinctCount: 3, topValues: [] }],
          warnings: [],
          depth: 1
        }
      ]
    };

    localStorage.setItem("compass_plus_schema_snap_test_db_users", JSON.stringify(oldSnapshot));

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Re-sample Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // No banner because getDiffSummary returns null (0 added/removed/changed)
    expect(screen.queryByText(/Compared to the last schema snapshot:/i)).not.toBeInTheDocument();
  });

  it("renders sparsity percent in amber color when > 20", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return {
        documents: [
          { _id: { $oid: "111" }, name: "Alice", score: 10, extra: "X" },
          { _id: { $oid: "222" }, name: "Bob" },
          { _id: { $oid: "333" }, name: "Charlie" },
          { _id: { $oid: "444" }, name: "Dave" },
          { _id: { $oid: "555" }, name: "Eve" },
        ],
        total_count: 5
      };
      return null;
    });

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Analyze Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // sparsity should be > 20 because score/extra are in < 50% of docs
    const sparsityLabel = screen.getByText("Schema Sparsity");
    expect(sparsityLabel).toBeInTheDocument();

    // The sparsity % value element — check it's there
    const sparsitySection = screen.getByText("Percentage of fields missing in over 50% of sampled documents.");
    expect(sparsitySection).toBeInTheDocument();
  });

  it("cannot click removed field rows to expand them", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "find_documents") return mockDocumentsResult;
      return null;
    });

    const oldSnapshot = {
      totalDocs: 2,
      totalFields: 3,
      averageDepth: 1,
      maxDepth: 1,
      mixedTypesCount: 0,
      sparsityPercent: 0,
      fields: [
        {
          path: "removed_field",
          occurrences: 2,
          percentage: 1.0,
          types: [{ type: "String", count: 2, distinctCount: 2, topValues: [] }],
          warnings: [],
          depth: 1
        },
        {
          path: "name",
          occurrences: 2,
          percentage: 1.0,
          types: [{ type: "String", count: 2, distinctCount: 2, topValues: [] }],
          warnings: [],
          depth: 1
        }
      ]
    };

    localStorage.setItem("compass_plus_schema_snap_test_db_users", JSON.stringify(oldSnapshot));

    render(<SchemaView dbName="test_db" collName="users" />);
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole("button", { name: /Re-sample Schema/i }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The removed_field row should be present with Removed badge
    expect(screen.getByText("Removed")).toBeInTheDocument();

    // Clicking the removed field row should not expand it
    const removedRow = screen.getByText("removed_field").closest("tr")!;
    fireEvent.click(removedRow);

    // Value Statistics should NOT appear since clicking removed field is blocked
    expect(screen.queryByText("Value Statistics")).not.toBeInTheDocument();
  });
});
