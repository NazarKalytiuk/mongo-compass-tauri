import { describe, it, expect } from "vitest";
import { validateAgainstSchema, matchBsonType, generateJsonSchema } from "../../schemaValidation";
import { analyzeDocuments } from "../../schemaAnalyzer";

describe("matchBsonType", () => {
  it("matches scalar bson types", () => {
    expect(matchBsonType("hi", "string")).toBe(true);
    expect(matchBsonType(5, "number")).toBe(true);
    expect(matchBsonType(5, "int")).toBe(true);
    expect(matchBsonType(true, "bool")).toBe(true);
    expect(matchBsonType(null, "null")).toBe(true);
    expect(matchBsonType({ $oid: "x" }, "objectId")).toBe(true);
    expect(matchBsonType({ $date: "x" }, "date")).toBe(true);
  });

  it("returns false on type mismatch and supports arrays of types", () => {
    expect(matchBsonType("hi", "number")).toBe(false);
    expect(matchBsonType("hi", ["number", "string"])).toBe(true);
    expect(matchBsonType(5, ["string", "bool"])).toBe(false);
  });
});

describe("validateAgainstSchema", () => {
  const schema = {
    $jsonSchema: {
      bsonType: "object",
      required: ["name", "age"],
      properties: {
        name: { bsonType: "string" },
        age: { bsonType: "number", minimum: 0, maximum: 120 },
        role: { enum: ["admin", "user"] },
      },
    },
  };

  it("returns no errors for a valid document", () => {
    expect(validateAgainstSchema({ name: "A", age: 30, role: "admin" }, schema)).toHaveLength(0);
  });

  it("flags a missing required field", () => {
    const errors = validateAgainstSchema({ name: "A" }, schema);
    expect(errors.some((e) => e.path === "age" && /required/i.test(e.message))).toBe(true);
  });

  it("flags a wrong type and out-of-range number", () => {
    const errors = validateAgainstSchema({ name: 1, age: 200 }, schema);
    expect(errors.some((e) => e.path === "name" && /type/i.test(e.message))).toBe(true);
    expect(errors.some((e) => e.path === "age" && /at most/i.test(e.message))).toBe(true);
  });

  it("flags an invalid enum value", () => {
    const errors = validateAgainstSchema({ name: "A", age: 30, role: "root" }, schema);
    expect(errors.some((e) => e.path === "role" && /enum/i.test(e.message))).toBe(true);
  });
});

describe("generateJsonSchema", () => {
  it("builds a $jsonSchema from a document sample with required top-level fields", () => {
    const analysis = analyzeDocuments([
      { _id: { $oid: "1" }, name: "A", age: 30 },
      { _id: { $oid: "2" }, name: "B", age: 25 },
      { _id: { $oid: "3" }, name: "C" }, // age missing -> not required
    ]);
    const schema = generateJsonSchema(analysis) as any;
    expect(schema.$jsonSchema.bsonType).toBe("object");
    expect(schema.$jsonSchema.properties.name.bsonType).toBe("string");
    expect(schema.$jsonSchema.properties.age.bsonType).toBe("number");
    // name present in 100% -> required; age missing in one -> not required; _id excluded
    expect(schema.$jsonSchema.required).toContain("name");
    expect(schema.$jsonSchema.required).not.toContain("age");
    expect(schema.$jsonSchema.properties._id).toBeUndefined();
  });
});
