import { describe, it, expect } from "vitest";
import {
  detectType,
  getNumericValue,
  stringifyValue,
  analyzeDocuments,
  compareSnapshots,
} from "../../schemaAnalyzer";

describe("schemaAnalyzer type detection", () => {
  it("should detect null and undefined as Null", () => {
    expect(detectType(null)).toBe("Null");
    expect(detectType(undefined)).toBe("Null");
  });

  it("should detect boolean", () => {
    expect(detectType(true)).toBe("Boolean");
    expect(detectType(false)).toBe("Boolean");
  });

  it("should detect numbers", () => {
    expect(detectType(42)).toBe("Number");
    expect(detectType(3.14)).toBe("Number");
    expect(detectType({ $numberLong: "123456789" })).toBe("Number");
    expect(detectType({ $numberInt: "10" })).toBe("Number");
    expect(detectType({ $numberDouble: "12.34" })).toBe("Number");
    expect(detectType({ $numberDecimal: "9.99" })).toBe("Number");
  });

  it("should detect BSON ObjectID and Date", () => {
    expect(detectType({ $oid: "507f1f77bcf86cd799439011" })).toBe("ObjectID");
    expect(detectType({ $date: "2026-06-18T19:00:00Z" })).toBe("Date");
  });

  it("should detect strings", () => {
    expect(detectType("hello")).toBe("String");
    expect(detectType("")).toBe("String");
  });

  it("should detect arrays", () => {
    expect(detectType([])).toBe("Array");
    expect(detectType([1, 2, 3])).toBe("Array");
  });

  it("should detect nested objects", () => {
    expect(detectType({})).toBe("Object");
    expect(detectType({ name: "Compass+" })).toBe("Object");
  });
});

describe("schemaAnalyzer numeric value extraction", () => {
  it("should extract native numbers", () => {
    expect(getNumericValue(42)).toBe(42);
    expect(getNumericValue(3.14)).toBe(3.14);
  });

  it("should extract BSON number representations", () => {
    expect(getNumericValue({ $numberLong: "999" })).toBe(999);
    expect(getNumericValue({ $numberInt: "-5" })).toBe(-5);
    expect(getNumericValue({ $numberDouble: "123.45" })).toBe(123.45);
    expect(getNumericValue({ $numberDecimal: "0.1" })).toBe(0.1);
  });

  it("should return 0 for non-numeric non-object values", () => {
    expect(getNumericValue("not a number")).toBe(0);
    expect(getNumericValue(null)).toBe(0);
    expect(getNumericValue(undefined)).toBe(0);
  });

  it("should return 0 for an object without any BSON number key", () => {
    expect(getNumericValue({ someKey: "value" })).toBe(0);
  });
});

describe("schemaAnalyzer stringify helper", () => {
  it("should format types clearly", () => {
    expect(stringifyValue(null)).toBe("null");
    expect(stringifyValue(true)).toBe("true");
    expect(stringifyValue(42)).toBe("42");
    expect(stringifyValue("hello")).toBe('"hello"');
    expect(stringifyValue({ $oid: "abc" })).toBe('ObjectId("abc")');
    expect(stringifyValue({ $date: "2026-06-18T19:00:00Z" })).toBe('ISODate("2026-06-18T19:00:00Z")');
    expect(stringifyValue({ $numberLong: "100" })).toBe("100");
  });

  it("should stringify undefined as 'undefined'", () => {
    expect(stringifyValue(undefined)).toBe("undefined");
  });

  it("should stringify false boolean as 'false'", () => {
    expect(stringifyValue(false)).toBe("false");
  });

  it("should stringify BSON number types as their string representations", () => {
    expect(stringifyValue({ $numberInt: "7" })).toBe("7");
    expect(stringifyValue({ $numberDouble: "3.14" })).toBe("3.14");
    expect(stringifyValue({ $numberDecimal: "99.99" })).toBe("99.99");
  });

  it("should stringify generic objects via JSON.stringify", () => {
    expect(stringifyValue({ foo: "bar" })).toBe('{"foo":"bar"}');
  });

  it("should stringify $date with numeric millisecond value", () => {
    const epochMs = 0;
    const result = stringifyValue({ $date: epochMs });
    expect(result).toBe('ISODate("1970-01-01T00:00:00.000Z")');
  });

  it("should stringify $date with $numberLong millisecond value", () => {
    const result = stringifyValue({ $date: { $numberLong: "0" } });
    expect(result).toBe('ISODate("1970-01-01T00:00:00.000Z")');
  });

  it("should fall through to String() for non-object primitive-like values", () => {
    // Symbol is not null/undefined/boolean/number/string/object — hits the final String(val)
    const sym = Symbol("test");
    expect(stringifyValue(sym)).toBe(sym.toString());
  });
});

