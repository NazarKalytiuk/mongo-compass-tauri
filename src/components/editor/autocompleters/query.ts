/**
 * Query autocompleter — for find filters, sort and projection inputs.
 *
 * Key position  → field names + query operators ($gt, $in, $exists, ...).
 * Value position → `$field` references + BSON-type constructors.
 *
 * Returns a CodeMirror `CompletionSource`.
 */
import type { Completion, CompletionSource } from "@codemirror/autocomplete";
import {
  filterCompletions,
  dictionaryToCmCompletion,
  fieldToCmCompletion,
} from "../completer";
import type { EditorField } from "../fieldsFromSchema";
import { getCursorContext } from "./context";

export interface QueryAutocompleterOptions {
  fields?: EditorField[];
  serverVersion?: string;
}

/** Matches the token being typed: identifiers, dotted paths, and `$`-sigils. */
const TOKEN_RE = /[$\w.]*/;

export function createQueryAutocompleter(
  options: QueryAutocompleterOptions = {}
): CompletionSource {
  const { fields = [], serverVersion } = options;

  return (context) => {
    const word = context.matchBefore(TOKEN_RE);
    if (!word) return null;
    // Only auto-open on an explicit request when there's nothing typed yet.
    if (word.from === word.to && !context.explicit) return null;

    const prefix = word.text;
    const ctx = getCursorContext(context.state.doc.toString(), context.pos);
    const completionOptions: Completion[] = [];

    if (ctx === "key") {
      for (const field of fields) {
        completionOptions.push(fieldToCmCompletion(field, false));
      }
      for (const entry of filterCompletions(prefix, ["query-operator"], {
        serverVersion,
      })) {
        completionOptions.push(dictionaryToCmCompletion(entry));
      }
    } else {
      for (const field of fields) {
        completionOptions.push(fieldToCmCompletion(field, true));
      }
      for (const entry of filterCompletions(prefix, ["bson-type"], {
        serverVersion,
      })) {
        completionOptions.push(dictionaryToCmCompletion(entry));
      }
    }

    if (completionOptions.length === 0) return null;

    return {
      from: word.from,
      options: completionOptions,
      validFor: TOKEN_RE,
    };
  };
}
