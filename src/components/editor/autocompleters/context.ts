/**
 * Lexical cursor-context detection for mongo-style JSON.
 *
 * Determines whether the cursor sits in a "key" position (a document field /
 * operator name) or a "value" position (after a `:` or inside an array). Ported
 * from the original AggregationBuilder `getCursorContext`, kept purely lexical
 * so it tolerates partial/invalid JSON exactly like the editor needs.
 */
export type CursorContext = "key" | "value";

export function getCursorContext(value: string, pos: number): CursorContext {
  // Skip back over the token currently being typed.
  let i = pos - 1;
  while (i >= 0 && /[a-zA-Z0-9_$.]/.test(value[i])) {
    i--;
  }

  // Find the last non-whitespace character before the token.
  let lastChar = "";
  while (i >= 0) {
    if (!/\s/.test(value[i])) {
      lastChar = value[i];
      break;
    }
    i--;
  }

  if (lastChar === ":") {
    return "value";
  }

  // Trace bracket/brace depth to find the enclosing structure.
  let braceDepth = 0;
  let bracketDepth = 0;
  while (i >= 0) {
    const char = value[i];
    if (char === "}") {
      braceDepth++;
    } else if (char === "{") {
      if (braceDepth > 0) braceDepth--;
      else return "key";
    } else if (char === "]") {
      bracketDepth++;
    } else if (char === "[") {
      if (bracketDepth > 0) bracketDepth--;
      else return "value";
    }
    i--;
  }

  return "key";
}
