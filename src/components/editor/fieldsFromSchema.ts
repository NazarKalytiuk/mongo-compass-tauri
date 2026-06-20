/**
 * Maps sampled documents / schema analysis into the field-completion shape used
 * by the editor autocompleters. Reuses the existing `schemaAnalyzer`, which
 * already produces nested dotted paths (e.g. `address.street`) with type info —
 * a strict improvement over the previous top-level-only field extraction.
 */
import {
  analyzeDocuments,
  type FieldAnalysis,
} from "../../schemaAnalyzer";

export interface EditorField {
  /** Dotted field path, e.g. "address.street". */
  name: string;
  /** Short type summary, shown as the completion detail. */
  description?: string;
}

/** Builds a "String" / "String | Number" style summary from a field's types. */
function describeTypes(field: FieldAnalysis): string {
  // `types` is already sorted by count desc in schemaAnalyzer.
  const names = field.types.map((t) => t.type).filter(Boolean);
  if (names.length === 0) return "";
  // Show the two most common types to keep the hint compact.
  return names.slice(0, 2).join(" | ");
}

/** Maps analyzed schema fields into editor field completions. */
export function fieldsFromAnalysis(fields: FieldAnalysis[]): EditorField[] {
  return fields
    .map((f) => ({
      name: f.path,
      description: describeTypes(f),
    }))
    .filter((f) => f.name.length > 0);
}

/** Samples documents through the schema analyzer to derive field completions. */
export function fieldsFromDocs(docs: any[]): EditorField[] {
  if (!Array.isArray(docs) || docs.length === 0) return [];
  const analysis = analyzeDocuments(docs);
  return fieldsFromAnalysis(analysis.fields);
}
