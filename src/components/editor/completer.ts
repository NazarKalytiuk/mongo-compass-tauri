/**
 * Completion matcher — our own replacement for `@mongodb-js/mongodb-constants`'
 * `completer()` / `getFilteredCompletions()` helpers.
 *
 * It filters the hand-authored dictionary by category (meta) and prefix, applies
 * server-version gating, and maps results into CodeMirror `Completion` objects.
 */
import type { Completion } from "@codemirror/autocomplete";
import {
  COMPLETIONS_BY_META,
  type MongoCompletion,
  type MongoMeta,
} from "./mongodbDictionary";
import type { EditorField } from "./fieldsFromSchema";

/** Parses a server version string (e.g. "7.0.5") into [major, minor, patch]. */
function parseVersion(version?: string): [number, number, number] | null {
  if (!version) return null;
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** Returns true when `required` <= `server` (or either is unknown). */
function versionSatisfies(required?: string, serverVersion?: string): boolean {
  const req = parseVersion(required);
  const server = parseVersion(serverVersion);
  // If we can't determine either side, don't hide the completion.
  if (!req || !server) return true;
  for (let i = 0; i < 3; i++) {
    if (server[i] > req[i]) return true;
    if (server[i] < req[i]) return false;
  }
  return true;
}

/** Strips a leading `$` (or `$$`) so prefixes match regardless of typed sigil. */
function bareToken(token: string): string {
  return token.replace(/^\$+/, "").toLowerCase();
}

export interface FilterOptions {
  serverVersion?: string;
}

/**
 * Returns dictionary entries of the given categories whose name matches `prefix`.
 * `prefix` may or may not include a leading `$`.
 */
export function filterCompletions(
  prefix: string,
  metas: MongoMeta[],
  options: FilterOptions = {}
): MongoCompletion[] {
  const bare = bareToken(prefix);
  const seen = new Set<string>();
  const out: MongoCompletion[] = [];

  for (const meta of metas) {
    for (const entry of COMPLETIONS_BY_META[meta]) {
      if (seen.has(entry.name)) continue;
      if (!versionSatisfies(entry.version, options.serverVersion)) continue;
      const entryBare = bareToken(entry.name);
      if (bare === "" || entryBare.startsWith(bare)) {
        seen.add(entry.name);
        out.push(entry);
      }
    }
  }

  // Exact-prefix matches first, then alphabetical for stable ordering.
  out.sort((a, b) => {
    const aExact = bareToken(a.name) === bare ? 0 : 1;
    const bExact = bareToken(b.name) === bare ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return a.name.localeCompare(b.name);
  });

  return out;
}

/** Maps a dictionary entry to a CodeMirror completion. */
export function dictionaryToCmCompletion(entry: MongoCompletion): Completion {
  return {
    label: entry.name,
    detail: entry.meta,
    info: entry.description,
    type: entry.meta === "bson-type" ? "class" : "keyword",
  };
}

/**
 * Maps a collection field to a CodeMirror completion.
 * When `asReference` is set, the field is offered as a `$`-prefixed reference
 * (used in aggregation value position, e.g. `"$user.name"`).
 */
export function fieldToCmCompletion(
  field: EditorField,
  asReference = false
): Completion {
  const label = asReference ? "$" + field.name : field.name;
  return {
    label,
    detail: field.description ? `field · ${field.description}` : "field",
    type: "property",
  };
}
