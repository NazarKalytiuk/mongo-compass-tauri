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
