import { useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { invokeWithLog } from "../queryLogger";
import {
  Play, Plus, Trash2, ChevronDown, ChevronRight, Copy, Check,
  Loader2, AlertCircle, AlertTriangle, Sparkles, Code, Clock, GripVertical, X,
  Bookmark, History, Eye, EyeOff, Maximize2, FileJson, ListTree
} from "lucide-react";
import { BsonTreeObject } from "./DocumentExplorer";
import { TabState } from "../types";
import CodeGeneratorModal from "./CodeGeneratorModal";
import ExplainPlanView from "./ExplainPlanView";
import CodeEditor, { type CodeEditorHandle } from "./editor/CodeEditor";
import { createStageAutocompleter } from "./editor/autocompleters";
import { useCollectionFields } from "./editor/useCollectionFields";
import type { CompletionSource } from "@codemirror/autocomplete";

interface PipelineStage {
  id: string;
  operator: string; // e.g. "$match"
  value: string;    // e.g. "{}"
  previewDocs: any[];
  error: string | null;
  loading: boolean;
  isExpanded: boolean;
  disabled?: boolean;
  executionTime?: number | null;
  indexUsed?: string | null;
  explainError?: string | null;
}

// Traverse explain plan recursively to find any stage containing IXSCAN and extract indexName
function findUsedIndex(explain: any): string | null {
  if (!explain || typeof explain !== "object") return null;

  // Check if this node is an IXSCAN stage
  if (explain.stage === "IXSCAN" && typeof explain.indexName === "string") {
    return explain.indexName;
  }

  // Check recursively in all object properties
  for (const key of Object.keys(explain)) {
    const val = explain[key];
    if (val && typeof val === "object") {
      const idx = findUsedIndex(val);
      if (idx) return idx;
    }
  }
  return null;
}

// Find total execution time from explain plan
function findExecutionTime(explain: any): number | null {
  if (!explain || typeof explain !== "object") return null;

  // Commonly at explain.executionStats.executionTimeMillis
  if (explain.executionStats && typeof explain.executionStats.executionTimeMillis === "number") {
    return explain.executionStats.executionTimeMillis;
  }

  // Or check recursively for executionTimeMillis, executionTimeMillisEstimate, or timeMillis
  if (typeof explain.executionTimeMillis === "number") {
    return explain.executionTimeMillis;
  }
  if (typeof explain.executionTimeMillisEstimate === "number") {
    return explain.executionTimeMillisEstimate;
  }
  if (typeof explain.timeMillis === "number") {
    return explain.timeMillis;
  }

  for (const key of Object.keys(explain)) {
    const val = explain[key];
    if (val && typeof val === "object") {
      const t = findExecutionTime(val);
      if (t !== null) return t;
    }
  }

  return null;
}

// Detect match fields from match query string
function detectMatchFields(valueStr: string): string[] {
  try {
    const parsed = JSON.parse(valueStr);
    if (parsed && typeof parsed === "object") {
      return Object.keys(parsed).filter(k => !k.startsWith("$"));
    }
  } catch {}
  return [];
}

interface AggregationBuilderProps {
  dbName: string;
  collName: string;
  tab?: TabState;
  serverVersion?: string;
}

const AGG_OPERATORS = [
  { value: "$match", desc: "Filters documents to pass only matching ones." },
  { value: "$group", desc: "Groups documents by a specified identifier expression." },
  { value: "$project", desc: "Reshapes documents (adds, renames, or removes fields)." },
  { value: "$sort", desc: "Reorders the document stream by a specified sort key." },
  { value: "$limit", desc: "Passes the first N documents to the next stage." },
  { value: "$skip", desc: "Skips the first N documents in the stream." },
  { value: "$unwind", desc: "Deconstructs an array field into individual documents." },
  { value: "$lookup", desc: "Performs a left outer join to another collection." },
  { value: "$addFields", desc: "Adds new fields to documents." },
  { value: "$count", desc: "Returns a count of the number of input documents." },
];

const OPERATOR_TEMPLATES = [
  { label: "$match (Filter)", value: '{\n  "status": "active"\n}' },
  { label: "$group (Agg)", value: '{\n  "_id": "$field",\n  "total": { "$sum": 1 }\n}' },
  { label: "$project (Select)", value: '{\n  "name": 1,\n  "count": { "$add": ["$qty", 10] }\n}' },
  { label: "$lookup (Join)", value: '{\n  "from": "other_collection",\n  "localField": "local_key",\n  "foreignField": "foreign_key",\n  "as": "joined_array"\n}' },
  { label: "$unwind (Deconstruct)", value: '"$array_field"' },
  { label: "$sort (Order)", value: '{\n  "age": -1\n}' },
  { label: "$addFields (Add)", value: '{\n  "newField": "$existingField"\n}' },
  { label: "$cond (If/Else)", value: '{\n  "$cond": { "if": { "$gte": ["$age", 18] }, "then": "adult", "else": "minor" }\n}' },
  { label: "$dateToString (Format Date)", value: '{\n  "$dateToString": { "format": "%Y-%m-%d", "date": "$createdAt" }\n}' },
];

export default function AggregationBuilder({ dbName, collName, tab, serverVersion }: AggregationBuilderProps) {
  const [stages, setStages] = useState<PipelineStage[]>([
    {
      id: "stage-0",
      operator: "$match",
      value: "{\n  \n}",
      previewDocs: [],
      error: null,
      loading: false,
      isExpanded: true,
    }
  ]);

  useEffect(() => {
    if (tab?.pipeline) {
      try {
        const parsed = JSON.parse(tab.pipeline);
        if (Array.isArray(parsed)) {
          const newStages: PipelineStage[] = parsed.map((stageObj: any, index: number) => {
            const operator = Object.keys(stageObj)[0] || "$match";
            const value = JSON.stringify(stageObj[operator], null, 2);
            return {
              id: `stage-${Date.now()}-${index}`,
              operator,
              value,
              previewDocs: [],
              error: null,
              loading: false,
              isExpanded: true,
            };
          });
          setStages(newStages);
        }
      } catch (e) {
        console.error("Failed to load pipeline from tab", e);
      }
    }
  }, [tab]);

  interface SavedPipeline {
    id: string;
    name: string;
    dbName: string;
    collName: string;
    stages: {
      operator: string;
      value: string;
    }[];
    createdAt: string;
  }

  function validateSavedPipelines(data: any): SavedPipeline[] {
    if (!Array.isArray(data)) return [];
    return data.filter(item => {
      return (
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.dbName === "string" &&
        typeof item.collName === "string" &&
        Array.isArray(item.stages) &&
        item.stages.every((st: any) => typeof st.operator === "string" && typeof st.value === "string") &&
        typeof item.createdAt === "string"
      );
    }) as SavedPipeline[];
  }

  const [savedPipelines, setSavedPipelines] = useState<SavedPipeline[]>([]);
  const [showSavedPipelinesDrawer, setShowSavedPipelinesDrawer] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [codeGeneratorOpen, setCodeGeneratorOpen] = useState(false);
  const [pipelineName, setPipelineName] = useState("");

  const getPipelineStr = () => {
    const fullPipeline: any[] = [];
    for (const stage of stages) {
      if (stage.disabled) continue;
      try {
        let cleanVal = stage.value.trim();
        if (cleanVal === "") cleanVal = "{}";
        const parsedValue = JSON.parse(cleanVal);
        fullPipeline.push({ [stage.operator]: parsedValue });
      } catch (err: any) {
        fullPipeline.push({ [stage.operator]: {} });
      }
    }
    return JSON.stringify(fullPipeline);
  };

  useEffect(() => {
    const saved = localStorage.getItem("mongo_compass_saved_pipelines");
    if (saved) {
      try {
        setSavedPipelines(validateSavedPipelines(JSON.parse(saved)));
      } catch (e) {
        setSavedPipelines([]);
      }
    }
  }, []);

  const handleLoadPipeline = (saved: SavedPipeline, runImmediately = false) => {
    const loadedStages: PipelineStage[] = saved.stages.map((s, index) => ({
      id: `stage-${Date.now()}-${index}-${Math.random().toString(36).substring(5)}`,
      operator: s.operator,
      value: s.value,
      previewDocs: [],
      error: null,
      loading: false,
      isExpanded: true,
    }));
    setStages(loadedStages);
    setShowSavedPipelinesDrawer(false);
    setTimeout(() => {
      runStagePreviewsFrom(0, loadedStages);
      if (runImmediately) {
        runEntirePipelineWithStages(loadedStages);
      }
    }, 100);
  };

  const handleSavePipeline = () => {
    if (!pipelineName.trim()) return;

    const newPipeline: SavedPipeline = {
      id: Math.random().toString(36).substring(7),
      name: pipelineName.trim(),
      dbName,
      collName,
      stages: stages.map(s => ({ operator: s.operator, value: s.value })),
      createdAt: new Date().toISOString(),
    };

    const updated = [newPipeline, ...savedPipelines];
    setSavedPipelines(updated);
    localStorage.setItem("mongo_compass_saved_pipelines", JSON.stringify(updated));
    setPipelineName("");
    setShowSaveModal(false);
  };

  const handleDeletePipeline = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedPipelines.filter(p => p.id !== id);
    setSavedPipelines(updated);
    localStorage.setItem("mongo_compass_saved_pipelines", JSON.stringify(updated));
  };

  const [copied, setCopied] = useState(false);

  // Editor view (visual stages vs. full-pipeline text) + focus mode
  const [editorView, setEditorView] = useState<"stages" | "text">("stages");
  const [pipelineText, setPipelineText] = useState("[]");
  const [textError, setTextError] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);

  const switchToText = () => {
    const arr = stages.map((s) => {
      let v: any;
      try { v = JSON.parse(s.value.trim() || "{}"); } catch { v = {}; }
      return { [s.operator]: v };
    });
    setPipelineText(JSON.stringify(arr, null, 2));
    setTextError(null);
    setEditorView("text");
  };

  const switchToStages = () => {
    try {
      const parsed = JSON.parse(pipelineText);
      if (!Array.isArray(parsed)) {
        setTextError("Pipeline must be a JSON array of stages.");
        return;
      }
      const newStages: PipelineStage[] = parsed.map((stageObj: any, index: number) => {
        const operator = Object.keys(stageObj)[0] || "$match";
        const value = JSON.stringify(stageObj[operator], null, 2);
        return {
          id: `stage-${Date.now()}-${index}`,
          operator,
          value,
          previewDocs: [],
          error: null,
          loading: false,
          isExpanded: true,
        };
      });
      if (newStages.length > 0) {
        setStages(newStages);
        setTimeout(() => runStagePreviewsFrom(0, newStages), 100);
      }
      setTextError(null);
      setEditorView("stages");
    } catch (err: any) {
      setTextError(`Invalid JSON: ${err.message}`);
    }
  };

  const toggleStageDisabled = (index: number) => {
    setStages((prev) => {
      const updated = prev.map((s, i) => (i === index ? { ...s, disabled: !s.disabled } : s));
      setTimeout(() => runStagePreviewsFrom(index, updated), 50);
      return updated;
    });
  };

  // Drag and drop states
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isGripPressed, setIsGripPressed] = useState(false);

  // Explain states
  const [explainPlan, setExplainPlan] = useState<any | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [showExplainSheet, setShowExplainSheet] = useState(false);
  const [explainErrorMsg, setExplainErrorMsg] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData("text/plain", index.toString());
    setDraggingIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, _index: number) => {
    e.preventDefault();
  };

  const handleDragEnter = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndexStr = e.dataTransfer.getData("text/plain");
    const dragIndex = parseInt(dragIndexStr, 10);
    if (isNaN(dragIndex) || dragIndex === dropIndex) {
      setDraggingIndex(null);
      setDragOverIndex(null);
      return;
    }

    setStages((prev) => {
      const updated = [...prev];
      const [draggedStage] = updated.splice(dragIndex, 1);
      updated.splice(dropIndex, 0, draggedStage);
      // Re-run previews from the minimum index of change
      const minIdx = Math.min(dragIndex, dropIndex);
      setTimeout(() => runStagePreviewsFrom(minIdx, updated), 50);
      return updated;
    });

    setDraggingIndex(null);
    setDragOverIndex(null);
  };

  const handleExplainPipeline = async () => {
    setShowExplainSheet(true);
    setExplainLoading(true);
    setExplainErrorMsg(null);
    setExplainPlan(null);

    const fullPipeline: any[] = [];
    for (const stage of stages) {
      if (stage.disabled) continue;
      try {
        let cleanVal = stage.value.trim();
        if (cleanVal === "") cleanVal = "{}";
        const parsedValue = JSON.parse(cleanVal);
        fullPipeline.push({ [stage.operator]: parsedValue });
      } catch (err: any) {
        setExplainErrorMsg(`Stage ${stages.indexOf(stage) + 1} JSON parse error: ${err.message}`);
        setExplainLoading(false);
        return;
      }
    }

    try {
      const explainResult = await invoke<any>("explain_aggregation", {
        dbName,
        collName,
        pipelineStr: JSON.stringify(fullPipeline),
      });
      setExplainPlan(explainResult);
    } catch (err: any) {
      setExplainErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setExplainLoading(false);
    }
  };
  const [finalOutput, setFinalOutput] = useState<any[]>([]);
  const [finalLoading, setFinalLoading] = useState(false);
  const [finalError, setFinalError] = useState<string | null>(null);

  // Field-name completions sampled from the collection (nested dotted paths).
  const { fields } = useCollectionFields(dbName, collName);

  // One memoized stage autocompleter per stage operator (e.g. $group, $project),
  // rebuilt only when the available fields or server version change.
  const getStageCompleter = useMemo(() => {
    const cache = new Map<string, CompletionSource>();
    return (operator: string): CompletionSource => {
      let completer = cache.get(operator);
      if (!completer) {
        completer = createStageAutocompleter({
          stageOperator: operator,
          fields,
          serverVersion,
        });
        cache.set(operator, completer);
      }
      return completer;
    };
  }, [fields, serverVersion]);

  // Imperative handles to each stage's editor, for "Insert Template".
  const editorRefs = useRef<Record<string, CodeEditorHandle | null>>({});

  const insertTextAtCursor = (stageIndex: number, textToInsert: string) => {
    const stageId = stages[stageIndex]?.id;
    editorRefs.current[stageId]?.insertAtCursor(textToInsert);
  };

  // Run initial preview for stage 0 on mount
  useEffect(() => {
    runStagePreview(0, stages);
  }, [dbName, collName]);

  const addStage = () => {
    const nextId = `stage-${Date.now()}`;
    const newStage: PipelineStage = {
      id: nextId,
      operator: "$match",
      value: "{\n  \n}",
      previewDocs: [],
      error: null,
      loading: false,
      isExpanded: true,
    };
    const nextStages = [...stages, newStage];
    setStages(nextStages);
    // Run preview for the newly added stage
    runStagePreview(nextStages.length - 1, nextStages);
  };

  const removeStage = (index: number) => {
    const nextStages = stages.filter((_, i) => i !== index);
    setStages(nextStages);
    // Re-run previews starting from the removed index to update consecutive states
    for (let i = index; i < nextStages.length; i++) {
      runStagePreview(i, nextStages);
    }
  };

  const updateStage = (index: number, fields: Partial<PipelineStage>) => {
    setStages((prev) => {
      const updated = prev.map((s, i) => (i === index ? { ...s, ...fields } : s));
      // Trigger preview run for this stage and all subsequent stages
      setTimeout(() => runStagePreviewsFrom(index, updated), 50);
      return updated;
    });
  };

  const runStagePreviewsFrom = async (startIndex: number, currentStages: PipelineStage[]) => {
    for (let i = startIndex; i < currentStages.length; i++) {
      await runStagePreview(i, currentStages);
    }
  };

  const runStagePreview = async (index: number, currentStages: PipelineStage[]) => {
    if (index >= currentStages.length) return;

    // Disabled stages contribute nothing to the pipeline and skip their own preview
    if (currentStages[index]?.disabled) {
      setStages((prev) =>
        prev.map((s, i) => (i === index ? { ...s, loading: false, error: null, previewDocs: [] } : s))
      );
      return;
    }

    // Mark stage loading
    setStages((prev) =>
      prev.map((s, i) => (i === index ? { ...s, loading: true, error: null } : s))
    );

    // Build pipeline up to this stage
    const partialPipeline: any[] = [];
    let hasError = false;

    for (let i = 0; i <= index; i++) {
      const stage = currentStages[i];
      if (stage.disabled) continue;
      try {
        let cleanVal = stage.value.trim();
        if (cleanVal === "") cleanVal = "{}";
        const parsedValue = JSON.parse(cleanVal);
        partialPipeline.push({ [stage.operator]: parsedValue });
      } catch (err: any) {
        setStages((prev) =>
          prev.map((s, i) =>
            i === index
              ? {
                  ...s,
                  loading: false,
                  error: `Stage ${i} JSON parse error: ${err.message}`,
                  previewDocs: [],
                }
              : s
          )
        );
        hasError = true;
        break;
      }
    }

    if (hasError) return;

    try {
      const [result, explainResult] = await Promise.all([
        invokeWithLog(
          "AGGREGATE",
          `${dbName}.${collName}`,
          "aggregate_documents",
          {
            dbName,
            collName,
            pipelineStr: JSON.stringify(partialPipeline),
          },
          JSON.stringify(partialPipeline),
          (res: any[]) => res?.length || 0
        ),
        invoke("explain_aggregation", {
          dbName,
          collName,
          pipelineStr: JSON.stringify(partialPipeline),
        }).catch((err) => {
          console.warn("Explain aggregation failed:", err);
          return null;
        })
      ]);

      const execTime = findExecutionTime(explainResult);
      const indexUsed = findUsedIndex(explainResult);

      setStages((prev) =>
        prev.map((s, i) =>
          i === index
            ? {
                ...s,
                previewDocs: result as any[],
                loading: false,
                error: null,
                executionTime: execTime,
                indexUsed: indexUsed,
                explainError: explainResult ? null : "Explain failed"
              }
            : s
        )
      );
    } catch (err: any) {
      setStages((prev) =>
        prev.map((s, i) =>
          i === index
            ? {
                ...s,
                loading: false,
                error: String(err),
                previewDocs: [],
                executionTime: null,
                indexUsed: null,
              }
            : s
        )
      );
    }
  };

  const runEntirePipelineWithStages = async (pipelineStages: PipelineStage[]) => {
    setFinalLoading(true);
    setFinalError(null);
    setFinalOutput([]);

    const fullPipeline: any[] = [];
    try {
      for (const stage of pipelineStages) {
        if (stage.disabled) continue;
        let cleanVal = stage.value.trim();
        if (cleanVal === "") cleanVal = "{}";
        const parsed = JSON.parse(cleanVal);
        fullPipeline.push({ [stage.operator]: parsed });
      }
    } catch (err: any) {
      setFinalError(`Pipeline syntax error: ${err.message}`);
      setFinalLoading(false);
      return;
    }

    try {
      const result: any[] = await invokeWithLog(
        "AGGREGATE",
        `${dbName}.${collName}`,
        "aggregate_documents",
        {
          dbName,
          collName,
          pipelineStr: JSON.stringify(fullPipeline),
        },
        JSON.stringify(fullPipeline),
        (res: any[]) => res?.length || 0
      );
      setFinalOutput(result);
    } catch (err: any) {
      setFinalError(String(err));
    } finally {
      setFinalLoading(false);
    }
  };

  const runEntirePipeline = () => runEntirePipelineWithStages(stages);

  const copyToClipboard = () => {
    const fullPipeline: any[] = [];
    for (const stage of stages) {
      if (stage.disabled) continue;
      try {
        let cleanVal = stage.value.trim();
        if (cleanVal === "") cleanVal = "{}";
        const parsed = JSON.parse(cleanVal);
        fullPipeline.push({ [stage.operator]: parsed });
      } catch {
        fullPipeline.push({ [stage.operator]: {} });
      }
    }
    const command = `db.${collName}.aggregate(${JSON.stringify(fullPipeline, null, 2)})`;
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FAFAF7] overflow-hidden select-text">
      {/* 1. Header Toolbar */}
      <div className="px-6 py-4 bg-white border-b border-[#111827]/10 flex items-center justify-between shrink-0 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-[#F2673C]/10 rounded-lg text-[#F2673C]">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-[#111827]">Aggregation Pipeline Builder</h2>
            <p className="text-[10px] text-[#8A93A2] mt-0.5">
              Compose matching, grouping, and projection stages to aggregate documents.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Stages / Text view toggle */}
          <div className="flex border border-[#EBE7DF] bg-white rounded-lg p-0.5 shadow-2xs mr-1">
            <button
              onClick={() => { if (editorView !== "stages") switchToStages(); }}
              className={`px-2 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition-colors ${
                editorView === "stages" ? "bg-[#EBE7DF] text-[#111827]" : "text-[#8A93A2] hover:text-[#5B6472]"
              }`}
              title="Visual stage editor"
            >
              <ListTree className="w-3.5 h-3.5" /> Stages
            </button>
            <button
              onClick={() => { if (editorView !== "text") switchToText(); }}
              className={`px-2 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition-colors ${
                editorView === "text" ? "bg-[#EBE7DF] text-[#111827]" : "text-[#8A93A2] hover:text-[#5B6472]"
              }`}
              title="Full-pipeline text editor"
            >
              <FileJson className="w-3.5 h-3.5" /> Text
            </button>
          </div>
          <button
            onClick={copyToClipboard}
            className="px-3 py-1.5 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Copy Pipeline command for mongosh"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#16A34A]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "Copied Command" : "Copy Pipeline"}</span>
          </button>

          <button
            onClick={() => setShowSaveModal(true)}
            className="px-3 py-1.5 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Save current pipeline"
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>Save Pipeline</span>
          </button>

          <button
            onClick={() => setShowSavedPipelinesDrawer(true)}
            className="px-3 py-1.5 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            title="View saved pipelines"
          >
            <History className="w-3.5 h-3.5" />
            <span>Saved Pipelines</span>
          </button>

          <button
            onClick={() => setCodeGeneratorOpen(true)}
            className="px-3 py-1.5 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Generate copy-pasteable driver code for this pipeline"
          >
            <Code className="w-3.5 h-3.5" />
            <span>Export Code</span>
          </button>

          <button
            onClick={handleExplainPipeline}
            className="px-3 py-1.5 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Explain entire aggregation pipeline"
          >
            <Code className="w-3.5 h-3.5" />
            <span>Explain Plan</span>
          </button>

          <button
            onClick={runEntirePipeline}
            disabled={finalLoading}
            className="px-4 py-1.5 bg-[#F2673C] text-white hover:bg-[#D9491F] disabled:bg-[#F2673C]/50 font-bold text-xs rounded-lg flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
          >
            {finalLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>Run Pipeline</span>
          </button>
        </div>
      </div>

      {/* 2. Scrollable Sandbox */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0">
        {editorView === "text" ? (
          <div className="bg-white rounded-xl border border-[#111827]/10 shadow-xs p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#8A93A2] uppercase">Full Pipeline (JSON array of stages)</span>
              <button
                onClick={switchToStages}
                className="px-2.5 py-1 text-[10px] font-bold bg-[#F2673C]/10 hover:bg-[#F2673C] text-[#F2673C] hover:text-white rounded-md transition-colors cursor-pointer"
              >
                Apply to Stages
              </button>
            </div>
            {textError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{textError}</div>
            )}
            <textarea
              value={pipelineText}
              onChange={(e) => setPipelineText(e.target.value)}
              className="w-full min-h-[360px] p-4 bg-[#1B1F27] text-[#E6E6E6] font-mono text-xs rounded-lg border border-[#232833] focus:outline-none resize-y leading-relaxed"
              spellCheck={false}
              placeholder='[ { "$match": { } } ]'
            />
          </div>
        ) : (
        <>
        <div className="space-y-4">
          {stages.map((stage, idx) => (
            <div 
              key={stage.id} 
              draggable={isGripPressed}
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnter={(e) => handleDragEnter(e, idx)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={() => {
                setDraggingIndex(null);
                setDragOverIndex(null);
                setIsGripPressed(false);
              }}
              className={`bg-white rounded-xl border shadow-xs overflow-hidden flex flex-col transition-all ${
                draggingIndex === idx ? "opacity-30 border-dashed border-[#F2673C]" : "border-[#111827]/10"
              } ${
                dragOverIndex === idx && draggingIndex !== idx ? "border-t-4 border-t-[#F2673C] scale-[1.01] shadow-md" : ""
              } ${stage.disabled ? "opacity-60" : ""}`}
            >
              {/* Stage Header */}
              <div className="px-4 py-3 bg-[#F4F1EC]/30 border-b border-[#111827]/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {/* Grip Handle for Drag & Drop */}
                  <div
                    className="p-1 hover:bg-[#111827]/5 rounded-md text-[#8A93A2] hover:text-[#5B6472] cursor-grab active:cursor-grabbing transition-colors shrink-0"
                    onMouseDown={() => setIsGripPressed(true)}
                    onMouseUp={() => setIsGripPressed(false)}
                    onTouchStart={() => setIsGripPressed(true)}
                    onTouchEnd={() => setIsGripPressed(false)}
                    title="Drag to reorder stage"
                  >
                    <GripVertical className="w-4 h-4" />
                  </div>

                  <button 
                    onClick={() => updateStage(idx, { isExpanded: !stage.isExpanded })}
                    className="p-1 hover:bg-[#111827]/5 rounded-md text-[#5B6472] transition-colors"
                  >
                    {stage.isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider bg-[#EBE7DF] text-[#5B6472] px-2 py-0.5 rounded-md">
                    Stage {idx + 1}
                  </span>
                  {stage.disabled && (
                    <span className="text-[9px] font-bold uppercase tracking-wider bg-[#111827]/5 text-[#8A93A2] px-1.5 py-0.5 rounded-md">
                      Disabled
                    </span>
                  )}
                  
                  {/* Operator selector */}
                  <div className="relative">
                    <select
                      value={stage.operator}
                      onChange={(e) => updateStage(idx, { operator: e.target.value })}
                      className="text-xs font-bold bg-white border border-[#111827]/15 rounded-lg pl-3 pr-8 py-1 focus:outline-none focus:border-[#F2673C] text-[#1F2937]"
                    >
                      {AGG_OPERATORS.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.value}
                        </option>
                      ))}
                    </select>
                  </div>

                  <span className="text-[10px] text-[#8A93A2] italic hidden md:inline">
                    {AGG_OPERATORS.find(op => op.value === stage.operator)?.desc}
                  </span>
                </div>

                <div className="flex items-center gap-2 select-none">
                  {stage.executionTime !== undefined && stage.executionTime !== null && (
                    <span className="text-[10px] font-mono font-bold bg-[#EBE7DF]/60 text-[#1F2937] px-2 py-0.5 rounded-md flex items-center gap-1">
                      <Clock className="w-3 h-3 text-[#5B6472]" />
                      {stage.executionTime} ms
                    </span>
                  )}
                  {stage.indexUsed !== undefined && (
                    <span className={`text-[10px] font-sans font-bold px-2 py-0.5 rounded-md ${
                      stage.indexUsed 
                        ? "bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0]" 
                        : "bg-amber-50 text-amber-700 border border-amber-200"
                    }`}>
                      {stage.indexUsed ? `Index: ${stage.indexUsed}` : "COLLSCAN"}
                    </span>
                  )}

                  <button
                    onClick={() => setFocusIdx(idx)}
                    className="p-1.5 hover:bg-[#111827]/5 text-[#5B6472] hover:text-[#111827] rounded-lg transition-colors cursor-pointer"
                    title="Focus mode — edit this stage"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => toggleStageDisabled(idx)}
                    className="p-1.5 hover:bg-[#111827]/5 text-[#5B6472] hover:text-[#111827] rounded-lg transition-colors cursor-pointer"
                    title={stage.disabled ? "Enable stage" : "Disable stage"}
                  >
                    {stage.disabled ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>

                  <button
                    onClick={() => removeStage(idx)}
                    className="p-1.5 hover:bg-[#DC2626]/10 text-[#5B6472] hover:text-[#DC2626] rounded-lg transition-colors cursor-pointer"
                    title="Remove Stage"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Stage body (Editor and Preview) */}
              {stage.isExpanded && (
                <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#111827]/10 min-h-[200px]">
                  {/* Left Column: JSON Editor */}
                  <div className="p-4 flex flex-col bg-[#FAFAF7]/35 relative">
                    <div className="flex items-center justify-between text-[10px] font-bold text-[#8A93A2] uppercase mb-1.5">
                      <span>Parameters</span>
                      
                      <div className="flex items-center gap-2">
                        {/* Operator / Snippet dropdown */}
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              insertTextAtCursor(idx, e.target.value);
                              e.target.value = ""; // reset
                            }
                          }}
                          className="bg-[#FAFAF7] border border-[#111827]/15 rounded-md px-2 py-0.5 text-[9px] text-[#5B6472] font-semibold focus:outline-none focus:border-[#F2673C] cursor-pointer"
                          defaultValue=""
                        >
                          <option value="" disabled>+ Insert Template</option>
                          {OPERATOR_TEMPLATES.map((tmpl) => (
                            <option key={tmpl.label} value={tmpl.value}>
                              {tmpl.label}
                            </option>
                          ))}
                        </select>
                        <span className="font-normal lowercase font-mono">JSON format</span>
                      </div>
                    </div>
                    <div className="flex-1 relative min-h-[140px] rounded-lg border border-[#232833] bg-[#1B1F27] overflow-auto focus-within:border-[#F2673C] transition-all">
                      <CodeEditor
                        ref={(h) => {
                          editorRefs.current[stage.id] = h;
                        }}
                        value={stage.value}
                        onChange={(v) => updateStage(idx, { value: v })}
                        language="json"
                        theme="dark"
                        completer={getStageCompleter(stage.operator)}
                        onRun={() => runStagePreviewsFrom(idx, stages)}
                        placeholder="e.g. { }"
                        ariaLabel={`Stage ${idx + 1} editor`}
                        className="absolute inset-0"
                      />
                    </div>
                  </div>

                  {/* Right Column: Live Output Preview */}
                  <div className="p-4 flex flex-col min-h-0 relative">
                    <div className="flex items-center justify-between text-[10px] font-bold text-[#8A93A2] uppercase mb-2">
                      <span>Stage Output Preview</span>
                      {stage.loading && <span className="text-xs text-[#F2673C] flex items-center gap-1 font-normal uppercase tracking-wider"><Loader2 className="w-3 h-3 animate-spin" /> executing...</span>}
                    </div>

                    <div className="flex-1 overflow-y-auto max-h-[220px] pr-1">
                      {stage.executionTime && stage.executionTime > 100 && stage.operator === "$match" && (
                        <div className="mb-3 bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg flex items-start gap-2.5 text-[11px] font-medium leading-relaxed select-text">
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold block">⚠️ Slow Match Stage Detected ({stage.executionTime}ms)</span>
                            <span>
                              Consider creating an index on:
                              {detectMatchFields(stage.value).length > 0 ? (
                                detectMatchFields(stage.value).map(f => (
                                  <code key={f} className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-100 font-bold ml-1">
                                    {`{ ${f}: 1 }`}
                                  </code>
                                ))
                              ) : (
                                <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-100 font-bold ml-1">
                                  {`{ field: 1 }`}
                                </code>
                              )}
                            </span>
                          </div>
                        </div>
                      )}
                      {stage.error ? (
                        <div className="bg-[#FEE2E2] border border-[#DC2626]/10 text-[#721C24] p-3 rounded-lg flex gap-2 text-[11px]">
                          <AlertCircle className="w-4 h-4 text-[#DC2626] shrink-0" />
                          <span className="leading-snug">{stage.error}</span>
                        </div>
                      ) : stage.previewDocs.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center py-8 text-[#8A93A2]">
                          <Code className="w-6 h-6 mb-2 opacity-50" />
                          <p className="text-[11px] font-semibold">No documents generated by this stage</p>
                        </div>
                      ) : (
                        <div className="space-y-3 font-mono text-[11px]">
                          {stage.previewDocs.map((doc, dIdx) => (
                            <div key={dIdx} className="p-3 border border-[#111827]/5 rounded-lg bg-[#FAFAF7]/50 select-text">
                              <BsonTreeObject value={doc} isRoot={true} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add Stage Button */}
        <button
          onClick={addStage}
          className="w-full py-3 border-2 border-dashed border-[#111827]/10 hover:border-[#F2673C]/40 hover:bg-[#F2673C]/5 text-[#5B6472] hover:text-[#F2673C] rounded-xl flex items-center justify-center gap-2 text-xs font-bold transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Stage</span>
        </button>
        </>
        )}

        {/* 3. Final Aggregated Results Panel */}
        {(finalOutput.length > 0 || finalError || finalLoading) && (
          <div className="bg-white rounded-xl border border-[#111827]/10 shadow-md overflow-hidden flex flex-col animate-fadeIn">
            <div className="px-4 py-3 bg-[#EBE7DF]/30 border-b border-[#111827]/10 flex items-center justify-between">
              <span className="text-xs font-bold text-[#111827] uppercase tracking-wider">
                Pipeline Final Output (Preview)
              </span>
              <span className="text-[10px] font-semibold text-[#5B6472]">
                {finalOutput.length} documents returned
              </span>
            </div>

            <div className="p-4 overflow-y-auto max-h-[350px]">
              {finalLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-[#5B6472]">
                  <Loader2 className="w-8 h-8 animate-spin text-[#F2673C] mb-2" />
                  <span className="text-xs">Executing aggregation pipeline...</span>
                </div>
              ) : finalError ? (
                <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-lg flex gap-2 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{finalError}</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {finalOutput.map((doc, idx) => (
                    <div key={idx} className="p-4 border border-[#111827]/5 hover:border-[#111827]/10 rounded-lg bg-[#FAFAF7]/50 select-text">
                      <BsonTreeObject value={doc} isRoot={true} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Explain Plan Side Drawer / Overlay */}
      {showExplainSheet && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-xs transition-opacity animate-fadeIn">
          {/* Backdrop click to close */}
          <div className="flex-1" onClick={() => setShowExplainSheet(false)} />
          
          {/* Sheet Container */}
          <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-slideInRight select-text">
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#111827]/10 flex items-center justify-between bg-[#FAFAF7]">
              <div>
                <h3 className="text-sm font-bold text-[#111827]">Aggregation Explain Plan</h3>
                <p className="text-[10px] text-[#8A93A2] mt-0.5">
                  Detailed performance stats and query execution plan.
                </p>
              </div>
              <button
                onClick={() => setShowExplainSheet(false)}
                aria-label="Close explain drawer"
                className="p-1.5 hover:bg-[#111827]/5 rounded-lg text-[#5B6472] hover:text-[#111827] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {explainLoading ? (
                <div className="flex flex-col items-center justify-center py-24 text-[#5B6472]">
                  <Loader2 className="w-8 h-8 animate-spin text-[#F2673C] mb-2" />
                  <span className="text-xs">Generating explain plan...</span>
                </div>
              ) : explainErrorMsg ? (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-3 text-xs shadow-2xs">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold">Explain execution failed</h4>
                    <p className="opacity-95 mt-1 leading-relaxed">{explainErrorMsg}</p>
                  </div>
                </div>
              ) : explainPlan ? (
                <ExplainPlanView explain={explainPlan} />
              ) : (
                <div className="flex flex-col items-center justify-center py-24 text-[#8A93A2]">
                  <span className="text-xs">No explain plan generated.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save Pipeline Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-xl border border-[#111827]/10 p-6 shadow-2xl w-full max-w-md animate-scaleIn select-text">
            <h3 className="text-sm font-bold text-[#111827] mb-2">Save Aggregation Pipeline</h3>
            <p className="text-xs text-[#5B6472] mb-4">
              Enter a name to save this pipeline for the collection <code className="font-mono bg-[#FAFAF7] px-1 py-0.5 rounded border border-[#111827]/5 font-semibold">{dbName}.{collName}</code>.
            </p>
            <input
              type="text"
              value={pipelineName}
              onChange={(e) => setPipelineName(e.target.value)}
              placeholder="e.g. Active Users Grouping"
              className="w-full text-xs px-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C] focus:bg-white transition-all mb-4"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSavePipeline();
              }}
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => {
                  setShowSaveModal(false);
                  setPipelineName("");
                }}
                className="px-3 py-1.5 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSavePipeline}
                disabled={!pipelineName.trim()}
                className="px-4 py-1.5 bg-[#F2673C] text-white hover:bg-[#D9491F] disabled:bg-[#F2673C]/50 font-bold rounded-lg transition-colors shadow-2xs cursor-pointer"
              >
                Save Pipeline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Saved Pipelines Drawer */}
      {showSavedPipelinesDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-xs transition-opacity animate-fadeIn">
          {/* Backdrop click to close */}
          <div className="flex-1" onClick={() => setShowSavedPipelinesDrawer(false)} />
          
          {/* Drawer Container */}
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-slideInRight select-text">
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#111827]/10 flex items-center justify-between bg-[#FAFAF7]">
              <div>
                <h3 className="text-sm font-bold text-[#111827]">Saved Pipelines</h3>
                <p className="text-[10px] text-[#8A93A2] mt-0.5">
                  Saved aggregation pipelines for <code className="font-mono font-bold text-[#1F2937]">{dbName}.{collName}</code>.
                </p>
              </div>
              <button
                onClick={() => setShowSavedPipelinesDrawer(false)}
                className="p-1.5 hover:bg-[#111827]/5 rounded-lg text-[#5B6472] hover:text-[#111827] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {savedPipelines.filter(p => p.dbName === dbName && p.collName === collName).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center text-[#8A93A2]">
                  <History className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-xs font-semibold">No saved pipelines yet</p>
                  <p className="text-[10px] text-[#8A93A2]/80 mt-1">Build a pipeline and click "Save Pipeline" to store it.</p>
                </div>
              ) : (
                savedPipelines
                  .filter(p => p.dbName === dbName && p.collName === collName)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="group flex flex-col p-4 bg-[#FAFAF7] hover:bg-[#F4F1EC]/40 rounded-xl border border-[#111827]/5 shadow-xs transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="overflow-hidden">
                          <h4 className="text-xs font-bold text-[#111827] truncate">
                            {p.name}
                          </h4>
                          <span className="text-[10px] font-semibold text-[#5B6472] block mt-0.5">
                            {p.stages.length} {p.stages.length === 1 ? "stage" : "stages"}
                          </span>
                        </div>
                        <button
                          onClick={(e) => handleDeletePipeline(p.id, e)}
                          title="Delete saved pipeline"
                          className="p-1 hover:bg-red-50 text-[#8A93A2] hover:text-[#DC2626] rounded-md transition-colors shrink-0 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="mt-4 flex items-center justify-between text-[10px] border-t border-[#111827]/5 pt-3 select-none">
                        <span className="text-[#8A93A2]">
                          Saved {new Date(p.createdAt).toLocaleDateString()}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleLoadPipeline(p, false)}
                            className="px-2.5 py-1 text-[10px] font-bold bg-[#EBE7DF]/50 hover:bg-[#EBE7DF] text-[#5B6472] rounded-md transition-colors cursor-pointer"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => handleLoadPipeline(p, true)}
                            className="px-2.5 py-1 text-[10px] font-bold bg-[#F2673C]/10 hover:bg-[#F2673C] text-[#F2673C] hover:text-white rounded-md transition-colors cursor-pointer"
                          >
                            Run
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Code Generator Modal */}
      <CodeGeneratorModal
        isOpen={codeGeneratorOpen}
        onClose={() => setCodeGeneratorOpen(false)}
        dbName={dbName}
        collName={collName}
        queryType="aggregate"
        queryData={{
          pipelineStr: getPipelineStr(),
        }}
      />

      {/* Focus Mode Modal */}
      {focusIdx !== null && stages[focusIdx] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs animate-fadeIn p-4">
          <div className="bg-white rounded-xl border border-[#111827]/10 shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden animate-scaleIn">
            <div className="px-6 py-4 bg-[#F4F1EC] border-b border-[#111827]/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Maximize2 className="w-4 h-4 text-[#F2673C]" />
                <h3 className="text-sm font-bold text-[#111827]">Focus: Stage {focusIdx + 1}</h3>
                <select
                  value={stages[focusIdx].operator}
                  onChange={(e) => updateStage(focusIdx, { operator: e.target.value })}
                  className="text-xs font-bold bg-white border border-[#111827]/15 rounded-lg pl-3 pr-8 py-1 focus:outline-none focus:border-[#F2673C] text-[#1F2937]"
                >
                  {AGG_OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>{op.value}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => setFocusIdx(null)}
                className="p-1.5 hover:bg-[#EBE7DF] rounded-lg text-[#5B6472] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#111827]/10 flex-1 min-h-0 overflow-hidden">
              <div className="p-4 flex flex-col min-h-[300px]">
                <span className="text-[10px] font-bold text-[#8A93A2] uppercase mb-1.5">Parameters (JSON)</span>
                <textarea
                  value={stages[focusIdx].value}
                  onChange={(e) => updateStage(focusIdx, { value: e.target.value })}
                  className="flex-1 p-3 bg-[#1B1F27] text-[#E6E6E6] font-mono text-xs rounded-lg border border-[#232833] focus:outline-none resize-none leading-relaxed"
                  spellCheck={false}
                />
              </div>
              <div className="p-4 flex flex-col min-h-0 overflow-y-auto">
                <span className="text-[10px] font-bold text-[#8A93A2] uppercase mb-2">Stage Output Preview</span>
                {stages[focusIdx].error ? (
                  <div className="bg-[#FEE2E2] border border-[#DC2626]/10 text-[#721C24] p-3 rounded-lg flex gap-2 text-[11px]">
                    <AlertCircle className="w-4 h-4 text-[#DC2626] shrink-0" />
                    <span className="leading-snug">{stages[focusIdx].error}</span>
                  </div>
                ) : stages[focusIdx].previewDocs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center py-8 text-[#8A93A2]">
                    <Code className="w-6 h-6 mb-2 opacity-50" />
                    <p className="text-[11px] font-semibold">No documents generated by this stage</p>
                  </div>
                ) : (
                  <div className="space-y-3 font-mono text-[11px]">
                    {stages[focusIdx].previewDocs.map((doc, dIdx) => (
                      <div key={dIdx} className="p-3 border border-[#111827]/5 rounded-lg bg-[#FAFAF7]/50 select-text">
                        <BsonTreeObject value={doc} isRoot={true} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
