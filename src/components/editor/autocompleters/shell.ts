/**
 * Lightweight shell autocompleter — for the MongoDB Shell input.
 *
 * Offers `db`, the current database's collection names (`db.<coll>`) and common
 * collection methods (`db.<coll>.<method>`). Intentionally simple — no full
 * mongosh language service.
 */
import type { Completion, CompletionSource } from "@codemirror/autocomplete";

export interface ShellAutocompleterOptions {
  collections?: string[];
}

/** Common collection methods offered after `db.<coll>.`. */
const COLLECTION_METHODS: { name: string; info: string }[] = [
  { name: "find", info: "Selects documents in a collection" },
  { name: "findOne", info: "Returns one matching document" },
  { name: "insertOne", info: "Inserts a single document" },
  { name: "insertMany", info: "Inserts multiple documents" },
  { name: "updateOne", info: "Updates a single document" },
  { name: "updateMany", info: "Updates multiple documents" },
  { name: "replaceOne", info: "Replaces a single document" },
  { name: "deleteOne", info: "Deletes a single document" },
  { name: "deleteMany", info: "Deletes multiple documents" },
  { name: "aggregate", info: "Runs an aggregation pipeline" },
  { name: "countDocuments", info: "Counts matching documents" },
  { name: "estimatedDocumentCount", info: "Fast approximate count" },
  { name: "distinct", info: "Returns distinct values for a field" },
  { name: "createIndex", info: "Creates an index" },
  { name: "getIndexes", info: "Lists the collection's indexes" },
  { name: "dropIndex", info: "Removes an index" },
  { name: "drop", info: "Drops the collection" },
  { name: "stats", info: "Returns collection statistics" },
  { name: "bulkWrite", info: "Performs bulk write operations" },
];

/** Top-level shell globals offered when no `db.` prefix is present. */
const GLOBALS: { name: string; info: string }[] = [
  { name: "db", info: "The current database" },
  { name: "use", info: "Switch the current database" },
  { name: "show", info: "Show dbs / collections / etc." },
  { name: "printjson", info: "Pretty-print a value as JSON" },
];

function toCompletions(
  entries: { name: string; info: string }[],
  type: string
): Completion[] {
  return entries.map((e) => ({ label: e.name, info: e.info, type }));
}

export function createShellAutocompleter(
  options: ShellAutocompleterOptions = {}
): CompletionSource {
  const { collections = [] } = options;
  const collectionCompletions: Completion[] = collections.map((name) => ({
    label: name,
    detail: "collection",
    type: "class",
  }));

  return (context) => {
    const before = context.state.doc.sliceString(0, context.pos);

    // After `db.<coll>.` → method completions.
    const methodMatch = /\bdb\.[\w$]+\.([\w$]*)$/.exec(before);
    if (methodMatch) {
      const word = context.matchBefore(/[\w$]*/);
      if (!word) return null;
      return {
        from: word.from,
        options: toCompletions(COLLECTION_METHODS, "method"),
        validFor: /[\w$]*/,
      };
    }

    // After `db.` → collection completions.
    const collMatch = /\bdb\.([\w$]*)$/.exec(before);
    if (collMatch) {
      const word = context.matchBefore(/[\w$]*/);
      if (!word) return null;
      return {
        from: word.from,
        options: collectionCompletions,
        validFor: /[\w$]*/,
      };
    }

    // Otherwise offer top-level globals.
    const word = context.matchBefore(/[\w$]*/);
    if (!word) return null;
    if (word.from === word.to && !context.explicit) return null;
    return {
      from: word.from,
      options: toCompletions(GLOBALS, "variable"),
      validFor: /[\w$]*/,
    };
  };
}
