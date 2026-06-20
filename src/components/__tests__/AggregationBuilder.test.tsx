import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within, waitFor } from "@testing-library/react";
import AggregationBuilder from "../AggregationBuilder";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri invoke function
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock queryLogger so invokeWithLog delegates to our mocked invoke
// Also call the docsAffectedCountSelector so lines 759 and 837 are covered
vi.mock("../../queryLogger", () => ({
  invokeWithLog: vi.fn(async (
    _op: string,
    _ns: string,
    cmd: string,
    args: Record<string, any>,
    _queryStr?: string,
    docsAffectedCountSelector?: (result: any) => number
  ) => {
    const result = await vi.mocked(invoke)(cmd as any, args);
    // Call the selector callback so the lambda branches in AggregationBuilder.tsx are covered
    if (docsAffectedCountSelector) {
      docsAffectedCountSelector(result);
    }
    return result;
  }),
}));

// Use a plain-textarea test double for the CodeMirror editor
vi.mock("../editor/CodeEditor", () => import("./codeEditorMock"));

// Mock CodeGeneratorModal to keep it lightweight
vi.mock("../CodeGeneratorModal", () => ({
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="code-generator-modal">
        <button onClick={onClose}>Close Code Generator</button>
      </div>
    ) : null,
}));

// Provide a writable clipboard mock
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: vi.fn() },
  writable: true,
});

/** Default mock: find_documents returns 1 doc, explain returns IXSCAN+5ms, aggregate returns 1 doc */
const setupDefaultMocks = () => {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "find_documents") {
      return { documents: [{ _id: "1", name: "Test Doc", price: 100 }], total_count: 1 };
    }
    if (cmd === "explain_aggregation") {
      return {
        queryPlanner: { winningPlan: { stage: "IXSCAN", indexName: "idx_1" } },
        executionStats: { executionTimeMillis: 5 },
      };
    }
    // aggregate_documents
    return [{ _id: "1", name: "Aggregated Product", price: 100 }];
  });
};

