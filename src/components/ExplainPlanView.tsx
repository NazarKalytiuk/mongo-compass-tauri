import { useState } from "react";
import {
  Clock, Database, Check, Copy, AlertTriangle, GitBranch, FileJson, ListTree,
} from "lucide-react";

// ── Explain plan helpers (exported for unit tests) ───────────────────────────

export function findExecutionTime(explain: any): number | null {
  if (!explain || typeof explain !== "object") return null;
  if (explain.executionStats && typeof explain.executionStats.executionTimeMillis === "number") {
    return explain.executionStats.executionTimeMillis;
  }
  if (typeof explain.executionTimeMillis === "number") return explain.executionTimeMillis;
  if (typeof explain.executionTimeMillisEstimate === "number") return explain.executionTimeMillisEstimate;
  if (typeof explain.timeMillis === "number") return explain.timeMillis;
  for (const key of Object.keys(explain)) {
    const val = explain[key];
    if (val && typeof val === "object") {
      const t = findExecutionTime(val);
      if (t !== null) return t;
    }
  }
  return null;
}

export function findUsedIndex(explain: any): string | null {
  if (!explain || typeof explain !== "object") return null;
  if (explain.stage === "IXSCAN" && typeof explain.indexName === "string") {
    return explain.indexName;
  }
  for (const key of Object.keys(explain)) {
    const val = explain[key];
    if (val && typeof val === "object") {
      const idx = findUsedIndex(val);
      if (idx) return idx;
    }
  }
  return null;
}

function findExecutionStats(explain: any): any | null {
  if (!explain || typeof explain !== "object") return null;
  if (explain.executionStats && typeof explain.executionStats === "object") {
    return explain.executionStats;
  }
  for (const key of Object.keys(explain)) {
    const val = explain[key];
    if (val && typeof val === "object") {
      const found = findExecutionStats(val);
      if (found) return found;
    }
  }
  return null;
}

export interface PlanNode {
  stage: string;
  index?: string;
  nReturned?: number;
  ms?: number;
  docsExamined?: number;
  keysExamined?: number;
  children: PlanNode[];
}

// Find the root plan node (executionStages preferred, else winningPlan), searching recursively
function findPlanRoot(explain: any): any | null {
  if (!explain || typeof explain !== "object") return null;
  if (explain.executionStats && explain.executionStats.executionStages) {
    return explain.executionStats.executionStages;
  }
  if (explain.queryPlanner && explain.queryPlanner.winningPlan) {
    return explain.queryPlanner.winningPlan;
  }
  // Recurse (handles aggregation $cursor wrappers and sharded plans)
  for (const key of Object.keys(explain)) {
    const val = explain[key];
    if (val && typeof val === "object") {
      const found = findPlanRoot(val);
      if (found) return found;
    }
  }
  // Fallback: this node itself looks like a plan stage
  if (typeof explain.stage === "string") return explain;
  return null;
}

export function buildPlanTree(node: any): PlanNode | null {
  if (!node || typeof node !== "object") return null;
  const stage: string | undefined = node.stage || node.nodeType;
  if (!stage) {
    // Some wrappers nest the real stage in `queryPlan` / `winningPlan`
    if (node.queryPlan) return buildPlanTree(node.queryPlan);
    if (node.winningPlan) return buildPlanTree(node.winningPlan);
    return null;
  }

  const children: PlanNode[] = [];
  const childKeys = ["inputStage", "innerStage", "outerStage", "thenStage", "elseStage"];
  for (const k of childKeys) {
    if (node[k]) {
      const c = buildPlanTree(node[k]);
      if (c) children.push(c);
    }
  }
  if (Array.isArray(node.inputStages)) {
    node.inputStages.forEach((s: any) => {
      const c = buildPlanTree(s);
      if (c) children.push(c);
    });
  }
  if (Array.isArray(node.shards)) {
    node.shards.forEach((s: any) => {
      const c = buildPlanTree(s.executionStages || s.winningPlan || s);
      if (c) children.push(c);
    });
  }

  return {
    stage,
    index: typeof node.indexName === "string" ? node.indexName : undefined,
    nReturned: typeof node.nReturned === "number" ? node.nReturned : undefined,
    ms: typeof node.executionTimeMillisEstimate === "number" ? node.executionTimeMillisEstimate : undefined,
    docsExamined: typeof node.docsExamined === "number" ? node.docsExamined : undefined,
    keysExamined: typeof node.keysExamined === "number" ? node.keysExamined : undefined,
    children,
  };
}

