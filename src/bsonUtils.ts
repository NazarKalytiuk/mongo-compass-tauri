/**
 * Shared BSON utility helpers.
 * All BSON-type detection / formatting logic lives here so that
 * DocumentExplorer, SchemaView, and schemaAnalyzer can share one source.
 */

// ── Type detection ─────────────────────────────────────────────────────────────

export function detectType(val: any): string {
  if (val === null || val === undefined) return "Null";
  if (typeof val === "boolean") return "Boolean";
  if (typeof val === "number") return "Number";
  if (Array.isArray(val)) return "Array";
  if (typeof val === "object") {
    if ("$oid" in val) return "ObjectID";
    if ("$date" in val) return "Date";
    if (
      "$numberLong" in val ||
      "$numberInt" in val ||
      "$numberDouble" in val ||
      "$numberDecimal" in val
    )
      return "Number";
    return "Object";
  }
  if (typeof val === "string") return "String";
  return "Unknown";
}

export function isBsonNumber(val: any): boolean {
  if (val && typeof val === "object") {
    return (
      "$numberLong" in val ||
      "$numberInt" in val ||
      "$numberDouble" in val ||
      "$numberDecimal" in val
    );
  }
  return false;
}

export function getBsonNumberValue(val: any): string {
  if (val && typeof val === "object") {
    if ("$numberLong" in val) return String(val.$numberLong);
    if ("$numberInt" in val) return String(val.$numberInt);
    if ("$numberDouble" in val) return String(val.$numberDouble);
    if ("$numberDecimal" in val) return String(val.$numberDecimal);
  }
  return "";
}

// ── Numeric helpers ────────────────────────────────────────────────────────────

/** BSON numeric types as they arrive from the backend (see src-tauri/src/ejson.rs). */
export type NumberKind = "int32" | "int64" | "double" | "decimal128";

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/**
 * The BSON type of a numeric wire value, or null if it is not a number.
 * Int32 and fractional doubles arrive as plain numbers; Int64, integral doubles
 * and decimals arrive in their Extended JSON wrappers.
 */
export function numberKind(val: any): NumberKind | null {
  if (typeof val === "number") {
    if (!Number.isInteger(val)) return "double";
    // The backend's parser stores integers outside the int32 range as Int64.
    return val >= INT32_MIN && val <= INT32_MAX ? "int32" : "int64";
  }
  if (val && typeof val === "object") {
    if ("$numberInt" in val) return "int32";
    if ("$numberLong" in val) return "int64";
    if ("$numberDouble" in val) return "double";
    if ("$numberDecimal" in val) return "decimal128";
  }
  return null;
}

/** Exact text of a numeric wire value (no precision loss for Int64/Decimal128). */
export function numberText(val: any): string {
  if (typeof val === "number") return String(val);
  return getBsonNumberValue(val);
}

/**
 * Builds the wire value for a number of the given kind from user-entered text.
 * Returns an error message instead when the text is not valid for that kind.
 */
export function numberFromText(kind: NumberKind, text: string): { value: any } | { error: string } {
  const t = text.trim();
  switch (kind) {
    case "int32": {
      if (!/^-?\d+$/.test(t)) return { error: "Int32 must be a whole number" };
      const n = Number(t);
      if (n < INT32_MIN || n > INT32_MAX) return { error: "Out of Int32 range; use Int64" };
      return { value: n };
    }
    case "int64": {
      if (!/^-?\d+$/.test(t)) return { error: "Int64 must be a whole number" };
      const big = BigInt(t);
      if (big < -(2n ** 63n) || big > 2n ** 63n - 1n) return { error: "Out of Int64 range" };
      return { value: { $numberLong: big.toString() } };
    }
    case "double": {
      if (/^(NaN|-?Infinity)$/.test(t)) return { value: { $numberDouble: t } };
      const n = Number(t);
      if (t === "" || !Number.isFinite(n)) return { error: "Double must be a number" };
      // JSON.stringify(3.0) is "3", which the backend would read as Int32.
      return { value: Number.isInteger(n) ? { $numberDouble: String(n) } : n };
    }
    case "decimal128": {
      if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$|^(NaN|[-+]?Infinity)$/.test(t)) return { error: "Decimal128 must be a decimal number" };
      return { value: { $numberDecimal: t } };
    }
  }
}

export function getNumericValue(val: any): number {
  if (typeof val === "number") return val;
  if (val && typeof val === "object") {
    if ("$numberLong" in val) return Number(val.$numberLong);
    if ("$numberInt" in val) return Number(val.$numberInt);
    if ("$numberDouble" in val) return Number(val.$numberDouble);
    if ("$numberDecimal" in val) return Number(val.$numberDecimal);
  }
  return 0;
}

// ── Date helpers ───────────────────────────────────────────────────────────────

export function formatBsonDate(dateVal: any): string {
  if (typeof dateVal === "string") return dateVal;
  if (typeof dateVal === "number") return new Date(dateVal).toISOString();
  if (dateVal && typeof dateVal === "object" && "$numberLong" in dateVal) {
    return new Date(Number(dateVal.$numberLong)).toISOString();
  }
  return String(dateVal);
}

// ── Generic string representation ─────────────────────────────────────────────

export function stringifyValue(val: any): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return `"${val}"`;
  if (val && typeof val === "object") {
    if ("$oid" in val) return `ObjectId("${val.$oid}")`;
    if ("$date" in val) {
      const dateVal = val.$date;
      let dateStr = "";
      if (typeof dateVal === "string") dateStr = dateVal;
      else if (typeof dateVal === "number")
        dateStr = new Date(dateVal).toISOString();
      else if (
        dateVal &&
        typeof dateVal === "object" &&
        "$numberLong" in dateVal
      ) {
        dateStr = new Date(Number(dateVal.$numberLong)).toISOString();
      }
      return `ISODate("${dateStr}")`;
    }
    if ("$numberLong" in val) return String(val.$numberLong);
    if ("$numberInt" in val) return String(val.$numberInt);
    if ("$numberDouble" in val) return String(val.$numberDouble);
    if ("$numberDecimal" in val) return String(val.$numberDecimal);
    return JSON.stringify(val);
  }
  return String(val);
}
