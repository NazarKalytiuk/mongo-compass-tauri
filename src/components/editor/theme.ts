/**
 * CodeMirror themes matching the app's palette.
 *  - dark:  aggregation stage editors + shell (the #1B1F27 editor surface).
 *  - light: filter / sort / projection single-line inputs.
 *
 * Each theme bundles an `EditorView.theme` (chrome) and a `HighlightStyle`
 * (token colors mirrored from the previous hand-rolled `highlightJson`).
 */
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const ACCENT = "#F2673C";

/* ---------------------------------------------------------------- dark ---- */

const darkChrome = EditorView.theme(
  {
    "&": {
      color: "#E6E6E6",
      backgroundColor: "transparent",
      fontSize: "11px",
    },
    ".cm-content": {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      caretColor: "#E6E6E6",
      padding: "12px",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#E6E6E6" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
      { backgroundColor: "rgba(242,103,60,0.20)" },
    ".cm-gutters": { display: "none" },
    ".cm-placeholder": { color: "#5B6472" },
    // Autocomplete tooltip, styled like the previous popup.
    ".cm-tooltip.cm-tooltip-autocomplete": {
      backgroundColor: "#1B1F27",
      border: "1px solid #232833",
      borderRadius: "8px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    },
    ".cm-tooltip-autocomplete > ul": {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: "10px",
      maxHeight: "150px",
    },
    ".cm-tooltip-autocomplete > ul > li": {
      padding: "4px 10px",
      color: "#E6E6E6",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: ACCENT,
      color: "#FFFFFF",
    },
    ".cm-completionDetail": {
      color: "#8A93A2",
      fontStyle: "normal",
      marginLeft: "0.5em",
      fontSize: "8px",
      textTransform: "uppercase",
      letterSpacing: "0.05em",
    },
    ".cm-tooltip.cm-completionInfo": {
      backgroundColor: "#232833",
      border: "1px solid #2E3440",
      color: "#C7CDD6",
      borderRadius: "6px",
      padding: "6px 8px",
    },
  },
  { dark: true }
);

const darkHighlight = HighlightStyle.define([
  { tag: t.propertyName, color: "#818CF8" },
  { tag: [t.string, t.special(t.string)], color: "#34D399" },
  { tag: t.number, color: "#F59E0B" },
  { tag: [t.bool, t.null, t.keyword], color: "#A78BFA" },
  { tag: [t.punctuation, t.separator, t.brace, t.bracket], color: "#8A93A2" },
]);

export const darkTheme: Extension = [darkChrome, syntaxHighlighting(darkHighlight)];

/* --------------------------------------------------------------- light ---- */

const lightChrome = EditorView.theme(
  {
    "&": {
      color: "#111827",
      backgroundColor: "transparent",
      fontSize: "12px",
    },
    ".cm-content": {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      caretColor: "#111827",
      padding: "0",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#111827" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
      { backgroundColor: "rgba(242,103,60,0.18)" },
    ".cm-gutters": { display: "none" },
    ".cm-placeholder": { color: "#9CA3AF" },
    ".cm-tooltip.cm-tooltip-autocomplete": {
      backgroundColor: "#FFFFFF",
      border: "1px solid #EBE7DF",
      borderRadius: "8px",
      boxShadow: "0 8px 24px rgba(17,24,39,0.12)",
    },
    ".cm-tooltip-autocomplete > ul": {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: "11px",
      maxHeight: "200px",
    },
    ".cm-tooltip-autocomplete > ul > li": {
      padding: "4px 10px",
      color: "#111827",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: ACCENT,
      color: "#FFFFFF",
    },
    ".cm-completionDetail": {
      color: "#8A93A2",
      fontStyle: "normal",
      marginLeft: "0.5em",
      fontSize: "9px",
      textTransform: "uppercase",
      letterSpacing: "0.05em",
    },
    ".cm-tooltip.cm-completionInfo": {
      backgroundColor: "#FAFAF7",
      border: "1px solid #EBE7DF",
      color: "#5B6472",
      borderRadius: "6px",
      padding: "6px 8px",
    },
  },
  { dark: false }
);

const lightHighlight = HighlightStyle.define([
  { tag: t.propertyName, color: "#4F46E5" },
  { tag: [t.string, t.special(t.string)], color: "#059669" },
  { tag: t.number, color: "#B45309" },
  { tag: [t.bool, t.null, t.keyword], color: "#7C3AED" },
  { tag: [t.punctuation, t.separator, t.brace, t.bracket], color: "#6B7280" },
]);

export const lightTheme: Extension = [
  lightChrome,
  syntaxHighlighting(lightHighlight),
];

export function editorTheme(kind: "dark" | "light"): Extension {
  return kind === "light" ? lightTheme : darkTheme;
}
