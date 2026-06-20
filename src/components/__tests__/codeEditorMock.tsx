/**
 * Test double for the CodeMirror-based CodeEditor.
 *
 * The real editor renders a contenteditable surface that React Testing Library
 * can't drive with `fireEvent.change`. This lightweight mock renders a plain
 * <textarea> exposing the same props (value/onChange/onRun/ariaLabel/placeholder)
 * and imperative handle, so component tests can interact with it as before.
 * The real editor behavior is covered separately in CodeEditor.test.tsx.
 */
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type KeyboardEvent,
} from "react";

export interface MockCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  singleLine?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

const CodeEditor = forwardRef(function CodeEditor(
  props: MockCodeEditorProps,
  ref
) {
  const { value, onChange, onRun, singleLine, placeholder, ariaLabel } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    selectAll: () => textareaRef.current?.select(),
    insertAtCursor: (text: string) => onChange((value ?? "") + text),
  }));

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Mirror the real editor: Enter runs in single-line mode; Mod-Enter runs
    // in multi-line mode.
    if (
      e.key === "Enter" &&
      (singleLine || e.metaKey || e.ctrlKey) &&
      onRun
    ) {
      e.preventDefault();
      onRun();
    }
  };

  return (
    <textarea
      ref={textareaRef}
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
    />
  );
});

export default CodeEditor;
