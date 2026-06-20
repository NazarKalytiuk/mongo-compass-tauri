import { describe, it, expect } from "vitest";
import { fieldsFromDocs, fieldsFromAnalysis } from "../fieldsFromSchema";
import { analyzeDocuments } from "../../../schemaAnalyzer";

describe("fieldsFromSchema", () => {
  it("returns nested dotted paths with type descriptions", () => {
    const docs = [
      { _id: { $oid: "1" }, name: "Alice", address: { street: "Main", zip: 12345 } },
      { _id: { $oid: "2" }, name: "Bob", address: { street: "Second", zip: 67890 } },
    ];
    const fields = fieldsFromDocs(docs);
    const byName = Object.fromEntries(fields.map((f) => [f.name, f.description]));

    expect(Object.keys(byName)).toContain("name");
    expect(Object.keys(byName)).toContain("address.street");
    expect(Object.keys(byName)).toContain("address.zip");
    expect(byName["name"]).toContain("String");
    expect(byName["address.zip"]).toContain("Number");
  });

  it("renders mixed types in the description", () => {
    const docs = [{ value: 1 }, { value: "two" }];
    const fields = fieldsFromDocs(docs);
    const value = fields.find((f) => f.name === "value");
    expect(value?.description).toMatch(/String|Number/);
    // Two types present → joined with a pipe.
    expect(value?.description).toContain("|");
  });

  it("returns an empty list for no documents", () => {
    expect(fieldsFromDocs([])).toEqual([]);
    expect(fieldsFromDocs(null as any)).toEqual([]);
  });

  it("fieldsFromAnalysis maps analysis results", () => {
    const analysis = analyzeDocuments([{ a: 1, b: "x" }]);
    const fields = fieldsFromAnalysis(analysis.fields);
    expect(fields.map((f) => f.name).sort()).toEqual(["a", "b"]);
  });
});
