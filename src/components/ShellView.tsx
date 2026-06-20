import { useState, useEffect, useRef, useMemo } from "react";
import { Terminal, History, Trash2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import CodeEditor, { type CodeEditorHandle } from "./editor/CodeEditor";
import { createShellAutocompleter } from "./editor/autocompleters";

interface ShellHistoryItem {
  type: "input" | "output" | "error";
  text: string;
}

interface ShellViewProps {
  /** Current database, used to source collection-name completions. */
  activeDb?: string;
}

export function ShellView({ activeDb }: ShellViewProps = {}) {
  const [input, setInput] = useState("");
  const [collections, setCollections] = useState<string[]>([]);
  const [history, setHistory] = useState<ShellHistoryItem[]>([
    { type: "output", text: "MongoDB Shell (mongosh) - Tauri Edition" },
    { type: "output", text: 'Type JS commands or standard query operations. Use ⌘↵ or Ctrl+Enter to evaluate.' },
  ]);
  const [shellHistory, setShellHistory] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<CodeEditorHandle>(null);

  const shellCompleter = useMemo(
    () => createShellAutocompleter({ collections }),
    [collections]
  );

  // Auto-scroll logs
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [history]);

  // Load local shell command history
  useEffect(() => {
    const saved = localStorage.getItem("mongo_compass_shell_history");
    if (saved) {
      try {
        setShellHistory(JSON.parse(saved));
      } catch (e) {
        setShellHistory([]);
      }
    }
  }, []);

  // Load collection names of the active DB for shell autocompletion
  useEffect(() => {
    if (!activeDb) {
      setCollections([]);
      return;
    }
    let cancelled = false;
    invoke<string[]>("list_collections", { dbName: activeDb })
      .then((colls) => {
        if (!cancelled) setCollections(Array.isArray(colls) ? colls : []);
      })
      .catch(() => {
        if (!cancelled) setCollections([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDb]);

  // Hook up Tauri mongosh subprocess
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      try {
        await invoke("start_shell");
      } catch (err) {
        setHistory((prev) => [
          ...prev,
          { type: "error", text: `Failed to spawn mongosh process: ${err}` },
        ]);
      }

      unlisten = await listen<{ text: string }>("shell-log", (e) => {
        const text = e.payload.text;
        if (text.startsWith("[ERROR] ")) {
          setHistory((prev) => [...prev, { type: "error", text: text.substring(8) }]);
        } else {
          setHistory((prev) => [...prev, { type: "output", text }]);
        }
      });
    };

    setup();

    return () => {
      unlisten?.();
    };
  }, []);

  const handleCommandSubmit = async () => {
    const cmd = input.trim();
    if (!cmd) return;

    // Append user input to local terminal history
    setHistory((prev) => [...prev, { type: "input", text: cmd }]);
    setInput("");

    // Add to history drawer storage
    const updatedHistory = [cmd, ...shellHistory.filter((h) => h !== cmd)].slice(0, 20);
    setShellHistory(updatedHistory);
    localStorage.setItem("mongo_compass_shell_history", JSON.stringify(updatedHistory));

    try {
      await invoke("write_shell_command", { command: cmd });
    } catch (err) {
      setHistory((prev) => [
        ...prev,
        { type: "error", text: `Failed to write command to shell: ${err}` },
      ]);
    }
  };

  const clearHistoryDrawer = () => {
    setShellHistory([]);
    localStorage.removeItem("mongo_compass_shell_history");
  };

  return (
    <div className="flex-1 flex bg-[#1B1F27] h-full overflow-hidden text-[#E6E6E6] font-mono text-xs select-text">
      {/* Main Terminal View */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Terminal Header */}
        <div className="bg-[#11141A] px-4 py-2 border-b border-[#232833]/80 flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#F2673C]" />
            <span className="font-bold text-[10px] text-[#8A93A2] uppercase tracking-wider">
              mongosh interactive terminal
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setHistory([])}
              className="px-2.5 py-1 border border-[#232833] hover:bg-[#232833] rounded text-[10px] font-bold transition-all text-[#8A93A2] cursor-pointer"
            >
              Clear Screen
            </button>
            <button
              onClick={() => setDrawerOpen(!drawerOpen)}
              className={`px-2.5 py-1 border rounded text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
                drawerOpen
                  ? "bg-[#F2673C]/10 border-[#F2673C] text-[#F2673C]"
                  : "border-[#232833] text-[#8A93A2] hover:bg-[#232833]"
              }`}
            >
              <History className="w-3 h-3" />
              <span>History</span>
            </button>
          </div>
        </div>

        {/* Scrollable logs area */}
        <div
          ref={containerRef}
          className="flex-1 p-4 overflow-y-auto space-y-2.5 leading-relaxed"
          onClick={() => inputRef.current?.focus()}
        >
          {history.map((h, idx) => {
            if (h.type === "input") {
              return (
                <div key={idx} className="flex items-start gap-1">
                  <span className="text-[#F2673C] shrink-0 select-none">compass-plus:PRIMARY&gt;</span>
                  <span className="text-white select-all break-all whitespace-pre-wrap">{h.text}</span>
                </div>
              );
            } else if (h.type === "error") {
              return (
                <pre
                  key={idx}
                  className="text-red-400 whitespace-pre-wrap break-all pl-2.5 border-l border-red-500/40"
                >
                  {h.text}
                </pre>
              );
            } else {
              return (
                <pre key={idx} className="text-[#E6E6E6] whitespace-pre-wrap break-all font-mono">
                  {h.text}
                </pre>
              );
            }
          })}

          {/* Interactive Textarea Prompt */}
          <div className="flex items-start gap-1.5 pt-1">
            <span className="text-[#F2673C] shrink-0 select-none mt-0.5">compass-plus:PRIMARY&gt;</span>
            <CodeEditor
              ref={inputRef}
              value={input}
              onChange={setInput}
              language="javascript"
              theme="dark"
              completer={shellCompleter}
              onRun={handleCommandSubmit}
              ariaLabel="Shell Input"
              placeholder="Enter command... (⌘↵ to run)"
              className="flex-1 min-w-0"
              autoFocus
            />
          </div>
        </div>
      </div>

      {/* Slide-out History Drawer */}
      {drawerOpen && (
        <div className="w-64 bg-[#11141A] border-l border-[#232833]/80 flex flex-col shrink-0 h-full overflow-hidden select-none">
          <div className="p-4 border-b border-[#232833]/80 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#8A93A2]">
              <History className="w-3.5 h-3.5" />
              <span>Command History</span>
            </div>
            <button
              onClick={() => setDrawerOpen(false)}
              className="p-1 hover:bg-[#232833] rounded text-[#8A93A2] hover:text-[#E6E6E6] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 p-3 overflow-y-auto space-y-1.5">
            {shellHistory.length === 0 ? (
              <p className="text-[10px] text-[#5B6472] italic text-center pt-8">
                No recent commands
              </p>
            ) : (
              shellHistory.map((cmd, idx) => (
                <div
                  key={idx}
                  onClick={() => setInput(cmd)}
                  className="p-2.5 bg-[#1B1F27] border border-[#232833] hover:border-[#F2673C]/50 rounded-lg cursor-pointer transition-all hover:bg-[#232833]/50 flex flex-col gap-1 text-[10px] font-mono text-[#8A93A2] hover:text-white break-all max-h-24 overflow-y-auto"
                >
                  {cmd}
                </div>
              ))
            )}
          </div>

          {shellHistory.length > 0 && (
            <div className="p-3 border-t border-[#232833]/80 bg-[#11141A]">
              <button
                onClick={clearHistoryDrawer}
                className="w-full py-1.5 border border-[#232833] hover:bg-red-950/20 hover:text-red-400 hover:border-red-900/35 rounded-lg text-[10px] font-bold text-[#8A93A2] flex items-center justify-center gap-1 transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear History</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
