import { describe, it, expect } from "vitest";
import {
  filterCompletions,
  dictionaryToCmCompletion,
  fieldToCmCompletion,
} from "../completer";

describe("filterCompletions", () => {
  it("filters by meta category", () => {
    const stages = filterCompletions("", ["stage"]);
    expect(stages.every((c) => c.meta === "stage")).toBe(true);
    expect(stages.some((c) => c.name === "$match")).toBe(true);
    // Query operators must not leak into a stage-only request.
    expect(stages.some((c) => c.name === "$regex")).toBe(false);
  });

  it("matches a prefix with or without the $ sigil", () => {
    const withSigil = filterCompletions("$ma", ["stage"]);
    const without = filterCompletions("ma", ["stage"]);
    expect(withSigil.some((c) => c.name === "$match")).toBe(true);
    expect(without.some((c) => c.name === "$match")).toBe(true);
  });

  it("ranks an exact prefix match first", () => {
    const results = filterCompletions("$sum", ["accumulator"]);
    expect(results[0].name).toBe("$sum");
  });

  it("gates completions by server version", () => {
    // $setWindowFields requires 5.0.0.
    const old = filterCompletions("$setWindowFields", ["stage"], {
      serverVersion: "4.4.0",
    });
    expect(old.some((c) => c.name === "$setWindowFields")).toBe(false);

    const recent = filterCompletions("$setWindowFields", ["stage"], {
      serverVersion: "6.0.0",
    });
    expect(recent.some((c) => c.name === "$setWindowFields")).toBe(true);
  });

  it("does not hide versioned completions when server version is unknown", () => {
    const results = filterCompletions("$setWindowFields", ["stage"]);
    expect(results.some((c) => c.name === "$setWindowFields")).toBe(true);
  });

  it("dedupes entries shared across categories", () => {
    const results = filterCompletions("$sum", ["accumulator", "expr-operator"]);
    const sums = results.filter((c) => c.name === "$sum");
    expect(sums.length).toBe(1);
  });
});

describe("CodeMirror completion mapping", () => {
  it("maps a dictionary entry", () => {
    const entry = filterCompletions("$match", ["stage"])[0];
    const cm = dictionaryToCmCompletion(entry);
    expect(cm.label).toBe("$match");
    expect(cm.detail).toBe("stage");
    expect(cm.info).toBeTruthy();
  });

  it("maps a field as a plain name or a $ reference", () => {
    const plain = fieldToCmCompletion({ name: "price", description: "Number" });
    expect(plain.label).toBe("price");
    expect(plain.detail).toContain("Number");

    const ref = fieldToCmCompletion({ name: "price" }, true);
    expect(ref.label).toBe("$price");
    expect(ref.detail).toBe("field");
  });
});