function stageColor(stage: string): string {
  const s = stage.toUpperCase();
  if (s.includes("COLLSCAN")) return "bg-red-50 border-red-200 text-red-800";
  if (s.includes("IXSCAN") || s.includes("DISTINCT_SCAN")) return "bg-emerald-50 border-emerald-200 text-emerald-800";
  if (s.includes("FETCH")) return "bg-blue-50 border-blue-200 text-blue-800";
  if (s.includes("SORT")) return "bg-violet-50 border-violet-200 text-violet-800";
  if (s.includes("GROUP") || s.includes("PROJECTION")) return "bg-amber-50 border-amber-200 text-amber-800";
  if (s.includes("LIMIT") || s.includes("SKIP")) return "bg-slate-50 border-slate-200 text-slate-700";
  return "bg-[#F4F1EC] border-[#111827]/10 text-[#1F2937]";
}

function PlanNodeView({ node, depth = 0 }: { node: PlanNode; depth?: number }) {
  return (
    <div className={depth > 0 ? "pl-5 border-l-2 border-dashed border-[#111827]/10 ml-3 mt-2" : ""}>
      <div className={`inline-flex flex-col rounded-lg border px-3 py-2 shadow-2xs ${stageColor(node.stage)}`}>
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 shrink-0 opacity-70" />
          <span className="text-xs font-extrabold tracking-wide">{node.stage}</span>
          {node.index && (
            <span className="text-[9px] font-mono font-bold bg-white/70 px-1.5 py-0.5 rounded border border-current/20">
              {node.index}
            </span>
          )}
        </div>
        {(node.nReturned !== undefined || node.ms !== undefined || node.docsExamined !== undefined || node.keysExamined !== undefined) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[10px] font-mono opacity-80">
            {node.nReturned !== undefined && <span>returned: {node.nReturned}</span>}
            {node.keysExamined !== undefined && <span>keys: {node.keysExamined}</span>}
            {node.docsExamined !== undefined && <span>docs: {node.docsExamined}</span>}
            {node.ms !== undefined && <span>{node.ms} ms</span>}
          </div>
        )}
      </div>
      {node.children.map((child, idx) => (
        <PlanNodeView key={idx} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

const highlightJson = (text: string) => {
  if (!text) return "";
  let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const stringRegex = /"(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"/g;
  html = html.replace(stringRegex, (match, offset, fullText) => {
    const remainingText = fullText.substring(offset + match.length);
    const isKey = /^\s*:/.test(remainingText);
    if (isKey) return `<span class="text-[#818CF8] font-medium">${match}</span>`;
    return `<span class="text-[#34D399]">${match}</span>`;
  });
  html = html.replace(/\b(\d+(\.\d+)?)\b(?=(?:[^"]*"[^"]*")*[^"]*$)/g, '<span class="text-[#F59E0B]">$1</span>');
  html = html.replace(/\b(true|false|null)\b(?=(?:[^"]*"[^"]*")*[^"]*$)/g, '<span class="text-[#A78BFA] font-bold">$1</span>');
  return html;
};

interface ExplainPlanViewProps {
  explain: any;
}

export default function ExplainPlanView({ explain }: ExplainPlanViewProps) {
  const [mode, setMode] = useState<"tree" | "raw">("tree");
  const [copied, setCopied] = useState(false);

  const execTime = findExecutionTime(explain);
  const usedIndex = findUsedIndex(explain);
  const execStats = findExecutionStats(explain);
  const nReturned = execStats?.nReturned;
  const totalDocsExamined = execStats?.totalDocsExamined;
  const totalKeysExamined = execStats?.totalKeysExamined;

  const planRoot = findPlanRoot(explain);
  const tree = planRoot ? buildPlanTree(planRoot) : null;

  // Health: examined-to-returned ratio
  const ratio =
    typeof totalDocsExamined === "number" && typeof nReturned === "number" && nReturned > 0
      ? totalDocsExamined / nReturned
      : null;

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[#FAFAF7] border border-[#111827]/5 rounded-xl p-3 flex flex-col gap-1">
          <span className="text-[9px] font-bold text-[#8A93A2] uppercase">Exec Time</span>
          <span className="text-base font-bold text-[#111827] flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-[#5B6472]" />
            {execTime !== null ? `${execTime} ms` : "—"}
          </span>
        </div>
        <div className="bg-[#FAFAF7] border border-[#111827]/5 rounded-xl p-3 flex flex-col gap-1">
          <span className="text-[9px] font-bold text-[#8A93A2] uppercase">Returned</span>
          <span className="text-base font-bold text-[#111827]">{nReturned ?? "—"}</span>
        </div>
        <div className="bg-[#FAFAF7] border border-[#111827]/5 rounded-xl p-3 flex flex-col gap-1">
          <span className="text-[9px] font-bold text-[#8A93A2] uppercase">Docs Examined</span>
          <span className="text-base font-bold text-[#111827]">{totalDocsExamined ?? "—"}</span>
        </div>
        <div className="bg-[#FAFAF7] border border-[#111827]/5 rounded-xl p-3 flex flex-col gap-1">
          <span className="text-[9px] font-bold text-[#8A93A2] uppercase">Keys Examined</span>
          <span className="text-base font-bold text-[#111827]">{totalKeysExamined ?? "—"}</span>
        </div>
      </div>

      {/* Index / scan status */}
      <div
        className={`rounded-xl border p-3 flex items-center gap-2 text-xs font-bold ${
          usedIndex
            ? "bg-[#DCFCE7] border-[#BBF7D0] text-[#15803D]"
            : "bg-amber-50 border-amber-200 text-amber-800"
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${usedIndex ? "bg-[#16A34A]" : "bg-amber-500"}`} />
        <Database className="w-3.5 h-3.5" />
        {usedIndex ? `Index used: ${usedIndex}` : "COLLSCAN — full collection scan (no index used)"}
      </div>

      {/* Health warning */}
      {ratio !== null && ratio > 10 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl flex items-start gap-2.5 text-xs leading-relaxed">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block">Inefficient query</span>
            Examined {totalDocsExamined} documents to return {nReturned}
            {" "}({ratio.toFixed(1)}× ratio). Consider adding an index on the filtered fields.
          </div>
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex items-center justify-between">
        <div className="flex border border-[#EBE7DF] bg-white rounded-lg p-0.5 shadow-2xs">
          <button
            onClick={() => setMode("tree")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1.5 transition-colors ${
              mode === "tree" ? "bg-[#EBE7DF] text-[#111827]" : "text-[#8A93A2] hover:text-[#5B6472]"
            }`}
          >
            <ListTree className="w-3.5 h-3.5" /> Visual Tree
          </button>
          <button
            onClick={() => setMode("raw")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1.5 transition-colors ${
              mode === "raw" ? "bg-[#EBE7DF] text-[#111827]" : "text-[#8A93A2] hover:text-[#5B6472]"
            }`}
          >
            <FileJson className="w-3.5 h-3.5" /> Raw Output
          </button>
        </div>
        {mode === "raw" && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(explain, null, 2));
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="px-2.5 py-1 text-[10px] font-bold bg-[#EBE7DF]/40 hover:bg-[#EBE7DF]/75 text-[#5B6472] border border-[#111827]/10 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-[#16A34A]" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy JSON"}
          </button>
        )}
      </div>

      {/* Body */}
      {mode === "tree" ? (
        tree ? (
          <div className="bg-white border border-[#111827]/10 rounded-xl p-4 overflow-x-auto">
            <PlanNodeView node={tree} />
          </div>
        ) : (
          <div className="text-center py-10 text-xs text-[#8A93A2]">
            No execution stage tree available for this plan. Switch to Raw Output.
          </div>
        )
      ) : (
        <div className="bg-[#1B1F27] border border-[#232833] rounded-xl p-4 overflow-x-auto max-h-[450px] font-mono text-[10px] text-[#E6E6E6]">
          <pre dangerouslySetInnerHTML={{ __html: highlightJson(JSON.stringify(explain, null, 2)) }} />
        </div>
      )}
    </div>
  );
}