describe("schemaAnalyzer document analysis", () => {
  it("should return empty result for empty list", () => {
    const res = analyzeDocuments([]);
    expect(res.totalDocs).toBe(0);
    expect(res.fields.length).toBe(0);
  });

  it("should analyze simple documents and compute stats", () => {
    const docs = [
      { name: "John", age: 30, active: true },
      { name: "Jane", age: 25, active: false },
      { name: "Bob", active: true }, // age is missing
    ];

    const res = analyzeDocuments(docs);
    expect(res.totalDocs).toBe(3);
    expect(res.totalFields).toBe(3);
    expect(res.maxDepth).toBe(1);
    expect(res.sparsityPercent).toBe(0);

    const nameField = res.fields.find(f => f.path === "name")!;
    expect(nameField).toBeDefined();
    expect(nameField.occurrences).toBe(3);
    expect(nameField.percentage).toBe(1.0);
    expect(nameField.types.length).toBe(1);
    expect(nameField.types[0].type).toBe("String");
    expect(nameField.types[0].minLength).toBe(3);
    expect(nameField.types[0].maxLength).toBe(4);

    const ageField = res.fields.find(f => f.path === "age")!;
    expect(ageField).toBeDefined();
    expect(ageField.occurrences).toBe(2);
    expect(ageField.percentage).toBe(Number((2/3).toFixed(4)));
    expect(ageField.types[0].type).toBe("Number");
    expect(ageField.types[0].min).toBe(25);
    expect(ageField.types[0].max).toBe(30);
    expect(ageField.types[0].mean).toBe(27.5);
  });

  it("should detect mixed types and warnings", () => {
    const docs = [
      { status: "active" },
      { status: 1 }, // status is mixed String and Number
      { score: 100 }, // status is missing (sparse)
    ];

    const res = analyzeDocuments(docs);
    const statusField = res.fields.find(f => f.path === "status")!;
    expect(statusField.warnings.some(w => w.includes("Mixed Types"))).toBe(true);

    const scoreField = res.fields.find(f => f.path === "score")!;
    expect(scoreField.warnings.some(w => w.includes("Sparse Field"))).toBe(true);
    expect(res.mixedTypesCount).toBe(1);
  });

  it("should recursively analyze nested objects and arrays", () => {
    const docs = [
      {
        profile: {
          firstName: "John",
          contacts: { email: "john@example.com" }
        },
        tags: ["admin", "staff"]
      }
    ];

    const res = analyzeDocuments(docs);
    expect(res.maxDepth).toBe(3); // profile.contacts.email has depth 3

    const emailField = res.fields.find(f => f.path === "profile.contacts.email");
    expect(emailField).toBeDefined();
    expect(emailField!.types[0].type).toBe("String");

    const tagsField = res.fields.find(f => f.path === "tags")!;
    // tags has Array and String (elements) types
    expect(tagsField.types.map(t => t.type)).toContain("Array");
    expect(tagsField.types.map(t => t.type)).toContain("String");
  });

  it("should handle non-object documents at the root (_root path)", () => {
    // Line 155 branch: document is not an object (e.g. a primitive or array)
    const docs = ["just a string"];
    const res = analyzeDocuments(docs);
    const rootField = res.fields.find(f => f.path === "_root");
    expect(rootField).toBeDefined();
    expect(rootField!.types[0].type).toBe("String");
  });

  it("should warn for non-standard _id type (not ObjectID)", () => {
    // Line 216 branch: _id field exists but is not ObjectID
    const docs = [{ _id: "string-id", value: 1 }];
    const res = analyzeDocuments(docs);
    const idField = res.fields.find(f => f.path === "_id")!;
    expect(idField).toBeDefined();
    expect(idField.warnings.some(w => w.includes("Non-standard _id"))).toBe(true);
  });

  it("should NOT warn for _id that uses ObjectID type", () => {
    const docs = [{ _id: { $oid: "507f1f77bcf86cd799439011" }, value: 1 }];
    const res = analyzeDocuments(docs);
    const idField = res.fields.find(f => f.path === "_id")!;
    expect(idField.warnings.every(w => !w.includes("Non-standard _id"))).toBe(true);
  });

  it("should compute array length stats for Array type fields", () => {
    const docs = [
      { tags: ["a", "b", "c"] },
      { tags: ["x"] },
    ];
    const res = analyzeDocuments(docs);
    const tagsField = res.fields.find(f => f.path === "tags")!;
    const arrayTypeStats = tagsField.types.find(t => t.type === "Array");
    expect(arrayTypeStats).toBeDefined();
    expect(arrayTypeStats!.minLength).toBe(1);
    expect(arrayTypeStats!.maxLength).toBe(3);
  });
});