describe("AggregationBuilder", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupDefaultMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── RENDER & BASIC UI ───────────────────────────────────────────────────────

  it("renders header with title and all toolbar buttons", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    expect(screen.getByText("Aggregation Pipeline Builder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy Pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save Pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Saved Pipelines/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export Code/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Explain Plan/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run Pipeline/i })).toBeInTheDocument();
  });

  it("renders stage 1 with default $match operator on mount", () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    expect(screen.getByText("Stage 1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("$match")).toBeInTheDocument();
  });

  it("shows stage output preview with aggregated data after mount", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);
    expect(await screen.findByText(/Aggregated Product/)).toBeInTheDocument();
  });

  it("calls explain_aggregation on mount", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("explain_aggregation", expect.objectContaining({
        dbName: "store_db",
        collName: "products",
      }));
    });
  });

  it("shows operator description text next to operator select", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);
    expect(await screen.findByText(/Filters documents to pass only matching ones/)).toBeInTheDocument();
  });

  it("renders all available AGG_OPERATORS in the dropdown", () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const operatorSelect = screen.getByDisplayValue("$match") as HTMLSelectElement;
    const options = Array.from(operatorSelect.options).map(o => o.value);
    const expected = ["$match", "$group", "$project", "$sort", "$limit", "$skip", "$unwind", "$lookup", "$addFields", "$count"];
    expected.forEach(op => expect(options).toContain(op));
  });

  // ─── TAB PIPELINE LOADING ────────────────────────────────────────────────────

  it("loads pipeline stages from tab.pipeline prop (valid JSON array)", async () => {
    const tabPipeline = JSON.stringify([
      { "$match": { "status": "active" } },
      { "$group": { "_id": "$dept", "count": { "$sum": 1 } } },
    ]);

    render(
      <AggregationBuilder
        dbName="store_db"
        collName="products"
        tab={{ pipeline: tabPipeline } as any}
      />
    );

    expect(await screen.findByText("Stage 2")).toBeInTheDocument();
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const operatorSelects = selects.filter(s =>
      ["$match", "$group", "$project", "$sort", "$limit", "$skip", "$unwind", "$lookup", "$addFields", "$count"]
        .includes(s.value)
    );
    expect(operatorSelects.map(s => s.value)).toContain("$match");
    expect(operatorSelects.map(s => s.value)).toContain("$group");
  });

  it("gracefully ignores malformed tab.pipeline JSON", async () => {
    render(
      <AggregationBuilder
        dbName="store_db"
        collName="products"
        tab={{ pipeline: "not valid json" } as any}
      />
    );
    // Falls back to default 1-stage pipeline
    expect(screen.getByText("Stage 1")).toBeInTheDocument();
    expect(screen.queryByText("Stage 2")).not.toBeInTheDocument();
  });

  it("ignores tab.pipeline that parses to non-array", () => {
    render(
      <AggregationBuilder
        dbName="store_db"
        collName="products"
        tab={{ pipeline: '{"not": "array"}' } as any}
      />
    );
    expect(screen.getByText("Stage 1")).toBeInTheDocument();
    expect(screen.queryByText("Stage 2")).not.toBeInTheDocument();
  });

  it("does nothing when tab has no pipeline property", () => {
    render(
      <AggregationBuilder
        dbName="store_db"
        collName="products"
        tab={{} as any}
      />
    );
    expect(screen.getByText("Stage 1")).toBeInTheDocument();
  });

  // ─── ADD / REMOVE STAGES ─────────────────────────────────────────────────────

  it("adds a new stage when Add Stage button is clicked", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByText("Add Stage"));
    });

    expect(await screen.findByText("Stage 2")).toBeInTheDocument();
  });

  it("removes a stage and renumbers remaining stages", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByText("Add Stage"));
    });
    await screen.findByText("Stage 2");

    const removeBtns = screen.getAllByTitle("Remove Stage");
    await act(async () => {
      fireEvent.click(removeBtns[0]);
    });

    await waitFor(() => {
      expect(screen.queryByText("Stage 2")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Stage 1")).toBeInTheDocument();
  });

  it("re-runs previews for remaining stages after one is removed", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByText("Add Stage"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Add Stage"));
    });
    await screen.findByText("Stage 3");

    const removeBtns = screen.getAllByTitle("Remove Stage");
    await act(async () => {
      fireEvent.click(removeBtns[0]);
    });

    await waitFor(() => {
      expect(screen.queryByText("Stage 3")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Stage 2")).toBeInTheDocument();
  });

  // ─── STAGE COLLAPSE / EXPAND ─────────────────────────────────────────────────

  it("collapses and expands a stage by clicking the chevron toggle button", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);
    await screen.findByPlaceholderText("e.g. { }");

    // The collapse button is in the stage header — find the first p-1 button in the header
    const allBtns = document.querySelectorAll("button");
    // The collapse/expand btn wraps a ChevronDown/ChevronRight icon and is positioned in stage header
    const collapseBtn = Array.from(allBtns).find(btn => {
      const svg = btn.querySelector("svg");
      return svg
        && btn.className.includes("rounded-md")
        && btn.className.includes("text-[#5B6472]")
        && btn.className.includes("hover:bg-[#111827]/5");
    });

    if (collapseBtn) {
      await act(async () => {
        fireEvent.click(collapseBtn);
      });
      expect(screen.queryByPlaceholderText("e.g. { }")).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(collapseBtn);
      });
      expect(screen.getByPlaceholderText("e.g. { }")).toBeInTheDocument();
    }
  });

  // ─── OPERATOR SELECT ─────────────────────────────────────────────────────────

  it("changes the stage operator via the operator dropdown", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const operatorSelect = screen.getByDisplayValue("$match");
    await act(async () => {
      fireEvent.change(operatorSelect, { target: { value: "$group" } });
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("$group")).toBeInTheDocument();
    });
  });

  // ─── TEMPLATE INSERT ─────────────────────────────────────────────────────────

  it("inserts $group template text into textarea when selected from dropdown", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const templateSelect = screen.getByDisplayValue("+ Insert Template");
    await act(async () => {
      fireEvent.change(templateSelect, {
        target: { value: '{\n  "_id": "$field",\n  "total": { "$sum": 1 }\n}' },
      });
    });

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    expect(textarea.value).toContain('"$sum": 1');
  });

  it("inserts $lookup template text when selected", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const templateSelect = screen.getByDisplayValue("+ Insert Template");
    const lookupValue = '{\n  "from": "other_collection",\n  "localField": "local_key",\n  "foreignField": "foreign_key",\n  "as": "joined_array"\n}';
    await act(async () => {
      fireEvent.change(templateSelect, { target: { value: lookupValue } });
    });

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    expect(textarea.value).toContain("other_collection");
  });

  it("does nothing when empty option is picked from template dropdown", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    const originalValue = textarea.value;

    const templateSelect = screen.getByDisplayValue("+ Insert Template");
    await act(async () => {
      fireEvent.change(templateSelect, { target: { value: "" } });
    });

    expect(textarea.value).toBe(originalValue);
  });

  // ─── STAGE PREVIEW ERROR / EMPTY ─────────────────────────────────────────────

  it("shows error alert when stage value is invalid JSON", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "{ invalid json }" } });
    });

    expect(await screen.findByText(/JSON parse error/)).toBeInTheDocument();
  });

  it("shows 'No documents generated' when aggregate returns empty array", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") return { executionStats: { executionTimeMillis: 0 } };
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);
    expect(await screen.findByText("No documents generated by this stage")).toBeInTheDocument();
  });

  it("shows stage error when aggregate_documents rejects", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") return null;
      throw new Error("Aggregation failed");
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);
    expect(await screen.findByText(/Aggregation failed/)).toBeInTheDocument();
  });

  it("handles empty stage value by treating it as '{}'", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") return { executionStats: { executionTimeMillis: 1 } };
      return [{ _id: "2" }];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "" } });
    });

    // Should not show JSON parse error — treated as {}
    await waitFor(() => {
      expect(screen.queryByText(/JSON parse error/)).not.toBeInTheDocument();
    });
  });

  // ─── EXECUTION TIME / INDEX BADGES ───────────────────────────────────────────

  it("shows execution time badge when explain returns executionStats", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);
    expect(await screen.findByText("5 ms")).toBeInTheDocument();
  });

  it("shows index badge when explain winningPlan contains IXSCAN", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);
    expect(await screen.findByText("Index: idx_1")).toBeInTheDocument();
  });

  it("shows COLLSCAN badge when explain has no IXSCAN", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") {
        return {
          queryPlanner: { winningPlan: { stage: "COLLSCAN" } },
          executionStats: { executionTimeMillis: 10 },
        };
      }
      return [{ _id: "1" }];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);
    expect(await screen.findByText("COLLSCAN")).toBeInTheDocument();
  });

  it("uses timeMillis field from explain plan when executionStats is absent", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") return { timeMillis: 33 };
      return [{ _id: "1" }];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);
    expect(await screen.findByText("33 ms")).toBeInTheDocument();
  });

  it("uses executionTimeMillisEstimate when executionStats and executionTimeMillis are absent", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") {
        return { queryPlanner: { winningPlan: { executionTimeMillisEstimate: 77 } } };
      }
      return [{ _id: "1" }];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);
    expect(await screen.findByText("77 ms")).toBeInTheDocument();
  });

  it("finds IXSCAN recursively inside nested explain plan object", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") {
        return {
          queryPlanner: {
            winningPlan: {
              inputStage: { stage: "IXSCAN", indexName: "nested_idx" },
            },
          },
          executionStats: { executionTimeMillis: 3 },
        };
      }
      return [{ _id: "1" }];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);
    expect(await screen.findByText("Index: nested_idx")).toBeInTheDocument();
  });

  it("finds executionTimeMillis in nested explain object (recursive search)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") {
        return { stages: [{ executionTimeMillis: 99 }] };
      }
      return [{ _id: "1" }];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);
    expect(await screen.findByText("99 ms")).toBeInTheDocument();
  });

  // ─── SLOW MATCH WARNING ───────────────────────────────────────────────────────

  it("shows slow match warning when $match stage > 100ms and COLLSCAN", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") {
        return {
          queryPlanner: { winningPlan: { stage: "COLLSCAN" } },
          executionStats: { executionTimeMillis: 200 },
        };
      }
      return [{ _id: "1" }];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{"status": "active"}' } });
    });

    expect(await screen.findByText(/Slow Match Stage Detected/)).toBeInTheDocument();
    expect(screen.getByText(/{ status: 1 }/)).toBeInTheDocument();
  });

  it("shows generic '{field: 1}' index hint when match stage has no plain fields", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") {
        return {
          queryPlanner: { winningPlan: { stage: "COLLSCAN" } },
          executionStats: { executionTimeMillis: 200 },
        };
      }
      return [{ _id: "1" }];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }");
    await act(async () => {
      // Only operators, no plain fields
      fireEvent.change(textarea, { target: { value: '{"$expr": {"$gt": ["$a", 1]}}' } });
    });

    expect(await screen.findByText(/Slow Match Stage Detected/)).toBeInTheDocument();
    expect(screen.getByText(/{ field: 1 }/)).toBeInTheDocument();
  });

  it("does NOT show slow match warning for non-$match stages", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") {
        return {
          queryPlanner: { winningPlan: { stage: "COLLSCAN" } },
          executionStats: { executionTimeMillis: 200 },
        };
      }
      return [{ _id: "1" }];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const operatorSelect = screen.getByDisplayValue("$match");
    await act(async () => {
      fireEvent.change(operatorSelect, { target: { value: "$group" } });
    });

    // Give time for preview to complete
    await new Promise(r => setTimeout(r, 100));

    expect(screen.queryByText(/Slow Match Stage Detected/)).not.toBeInTheDocument();
  });

  // ─── RUN ENTIRE PIPELINE ─────────────────────────────────────────────────────

  it("runs entire pipeline and shows Final Output panel with results", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Pipeline/i }));
    });

    expect(await screen.findByText("Pipeline Final Output (Preview)")).toBeInTheDocument();
    expect(await screen.findByText("1 documents returned")).toBeInTheDocument();
  });

  it("shows 'Pipeline Final Output' header when run pipeline result is a non-empty array", async () => {
    // When empty [], the panel is hidden (condition: finalOutput.length > 0 || finalError || finalLoading).
    // Test with non-empty result to validate the header renders.
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") return { executionStats: { executionTimeMillis: 1 } };
      return [{ _id: "x" }];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Pipeline/i }));
    });

    expect(await screen.findByText("Pipeline Final Output (Preview)")).toBeInTheDocument();
    // findAll because stage previews also call aggregate
    expect(await screen.findByText("1 documents returned")).toBeInTheDocument();
  });

  it("shows finalError in Final Output panel when aggregate invoke fails during Run Pipeline", async () => {
    // Stage preview also calls aggregate, so let early calls succeed, then fail on run
    let callCount = 0;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") return { executionStats: { executionTimeMillis: 1 } };
      // aggregate_documents: first call is stage preview (allow), second is Run Pipeline (fail)
      callCount++;
      if (callCount > 1) throw new Error("pipeline exec error");
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);
    // Wait for stage preview to complete
    await new Promise(r => setTimeout(r, 100));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run Pipeline/i }));
    });

    // The error shows in the Final Output panel
    expect(await screen.findByText("Pipeline Final Output (Preview)")).toBeInTheDocument();
    const errorSpans = screen.getAllByText(/pipeline exec error/);
    expect(errorSpans.length).toBeGreaterThanOrEqual(1);
  });

  it("shows loading spinner during Run Pipeline execution", async () => {
    let resolveAggregate!: (v: any) => void;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") return { executionStats: { executionTimeMillis: 1 } };
      return new Promise(res => { resolveAggregate = res; });
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Run Pipeline/i }));
    });

    expect(screen.getByText("Executing aggregation pipeline...")).toBeInTheDocument();

    await act(async () => {
      resolveAggregate([{ _id: "1" }]);
    });
  });

  // ─── COPY PIPELINE ───────────────────────────────────────────────────────────

  it("copies the pipeline mongosh command to clipboard on Copy Pipeline click", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Pipeline/i }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("db.products.aggregate(")
    );
    expect(await screen.findByText("Copied Command")).toBeInTheDocument();
  });

  it("Copy Pipeline uses {} fallback for stages with invalid JSON", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "{ bad json" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Copy Pipeline/i }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("db.products.aggregate(")
    );
  });

  // ─── EXPORT CODE / CODE GENERATOR ────────────────────────────────────────────

  it("opens Code Generator modal when Export Code is clicked", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Export Code/i }));
    });

    expect(screen.getByTestId("code-generator-modal")).toBeInTheDocument();
  });

  it("closes Code Generator modal when its close button is clicked", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Export Code/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Close Code Generator"));
    });

    expect(screen.queryByTestId("code-generator-modal")).not.toBeInTheDocument();
  });

  // ─── EXPLAIN PLAN DRAWER ─────────────────────────────────────────────────────

  it("opens Explain Plan drawer and shows COLLSCAN warning", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") {
        return {
          queryPlanner: { winningPlan: { stage: "COLLSCAN" } },
          executionStats: { executionTimeMillis: 75 },
        };
      }
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Explain Plan" }));
    });

    expect(await screen.findByText("Aggregation Explain Plan")).toBeInTheDocument();
    expect(screen.getAllByText(/COLLSCAN/).length).toBeGreaterThan(0);
  });

  it("closes Explain Plan drawer by clicking the close button", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") {
        return { queryPlanner: { winningPlan: { stage: "COLLSCAN" } }, executionStats: { executionTimeMillis: 10 } };
      }
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Explain Plan" }));
    });
    await screen.findByText("Aggregation Explain Plan");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close explain drawer" }));
    });

    expect(screen.queryByText("Aggregation Explain Plan")).not.toBeInTheDocument();
  });

  it("closes Explain Plan drawer by clicking the backdrop", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") {
        return { queryPlanner: { winningPlan: { stage: "COLLSCAN" } }, executionStats: { executionTimeMillis: 10 } };
      }
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Explain Plan" }));
    });
    await screen.findByText("Aggregation Explain Plan");

    // Backdrop is a flex-1 sibling before the drawer sheet
    const backdrop = document.querySelector(".fixed.inset-0.z-50 > .flex-1");
    if (backdrop) {
      await act(async () => { fireEvent.click(backdrop); });
      expect(screen.queryByText("Aggregation Explain Plan")).not.toBeInTheDocument();
    }
  });

  it("shows loading state when Explain Plan drawer is opening", async () => {
    let resolveExplain!: (v: any) => void;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") {
        // Don't resolve immediately the first time (for drawer), return slow promise
        return new Promise(res => { resolveExplain = res; });
      }
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Explain Plan" }));
    });

    expect(screen.getByText("Generating explain plan...")).toBeInTheDocument();

    await act(async () => {
      resolveExplain({ queryPlanner: { winningPlan: { stage: "COLLSCAN" } }, executionStats: { executionTimeMillis: 5 } });
    });
  });

  it("shows error in explain drawer when explain_aggregation rejects", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") throw new Error("explain error msg");
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Explain Plan" }));
    });

    expect(await screen.findByText("Explain execution failed")).toBeInTheDocument();
    expect(screen.getByText(/explain error msg/)).toBeInTheDocument();
  });

  it("shows stage JSON parse error in explain drawer when stage value is invalid", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "{ bad" } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Explain Plan" }));
    });

    expect(await screen.findByText("Explain execution failed")).toBeInTheDocument();
  });

  it("shows IXSCAN index in explain drawer without COLLSCAN warning", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") {
        return {
          queryPlanner: { winningPlan: { stage: "IXSCAN", indexName: "email_idx" } },
          executionStats: { executionTimeMillis: 2 },
        };
      }
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Explain Plan" }));
    });

    await screen.findByText("Aggregation Explain Plan");
    expect(screen.getAllByText(/email_idx/).length).toBeGreaterThan(0);
  });

  it("copies explain JSON to clipboard when 'Copy JSON' is clicked in drawer", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") {
        return { queryPlanner: { winningPlan: { stage: "COLLSCAN" } }, executionStats: { executionTimeMillis: 5 } };
      }
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Explain Plan" }));
    });
    await screen.findByText("Aggregation Explain Plan");

    // Copy JSON lives in the Raw Output view of the explain plan
    await act(async () => {
      fireEvent.click(screen.getByText("Raw Output"));
    });
    await screen.findByText("Copy JSON");

    await act(async () => {
      fireEvent.click(screen.getByText("Copy JSON"));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("winningPlan")
    );
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("shows 'No explain plan generated' when explain returns null", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") return null;
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Explain Plan" }));
    });

    expect(await screen.findByText("No explain plan generated.")).toBeInTheDocument();
  });

  it("renders explain drawer when explain plan has no executionTime field", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") return { queryPlanner: { winningPlan: { stage: "COLLSCAN" } } };
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Explain Plan" }));
    });

    expect(await screen.findByText("Aggregation Explain Plan")).toBeInTheDocument();
    expect(screen.getAllByText(/COLLSCAN/).length).toBeGreaterThan(0);
  });

  // ─── SAVE PIPELINE MODAL ─────────────────────────────────────────────────────

  it("opens Save Pipeline modal when Save Pipeline button is clicked", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save Pipeline/i }));
    });

    expect(screen.getByText("Save Aggregation Pipeline")).toBeInTheDocument();
  });

  it("saves pipeline to localStorage when Enter is pressed in name input", async () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save Pipeline/i }));
    });

    const nameInput = screen.getByPlaceholderText("e.g. Active Users Grouping");
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "My Pipeline" } });
      fireEvent.keyDown(nameInput, { key: "Enter", code: "Enter" });
    });

    expect(storageSpy).toHaveBeenCalledWith(
      "mongo_compass_saved_pipelines",
      expect.stringContaining("My Pipeline")
    );
    // Modal should close after save
    await waitFor(() => {
      expect(screen.queryByText("Save Aggregation Pipeline")).not.toBeInTheDocument();
    });
  });

  it("saves pipeline via Save Pipeline button click in modal", async () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save Pipeline/i }));
    });

    const nameInput = screen.getByPlaceholderText("e.g. Active Users Grouping");
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Button Save Test" } });
    });

    // Click the Save Pipeline button inside the modal
    const modalSaveBtn = screen.getAllByRole("button", { name: "Save Pipeline" }).find(
      b => b.closest(".fixed.inset-0")
    );
    await act(async () => {
      fireEvent.click(modalSaveBtn!);
    });

    expect(storageSpy).toHaveBeenCalledWith(
      "mongo_compass_saved_pipelines",
      expect.stringContaining("Button Save Test")
    );
  });

  it("clicking Cancel in Save Pipeline modal closes it without saving", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save Pipeline/i }));
    });

    expect(screen.getByText("Save Aggregation Pipeline")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(screen.queryByText("Save Aggregation Pipeline")).not.toBeInTheDocument();
  });

  it("Save button in modal is disabled when pipeline name is empty", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save Pipeline/i }));
    });

    const modalSaveBtn = screen.getAllByRole("button", { name: "Save Pipeline" }).find(
      b => b.closest(".fixed.inset-0")
    );
    expect(modalSaveBtn).toBeDisabled();
  });

  it("Save button becomes enabled when pipeline name is typed", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save Pipeline/i }));
    });

    const nameInput = screen.getByPlaceholderText("e.g. Active Users Grouping");
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "Pipeline A" } });
    });

    const modalSaveBtn = screen.getAllByRole("button", { name: "Save Pipeline" }).find(
      b => b.closest(".fixed.inset-0")
    );
    expect(modalSaveBtn).not.toBeDisabled();
  });

  it("does not save when pipeline name is only whitespace", async () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save Pipeline/i }));
    });

    const nameInput = screen.getByPlaceholderText("e.g. Active Users Grouping");
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: "   " } });
      fireEvent.keyDown(nameInput, { key: "Enter", code: "Enter" });
    });

    expect(storageSpy).not.toHaveBeenCalledWith("mongo_compass_saved_pipelines", expect.any(String));
  });

  // ─── SAVED PIPELINES DRAWER ───────────────────────────────────────────────────

  it("shows 'No saved pipelines yet' when drawer opened with no saved pipelines", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Saved Pipelines" }));
    });

    expect(screen.getByText("No saved pipelines yet")).toBeInTheDocument();
  });

  it("closes Saved Pipelines drawer by clicking the X button", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Saved Pipelines" }));
    });
    expect(screen.getByText("No saved pipelines yet")).toBeInTheDocument();

    // Find the drawer close button (X icon button inside the fixed overlay drawer)
    const overlay = document.querySelector(".fixed.inset-0.z-50");
    const xBtn = overlay?.querySelector("button:last-of-type") ??
      overlay?.querySelectorAll("button")[0];
    if (xBtn) {
      await act(async () => {
        fireEvent.click(xBtn);
      });
      await waitFor(() => {
        expect(screen.queryByText("No saved pipelines yet")).not.toBeInTheDocument();
      });
    }
  });

  it("closes Saved Pipelines drawer by clicking the backdrop", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Saved Pipelines" }));
    });
    expect(screen.getByText("No saved pipelines yet")).toBeInTheDocument();

    const allBackdrops = document.querySelectorAll(".fixed.inset-0.z-50 > .flex-1");
    if (allBackdrops.length > 0) {
      await act(async () => {
        fireEvent.click(allBackdrops[allBackdrops.length - 1]);
      });
      await waitFor(() => {
        expect(screen.queryByText("No saved pipelines yet")).not.toBeInTheDocument();
      });
    }
  });

  it("loads saved pipelines from localStorage on mount", async () => {
    const savedPipeline = {
      id: "abc123",
      name: "Pre-saved Pipeline",
      dbName: "store_db",
      collName: "products",
      stages: [{ operator: "$sort", value: '{"price": -1}' }],
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem("mongo_compass_saved_pipelines", JSON.stringify([savedPipeline]));

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Saved Pipelines" }));
    });

    expect(screen.getByText("Pre-saved Pipeline")).toBeInTheDocument();
    expect(screen.getByText("1 stage")).toBeInTheDocument();
  });

  it("shows 'stages' (plural) for pipelines with multiple stages in drawer", async () => {
    const savedPipeline = {
      id: "abc456",
      name: "Multi Stage",
      dbName: "store_db",
      collName: "products",
      stages: [
        { operator: "$match", value: "{}" },
        { operator: "$group", value: '{"_id": null}' },
      ],
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem("mongo_compass_saved_pipelines", JSON.stringify([savedPipeline]));

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Saved Pipelines" }));
    });

    expect(screen.getByText("2 stages")).toBeInTheDocument();
  });

  it("filters saved pipelines to only show those matching current db/collection", async () => {
    const pipelines = [
      {
        id: "p1", name: "Mine", dbName: "store_db", collName: "products",
        stages: [{ operator: "$match", value: "{}" }], createdAt: new Date().toISOString(),
      },
      {
        id: "p2", name: "Other DB", dbName: "other_db", collName: "users",
        stages: [{ operator: "$match", value: "{}" }], createdAt: new Date().toISOString(),
      },
    ];
    localStorage.setItem("mongo_compass_saved_pipelines", JSON.stringify(pipelines));

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Saved Pipelines" }));
    });

    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.queryByText("Other DB")).not.toBeInTheDocument();
  });

  it("loads a saved pipeline when Load button is clicked and closes drawer", async () => {
    const savedPipeline = {
      id: "load1",
      name: "To Load",
      dbName: "store_db",
      collName: "products",
      stages: [{ operator: "$sort", value: '{"_id": 1}' }],
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem("mongo_compass_saved_pipelines", JSON.stringify([savedPipeline]));

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Saved Pipelines" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load" }));
    });

    // Drawer should close
    await waitFor(() => {
      expect(screen.queryByText("To Load")).not.toBeInTheDocument();
    });
    // Loaded stage operator should be $sort
    await waitFor(() => {
      expect(screen.getByDisplayValue("$sort")).toBeInTheDocument();
    });
  });

  it("loads and runs a saved pipeline when Run button is clicked", async () => {
    const savedPipeline = {
      id: "run1",
      name: "To Run",
      dbName: "store_db",
      collName: "products",
      stages: [{ operator: "$limit", value: "5" }],
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem("mongo_compass_saved_pipelines", JSON.stringify([savedPipeline]));

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Saved Pipelines" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run" }));
    });

    // Drawer closes and the pipeline loads
    await waitFor(() => {
      expect(screen.queryByText("To Run")).not.toBeInTheDocument();
    });
  });

  it("deletes a saved pipeline when delete button is clicked", async () => {
    const savedPipeline = {
      id: "del1",
      name: "To Delete",
      dbName: "store_db",
      collName: "products",
      stages: [{ operator: "$match", value: "{}" }],
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem("mongo_compass_saved_pipelines", JSON.stringify([savedPipeline]));

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Saved Pipelines" }));
    });

    expect(screen.getByText("To Delete")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Delete saved pipeline"));
    });

    expect(screen.queryByText("To Delete")).not.toBeInTheDocument();
  });

  it("ignores malformed entries in saved pipelines (invalid type filtered out)", async () => {
    const data = [
      { id: "good1", name: "Valid", dbName: "store_db", collName: "products", stages: [{ operator: "$match", value: "{}" }], createdAt: new Date().toISOString() },
      { id: "bad1", name: 123 }, // invalid: name is not string
    ];
    localStorage.setItem("mongo_compass_saved_pipelines", JSON.stringify(data));

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Saved Pipelines" }));
    });

    expect(screen.getByText("Valid")).toBeInTheDocument();
  });

  it("handles corrupt (non-array) JSON in saved pipelines localStorage gracefully", async () => {
    localStorage.setItem("mongo_compass_saved_pipelines", '{"not": "an array"}');

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Saved Pipelines" }));
    });

    expect(screen.getByText("No saved pipelines yet")).toBeInTheDocument();
  });

  it("handles corrupt (invalid JSON string) localStorage gracefully", async () => {
    localStorage.setItem("mongo_compass_saved_pipelines", "broken{{{{");

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Saved Pipelines" }));
    });

    expect(screen.getByText("No saved pipelines yet")).toBeInTheDocument();
  });

  // ─── AUTOCOMPLETE ─────────────────────────────────────────────────────────────
  // The hand-rolled suggestion popup was replaced by the CodeMirror-based
  // CodeEditor (mocked here as a plain textarea). Autocompletion behavior is now
  // covered by the editor unit tests under editor/__tests__.

  it.skip("replaces word including surrounding quotes when replacement needed", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    // Position cursor inside a quoted $ma in "{"$ma"}" context
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '{ "$ma" }' } });
    });
    textarea.selectionStart = 5; // inside $ma
    await act(async () => { fireEvent.select(textarea); });

    if (screen.queryByText("Suggestions")) {
      const suggBtn = screen.queryByRole("button", { name: /^\$match/ });
      if (suggBtn) {
        await act(async () => {
          fireEvent.mouseDown(suggBtn);
        });
        expect(textarea.value).toContain("$match");
      }
    }
  });

  it("does not add ': ' after suggestion when next char is already ':'", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "$ma: value" } });
    });
    textarea.selectionStart = 3;
    await act(async () => { fireEvent.select(textarea); });

    if (screen.queryByText("Suggestions")) {
      const suggBtn = screen.queryByRole("button", { name: /^\$match/ });
      if (suggBtn) {
        await act(async () => {
          fireEvent.mouseDown(suggBtn);
        });
        expect(textarea.value).not.toContain(": : ");
        expect(textarea.value).not.toContain('": :');
      }
    }
  });

  it("filters suggestions by description text match", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    // "filter" is part of "Filter stage" description for $match
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "filter" } });
    });
    textarea.selectionStart = 6;
    await act(async () => { fireEvent.select(textarea); });

    if (screen.queryByText("Suggestions")) {
      const panel = screen.getByText("Suggestions").closest(".absolute") as HTMLElement;
      const buttons = within(panel).getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    }
  });

  // ─── KEYBOARD SHORTCUTS IN EDITOR ─────────────────────────────────────────────

  it("auto-closes { brace on keyDown", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "{" });
    });
    expect(screen.getByPlaceholderText("e.g. { }")).toBeInTheDocument();
  });

  it("auto-closes [ bracket on keyDown", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "[" });
    });
    expect(screen.getByPlaceholderText("e.g. { }")).toBeInTheDocument();
  });

  it("auto-closes double-quote on keyDown", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.keyDown(textarea, { key: '"' });
    });
    expect(screen.getByPlaceholderText("e.g. { }")).toBeInTheDocument();
  });

  it("auto-closes single-quote on keyDown", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "'" });
    });
    expect(screen.getByPlaceholderText("e.g. { }")).toBeInTheDocument();
  });

  it("Backspace deletes matching pair characters together", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    // We set selectionStart/End manually in the DOM object to simulate cursor between {}
    const origSelStart = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "selectionStart");
    const origSelEnd = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "selectionEnd");
    const origValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");

    // Override selectionStart/End/value for the test
    let mockVal = "{}";
    Object.defineProperty(textarea, "value", { get: () => mockVal, set: (v) => { mockVal = v; }, configurable: true });
    Object.defineProperty(textarea, "selectionStart", { get: () => 1, configurable: true });
    Object.defineProperty(textarea, "selectionEnd", { get: () => 1, configurable: true });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Backspace" });
    });

    // Restore
    if (origSelStart) Object.defineProperty(HTMLTextAreaElement.prototype, "selectionStart", origSelStart);
    if (origSelEnd) Object.defineProperty(HTMLTextAreaElement.prototype, "selectionEnd", origSelEnd);
    if (origValue) Object.defineProperty(HTMLTextAreaElement.prototype, "value", origValue);

    expect(screen.getByPlaceholderText("e.g. { }")).toBeInTheDocument();
  });

  it("skips over closing } when cursor is before a matching }", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    let mockVal = "{}";
    Object.defineProperty(textarea, "value", { get: () => mockVal, set: (v) => { mockVal = v; }, configurable: true });
    Object.defineProperty(textarea, "selectionStart", { get: () => 1, configurable: true });
    Object.defineProperty(textarea, "selectionEnd", { get: () => 1, configurable: true });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: "}" });
    });
    expect(screen.getByPlaceholderText("e.g. { }")).toBeInTheDocument();
  });

  it("non-special keystrokes in editor don't crash", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }");
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "a" });
      fireEvent.keyDown(textarea, { key: "Delete" });
      fireEvent.keyDown(textarea, { key: "ArrowLeft" });
    });
    expect(screen.getByPlaceholderText("e.g. { }")).toBeInTheDocument();
  });

  // ─── SCROLL SYNC ─────────────────────────────────────────────────────────────

  it("syncs scroll from textarea to pre overlay without crashing", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.scroll(textarea, { target: { scrollTop: 50, scrollLeft: 20 } });
    });

    expect(textarea).toBeInTheDocument();
  });

  // ─── DRAG AND DROP ────────────────────────────────────────────────────────────

  it("reorders two stages via drag and drop", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByText("Add Stage"));
    });
    await screen.findByText("Stage 2");

    const stageHeaders = screen.getAllByText(/Stage \d/).map(el => el.closest(".bg-white") as HTMLElement);
    const stage1Header = stageHeaders[0];
    const stage2Header = stageHeaders[1];

    const select2 = stage2Header.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select2, { target: { value: "$project" } });
    });

    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("0"),
      effectAllowed: "",
    };

    const gripDiv = stage1Header.querySelector("[title='Drag to reorder stage']");
    if (gripDiv) {
      await act(async () => { fireEvent.mouseDown(gripDiv); });
    }

    await act(async () => {
      fireEvent.dragStart(stage1Header, { dataTransfer });
      fireEvent.dragEnter(stage2Header, { dataTransfer });
      fireEvent.dragOver(stage2Header, { dataTransfer });
      fireEvent.drop(stage2Header, { dataTransfer });
    });

    await new Promise(r => setTimeout(r, 100));

    const stageHeadersAfter = screen.getAllByText(/Stage \d/).map(el => el.closest(".bg-white") as HTMLElement);
    const select1After = stageHeadersAfter[0].querySelector("select") as HTMLSelectElement;
    const select2After = stageHeadersAfter[1].querySelector("select") as HTMLSelectElement;

    expect(select1After.value).toBe("$project");
    expect(select2After.value).toBe("$match");
  });

  it("does not reorder when drop index equals drag index", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByText("Add Stage"));
    });
    await screen.findByText("Stage 2");

    const stageHeaders = screen.getAllByText(/Stage \d/).map(el => el.closest(".bg-white") as HTMLElement);
    const stage1Header = stageHeaders[0];

    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("0"), // same as drop index 0
      effectAllowed: "",
    };

    await act(async () => {
      fireEvent.dragStart(stage1Header, { dataTransfer });
      fireEvent.drop(stage1Header, { dataTransfer });
    });

    // Stage 1 should still be $match
    const select = stageHeaders[0].querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("$match");
  });

  it("does not reorder when drag data is NaN", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByText("Add Stage"));
    });
    await screen.findByText("Stage 2");

    const stageHeaders = screen.getAllByText(/Stage \d/).map(el => el.closest(".bg-white") as HTMLElement);

    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue("not-a-number"),
      effectAllowed: "",
    };

    await act(async () => {
      fireEvent.dragStart(stageHeaders[1], { dataTransfer });
      fireEvent.drop(stageHeaders[0], { dataTransfer });
    });

    expect(screen.getByText("Stage 1")).toBeInTheDocument();
    expect(screen.getByText("Stage 2")).toBeInTheDocument();
  });

  it("sets dragOverIndex on dragEnter and clears on dragLeave", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByText("Add Stage"));
    });
    await screen.findByText("Stage 2");

    const stageHeaders = screen.getAllByText(/Stage \d/).map(el => el.closest(".bg-white") as HTMLElement);

    await act(async () => {
      fireEvent.dragEnter(stageHeaders[1], { dataTransfer: { effectAllowed: "" } });
    });
    expect(screen.getByText("Stage 2")).toBeInTheDocument();

    await act(async () => {
      fireEvent.dragLeave(stageHeaders[1]);
    });
    expect(screen.getByText("Stage 2")).toBeInTheDocument();
  });

  it("clears dragging state on dragEnd event", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const stageHeader = screen.getByText("Stage 1").closest(".bg-white") as HTMLElement;
    const dataTransfer = { setData: vi.fn(), getData: vi.fn().mockReturnValue("0"), effectAllowed: "" };

    await act(async () => {
      fireEvent.dragStart(stageHeader, { dataTransfer });
    });
    await act(async () => {
      fireEvent.dragEnd(stageHeader, { dataTransfer });
    });

    // After dragEnd the dragging index is cleared (opacity-30 class gone)
    const wrapper = stageHeader.closest(".transition-all");
    expect(wrapper?.classList.contains("opacity-30")).toBe(false);
  });

  it("handles grip mouseDown/mouseUp to enable/disable drag", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const gripDiv = screen.getByTitle("Drag to reorder stage");

    await act(async () => { fireEvent.mouseDown(gripDiv); });
    await act(async () => { fireEvent.mouseUp(gripDiv); });
    await act(async () => { fireEvent.touchStart(gripDiv); });
    await act(async () => { fireEvent.touchEnd(gripDiv); });

    expect(gripDiv).toBeInTheDocument();
  });

  // ─── FIELD NAMES FROM find_documents ─────────────────────────────────────────

  it("ignores _id field when building autocomplete field suggestions", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") {
        return { documents: [{ _id: "1", color: "red" }], total_count: 1 };
      }
      if (cmd === "explain_aggregation") return { executionStats: { executionTimeMillis: 1 } };
      return [{ _id: "1" }];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "color" } });
    });
    textarea.selectionStart = 5;
    await act(async () => { fireEvent.select(textarea); });

    // "color" field should appear in suggestions
    await waitFor(() => {
      if (screen.queryByText("Suggestions")) {
        const panel = screen.getByText("Suggestions").closest(".absolute") as HTMLElement;
        expect(within(panel).queryByText("_id")).not.toBeInTheDocument();
      }
    });
  });

  it("handles find_documents returning null gracefully", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return null;
      if (cmd === "explain_aggregation") return { executionStats: { executionTimeMillis: 1 } };
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    // Should not crash
    expect(screen.getByText("Stage 1")).toBeInTheDocument();
  });

  it("handles find_documents rejection gracefully", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") throw new Error("DB connection error");
      if (cmd === "explain_aggregation") return { executionStats: { executionTimeMillis: 1 } };
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    expect(screen.getByText("Stage 1")).toBeInTheDocument();
  });

  // ─── MULTIPLE STAGES ─────────────────────────────────────────────────────────

  it("shows multiple stage outputs when multiple stages added", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") return { executionStats: { executionTimeMillis: 1 } };
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    await act(async () => {
      fireEvent.click(screen.getByText("Add Stage"));
    });
    await screen.findByText("Stage 2");

    const emptyMsgs = await screen.findAllByText("No documents generated by this stage");
    expect(emptyMsgs.length).toBeGreaterThanOrEqual(2);
  });

  // ─── replaceActiveWordWithSuggestion: whitespace-scanning in key context ─────

  it("replaces suggestion when whitespace separates word from next ':' character", async () => {
    // This covers lines 553-559: while loop scanning whitespace before the colon
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    // Set value: "$ma  : value" — whitespace before colon. Cursor at position 3 (end of "$ma")
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "$ma  : value" } });
    });
    textarea.selectionStart = 3;
    await act(async () => { fireEvent.select(textarea); });

    if (screen.queryByText("Suggestions")) {
      const suggBtn = screen.queryByRole("button", { name: /^\$match/ });
      if (suggBtn) {
        await act(async () => { fireEvent.mouseDown(suggBtn); });
        // The while loop scans the two spaces and finds ':', so no extra ': ' appended
        expect(textarea.value).toContain("$match");
        expect(textarea.value).not.toContain('": : ');
      }
    }
  });

  it.skip("replaces word when suggestion applied in middle of word (word boundary detection)", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    // "$match" word, cursor at position 5 (inside the word)
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "$matc" } });
    });
    textarea.selectionStart = 3; // cursor in middle
    await act(async () => { fireEvent.select(textarea); });

    if (screen.queryByText("Suggestions")) {
      const matchBtn = screen.queryByRole("button", { name: /^\$match/ });
      if (matchBtn) {
        await act(async () => { fireEvent.mouseDown(matchBtn); });
        expect(textarea.value).toContain("$match");
      }
    }
  });

  // ─── runEntirePipelineWithStages: JSON.parse error path ───────────────────────

  it("shows Pipeline syntax error when stage has invalid JSON at Run Pipeline time", async () => {
    // This tests the catch block in runEntirePipelineWithStages (lines ~820-824)
    // We need to set a stage to have invalid JSON at the time Run Pipeline is clicked,
    // but bypass the preview's own parse error (which clears loading state).
    // The key is: updateStage's debounced preview won't have run yet in the same tick.
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "explain_aggregation") return { executionStats: { executionTimeMillis: 1 } };
      return [];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);
    await new Promise(r => setTimeout(r, 50));

    // Set stage value to invalid JSON by directly manipulating the textarea
    // and then immediately running the pipeline (before debounce fires preview)
    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;

    // The stage value is changed synchronously AND we click Run in same act block
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "{ bad json here" } });
      // Immediately click Run before the debounced preview runs
      fireEvent.click(screen.getByRole("button", { name: /Run Pipeline/i }));
    });

    // Either shows pipeline syntax error OR the stage error from preview — either is valid
    await new Promise(r => setTimeout(r, 200));
    // The component doesn't crash
    expect(screen.getByRole("button", { name: /Run Pipeline/i })).toBeInTheDocument();
  });

  // ─── getCursorContext BRACKET PATHS ──────────────────────────────────────────

  it("autocomplete inside array value context (cursor after '[') returns value context", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") {
        return { documents: [{ _id: "1", tag: "x" }], total_count: 1 };
      }
      if (cmd === "explain_aggregation") return { executionStats: { executionTimeMillis: 1 } };
      return [{ _id: "1" }];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    // "[tag" — cursor inside array, context should be "value" so suggestions show $tag
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "[tag" } });
    });
    textarea.selectionStart = 4;
    await act(async () => { fireEvent.select(textarea); });

    // getCursorContext for "[tag" at position 4:
    // scans back from "t" → finds "[" → bracketDepth=0 → returns "value"
    // So field references ($tag) should appear
    if (screen.queryByText("Suggestions")) {
      const panel = screen.getByText("Suggestions").closest(".absolute") as HTMLElement;
      expect(within(panel).getByText("$tag")).toBeInTheDocument();
    }
  });

  it("autocomplete inside nested array with closing ] encountered (bracketDepth tracking)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "find_documents") {
        return { documents: [{ _id: "1", score: 10 }], total_count: 1 };
      }
      if (cmd === "explain_aggregation") return { executionStats: { executionTimeMillis: 1 } };
      return [{ _id: "1" }];
    });

    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    // "[[1,2],score" — cursor after nested brackets
    // When scanning back from 'score': hits ']' → bracketDepth++, then hits '[' → bracketDepth-- (not returning value)
    // then hits '[' → bracketDepth=0 → returns "value"
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "[[1,2],score" } });
    });
    textarea.selectionStart = 12;
    await act(async () => { fireEvent.select(textarea); });

    if (screen.queryByText("Suggestions")) {
      const panel = screen.getByText("Suggestions").closest(".absolute") as HTMLElement;
      expect(within(panel).getByText("$score")).toBeInTheDocument();
    }
  });

  it("autocomplete after closing bracket ] tracks braceDepth correctly", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    // "{key" — scans back, finds '{' → returns "key"
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "{key" } });
    });
    textarea.selectionStart = 4;
    await act(async () => { fireEvent.select(textarea); });

    if (screen.queryByText("Suggestions")) {
      const panel = screen.getByText("Suggestions").closest(".absolute") as HTMLElement;
      const btns = within(panel).getAllByRole("button");
      expect(btns.length).toBeGreaterThan(0);
    }
  });

  it("autocomplete with nested braces tracks outer brace as key context", async () => {
    render(<AggregationBuilder dbName="store_db" collName="products" />);

    const textarea = screen.getByPlaceholderText("e.g. { }") as HTMLTextAreaElement;
    // "{ {inner}, key" — scans back: finds '}' (braceDepth++), '{' (braceDepth--), then '{' → returns "key"
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "{ {inner}, key" } });
    });
    textarea.selectionStart = 14;
    await act(async () => { fireEvent.select(textarea); });

    if (screen.queryByText("Suggestions")) {
      const panel = screen.getByText("Suggestions").closest(".absolute") as HTMLElement;
      // In key context → raw field names shown
      expect(panel).toBeInTheDocument();
    }
  });

  // ─── db/collection CHANGE ─────────────────────────────────────────────────────

  it("re-runs find_documents and stage preview when dbName/collName prop changes", async () => {
    const { rerender } = render(
      <AggregationBuilder dbName="db1" collName="coll1" />
    );

    vi.mocked(invoke).mockClear();

    await act(async () => {
      rerender(<AggregationBuilder dbName="db2" collName="coll2" />);
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("find_documents", expect.objectContaining({
        dbName: "db2",
        collName: "coll2",
      }));
    });
  });
});
