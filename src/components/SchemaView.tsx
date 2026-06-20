import { useState, useEffect, useRef, Fragment } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  Sparkles, Loader2, AlertTriangle, Layers, 
  ChevronDown, ChevronRight, Check, AlertCircle,
  GitCompare, RefreshCw
} from "lucide-react";
import { 
  analyzeDocuments, 
  compareSnapshots, 
  SchemaAnalysisResult
} from "../schemaAnalyzer";

interface SchemaViewProps {
  dbName: string;
  collName: string;
}

const STORAGE_PREFIX = "compass_plus_schema_snap_";

function isValidSchemaSnapshot(obj: any): obj is SchemaAnalysisResult {
  if (!obj || typeof obj !== "object") return false;
  if (typeof obj.totalDocs !== "number") return false;
  if (typeof obj.totalFields !== "number") return false;
  if (typeof obj.averageDepth !== "number") return false;
  if (typeof obj.maxDepth !== "number") return false;
  if (typeof obj.mixedTypesCount !== "number") return false;
  if (typeof obj.sparsityPercent !== "number") return false;
  if (!Array.isArray(obj.fields)) return false;
  return true;
}

export default function SchemaView({ dbName, collName }: SchemaViewProps) {
  const [sampleSize, setSampleSize] = useState<number>(100);
  const [fullScan, setFullScan] = useState<boolean>(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingProgress, setAnalyzingProgress] = useState<{ loaded: number; total: number } | null>(null);
  const cancelRef = useRef<boolean>(false);
  
  const [currentResult, setCurrentResult] = useState<SchemaAnalysisResult | null>(null);
  const [previousResult, setPreviousResult] = useState<SchemaAnalysisResult | null>(null);
  const [diffResult, setDiffResult] = useState<SchemaAnalysisResult | null>(null);
  
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [totalCollDocs, setTotalCollDocs] = useState<number>(0);

  const storageKey = `${STORAGE_PREFIX}${dbName}_${collName}`;

  // Fetch the total collection document count on mount or namespace change
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const stats: any[] = await invoke("get_collections_stats", { dbName });
        const collStats = stats.find((s: any) => s.name === collName);
        if (collStats && typeof collStats.count === "number") {
          setTotalCollDocs(collStats.count);
        } else {
          // Fallback: query with limit 1 to get count if stats doesn't return count directly
          const result: any = await invoke("find_documents", {
            dbName,
            collName,
            filterStr: "{}",
            sortStr: "{}",
            projectionStr: "{}",
            limit: 1,
            skip: 0
          });
          setTotalCollDocs(result?.total_count || 0);
        }
      } catch (err) {
        console.error("Failed to fetch collection stats:", err);
      }
    };

    fetchStats();
    // Load previously saved snapshot
    const savedSnap = localStorage.getItem(storageKey);
    if (savedSnap) {
      try {
        const parsed = JSON.parse(savedSnap);
        if (isValidSchemaSnapshot(parsed)) {
          setCurrentResult(parsed);
          setDiffResult(parsed);
        } else {
          console.warn("Invalid schema snapshot format in localStorage. Clearing.");
          localStorage.removeItem(storageKey);
          setCurrentResult(null);
          setDiffResult(null);
        }
      } catch (e) {
        console.error("Failed to parse saved schema snapshot:", e);
        setCurrentResult(null);
        setDiffResult(null);
      }
    } else {
      setCurrentResult(null);
      setDiffResult(null);
    }
    setPreviousResult(null);
    setError(null);
    setExpandedFields(new Set());
  }, [dbName, collName]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    setError(null);
    setAnalyzingProgress(null);
    cancelRef.current = false;

    // If there is currently a result, set it as the previous snapshot to perform comparison diffing
    if (currentResult) {
      setPreviousResult(currentResult);
    }

    try {
      let docs: any[] = [];
      
      if (fullScan) {
        const batchSize = 1000;
        let skip = 0;
        const total = totalCollDocs || 0;

        if (total === 0) {
          throw new Error("Collection is empty or no documents were returned.");
        }

        setAnalyzingProgress({ loaded: 0, total });

        while (skip < total) {
          if (cancelRef.current) {
            throw new Error("Analysis cancelled by user.");
          }

          const result: any = await invoke("find_documents", {
            dbName,
            collName,
            filterStr: "{}",
            sortStr: "{}",
            projectionStr: "{}",
            limit: batchSize,
            skip
          });

          const batchDocs = result?.documents || [];
          if (batchDocs.length === 0) {
            break; // No more documents
          }

          docs.push(...batchDocs);
          skip += batchDocs.length;
          
          setAnalyzingProgress({ loaded: Math.min(skip, total), total });

          // Yield to browser main thread to keep UI responsive
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } else {
        const result: any = await invoke("find_documents", {
          dbName,
          collName,
          filterStr: "{}",
          sortStr: "{}",
          projectionStr: "{}",
          limit: sampleSize,
          skip: 0
        });
        docs = result?.documents || [];
      }

      if (docs.length === 0) {
        throw new Error("Collection is empty or no documents were returned.");
      }

      // Compute schema stats
      const analysis = analyzeDocuments(docs);
      
      // Save snapshot to localStorage
      localStorage.setItem(storageKey, JSON.stringify(analysis));
      setCurrentResult(analysis);

      // Perform comparison
      const compared = compareSnapshots(analysis, currentResult);
      setDiffResult(compared);

      // Dispatch event to update navbar badges (HomeView)
      window.dispatchEvent(new CustomEvent("schema_analysis_completed", {
        detail: { fieldsCount: analysis.totalFields }
      }));

    } catch (err: any) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
      setAnalyzingProgress(null);
    }
  };

  const toggleFieldExpand = (path: string) => {
    const next = new Set(expandedFields);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    setExpandedFields(next);
  };

  const getDiffSummary = () => {
    if (!diffResult || !previousResult) return null;
    let added = 0;
    let removed = 0;
    let changed = 0;

    diffResult.fields.forEach(f => {
      if (f.comparison === 'new') added++;
      if (f.comparison === 'removed') removed++;
      if (f.comparison === 'type_changed') changed++;
    });

    if (added === 0 && removed === 0 && changed === 0) return null;

    return { added, removed, changed };
  };

  const getTypeColorClass = (type: string) => {
    switch (type) {
      case 'String': return 'bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0]';
      case 'Number': return 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]';
      case 'Boolean': return 'bg-[#F3E8FF] text-[#6B21A8] border-[#E9D5FF]';
      case 'ObjectID': return 'bg-[#E0EBFB] text-[#1D4ED8] border-[#BFDBFE]';
      case 'Date': return 'bg-[#E0F2FE] text-[#0369A1] border-[#BAE6FD]';
      case 'Null': return 'bg-[#F4F1EC] text-[#5B6472] border-[#EBE7DF]';
      case 'Array': return 'bg-[#FEE2E2] text-[#991B1B] border-[#FCA5A5]';
      case 'Object': return 'bg-[#E2E8F0] text-[#475569] border-[#CBD5E1]';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const diffSummary = getDiffSummary();

  return (
    <div className="flex-1 p-6 bg-[#FAFAF7] overflow-y-auto space-y-6 select-text">
      {/* Control Panel */}
      <div className="bg-white p-6 rounded-xl border border-[#111827]/10 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4 select-none">
        <div className="space-y-1">
          <h2 className="text-sm font-bold text-[#111827]">Schema Analysis</h2>
          <p className="text-[11px] text-[#8A93A2]">
            Analyze a representative sample of documents to detect schema structure, field types, and outliers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {/* Full-scan option */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="fullScan"
              checked={fullScan}
              onChange={(e) => setFullScan(e.target.checked)}
              className="accent-[#F2673C] w-4 h-4 rounded cursor-pointer"
            />
            <label htmlFor="fullScan" className="text-xs font-semibold text-[#1F2937] cursor-pointer">
              Full-scan mode ({totalCollDocs.toLocaleString()} docs)
            </label>
          </div>

          {/* Sample size selector */}
          {!fullScan && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-[#8A93A2]">Sample size:</span>
              <select
                value={sampleSize}
                onChange={(e) => setSampleSize(Number(e.target.value))}
                className="text-xs bg-[#FAFAF7] border border-[#EBE7DF] rounded-lg px-2.5 py-1.5 font-bold text-[#1F2937] focus:outline-none focus:border-[#F2673C]"
              >
                <option value="100">100 docs</option>
                <option value="500">500 docs</option>
                <option value="1000">1,000 docs</option>
              </select>
            </div>
          )}

          {/* Progress text */}
          {analyzing && analyzingProgress && (
            <span className="text-[11px] text-[#5B6472] font-semibold animate-pulse select-none">
              Loaded {analyzingProgress.loaded.toLocaleString()} of {analyzingProgress.total.toLocaleString()} docs
            </span>
          )}

          {/* Cancel button */}
          {analyzing && (
            <button
              onClick={() => { cancelRef.current = true; }}
              className="px-3 py-2 border border-red-200 hover:bg-red-50 text-red-600 font-bold text-xs rounded-lg transition-colors cursor-pointer"
            >
              Cancel Scan
            </button>
          )}

          {/* Analyze / Re-sample button */}
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="px-4 py-2 bg-[#F2673C] text-white hover:bg-[#D9491F] disabled:bg-[#8A93A2] font-bold text-xs rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm shrink-0"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {fullScan ? "Full Scan..." : "Analyzing..."}
              </>
            ) : currentResult ? (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                Re-sample Schema
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Analyze Schema
              </>
            )}
          </button>
        </div>
      </div>

      {/* Safety warning for large collections */}
      {fullScan && totalCollDocs > 10000 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3.5 rounded-xl flex items-start gap-2.5 text-xs select-none animate-fadeIn">
          <AlertTriangle className="w-4.5 h-4.5 text-amber-500 shrink-0 mt-0.5" />
          <p>
            Analyzing a large collection ({totalCollDocs.toLocaleString()} documents) may take a while. 
            The scan will run in batches to keep the app responsive. You can cancel at any time.
          </p>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3 text-xs shadow-2xs">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold">Schema Analysis failed</h4>
            <p className="opacity-95 mt-1 leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {diffResult && (
        <div className="space-y-6">
          {/* Comparison summary banner */}
          {diffSummary && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-xl flex items-center gap-2.5 text-xs shadow-2xs select-none animate-fadeIn">
              <GitCompare className="w-4.5 h-4.5 text-blue-500 shrink-0" />
              <span>
                Compared to the last schema snapshot:{" "}
                {diffSummary.added > 0 && <strong className="text-blue-900">+{diffSummary.added} new fields</strong>}
                {diffSummary.added > 0 && (diffSummary.changed > 0 || diffSummary.removed > 0) && ", "}
                {diffSummary.changed > 0 && <strong className="text-blue-900">{diffSummary.changed} type changes</strong>}
                {diffSummary.changed > 0 && diffSummary.removed > 0 && ", "}
                {diffSummary.removed > 0 && <strong className="text-red-700">-{diffSummary.removed} removed fields</strong>}
              </span>
            </div>
          )}

          {/* Metrics summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 select-none">
            <div className="bg-white p-5 rounded-xl border border-[#111827]/10 shadow-2xs space-y-2">
              <div className="text-[10px] uppercase font-bold text-[#8A93A2] tracking-wider">Total Fields Analyzed</div>
              <div className="text-2xl font-black text-[#111827]">{diffResult.totalFields}</div>
              <div className="text-[10px] text-[#8A93A2]">
                Average Depth: {diffResult.averageDepth} levels · Max Depth: {diffResult.maxDepth}
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-[#111827]/10 shadow-2xs space-y-2">
              <div className="text-[10px] uppercase font-bold text-[#8A93A2] tracking-wider">Mixed Types Warnings</div>
              <div className={`text-2xl font-black ${diffResult.mixedTypesCount > 0 ? "text-[#DC2626]" : "text-[#16A34A]"}`}>
                {diffResult.mixedTypesCount}
              </div>
              <div className="text-[10px] text-[#8A93A2]">
                {diffResult.mixedTypesCount > 0 
                  ? "Consider enforcing schema validators or standardizing types." 
                  : "All fields have consistent data types."}
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-[#111827]/10 shadow-2xs space-y-2">
              <div className="text-[10px] uppercase font-bold text-[#8A93A2] tracking-wider">Schema Sparsity</div>
              <div className={`text-2xl font-black ${diffResult.sparsityPercent > 20 ? "text-amber-600" : "text-[#111827]"}`}>
                {diffResult.sparsityPercent}%
              </div>
              <div className="text-[10px] text-[#8A93A2]">
                Percentage of fields missing in over 50% of sampled documents.
              </div>
            </div>
          </div>

          {/* Fields analysis */}
          <div className="bg-white rounded-xl border border-[#111827]/10 overflow-hidden shadow-xs shrink-0 select-text">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#F4F1EC] border-b border-[#111827]/10 font-bold text-[#5B6472] select-none">
                  <th className="p-3 pl-4 w-8"></th>
                  <th className="p-3">Field Path</th>
                  <th className="p-3">Types & Share</th>
                  <th className="p-3">Occurrences</th>
                  <th className="p-3 pr-4">Quality / Warnings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#111827]/5 font-mono">
                {diffResult.fields.map((field) => {
                  const isExpanded = expandedFields.has(field.path);
                  const isRemoved = field.comparison === 'removed';
                  const isNew = field.comparison === 'new';
                  const isTypeChanged = field.comparison === 'type_changed';

                  return (
                    <Fragment key={field.path}>
                      {/* Field Row */}
                      <tr 
                        key={field.path} 
                        onClick={() => !isRemoved && toggleFieldExpand(field.path)}
                        className={`hover:bg-[#FAFAF7] cursor-pointer transition-colors ${isRemoved ? 'bg-red-50/20 opacity-60' : ''} ${isNew ? 'bg-green-50/10' : ''}`}
                      >
                        <td className="p-3 pl-4 text-center select-none">
                          {!isRemoved && (
                            isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-[#8A93A2]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#8A93A2]" />
                          )}
                        </td>
                        <td className="p-3 text-sm">
                          <span 
                            className={`font-semibold ${isRemoved ? 'line-through text-red-500 font-medium' : 'text-[#111827]'} pl-${(field.depth - 1) * 3}`}
                          >
                            {field.path}
                          </span>
                        </td>
                        <td className="p-3 py-4 space-y-1.5 min-w-[200px]">
                          {field.types.map((t) => {
                            const share = (t.count / field.occurrences) * 100;
                            return (
                              <div key={t.type} className="flex flex-col gap-0.5 max-w-[240px]">
                                <div className="flex items-center justify-between text-[10px] select-none">
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black border uppercase tracking-wider ${getTypeColorClass(t.type)}`}>
                                    {t.type}
                                  </span>
                                  <span className="font-bold text-[#5B6472]">{share.toFixed(0)}%</span>
                                </div>
                                {!isRemoved && (
                                  <div className="w-full bg-[#111827]/5 h-1 rounded-full overflow-hidden select-none">
                                    <div 
                                      className={`h-full rounded-full ${
                                        t.type === 'String' ? 'bg-[#16A34A]' :
                                        t.type === 'Number' ? 'bg-[#D97706]' :
                                        t.type === 'Boolean' ? 'bg-[#8B5CF6]' :
                                        t.type === 'ObjectID' ? 'bg-[#2563EB]' :
                                        t.type === 'Date' ? 'bg-[#0284C7]' :
                                        'bg-[#5B6472]'
                                      }`}
                                      style={{ width: `${share}%` }}
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </td>
                        <td className="p-3 text-[#1F2937] text-xs">
                          {field.occurrences} / {diffResult.totalDocs} docs
                          <span className="text-[10px] text-[#8A93A2] block mt-0.5">{(field.percentage * 100).toFixed(0)}% frequency</span>
                        </td>
                        <td className="p-3 space-y-1 select-none">
                          {isRemoved && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase text-red-600 bg-red-50 px-2 py-0.5 border border-red-200 rounded-md">
                              Removed
                            </span>
                          )}
                          {isNew && (
                            <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase text-green-700 bg-green-50 px-2 py-0.5 border border-green-200 rounded-md">
                              New Field
                            </span>
                          )}
                          {isTypeChanged && (
                            <span 
                              className="inline-flex items-center gap-1 text-[9px] font-black uppercase text-amber-700 bg-amber-50 px-2 py-0.5 border border-amber-200 rounded-md"
                              title={`Previously: ${field.prevTypes?.join(', ')}`}
                            >
                              Type changed
                            </span>
                          )}

                          {field.warnings.map((w, idx) => (
                            <span 
                              key={idx} 
                              className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-md border ${
                                w.includes("Mixed Types") 
                                  ? "bg-red-50 text-red-700 border-red-200" 
                                  : "bg-amber-50 text-amber-700 border-amber-200"
                              }`}
                            >
                              <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                              {w.split(":")[0]}
                            </span>
                          ))}

                          {field.warnings.length === 0 && !isRemoved && !isNew && !isTypeChanged && (
                            <span className="text-[#16A34A] font-semibold text-[10px] flex items-center gap-0.5">
                              <Check className="w-3.5 h-3.5" /> Optimal
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* Expanded Details Drawer */}
                      {isExpanded && !isRemoved && (
                        <tr className="bg-[#FAFAF7]/50 select-text animate-fadeIn">
                          <td colSpan={5} className="p-5 pl-12 border-t border-b border-[#111827]/5">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 font-sans text-xs">
                              {/* Left: Value statistics */}
                              <div className="space-y-4">
                                <h4 className="text-[10px] uppercase font-bold text-[#8A93A2] tracking-wider select-none">Value Statistics</h4>
                                <div className="space-y-2 bg-white p-4 rounded-xl border border-[#111827]/5 shadow-2xs font-mono">
                                  {field.types.map((t) => {
                                    const hasStats = t.min !== undefined || t.minLength !== undefined || t.distinctCount !== undefined;
                                    if (!hasStats) return null;
                                    return (
                                      <div key={t.type} className="space-y-2 border-b border-[#111827]/5 last:border-b-0 pb-2 last:pb-0">
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black border uppercase tracking-wider select-none ${getTypeColorClass(t.type)}`}>
                                          {t.type} stats
                                        </span>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs mt-1 text-[#1F2937]">
                                          <div>
                                            <span className="text-[#8A93A2] text-[10px] font-bold block select-none">Distinct Values</span>
                                            <span>{t.distinctCount.toLocaleString()}</span>
                                          </div>
                                          {t.type === 'Number' && t.min !== undefined && (
                                            <>
                                              <div>
                                                <span className="text-[#8A93A2] text-[10px] font-bold block select-none">Min Value</span>
                                                <span>{t.min}</span>
                                              </div>
                                              <div>
                                                <span className="text-[#8A93A2] text-[10px] font-bold block select-none">Max Value</span>
                                                <span>{t.max}</span>
                                              </div>
                                              <div>
                                                <span className="text-[#8A93A2] text-[10px] font-bold block select-none">Mean / Average</span>
                                                <span>{t.mean}</span>
                                              </div>
                                            </>
                                          )}
                                          {(t.type === 'String' || t.type === 'Array') && t.minLength !== undefined && (
                                            <>
                                              <div>
                                                <span className="text-[#8A93A2] text-[10px] font-bold block select-none">Min Length</span>
                                                <span>{t.minLength} {t.type === 'Array' ? 'elements' : 'chars'}</span>
                                              </div>
                                              <div>
                                                <span className="text-[#8A93A2] text-[10px] font-bold block select-none">Max Length</span>
                                                <span>{t.maxLength} {t.type === 'Array' ? 'elements' : 'chars'}</span>
                                              </div>
                                              <div>
                                                <span className="text-[#8A93A2] text-[10px] font-bold block select-none">Avg Length</span>
                                                <span>{t.avgLength} {t.type === 'Array' ? 'elements' : 'chars'}</span>
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Right: Top values */}
                              <div className="space-y-4 select-none">
                                <h4 className="text-[10px] uppercase font-bold text-[#8A93A2] tracking-wider">Top 5 Observed Values</h4>
                                <div className="space-y-3 bg-white p-4 rounded-xl border border-[#111827]/5 shadow-2xs font-mono">
                                  {field.types.map((t) => (
                                    <div key={t.type} className="space-y-2 border-b border-[#111827]/5 last:border-b-0 pb-2.5 last:pb-0">
                                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-black border uppercase tracking-wider ${getTypeColorClass(t.type)}`}>
                                        {t.type} values
                                      </span>
                                      <div className="space-y-2 mt-2">
                                        {t.topValues.map((v, vIdx) => (
                                          <div key={vIdx} className="space-y-1">
                                            <div className="flex justify-between items-center text-xs">
                                              <span className="text-[#1F2937] font-semibold truncate max-w-[180px] lg:max-w-[240px] select-all" title={v.value}>
                                                {v.value}
                                              </span>
                                              <span className="text-[10px] text-[#8A93A2] font-bold">
                                                {v.count}x ({(v.percentage * 100).toFixed(0)}%)
                                              </span>
                                            </div>
                                            <div className="w-full bg-[#111827]/5 h-1.5 rounded-full overflow-hidden">
                                              <div 
                                                className="bg-[#F2673C] h-full rounded-full" 
                                                style={{ width: `${v.percentage * 100}%` }}
                                              />
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!diffResult && !analyzing && (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-12 border border-dashed border-[#111827]/10 bg-white rounded-xl select-none">
          <Layers className="w-10 h-10 text-[#8A93A2] mb-3 opacity-60 animate-pulse" />
          <h3 className="text-sm font-bold text-[#111827]">No Schema Profile Yet</h3>
          <p className="text-xs text-[#8A93A2] max-w-sm mt-1">
            Click the "Analyze Schema" button above to sample documents and build a schema map for <strong className="text-[#1F2937]">{dbName}.{collName}</strong>.
          </p>
        </div>
      )}
    </div>
  );
}