describe("schemaAnalyzer snapshot comparison", () => {
  it("should flag all as new if no previous snapshot exists", () => {
    const current = analyzeDocuments([{ name: "John" }]);
    const res = compareSnapshots(current, null);
    expect(res.fields.every(f => f.comparison === "new")).toBe(true);
  });

  it("should compare snapshots and detect changes, additions, and removals", () => {
    const prevDocs = [
      { name: "John", age: 30, email: "john@example.com" }
    ];
    const currDocs = [
      { name: "Jane", age: "31", phone: "123-456" } // age type changed String, phone is new, email is removed
    ];

    const prev = analyzeDocuments(prevDocs);
    const curr = analyzeDocuments(currDocs);

    const res = compareSnapshots(curr, prev);

    const nameField = res.fields.find(f => f.path === "name")!;
    expect(nameField.comparison).toBe("unchanged");

    const ageField = res.fields.find(f => f.path === "age")!;
    expect(ageField.comparison).toBe("type_changed");
    expect(ageField.prevTypes).toContain("Number");

    const phoneField = res.fields.find(f => f.path === "phone")!;
    expect(phoneField.comparison).toBe("new");

    const emailField = res.fields.find(f => f.path === "email")!;
    expect(emailField.comparison).toBe("removed");
    expect(emailField.occurrences).toBe(0);
  });

  it("should preserve fields already marked as 'removed' in previous snapshot", () => {
    // Line 373 branch: prevField.comparison === 'removed' keeps the field as-is
    const prevDocs = [{ name: "John", legacy: "old-value" }];
    const currDocs = [{ name: "John" }];

    const prev = analyzeDocuments(prevDocs);
    const curr = analyzeDocuments(currDocs);

    // First comparison: legacy becomes 'removed'
    const firstComp = compareSnapshots(curr, prev);
    const removedLegacy = firstComp.fields.find(f => f.path === "legacy")!;
    expect(removedLegacy.comparison).toBe("removed");

    // Second comparison: pass a snapshot where legacy is already 'removed'
    // compareSnapshots treats the previous as a SchemaAnalysisResult, so we feed firstComp as previous
    const secondComp = compareSnapshots(curr, firstComp);
    const stillRemoved = secondComp.fields.find(f => f.path === "legacy")!;
    // The branch at line 371-373 fires: prevField.comparison === 'removed' -> push prevField as-is
    expect(stillRemoved.comparison).toBe("removed");
  });
});
