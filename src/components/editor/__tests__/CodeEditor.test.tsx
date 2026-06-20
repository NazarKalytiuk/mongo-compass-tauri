import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, act, fireEvent } from "@testing-library/react";
import type { CompletionContext } from "@codemirror/autocomplete";
import CodeEditor, { type CodeEditorHandle } from "../CodeEditor";

const noopCompleter = (_ctx: CompletionContext) => null;

describe("CodeEditor", () => {
  it("renders the initial value into the editor", () => {
    const { container } = render(
      <CodeEditor value='{ "a": 1 }' onChange={() => {}} language="json" />
    );
    expect(container.querySelector(".cm-editor")).toBeTruthy();
    expect(container.textContent).toContain('"a"');
  });

  it("emits onChange when content is inserted via the imperative handle", () => {
    const onChange = vi.fn();
    const ref = createRef<CodeEditorHandle>();
    render(
      <CodeEditor ref={ref} value="" onChange={onChange} language="json" />
    );
    act(() => {
      ref.current?.insertAtCursor("hello");
    });
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("reconciles an external value change without feedback loop", () => {
    const onChange = vi.fn();
    const { rerender, container } = render(
      <CodeEditor value="one" onChange={onChange} language="json" />
    );
    onChange.mockClear();
    rerender(<CodeEditor value="two" onChange={onChange} language="json" />);
    expect(container.textContent).toContain("two");
    // Programmatic reconciliation should not echo back through onChange.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("focus and selectAll do not throw", () => {
    const ref = createRef<CodeEditorHandle>();
    render(
      <CodeEditor ref={ref} value="abc" onChange={() => {}} language="json" />
    );
    expect(() => {
      act(() => {
        ref.current?.focus();
        ref.current?.selectAll();
      });
    }).not.toThrow();
  });

  it("supports the javascript language and single-line mode", () => {
    const { container } = render(
      <CodeEditor
        value="db.users.find()"
        onChange={() => {}}
        language="javascript"
        singleLine
        theme="dark"
      />
    );
    expect(container.querySelector(".cm-editor")).toBeTruthy();
  });

  it("strips newlines inserted in single-line mode", () => {
    const onChange = vi.fn();
    const ref = createRef<CodeEditorHandle>();
    render(
      <CodeEditor
        ref={ref}
        value=""
        onChange={onChange}
        language="json"
        singleLine
      />
    );
    act(() => {
      ref.current?.insertAtCursor("a\nb");
    });
    expect(onChange).toHaveBeenCalledWith("a b");
  });

  it("runs onRun on Enter in single-line mode", () => {
    const onRun = vi.fn();
    const { container } = render(
      <CodeEditor
        value=""
        onChange={() => {}}
        language="json"
        singleLine
        onRun={onRun}
      />
    );
    const content = container.querySelector(".cm-content") as HTMLElement;
    fireEvent.keyDown(content, { key: "Enter" });
    expect(onRun).toHaveBeenCalled();
  });

  it("runs onRun on Mod-Enter in multi-line mode", () => {
    const onRun = vi.fn();
    const { container } = render(
      <CodeEditor value="" onChange={() => {}} language="json" onRun={onRun} />
    );
    const content = container.querySelector(".cm-content") as HTMLElement;
    // CodeMirror maps "Mod" to Ctrl on non-mac (jsdom) and Cmd on mac.
    fireEvent.keyDown(content, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(content, { key: "Enter", metaKey: true });
    expect(onRun).toHaveBeenCalled();
  });

  it("accepts completer, readOnly, ariaLabel and autoFocus props", () => {
    const { container, rerender } = render(
      <CodeEditor
        value="x"
        onChange={() => {}}
        language="json"
        completer={noopCompleter}
        readOnly
        ariaLabel="My Editor"
        autoFocus
        placeholder="type here"
      />
    );
    const content = container.querySelector(".cm-content") as HTMLElement;
    expect(content.getAttribute("aria-label")).toBe("My Editor");
    expect(content.getAttribute("role")).toBe("textbox");
    // Reconfiguring the completer should not throw.
    expect(() =>
      rerender(
        <CodeEditor
          value="x"
          onChange={() => {}}
          language="json"
          completer={undefined}
          ariaLabel="My Editor"
        />
      )
    ).not.toThrow();
  });
});
