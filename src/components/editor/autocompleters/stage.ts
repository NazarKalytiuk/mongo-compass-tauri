/**
 * Stage autocompleter — for aggregation pipeline stage editors.
 *
 * In mongo aggregation, operators appear as object *keys* (e.g. `{ "$sum": 1 }`),
 * so key position offers field names plus query/expression/accumulator operators.
 * Value position offers `$field` references, system variables and BSON types.
 *
 * The optional `stageOperator` ($group, $project, ...) lets us bias which
 * operator categories are most relevant for that stage.
 */
import type { Completion, CompletionSource } from "@codemirror/autocomplete";
import {
  filterCompletions,
  dictionaryToCmCompletion,
  fieldToCmCompletion,
} from "../completer";
import type { MongoMeta } from "../mongodbDictionary";
import type { EditorField } from "../fieldsFromSchema";
import { getCursorContext } from "./context";

export interface StageAutocompleterOptions {
  stageOperator?: string;
  fields?: EditorField[];
  serverVersion?: string;
}

const TOKEN_RE = /[$\w.]*/;

/** Operator categories worth suggesting in key position for a given stage. */
function keyMetasForStage(stageOperator?: string): MongoMeta[] {
  switch (stageOperator) {
    case "$match":
      return ["query-operator", "expr-operator"];
    case "$group":
      return ["accumulator", "expr-operator", "conversion"];
    case "$project":
    case "$addFields":
    case "$set":
    case "$replaceRoot":
    case "$replaceWith":
      return ["expr-operator", "conversion", "accumulator"];
    case "$setWindowFields":
      return ["accumulator", "expr-operator"];
    default:
      return ["expr-operator", "accumulator", "query-operator", "conversion"];
  }
}

export function createStageAutocompleter(
  options: StageAutocompleterOptions = {}
): CompletionSource {
  const { stageOperator, fields = [], serverVersion } = options;
  const keyMetas = keyMetasForStage(stageOperator);

  return (context) => {
    const word = context.matchBefore(TOKEN_RE);
    if (!word) return null;
    if (word.from === word.to && !context.explicit) return null;

    const prefix = word.text;
    const ctx = getCursorContext(context.state.doc.toString(), context.pos);
    const completionOptions: Completion[] = [];

    if (ctx === "key") {
      for (const field of fields) {
        completionOptions.push(fieldToCmCompletion(field, false));
      }
      for (const entry of filterCompletions(prefix, keyMetas, { serverVersion })) {
        completionOptions.push(dictionaryToCmCompletion(entry));
      }
    } else {
      for (const field of fields) {
        completionOptions.push(fieldToCmCompletion(field, true));
      }
      for (const entry of filterCompletions(
        prefix,
        ["system-variable", "bson-type"],
        { serverVersion }
      )) {
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
