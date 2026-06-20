import { describe, it, expect } from "vitest";
import {
  detectType,
  isBsonNumber,
  getBsonNumberValue,
  getNumericValue,
  formatBsonDate,
  stringifyValue,
} from "../../bsonUtils";

// ── detectType ─────────────────────────────────────────────────────────────────

describe("detectType", () => {
  it("returns Null for null", () => {
    expect(detectType(null)).toBe("Null");
  });

  it("returns Null for undefined", () => {
    expect(detectType(undefined)).toBe("Null");
  });

  it("returns Boolean for true", () => {
    expect(detectType(true)).toBe("Boolean");
  });

  it("returns Boolean for false", () => {
    expect(detectType(false)).toBe("Boolean");
  });

  it("returns Number for numeric values", () => {
    expect(detectType(42)).toBe("Number");
    expect(detectType(0)).toBe("Number");
    expect(detectType(-3.14)).toBe("Number");
  });

  it("returns Array for arrays", () => {
    expect(detectType([])).toBe("Array");
    expect(detectType([1, 2, 3])).toBe("Array");
  });

  it("returns ObjectID for $oid objects", () => {
    expect(detectType({ $oid: "507f1f77bcf86cd799439011" })).toBe("ObjectID");
  });

  it("returns Date for $date objects", () => {
    expect(detectType({ $date: "2026-01-01T00:00:00.000Z" })).toBe("Date");
  });

  it("returns Number for $numberLong objects", () => {
    expect(detectType({ $numberLong: "12345" })).toBe("Number");
  });

  it("returns Number for $numberInt objects", () => {
    expect(detectType({ $numberInt: "42" })).toBe("Number");
  });

  it("returns Number for $numberDouble objects", () => {
    expect(detectType({ $numberDouble: "3.14" })).toBe("Number");
  });

  it("returns Number for $numberDecimal objects", () => {
    expect(detectType({ $numberDecimal: "99.99" })).toBe("Number");
  });

  it("returns Object for plain objects", () => {
    expect(detectType({ foo: "bar" })).toBe("Object");
    expect(detectType({})).toBe("Object");
  });

  it("returns String for string values", () => {
    expect(detectType("hello")).toBe("String");
    expect(detectType("")).toBe("String");
  });

  it("returns Unknown for symbols and functions (non-string primitives that aren't handled)", () => {
    // Functions fall through all checks (typeof is "function", not object/string/number/boolean)
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    expect(detectType(() => {})).toBe("Unknown");
  });
});

// ── isBsonNumber ──────────────────────────────────────────────────────────────

describe("isBsonNumber", () => {
  it("returns true for $numberLong", () => {
    expect(isBsonNumber({ $numberLong: "100" })).toBe(true);
  });

  it("returns true for $numberInt", () => {
    expect(isBsonNumber({ $numberInt: "1" })).toBe(true);
  });

  it("returns true for $numberDouble", () => {
    expect(isBsonNumber({ $numberDouble: "1.5" })).toBe(true);
  });

  it("returns true for $numberDecimal", () => {
    expect(isBsonNumber({ $numberDecimal: "9.99" })).toBe(true);
  });

  it("returns false for plain numbers", () => {
    expect(isBsonNumber(42)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isBsonNumber(null)).toBe(false);
  });

  it("returns false for plain objects without BSON keys", () => {
    expect(isBsonNumber({ foo: "bar" })).toBe(false);
  });

  it("returns false for strings", () => {
    expect(isBsonNumber("123")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isBsonNumber(undefined)).toBe(false);
  });
});

// ── getBsonNumberValue ────────────────────────────────────────────────────────

describe("getBsonNumberValue", () => {
  it("extracts $numberLong value as string", () => {
    expect(getBsonNumberValue({ $numberLong: "9876543210" })).toBe("9876543210");
  });

  it("extracts $numberInt value as string", () => {
    expect(getBsonNumberValue({ $numberInt: 7 })).toBe("7");
  });

  it("extracts $numberDouble value as string", () => {
    expect(getBsonNumberValue({ $numberDouble: 3.14 })).toBe("3.14");
  });

  it("extracts $numberDecimal value as string", () => {
    expect(getBsonNumberValue({ $numberDecimal: "0.001" })).toBe("0.001");
  });

  it("returns empty string for non-BSON objects", () => {
    expect(getBsonNumberValue({ foo: "bar" })).toBe("");
  });

  it("returns empty string for null", () => {
    expect(getBsonNumberValue(null)).toBe("");
  });

  it("returns empty string for plain number", () => {
    expect(getBsonNumberValue(42)).toBe("");
  });

  it("returns empty string for string input", () => {
    expect(getBsonNumberValue("hello")).toBe("");
  });
});

// ── getNumericValue ────────────────────────────────────────────────────────────

