/**
 * CodeEditor — the single reusable CodeMirror 6 wrapper used by every query
 * surface (filter / sort / projection, aggregation stages, shell).
 *
 * Dynamic concerns (completion source, theme, language) are held in Compartments
 * so they can be reconfigured without rebuilding the view. The controlled
 * `value` is reconciled only when it actually diverges from the document, which
 * is the critical detail that keeps CodeMirror and React from fighting.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { EditorState, Compartment, Prec, EditorSelection } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderExt,
  drawSelection,
  highlightSpecialChars,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
  acceptCompletion,
  completionStatus,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { javascript } from "@codemirror/lang-javascript";
import { editorTheme } from "./theme";

export type EditorLanguage = "json" | "javascript";

export interface CodeEditorHandle {
  focus(): void;
  selectAll(): void;
  insertAtCursor(text: string): void;
}

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: EditorLanguage;
  completer?: CompletionSource;
  theme?: "dark" | "light";
  singleLine?: boolean;
  placeholder?: string;
  onRun?: () => void;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
}

const singleLineTheme = EditorView.theme({
  "&": { height: "auto" },
  ".cm-scroller": { overflowX: "auto", overflowY: "hidden" },
  ".cm-content": { whiteSpace: "pre" },
});

function languageExtension(language: EditorLanguage) {
  return language === "json" ? json() : javascript();
}

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(props, ref) {
    const {
      value,
      onChange,
      language,
      completer,
      theme = "dark",
      singleLine = false,
      placeholder = "",
      onRun,
      className,
      ariaLabel,
      autoFocus = false,
      readOnly = false,
    } = props;

    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    // Keep latest callbacks/props in refs so the editor always calls the
    // current versions without rebuilding the view.
    const onChangeRef = useRef(onChange);
    const onRunRef = useRef(onRun);
    onChangeRef.current = onChange;
    onRunRef.current = onRun;

    const completionCompartment = useRef(new Compartment());
    // Set while reconciling the controlled value, so the resulting programmatic
    // transaction doesn't echo back through onChange.
    const reconcilingRef = useRef(false);

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          viewRef.current?.focus();
        },
        selectAll() {
          const view = viewRef.current;
          if (!view) return;
          view.dispatch({
            selection: EditorSelection.range(0, view.state.doc.length),
          });
        },
        insertAtCursor(text: string) {
          const view = viewRef.current;
          if (!view) return;
          const { from, to } = view.state.selection.main;
          view.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
          });
          view.focus();
        },
      }),
      []
    );

    // Build (and rebuild only on structural prop changes).
    useEffect(() => {
      if (!hostRef.current) return;

      // Enter (single-line) / Mod-Enter (multi-line) runs the query, but first
      // accepts an open completion so the popup behaves like VS Code.
      const runKeymap = Prec.highest(
        keymap.of([
          {
            key: singleLine ? "Enter" : "Mod-Enter",
            run: (view) => {
              if (completionStatus(view.state) === "active") {
                return acceptCompletion(view);
              }
              if (onRunRef.current) {
                onRunRef.current();
                return true;
              }
              return false;
            },
          },
        ])
      );

      // Reject newline insertions in single-line mode (also flattens paste).
      const noNewlines = EditorState.transactionFilter.of((tr) => {
        if (!singleLine || !tr.docChanged) return tr;
        if (!tr.newDoc.toString().includes("\n")) return tr;
        const changes: { from: number; to: number; insert: string }[] = [];
        tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
          changes.push({
            from: fromA,
            to: toA,
            insert: inserted.toString().replace(/\n/g, " "),
          });
        });
        return [{ changes, selection: tr.selection, scrollIntoView: tr.scrollIntoView }];
      });

      const extensions = [
        history(),
        drawSelection(),
        highlightSpecialChars(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        languageExtension(language),
        editorTheme(theme),
        completionCompartment.current.of(
          completer
            ? autocompletion({
                override: [completer],
                activateOnTyping: true,
                defaultKeymap: false,
              })
            : []
        ),
        placeholderExt(placeholder),
        runKeymap,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !reconcilingRef.current) {
            onChangeRef.current(u.state.doc.toString());
          }
        }),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        noNewlines,
      ];

      if (singleLine) extensions.push(singleLineTheme);

      const view = new EditorView({
        state: EditorState.create({ doc: value, extensions }),
        parent: hostRef.current,
      });
      viewRef.current = view;

      if (ariaLabel) {
        view.contentDOM.setAttribute("aria-label", ariaLabel);
      }
      view.contentDOM.setAttribute("role", "textbox");
      if (autoFocus) view.focus();

      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // value/onChange/onRun are intentionally excluded — handled via refs and
      // the dedicated reconciliation effect below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language, theme, singleLine, readOnly, placeholder, ariaLabel]);

    // Reconfigure the completion source when it changes (e.g. fields load).
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: completionCompartment.current.reconfigure(
          completer
            ? autocompletion({
                override: [completer],
                activateOnTyping: true,
                defaultKeymap: false,
              })
            : []
        ),
      });
    }, [completer]);

    // Reconcile controlled value → document, guarding against feedback loops.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (value !== current) {
        reconcilingRef.current = true;
        view.dispatch({
          changes: { from: 0, to: current.length, insert: value },
        });
        reconcilingRef.current = false;
      }
    }, [value]);

    return <div ref={hostRef} className={className} />;
  }
);

export default CodeEditor;
