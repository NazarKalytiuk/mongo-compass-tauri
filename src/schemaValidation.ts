/**
 * Shared schema-validation helpers.
 * Used by DocumentEditorModal (live lint) and ValidationView (rule authoring + preview).
 */
import { detectType, getNumericValue, numberKind } from "./bsonUtils";
import { SchemaAnalysisResult } from "./schemaAnalyzer";

export interface ValidationError {
  path: string;
  message: string;
}

export function matchBsonType(val: any, expected: string | string[]): boolean {
  if (Array.isArray(expected)) {
    return expected.some((t) => matchBsonType(val, t));
  }

  const detected = detectType(val);
  switch (expected) {
    case "string":
      return detected === "String";
    case "bool":
    case "boolean":
      return detected === "Boolean";
    case "number":
      return detected === "Number";
    case "double":
      return numberKind(val) === "double";
    case "int":
      return numberKind(val) === "int32";
    case "long":
      return numberKind(val) === "int64";
    case "decimal":
      return numberKind(val) === "decimal128";
    case "object":
      return detected === "Object";
    case "array":
      return detected === "Array";
    case "objectId":
      return detected === "ObjectID";
    case "date":
      return detected === "Date";
    case "null":
      return detected === "Null";
    default:
      return true;
  }
}

export function validateAgainstSchema(
  value: any,
  schema: any,
  path: string = ""
): ValidationError[] {
  if (!schema || typeof schema !== "object") return [];

  const errors: ValidationError[] = [];
  const activeSchema = schema.$jsonSchema ? schema.$jsonSchema : schema;

  // Type validation
  if (activeSchema.bsonType || activeSchema.type) {
    const expectedType = activeSchema.bsonType || activeSchema.type;
    if (!matchBsonType(value, expectedType)) {
      errors.push({
        path,
        message: `Expected type '${expectedType}' but got '${detectType(value)}'`,
      });
    }
  }

  // Enum validation
  if (Array.isArray(activeSchema.enum)) {
    const matched = activeSchema.enum.some(
      (e: any) => JSON.stringify(e) === JSON.stringify(value)
    );
    if (!matched) {
      errors.push({
        path,
        message: `Value must be one of the permitted enum values`,
      });
    }
  }

  // Object properties validation
  if (detectType(value) === "Object") {
    if (Array.isArray(activeSchema.required)) {
      activeSchema.required.forEach((key: string) => {
        if (!(key in value)) {
          errors.push({
            path: path ? `${path}.${key}` : key,
            message: `Field is required`,
          });
        }
      });
    }

    if (activeSchema.properties && typeof activeSchema.properties === "object") {
      Object.keys(activeSchema.properties).forEach((key) => {
        if (key in value) {
          errors.push(
            ...validateAgainstSchema(
              value[key],
              activeSchema.properties[key],
              path ? `${path}.${key}` : key
            )
          );
        }
      });
    }
  }

  // Array items validation
  if (detectType(value) === "Array" && Array.isArray(value)) {
    if (activeSchema.items) {
      value.forEach((item, idx) => {
        errors.push(
          ...validateAgainstSchema(item, activeSchema.items, `${path}[${idx}]`)
        );
      });
    }
  }

  // Value bounds/ranges validation
  if (numberKind(value) !== null) {
    const n = getNumericValue(value);
    if (typeof activeSchema.minimum === "number" && n < activeSchema.minimum) {
      errors.push({ path, message: `Must be at least ${activeSchema.minimum}` });
    }
    if (typeof activeSchema.maximum === "number" && n > activeSchema.maximum) {
      errors.push({ path, message: `Must be at most ${activeSchema.maximum}` });
    }
  }

  if (typeof value === "string") {
    if (typeof activeSchema.minLength === "number" && value.length < activeSchema.minLength) {
      errors.push({ path, message: `Must be at least ${activeSchema.minLength} characters long` });
    }
    if (typeof activeSchema.maxLength === "number" && value.length > activeSchema.maxLength) {
      errors.push({ path, message: `Must be at most ${activeSchema.maxLength} characters long` });
    }
    if (typeof activeSchema.pattern === "string") {
      try {
        const regex = new RegExp(activeSchema.pattern);
        if (!regex.test(value)) {
          errors.push({ path, message: `Must match pattern: ${activeSchema.pattern}` });
        }
      } catch {
        // Skip invalid pattern regex configurations
      }
    }
  }

  return errors;
}

// Map the analyzer's detected type label to a MongoDB bsonType keyword
function analyzerTypeToBson(type: string): string {
  switch (type) {
    case "String": return "string";
    case "Boolean": return "bool";
    case "Number": return "number";
    case "Object": return "object";
    case "Array": return "array";
    case "ObjectID": return "objectId";
    case "Date": return "date";
    case "Null": return "null";
    default: return "string";
  }
}

/**
 * Build a `$jsonSchema` validator from a schema analysis result.
 * Only top-level fields are emitted. Fields present in 100% of the sample
 * become `required`; the dominant type of each field becomes its `bsonType`.
 */
export function generateJsonSchema(analysis: SchemaAnalysisResult): any {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const field of analysis.fields) {
    // Top-level fields only (no dots / array markers)
    if (field.path.includes(".") || field.path.includes("[")) continue;
    if (field.path === "_id") continue;

    const dominant = field.types[0];
    if (!dominant) continue;

    properties[field.path] = {
      bsonType: analyzerTypeToBson(dominant.type),
      description: `must be a ${analyzerTypeToBson(dominant.type)}`,
    };

    if (field.percentage >= 0.999) {
      required.push(field.path);
    }
  }

  const schema: any = {
    bsonType: "object",
    properties,
  };
  if (required.length > 0) {
    schema.required = required;
  }

  return { $jsonSchema: schema };
}