describe("getNumericValue", () => {
  it("returns the number directly for numeric input", () => {
    expect(getNumericValue(42)).toBe(42);
    expect(getNumericValue(0)).toBe(0);
    expect(getNumericValue(-7.5)).toBe(-7.5);
  });

  it("converts $numberLong to number", () => {
    expect(getNumericValue({ $numberLong: "9007199254740991" })).toBe(9007199254740991);
  });

  it("converts $numberInt to number", () => {
    expect(getNumericValue({ $numberInt: "100" })).toBe(100);
  });

  it("converts $numberDouble to number", () => {
    expect(getNumericValue({ $numberDouble: "2.718" })).toBe(2.718);
  });

  it("converts $numberDecimal to number", () => {
    expect(getNumericValue({ $numberDecimal: "99.99" })).toBe(99.99);
  });

  it("returns 0 for null", () => {
    expect(getNumericValue(null)).toBe(0);
  });

  it("returns 0 for plain objects without BSON number keys", () => {
    expect(getNumericValue({ foo: "bar" })).toBe(0);
  });

  it("returns 0 for strings", () => {
    expect(getNumericValue("42")).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(getNumericValue(undefined)).toBe(0);
  });
});

// ── formatBsonDate ─────────────────────────────────────────────────────────────

describe("formatBsonDate", () => {
  it("returns string unchanged when input is a string", () => {
    expect(formatBsonDate("2026-01-01T00:00:00.000Z")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("converts numeric timestamp to ISO string", () => {
    const ts = 1640995200000; // 2022-01-01T00:00:00.000Z
    expect(formatBsonDate(ts)).toBe(new Date(ts).toISOString());
  });

  it("converts $numberLong date object to ISO string", () => {
    const ts = 1640995200000;
    expect(formatBsonDate({ $numberLong: String(ts) })).toBe(new Date(ts).toISOString());
  });

  it("falls back to String() for unrecognized types", () => {
    expect(formatBsonDate(true)).toBe("true");
    expect(formatBsonDate(null)).toBe("null");
  });
});

// ── stringifyValue ─────────────────────────────────────────────────────────────

describe("stringifyValue", () => {
  it("returns 'null' for null", () => {
    expect(stringifyValue(null)).toBe("null");
  });

  it("returns 'undefined' for undefined", () => {
    expect(stringifyValue(undefined)).toBe("undefined");
  });

  it("returns 'true' and 'false' for booleans", () => {
    expect(stringifyValue(true)).toBe("true");
    expect(stringifyValue(false)).toBe("false");
  });

  it("returns string representation for numbers", () => {
    expect(stringifyValue(42)).toBe("42");
    expect(stringifyValue(-3.14)).toBe("-3.14");
  });

  it("wraps strings in double quotes", () => {
    expect(stringifyValue("hello")).toBe('"hello"');
    expect(stringifyValue("")).toBe('""');
  });

  it("formats ObjectId correctly", () => {
    expect(stringifyValue({ $oid: "507f1f77bcf86cd799439011" })).toBe(
      'ObjectId("507f1f77bcf86cd799439011")'
    );
  });

  it("formats ISODate from string $date", () => {
    expect(stringifyValue({ $date: "2026-01-01T00:00:00.000Z" })).toBe(
      'ISODate("2026-01-01T00:00:00.000Z")'
    );
  });

  it("formats ISODate from numeric $date", () => {
    const ts = 1640995200000;
    expect(stringifyValue({ $date: ts })).toBe(
      `ISODate("${new Date(ts).toISOString()}")`
    );
  });

  it("formats ISODate from $date with $numberLong", () => {
    const ts = 1640995200000;
    expect(stringifyValue({ $date: { $numberLong: String(ts) } })).toBe(
      `ISODate("${new Date(ts).toISOString()}")`
    );
  });

  it("formats ISODate as empty string when $date value is an object without $numberLong", () => {
    // dateVal is an object but has no $numberLong — all three branches (string/number/numberLong) are false
    expect(stringifyValue({ $date: { someOtherKey: "value" } })).toBe('ISODate("")');
  });

  it("returns $numberLong value as string", () => {
    expect(stringifyValue({ $numberLong: "9007199254740991" })).toBe("9007199254740991");
  });

  it("returns $numberInt value as string", () => {
    expect(stringifyValue({ $numberInt: "42" })).toBe("42");
  });

  it("returns $numberDouble value as string", () => {
    expect(stringifyValue({ $numberDouble: "3.14" })).toBe("3.14");
  });

  it("returns $numberDecimal value as string", () => {
    expect(stringifyValue({ $numberDecimal: "99.99" })).toBe("99.99");
  });

  it("falls back to JSON.stringify for plain objects", () => {
    expect(stringifyValue({ foo: "bar", baz: 1 })).toBe(JSON.stringify({ foo: "bar", baz: 1 }));
  });

  it("falls back to String() for other types (e.g. Symbol)", () => {
    const sym = Symbol("test");
    expect(stringifyValue(sym)).toBe(String(sym));
  });
});
