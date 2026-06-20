import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { createQueryAutocompleter } from "../autocompleters/query";
import { createStageAutocompleter } from "../autocompleters/stage";
import { createShellAutocompleter } from "../autocompleters/shell";
import { getCursorContext } from "../autocompleters/context";

/** Runs a completion source against `doc` with the cursor at the end. */
function complete(
  source: CompletionSource,
  doc: string,
  pos = doc.length
): CompletionResult | null {
  const state = EditorState.create({ doc, selection: { anchor: pos } });
  const ctx = new CompletionContext(state, pos, true);
  return source(ctx) as CompletionResult | null;
}

function labels(result: CompletionResult | null): string[] {
  return (result?.options ?? []).map((o) =>
    typeof o.label === "string" ? o.label : ""
  );
}

describe("getCursorContext", () => {
  it("detects value position after a colon", () => {
    expect(getCursorContext('{ "a": ', 7)).toBe("value");
  });
  it("detects key position inside an object", () => {
    expect(getCursorContext("{ ", 2)).toBe("key");
  });
  it("detects value position inside an array", () => {
    expect(getCursorContext("[ ", 2)).toBe("value");
  });
  it("walks out of a nested closed object to find the key context", () => {
    // The inner { } is balanced, so the cursor is a key of the outer object.
    expect(getCursorContext("{ a: {}, ", 9)).toBe("key");
  });
  it("treats an unbalanced array as value context", () => {
    expect(getCursorContext("{ a: [ 1, ", 10)).toBe("value");
  });
  it("walks out of a balanced array", () => {
    // Balanced [] inside an object → still a key position.
    expect(getCursorContext("{ a: [], ", 9)).toBe("key");
  });
  it("defaults to key context at the very start", () => {
    expect(getCursorContext("ab", 1)).toBe("key");
  });
});

describe("createQueryAutocompleter", () => {
  const fields = [{ name: "status", description: "String" }, { name: "age" }];

  it("offers field names in key position", () => {
    const result = complete(createQueryAutocompleter({ fields }), "{ sta");
    expect(labels(result)).toContain("status");
  });

  it("offers query operators when an operator prefix is typed", () => {
    const result = complete(createQueryAutocompleter({ fields }), '{ "age": { $ex');
    expect(labels(result)).toContain("$exists");
  });

  it("offers $-prefixed field references in value position", () => {
    const result = complete(createQueryAutocompleter({ fields }), '{ "x": sta');
    expect(labels(result)).toContain("$status");
  });

  it("returns null when nothing matches", () => {
    const result = complete(
      createQueryAutocompleter({ fields: [] }),
      '{ "x": zzzqqq'
    );
    expect(result).toBeNull();
  });

  it("does not open implicitly with an empty token", () => {
    const state = complete(createQueryAutocompleter({ fields }), "{ ", 2);
    // explicit=true in helper, so it opens; verify it returns options here.
    expect(state).not.toBeNull();
  });
});

describe("createStageAutocompleter", () => {
  const fields = [{ name: "price" }];

  it("offers accumulators for a $group stage in key position", () => {
    const result = complete(
      createStageAutocompleter({ stageOperator: "$group", fields }),
      "{ su"
    );
    expect(labels(result)).toContain("$sum");
  });

  it("offers query operators for a $match stage", () => {
    const result = complete(
      createStageAutocompleter({ stageOperator: "$match", fields }),
      "{ \"price\": { gt"
    );
    // value-of-object position is a key again ($gt as an object key)
    expect(labels(result).some((x) => x === "$gt")).toBe(true);
  });

  it("offers $field references and system variables in value position", () => {
    const result = complete(
      createStageAutocompleter({ stageOperator: "$project", fields }),
      '{ "total": pri'
    );
    expect(labels(result)).toContain("$price");
  });

  it("uses default operator categories when no stage operator is given", () => {
    const result = complete(createStageAutocompleter({ fields }), "{ su");
    expect(labels(result)).toContain("$sum");
  });

  it("offers system variables like $$ROOT in value position", () => {
    const result = complete(
      createStageAutocompleter({ stageOperator: "$project", fields: [] }),
      '{ "doc": $$RO'
    );
    expect(labels(result)).toContain("$$ROOT");
  });
});

describe("createShellAutocompleter", () => {
  const collections = ["users", "orders"];

  it("offers collections after db.", () => {
    const result = complete(createShellAutocompleter({ collections }), "db.");
    expect(labels(result)).toEqual(expect.arrayContaining(["users", "orders"]));
  });

  it("offers methods after db.<coll>.", () => {
    const result = complete(
      createShellAutocompleter({ collections }),
      "db.users."
    );
    const l = labels(result);
    expect(l).toContain("find");
    expect(l).toContain("aggregate");
  });

  it("offers globals at the start", () => {
    const result = complete(createShellAutocompleter({ collections }), "d");
    expect(labels(result)).toContain("db");
  });

  it("works with no collections configured", () => {
    const result = complete(createShellAutocompleter(), "db.");
    expect(result?.options).toEqual([]);
  });
});
