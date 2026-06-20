import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ExplainPlanView, { buildPlanTree, findUsedIndex, findExecutionTime } from "../ExplainPlanView";

describe("ExplainPlanView helpers", () => {
  it("findUsedIndex finds IXSCAN index name recursively", () => {
    const explain = { queryPlanner: { winningPlan: { stage: "FETCH", inputStage: { stage: "IXSCAN", indexName: "email_1" } } } };
    expect(findUsedIndex(explain)).toBe("email_1");
    expect(findUsedIndex({ queryPlanner: { winningPlan: { stage: "COLLSCAN" } } })).toBeNull();
  });

  it("findExecutionTime reads executionStats.executionTimeMillis", () => {
    expect(findExecutionTime({ executionStats: { executionTimeMillis: 42 } })).toBe(42);
    expect(findExecutionTime({ foo: { timeMillis: 7 } })).toBe(7);
  });

  it("buildPlanTree builds a nested stage tree with children", () => {
    const node = buildPlanTree({
      stage: "FETCH",
      nReturned: 3,
      inputStage: { stage: "IXSCAN", indexName: "email_1", keysExamined: 3 },
    });
    expect(node?.stage).toBe("FETCH");
    expect(node?.nReturned).toBe(3);
    expect(node?.children).toHaveLength(1);
    expect(node?.children[0].stage).toBe("IXSCAN");
    expect(node?.children[0].index).toBe("email_1");
  });
});

describe("ExplainPlanView component", () => {
  const explain = {
    queryPlanner: { winningPlan: { stage: "COLLSCAN" } },
    executionStats: { executionTimeMillis: 12, nReturned: 5, totalDocsExamined: 100, totalKeysExamined: 0 },
  };

  it("renders summary and COLLSCAN status, toggles to raw output", () => {
    render(<ExplainPlanView explain={explain} />);
    expect(screen.getByText("12 ms")).toBeInTheDocument();
    expect(screen.getAllByText(/COLLSCAN/).length).toBeGreaterThan(0);
    // default tree mode shows the stage node
    expect(screen.getByText("Visual Tree")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Raw Output"));
    expect(screen.getByText("Copy JSON")).toBeInTheDocument();
  });
});
