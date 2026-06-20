import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  Layers, Activity, Trash2, Plus, X, AlertTriangle, 
  Loader2, ShieldAlert, Clock, RefreshCw, Check, Info,
  Search, Download, ChevronRight, ChevronDown
} from "lucide-react";
import { IndexInfo, CurrentOp } from "../types";
import { getQueryLogs } from "../queryLogger";

interface InvestigateViewProps {
  dbName: string;
  collName: string;
}

export default function InvestigateView({ dbName, collName }: InvestigateViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'indexes' | 'current-ops' | 'slow-queries'>('indexes');
  
  // Index management state
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [loadingIndexes, setLoadingIndexes] = useState(false);
  const [indexesError, setIndexesError] = useState<string | null>(null);
  
  // Create index modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  
  const [indexName, setIndexName] = useState("");
  const [isUnique, setIsUnique] = useState(false);
  const [isSparse, setIsSparse] = useState(false);
  const [fields, setFields] = useState<Array<{ field: string; type: string }>>([
    { field: "", type: "1" }
  ]);
  
  // Drop index modal state
  const [indexToDrop, setIndexToDrop] = useState<IndexInfo | null>(null);
  const [isDropping, setIsDropping] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  // Active operations state
  const [ops, setOps] = useState<CurrentOp[]>([]);
  const [loadingOps, setLoadingOps] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);

  // Slow Queries State
  const [profilingSource, setProfilingSource] = useState<'client' | 'server'>('client');
  const [minDurationFilter, setMinDurationFilter] = useState<number>(0);
  const [sortBy, setSortBy] = useState<'impact' | 'max' | 'count' | 'avg'>('impact');
  const [slowQuerySearch, setSlowQuerySearch] = useState('');
  const [serverProfileData, setServerProfileData] = useState<any[]>([]);
  const [loadingServerProfile, setLoadingServerProfile] = useState(false);
  const [serverProfileError, setServerProfileError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroupExpand = (groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const fetchServerProfile = async (showLoading = false) => {
    setServerProfileError(null);
    if (showLoading) {
      setLoadingServerProfile(true);
    }
    try {
      const result = await invoke<any>("find_documents", {
        dbName,
        collName: "system.profile",
        filterStr: "{}",
        sortStr: JSON.stringify({ ts: -1 }),
        projectionStr: "{}",
        limit: 100,
        skip: 0,
      });
      setServerProfileData(result?.documents || []);
    } catch (err: any) {
      setServerProfileError(err instanceof Error ? err.message : String(err));
      setServerProfileData([]);
    } finally {
      if (showLoading) {
        setLoadingServerProfile(false);
      }
    }
  };

  useEffect(() => {
    if (activeSubTab === 'slow-queries' && profilingSource === 'server') {
      fetchServerProfile(true);
    }
  }, [activeSubTab, profilingSource, dbName]);

  const handleSuggestIndex = (recommendedFields: string[]) => {
    setFields(recommendedFields.map(f => ({ field: f, type: "1" })));
    setIndexName(recommendedFields.join("_") + "_idx");
    setIsUnique(false);
    setIsSparse(false);
    setActiveSubTab('indexes');
    setShowCreateModal(true);
  };

  const handleExportReport = (groups: AggregatedQueryGroup[]) => {
    const reportData = {
      exportedAt: new Date().toISOString(),
      database: dbName,
      collection: collName,
      source: profilingSource === 'client' ? 'Client-side query logs' : 'Server-side system.profile',
      groups: groups.map(g => ({
        operation: g.op,
        namespace: g.ns,
        pattern: g.pattern,
        count: g.count,
        avgDurationMs: g.meanDuration,
        p99DurationMs: g.p99Duration,
        maxDurationMs: g.maxDuration,
        totalDurationMs: g.totalDuration,
        lastSeen: g.lastSeen,
        keys: g.keys
      }))
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compass_plus_query_profiler_${dbName}_${collName || 'global'}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fetchOps = async (showLoading = false) => {
    setOpsError(null);
    if (showLoading) {
      setLoadingOps(true);
    }
    try {
      const data = await invoke<CurrentOp[]>("current_ops");
      setOps(data);
    } catch (err: any) {
      setOpsError(err instanceof Error ? err.message : String(err));
    } finally {
      if (showLoading) {
        setLoadingOps(false);
      }
    }
  };

  useEffect(() => {
    if (activeSubTab === 'current-ops') {
      fetchOps(true);
      const interval = setInterval(() => {
        fetchOps(false);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [activeSubTab]);

  const fetchIndexes = async () => {
    if (!dbName || !collName) return;
    setLoadingIndexes(true);
    setIndexesError(null);
    try {
      const data = await invoke<IndexInfo[]>("list_indexes", { dbName, collName });
      setIndexes(data);
    } catch (err: any) {
      setIndexesError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingIndexes(false);
    }
  };

  useEffect(() => {
    fetchIndexes();
  }, [dbName, collName]);

  const handleAddField = () => {
    setFields([...fields, { field: "", type: "1" }]);
  };

  const handleRemoveField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const handleFieldChange = (index: number, value: string) => {
    setFields(
      fields.map((f, i) => (i === index ? { ...f, field: value } : f))
    );
  };

  const handleTypeChange = (index: number, value: string) => {
    setFields(
      fields.map((f, i) => (i === index ? { ...f, type: value } : f))
    );
  };

  const handleCreateIndex = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    
    // Validate fields
    const activeFields = fields.filter((f) => f.field.trim() !== "");
    if (activeFields.length === 0) {
      setCreateError("You must specify at least one field name.");
      return;
    }
    
    setIsCreating(true);
    try {
      const keysObj: Record<string, any> = {};
      activeFields.forEach((f) => {
        const val = f.type === "1" ? 1 : f.type === "-1" ? -1 : f.type;
        keysObj[f.field.trim()] = val;
      });
      
      const keysJson = JSON.stringify(keysObj);
      await invoke("create_index", {
        dbName,
        collName,
        keysJson,
        name: indexName.trim() || null,
        unique: isUnique,
        sparse: isSparse
      });
      
      setShowCreateModal(false);
      // Reset form
      setIndexName("");
      setIsUnique(false);
      setIsSparse(false);
      setFields([{ field: "", type: "1" }]);
      
      // Refresh
      fetchIndexes();
    } catch (err: any) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDropIndex = async () => {
    if (!indexToDrop) return;
    setIsDropping(true);
    setDropError(null);
    try {
      await invoke("drop_index", {
        dbName,
        collName,
        name: indexToDrop.name
      });
      setIndexToDrop(null);
      fetchIndexes();
    } catch (err: any) {
      setDropError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDropping(false);
    }
  };

  const killOp = async (opid: number) => {
    if (window.confirm(`Are you sure you want to kill operation ${opid}?`)) {
      try {
        await invoke("kill_op", { opid });
        fetchOps(false);
      } catch (err: any) {
        alert(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatKeys = (keyObj: Record<string, any>): string => {
    if (!keyObj || typeof keyObj !== 'object') return '{}';
    const parts = Object.entries(keyObj).map(([k, v]) => `${k}: ${v}`);
    return `{ ${parts.join(', ')} }`;
  };

  return (
    <div className="flex-1 flex flex-col bg-[#FAFAF7] h-full overflow-hidden select-text">
      {/* Sub-navigation */}
      <div className="bg-[#F4F1EC] border-b border-[#111827]/10 flex items-center shrink-0 select-none">
        <button
          onClick={() => setActiveSubTab('indexes')}
          className={`px-5 py-3 text-xs font-bold border-r border-[#111827]/10 flex items-center gap-2 transition-colors cursor-pointer ${
            activeSubTab === 'indexes'
              ? "bg-[#FAFAF7] text-[#D9491F] border-b-2 border-b-[#D9491F]"
              : "text-[#5B6472] hover:bg-[#EBE7DF]/50 hover:text-[#111827]"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Indexes ({collName || "Collection"})</span>
        </button>
        <button
          onClick={() => setActiveSubTab('current-ops')}
          className={`px-5 py-3 text-xs font-bold border-r border-[#111827]/10 flex items-center gap-2 transition-colors cursor-pointer ${
            activeSubTab === 'current-ops'
              ? "bg-[#FAFAF7] text-[#D9491F] border-b-2 border-b-[#D9491F]"
              : "text-[#5B6472] hover:bg-[#EBE7DF]/50 hover:text-[#111827]"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Current Database Operations</span>
        </button>
        <button
          onClick={() => setActiveSubTab('slow-queries')}
          className={`px-5 py-3 text-xs font-bold border-r border-[#111827]/10 flex items-center gap-2 transition-colors cursor-pointer ${
            activeSubTab === 'slow-queries'
              ? "bg-[#FAFAF7] text-[#D9491F] border-b-2 border-b-[#D9491F]"
              : "text-[#5B6472] hover:bg-[#EBE7DF]/50 hover:text-[#111827]"
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Slow Query Profiler</span>
        </button>
      </div>

      <div className="flex-1 p-6 overflow-y-auto space-y-6">
        {activeSubTab === 'indexes' && (
          <div className="space-y-6">
            {/* Header Card */}
            <div className="bg-white p-6 rounded-xl border border-[#111827]/10 shadow-xs flex items-center justify-between">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[#111827]">Collection Indexes</h3>
                <p className="text-[11px] text-[#8A93A2]">
                  Indexes support the efficient execution of queries in MongoDB by avoiding collection scans.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="px-3.5 py-1.5 bg-[#F2673C] text-white hover:bg-[#D9491F] font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Index
              </button>
            </div>

            {/* Error Banner */}
            {indexesError && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3 text-xs">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-bold">Failed to load indexes</h4>
                  <p className="opacity-95 mt-1">{indexesError}</p>
                </div>
                <button
                  type="button"
                  onClick={fetchIndexes}
                  className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-800 font-bold rounded-md transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Indexes Table */}
            {loadingIndexes ? (
              <div className="flex flex-col items-center justify-center p-12 bg-white border border-[#111827]/10 rounded-xl">
                <Loader2 className="w-8 h-8 text-[#F2673C] animate-spin mb-3" />
                <span className="text-xs text-[#8A93A2] font-semibold">Loading index definitions...</span>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-[#111827]/10 overflow-hidden shadow-xs">
                {indexes.length === 0 ? (
                  <div className="p-12 text-center text-[#8A93A2] text-xs">
                    No indexes detected on this collection.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#F4F1EC] border-b border-[#111827]/10 font-bold text-[#5B6472] select-none">
                        <th className="p-3 pl-4">Name</th>
                        <th className="p-3">Definition (Keys)</th>
                        <th className="p-3">Properties</th>
                        <th className="p-3">Size</th>
                        <th className="p-3">Usage Statistics</th>
                        <th className="p-3 pr-4 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#111827]/5 font-mono">
                      {indexes.map((idx) => {
                        const isSystem = idx.name === "_id_";
                        return (
                          <tr key={idx.name} className="hover:bg-[#FAFAF7]">
                            <td className="p-3 pl-4 font-bold text-[#111827]">{idx.name}</td>
                            <td className="p-3 text-[#5B6472] break-all">{formatKeys(idx.key)}</td>
                            <td className="p-3 space-x-1.5 select-none">
                              {idx.unique && (
                                <span className="inline-flex items-center px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[9px] font-bold uppercase rounded-md border border-blue-200">
                                  Unique
                                </span>
                              )}
                              {idx.sparse && (
                                <span className="inline-flex items-center px-1.5 py-0.5 bg-amber-50 text-amber-700 text-[9px] font-bold uppercase rounded-md border border-amber-200">
                                  Sparse
                                </span>
                              )}
                              {!idx.unique && !idx.sparse && (
                                <span className="text-[10px] text-[#8A93A2] italic font-sans font-medium">Standard</span>
                              )}
                            </td>
                            <td className="p-3 text-[#1F2937]">{formatBytes(idx.size)}</td>
                            <td className="p-3 text-[10px]">
                              {idx.accesses !== undefined ? (
                                <span className="flex items-center gap-1 font-sans font-semibold text-[#16A34A]">
                                  <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                                  {idx.accesses} hits
                                </span>
                              ) : (
                                <span className="text-[#8A93A2] italic font-sans">Unavailable</span>
                              )}
                            </td>
                            <td className="p-3 text-center select-none">
                              {isSystem ? (
                                <span className="text-[10px] text-[#8A93A2] italic font-sans font-semibold">System protected</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setIndexToDrop(idx)}
                                  className="p-1 text-[#8A93A2] hover:text-[#DC2626] hover:bg-[#FEE2E2] rounded-md transition-colors cursor-pointer"
                                  title="Drop Index"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}

        {activeSubTab === 'current-ops' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl border border-[#111827]/10 shadow-xs flex items-center justify-between">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[#111827]">Active Operations</h3>
                <p className="text-[11px] text-[#8A93A2]">
                  Monitor operations currently running on the server.
                </p>
              </div>
              <button 
                type="button"
                onClick={() => fetchOps(true)}
                className="p-1.5 hover:bg-[#EBE7DF] rounded-lg border border-[#EBE7DF] transition-all flex items-center gap-1.5 text-xs text-[#5B6472] font-bold cursor-pointer bg-white"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingOps ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {opsError && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3 text-xs mb-4">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="font-bold">Failed to load active operations</h4>
                  <p className="opacity-95 mt-1">{opsError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => fetchOps(true)}
                  className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-800 font-bold rounded-md transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {loadingOps ? (
              <div className="flex flex-col items-center justify-center p-12 bg-white border border-[#111827]/10 rounded-xl">
                <Loader2 className="w-8 h-8 text-[#F2673C] animate-spin mb-3" />
                <span className="text-xs text-[#8A93A2] font-semibold">Loading active operations...</span>
              </div>
            ) : ops.length === 0 ? (
              <div className="p-12 text-center text-[#8A93A2] text-xs bg-white border border-[#111827]/10 rounded-xl animate-fadeIn">
                No active operations detected on the server.
              </div>
            ) : (
              <div className="space-y-3 font-mono text-xs">
                {ops.map((op) => (
                  <div key={op.opid} className="bg-white p-4 rounded-xl border border-[#111827]/10 shadow-2xs flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black bg-[#EBE7DF] text-[#1F2937] px-2 py-0.5 rounded">
                          OPID: {op.opid}
                        </span>
                        {op.op && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#F2673C]">
                            {op.op}
                          </span>
                        )}
                        {op.ns && (
                          <span className="text-[10px] text-[#8A93A2]">
                            Namespace: <span className="font-bold text-[#111827]">{op.ns}</span>
                          </span>
                        )}
                      </div>
                      {op.query && (
                        <pre className="text-[11px] text-[#5B6472] bg-[#FAFAF7] p-2.5 rounded-lg border border-[#111827]/5 max-w-xl overflow-x-auto select-all leading-relaxed">
                          {op.query}
                        </pre>
                      )}
                      <div className="flex items-center gap-4 text-[10px] text-[#8A93A2]">
                        {op.client && <span>Client: {op.client}</span>}
                        {op.secs_running !== undefined && (
                          <span className="flex items-center gap-1 font-bold text-[#DC2626]">
                            <Clock className="w-3.5 h-3.5" />
                            Running for {op.secs_running}s
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => killOp(op.opid)}
                      className="px-3 py-1 bg-[#DC2626]/10 text-[#DC2626] hover:bg-[#DC2626] hover:text-white rounded-md text-[10px] font-bold uppercase transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Kill Op
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeSubTab === 'slow-queries' && (() => {
          const activeNs = collName ? `${dbName}.${collName}` : '';
          const filteredRawEntries = (profilingSource === 'client' ? getQueryLogs() : serverProfileData.map(mapSystemProfileEntry))
            .filter((entry: any) => {
              if (collName) {
                return entry.ns === activeNs;
              } else {
                return entry.ns.startsWith(`${dbName}.`);
              }
            })
            .filter((entry: any) => {
              if (entry.duration < minDurationFilter) return false;
              if (slowQuerySearch) {
                const term = slowQuerySearch.toLowerCase();
                return entry.query.toLowerCase().includes(term) || entry.ns.toLowerCase().includes(term) || entry.op.toLowerCase().includes(term);
              }
              return true;
            });

          const aggregatedGroups = aggregateQueries(filteredRawEntries);
          const sortedGroups = [...aggregatedGroups].sort((a, b) => {
            if (sortBy === 'impact') {
              return b.totalDuration - a.totalDuration;
            }
            if (sortBy === 'max') {
              return b.maxDuration - a.maxDuration;
            }
            if (sortBy === 'count') {
              return b.count - a.count;
            }
            if (sortBy === 'avg') {
              return b.meanDuration - a.meanDuration;
            }
            return 0;
          });

          return (
            <div className="space-y-6">
              {/* Header Card */}
              <div className="bg-white p-6 rounded-xl border border-[#111827]/10 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-[#111827]">Slow Query Profiler</h3>
                  <p className="text-[11px] text-[#8A93A2]">
                    Analyze latencies and execution patterns to optimize indexes. Source logs are grouped by structural query pattern.
                  </p>
                </div>
                <div className="flex items-center gap-3 self-start md:self-auto select-none shrink-0">
                  {/* Source Segmented Toggle */}
                  <div className="flex border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg p-0.5 shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setProfilingSource('client')}
                      className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                        profilingSource === 'client'
                          ? "bg-[#EBE7DF] text-[#111827]"
                          : "text-[#8A93A2] hover:text-[#5B6472]"
                      }`}
                    >
                      Client Logs ({getQueryLogs().filter(e => collName ? e.ns === `${dbName}.${collName}` : e.ns.startsWith(`${dbName}.`)).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setProfilingSource('server')}
                      className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                        profilingSource === 'server'
                          ? "bg-[#EBE7DF] text-[#111827]"
                          : "text-[#8A93A2] hover:text-[#5B6472]"
                      }`}
                    >
                      Server system.profile
                    </button>
                  </div>
                  {/* Refresh and Export Buttons */}
                  {profilingSource === 'server' && (
                    <button 
                      type="button"
                      onClick={() => fetchServerProfile(true)}
                      className="p-1.5 hover:bg-[#EBE7DF] rounded-lg border border-[#EBE7DF] transition-all flex items-center gap-1 text-xs text-[#5B6472] font-bold cursor-pointer bg-white"
                      title="Refresh server profile"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingServerProfile ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleExportReport(sortedGroups)}
                    disabled={sortedGroups.length === 0}
                    className="px-3 py-1.5 border border-[#EBE7DF] hover:bg-[#FEEFE8] disabled:opacity-40 disabled:hover:bg-transparent text-[#5B6472] hover:text-[#D9491F] font-bold text-xs rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                    title="Export report as JSON"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export JSON</span>
                  </button>
                </div>
              </div>

              {/* Filter Bar */}
              <div className="bg-white p-4 rounded-xl border border-[#111827]/10 shadow-2xs flex flex-col sm:flex-row items-center gap-3">
                <div className="flex-1 relative w-full">
                  <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-[#8A93A2]" />
                  <input
                    type="text"
                    value={slowQuerySearch}
                    onChange={(e) => setSlowQuerySearch(e.target.value)}
                    placeholder="Filter slow queries by namespace, pattern..."
                    className="w-full text-xs pl-9 pr-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] font-semibold rounded-lg focus:outline-none focus:border-[#F2673C] focus:bg-white transition-all"
                  />
                </div>
                <div className="flex items-center gap-3 w-full sm:w-auto shrink-0 select-none">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase font-bold text-[#8A93A2]">Min Duration:</span>
                    <select
                      value={minDurationFilter}
                      onChange={(e) => setMinDurationFilter(Number(e.target.value))}
                      className="text-xs bg-[#FAFAF7] border border-[#EBE7DF] rounded-lg px-2 py-1.5 font-bold text-[#1F2937] focus:outline-none focus:border-[#F2673C]"
                    >
                      <option value={0}>All queries</option>
                      <option value={50}>&gt; 50ms</option>
                      <option value={100}>&gt; 100ms</option>
                      <option value={500}>&gt; 500ms</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase font-bold text-[#8A93A2]">Sort By:</span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="text-xs bg-[#FAFAF7] border border-[#EBE7DF] rounded-lg px-2 py-1.5 font-bold text-[#1F2937] focus:outline-none focus:border-[#F2673C]"
                    >
                      <option value="impact">Total Impact (Time)</option>
                      <option value="max">Max Latency</option>
                      <option value="count">Run Count</option>
                      <option value="avg">Avg Latency</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Error banners or Loading indicators */}
              {profilingSource === 'server' && serverProfileError && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3 text-xs shadow-2xs">
                  <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="font-bold">Cannot access server system.profile</h4>
                    <p className="opacity-95 mt-1 leading-relaxed">
                      Profiling might be disabled or you lack permissions. To enable profiling on this database, run:
                      <code className="block mt-1 bg-white/60 p-1.5 rounded font-mono text-[10px] border border-red-100 select-all">db.setProfilingLevel(1, &#123; slowms: 100 &#125;)</code>
                    </p>
                  </div>
                </div>
              )}

              {profilingSource === 'server' && loadingServerProfile ? (
                <div className="flex flex-col items-center justify-center p-12 bg-white border border-[#111827]/10 rounded-xl shadow-2xs">
                  <Loader2 className="w-8 h-8 text-[#F2673C] animate-spin mb-3" />
                  <span className="text-xs text-[#8A93A2] font-semibold">Fetching system.profile logs...</span>
                </div>
              ) : sortedGroups.length === 0 ? (
                <div className="p-12 text-center text-[#8A93A2] text-xs bg-white border border-[#111827]/10 rounded-xl shadow-2xs">
                  No slow queries detected matching the filters.
                </div>
              ) : (
                <div className="space-y-4">
                  {sortedGroups.map((group) => {
                    const isExpanded = expandedGroups.has(group.key);
                    const isCurrentColl = group.ns === `${dbName}.${collName}`;
                    const indexCheck = isCurrentColl ? checkIndexCoverage(group.keys, indexes) : { covered: true, recommendation: null };
                    const isSlow = group.meanDuration >= 100 || group.maxDuration >= 100;
                    
                    return (
                      <div key={group.key} className="bg-white rounded-xl border border-[#111827]/10 shadow-2xs overflow-hidden hover:border-[#111827]/15 transition-all">
                        {/* Group Header summary */}
                        <div 
                          onClick={() => toggleGroupExpand(group.key)}
                          className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer hover:bg-[#FAFAF7]/50 select-none"
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="mt-0.5 shrink-0">
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4 text-[#8A93A2]" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-[#8A93A2]" />
                              )}
                            </div>
                            <div className="space-y-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-black border uppercase tracking-wider ${
                                  group.op === 'FIND' ? 'bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0]' :
                                  group.op === 'AGGREGATE' ? 'bg-[#F3E8FF] text-[#6B21A8] border-[#E9D5FF]' :
                                  'bg-[#F4F1EC] text-[#5B6472] border-[#EBE7DF]'
                                }`}>
                                  {group.op}
                                </span>
                                <span className="text-[10px] text-[#8A93A2] font-semibold">
                                  Namespace: <strong className="font-bold text-[#1F2937]">{group.ns}</strong>
                                </span>
                              </div>
                              <div className="font-mono text-xs font-semibold text-[#1F2937] truncate max-w-xl md:max-w-2xl bg-[#FAFAF7] px-2 py-1 rounded border border-[#111827]/5">
                                {group.pattern}
                              </div>
                            </div>
                          </div>

                          {/* Performance KPI badges */}
                          <div className="flex items-center gap-4 text-right shrink-0 self-end md:self-auto select-none">
                            <div className="text-center min-w-[60px]">
                              <span className="block text-[9px] text-[#8A93A2] uppercase font-bold">Runs</span>
                              <span className="text-xs font-bold text-[#1F2937]">{group.count}</span>
                            </div>
                            <div className="text-center min-w-[70px]">
                              <span className="block text-[9px] text-[#8A93A2] uppercase font-bold">Avg Latency</span>
                              <span className={`text-xs font-bold ${group.meanDuration >= 100 ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>
                                {group.meanDuration} ms
                              </span>
                            </div>
                            <div className="text-center min-w-[70px]">
                              <span className="block text-[9px] text-[#8A93A2] uppercase font-bold">P99 Latency</span>
                              <span className={`text-xs font-black ${group.p99Duration >= 150 ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>
                                {group.p99Duration} ms
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Expanded Section */}
                        {isExpanded && (
                          <div className="border-t border-[#111827]/5 bg-[#FAFAF7]/30 p-4 space-y-4 animate-fadeIn">
                            {/* Index Recommendation Banner */}
                            {!indexCheck.covered && indexCheck.recommendation && (
                              <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3.5 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs animate-slideDown">
                                <div className="flex items-start gap-2.5">
                                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                                  <div>
                                    <h5 className="font-bold">Missing Index Warning</h5>
                                    <p className="opacity-90 mt-0.5">
                                      This query pattern executes table scans. Proposing a compound index on fields:{" "}
                                      <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-100 font-bold">
                                        {indexCheck.recommendation.join(", ")}
                                      </code>
                                    </p>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleSuggestIndex(indexCheck.recommendation!)}
                                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-1 shadow-sm shrink-0 cursor-pointer self-start sm:self-auto"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  Create Index
                                </button>
                              </div>
                            )}

                            {/* Index check matches but it is a slow query */}
                            {indexCheck.covered && isSlow && group.op === 'FIND' && (
                              <div className="bg-green-50/50 border border-green-200/50 text-green-800 p-3 rounded-lg flex items-start gap-2 text-[11px] font-semibold">
                                <Check className="w-4.5 h-4.5 text-green-600 shrink-0" />
                                <div>
                                  <p>This query pattern matches an index prefix. Slow speed might be due to document sizes, server resource contention, or large skips/limits.</p>
                                </div>
                              </div>
                            )}

                            {/* Sample query list */}
                            <div className="space-y-2.5">
                              <h4 className="text-[10px] uppercase font-bold text-[#8A93A2]">Sample Execution Instances</h4>
                              <div className="space-y-2">
                                {group.samples.map((sample, sIdx) => (
                                  <div key={sIdx} className="bg-white p-3 rounded-lg border border-[#111827]/5 text-xs flex flex-col gap-2">
                                    <div className="flex items-center justify-between select-none text-[10px] text-[#8A93A2] font-semibold">
                                      <span>Time: {new Date(sample.timestamp).toLocaleString()}</span>
                                      <div className="flex gap-3">
                                        <span>Latency: <strong className="text-[#1F2937]">{sample.duration}ms</strong></span>
                                        <span>Affected: <strong className="text-[#1F2937]">{sample.docsAffected} docs</strong></span>
                                      </div>
                                    </div>
                                    <pre className="font-mono text-[10px] text-[#5B6472] bg-[#FAFAF7] p-2 rounded border border-[#111827]/5 overflow-x-auto select-all leading-relaxed">
                                      {sample.query}
                                    </pre>
                                    {sample.error && (
                                      <div className="text-[10px] text-red-600 bg-red-50 p-1.5 rounded font-semibold break-all border border-red-100 flex items-start gap-1">
                                        <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                                        <span>{sample.error}</span>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* CREATE INDEX MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-[#111827]/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn select-none">
          <div className="bg-white rounded-xl border border-[#111827]/10 max-w-lg w-full shadow-2xl overflow-hidden animate-slideUp">
            <div className="p-4 bg-[#F4F1EC] border-b border-[#111827]/10 flex justify-between items-center">
              <h3 className="text-xs font-bold text-[#111827] uppercase tracking-wider">Create Index</h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateError(null);
                }}
                className="text-[#8A93A2] hover:text-[#111827] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <form onSubmit={handleCreateIndex}>
              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                {createError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 p-3.5 rounded-lg flex items-start gap-2 text-xs">
                    <AlertTriangle className="w-4.5 h-4.5 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <h5 className="font-bold">Error creating index</h5>
                      <p className="opacity-95 mt-0.5 text-[11px]">{createError}</p>
                    </div>
                  </div>
                )}

                {/* Index Name */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase font-bold text-[#8A93A2]">Index Name</label>
                  <input
                    type="text"
                    value={indexName}
                    onChange={(e) => setIndexName(e.target.value)}
                    placeholder="e.g. email_idx (Optional: Auto-generated if empty)"
                    className="w-full text-xs px-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C]"
                  />
                </div>

                {/* Fields definition */}
                <div className="space-y-2.5">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] uppercase font-bold text-[#8A93A2]">Index Fields</label>
                    <button
                      type="button"
                      onClick={handleAddField}
                      className="text-[#F2673C] hover:text-[#D9491F] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Field
                    </button>
                  </div>

                  <div className="space-y-2">
                    {fields.map((field, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={field.field}
                          onChange={(e) => handleFieldChange(idx, e.target.value)}
                          placeholder="Field name (e.g. status)"
                          required
                          className="flex-1 text-xs px-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C]"
                        />
                        <select
                          value={field.type}
                          onChange={(e) => handleTypeChange(idx, e.target.value)}
                          className="text-xs bg-[#FAFAF7] border border-[#EBE7DF] rounded-lg px-2 py-2 font-bold text-[#1F2937] focus:outline-none focus:border-[#F2673C] w-28"
                        >
                          <option value="1">Ascending (1)</option>
                          <option value="-1">Descending (-1)</option>
                          <option value="text">Text</option>
                          <option value="hashed">Hashed</option>
                        </select>
                        {fields.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveField(idx)}
                            className="p-2 text-[#8A93A2] hover:text-[#DC2626] hover:bg-[#FEE2E2] rounded-lg transition-colors cursor-pointer"
                            title="Remove Field"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Options checkboxes */}
                <div className="pt-2 border-t border-[#111827]/5 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      id="unique"
                      checked={isUnique}
                      onChange={(e) => setIsUnique(e.target.checked)}
                      className="accent-[#F2673C] w-4.5 h-4.5 rounded mt-0.5 cursor-pointer"
                    />
                    <label htmlFor="unique" className="flex flex-col cursor-pointer">
                      <span className="text-xs font-bold text-[#1F2937]">Unique Index</span>
                      <span className="text-[10px] text-[#8A93A2] mt-0.5">
                        Forces MongoDB to reject documents containing duplicate values for this index keys definition.
                      </span>
                    </label>
                  </div>

                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      id="sparse"
                      checked={isSparse}
                      onChange={(e) => setIsSparse(e.target.checked)}
                      className="accent-[#F2673C] w-4.5 h-4.5 rounded mt-0.5 cursor-pointer"
                    />
                    <label htmlFor="sparse" className="flex flex-col cursor-pointer">
                      <span className="text-xs font-bold text-[#1F2937]">Sparse Index</span>
                      <span className="text-[10px] text-[#8A93A2] mt-0.5">
                        Only includes entries for documents that actually have the indexed fields.
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-[#F4F1EC] border-t border-[#111827]/10 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateError(null);
                  }}
                  className="px-4 py-1.5 hover:bg-[#EBE7DF] text-[#5B6472] hover:text-[#111827] font-bold text-xs rounded-lg transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-1.5 bg-[#F2673C] text-white hover:bg-[#D9491F] disabled:bg-[#F2673C]/50 font-bold text-xs rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Index"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DROP INDEX MODAL */}
      {indexToDrop && (
        <div className="fixed inset-0 bg-[#111827]/40 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn select-none">
          <div className="bg-white rounded-xl border border-[#111827]/10 max-w-md w-full shadow-2xl overflow-hidden animate-slideUp">
            <div className="p-4 bg-[#FEE2E2] border-b border-[#EF4444]/15 flex justify-between items-center">
              <h3 className="text-xs font-bold text-[#DC2626] uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                Drop Index
              </h3>
              <button
                onClick={() => {
                  setIndexToDrop(null);
                  setDropError(null);
                }}
                className="text-[#DC2626]/70 hover:text-[#DC2626] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              {dropError && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg flex items-start gap-2 text-[11px] font-semibold">
                  <AlertTriangle className="w-4.5 h-4.5 text-red-500 shrink-0" />
                  <div>
                    <h5 className="font-bold">Error dropping index</h5>
                    <p className="opacity-95 mt-0.5">{dropError}</p>
                  </div>
                </div>
              )}

              <p className="text-xs text-[#1F2937] leading-relaxed">
                Are you sure you want to drop the index <strong className="font-mono text-[#DC2626] bg-[#DC2626]/5 px-1.5 py-0.5 rounded border border-[#DC2626]/10">{indexToDrop.name}</strong> from <strong className="font-semibold">{dbName}.{collName}</strong>?
              </p>
              
              <div className="p-3 bg-red-50 border border-[#DC2626]/10 rounded-lg flex items-start gap-2.5 text-[11px] text-[#DC2626] font-medium leading-relaxed">
                <Info className="w-4.5 h-4.5 text-[#DC2626] shrink-0 mt-0.5" />
                <p>
                  Dropping an index is immediate and could cause queries that depend on it to run slower or perform collection scans.
                </p>
              </div>
            </div>

            <div className="p-4 bg-[#F4F1EC] border-t border-[#111827]/10 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setIndexToDrop(null);
                  setDropError(null);
                }}
                className="px-4 py-1.5 hover:bg-[#EBE7DF] text-[#5B6472] hover:text-[#111827] font-bold text-xs rounded-lg transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDropIndex}
                disabled={isDropping}
                className="px-4 py-1.5 bg-[#DC2626] text-white hover:bg-[#B91C1C] disabled:bg-[#DC2626]/50 font-bold text-xs rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              >
                {isDropping ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Dropping...
                  </>
                ) : (
                  "Drop Index"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// PROFILER HELPER FUNCTIONS
// ==========================================

interface AggregatedQueryGroup {
  key: string;
  op: string;
  ns: string;
  pattern: string;
  count: number;
  durations: number[];
  meanDuration: number;
  p99Duration: number;
  maxDuration: number;
  totalDuration: number;
  lastSeen: string;
  samples: Array<{ query: string; timestamp: string; duration: number; docsAffected: number; error?: string }>;
  keys: string[];
}

function getFilterKeys(obj: any, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [];
  if (Array.isArray(obj)) {
    return obj.flatMap(item => getFilterKeys(item, prefix));
  }
  
  const keys: string[] = [];
  for (const k of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (k.startsWith("$")) {
      if (k === "$or" || k === "$and" || k === "$nor") {
        if (Array.isArray(obj[k])) {
          keys.push(...getFilterKeys(obj[k], prefix));
        }
      }
    } else {
      if (obj[k] && typeof obj[k] === "object" && !Array.isArray(obj[k]) && !("$oid" in obj[k]) && !("$date" in obj[k]) && !("$numberLong" in obj[k]) && !("$numberInt" in obj[k]) && !("$numberDouble" in obj[k]) && !("$numberDecimal" in obj[k])) {
        const subKeys = getFilterKeys(obj[k], fullKey);
        if (subKeys.length > 0) {
          keys.push(...subKeys);
        } else {
          keys.push(fullKey);
        }
      } else {
        keys.push(fullKey);
      }
    }
  }
  return Array.from(new Set(keys));
}

function getQueryPattern(op: string, queryStr: string): { pattern: string; keys: string[] } {
  try {
    const parsed = JSON.parse(queryStr);
    
    if (parsed && typeof parsed === "object" && ("filter" in parsed || "pipeline" in parsed)) {
      if (op === "FIND" && typeof parsed.filter === "string") {
        const filterObj = JSON.parse(parsed.filter || "{}");
        const keys = getFilterKeys(filterObj);
        if (keys.length === 0) return { pattern: "find({})", keys: [] };
        const patternStr = `find({ ${keys.map(k => `${k}: ?`).join(", ")} })`;
        return { pattern: patternStr, keys };
      }
      if (op === "AGGREGATE") {
        const pipeline = typeof parsed.pipeline === "string" ? JSON.parse(parsed.pipeline) : parsed.pipeline;
        if (Array.isArray(pipeline)) {
          const stages = pipeline.map(stage => {
            if (stage && typeof stage === "object") {
              const keys = Object.keys(stage);
              return keys.find(k => k.startsWith("$")) || Object.keys(stage)[0] || "";
            }
            return "";
          }).filter(Boolean);
          return { pattern: `aggregate([ ${stages.join(", ")} ])`, keys: [] };
        }
      }
    }
    
    if (op === "FIND") {
      const keys = getFilterKeys(parsed);
      if (keys.length === 0) return { pattern: "find({})", keys: [] };
      return { pattern: `find({ ${keys.map(k => `${k}: ?`).join(", ")} })`, keys };
    }
    
    if (op === "AGGREGATE" && Array.isArray(parsed)) {
      const stages = parsed.map(stage => {
        if (stage && typeof stage === "object") {
          const keys = Object.keys(stage);
          return keys.find(k => k.startsWith("$")) || Object.keys(stage)[0] || "";
        }
        return "";
      }).filter(Boolean);
      return { pattern: `aggregate([ ${stages.join(", ")} ])`, keys: [] };
    }

    if (op === "INSERT" || op === "UPDATE" || op === "DELETE") {
      const keys = getFilterKeys(parsed);
      const action = op.toLowerCase();
      if (keys.length === 0) return { pattern: `${action}({})`, keys: [] };
      return { pattern: `${action}({ ${keys.map(k => `${k}: ?`).join(", ")} })`, keys };
    }
  } catch (_e) {
    // fallback
  }

  if (op === "FIND") return { pattern: "find({})", keys: [] };
  if (op === "AGGREGATE") return { pattern: "aggregate([])", keys: [] };
  return { pattern: `${op.toLowerCase()}(...)`, keys: [] };
}

function mapSystemProfileEntry(doc: any): any {
  let mappedOp: 'FIND' | 'INSERT' | 'UPDATE' | 'DELETE' | 'AGGREGATE' = 'FIND';
  let queryStr = '{}';
  let docsAffected = 0;
  
  const rawOp = doc.op || '';
  const command = doc.command || doc.query || {};
  
  if (rawOp === 'query') {
    mappedOp = 'FIND';
    queryStr = command.filter ? JSON.stringify(command.filter) : JSON.stringify(command);
    docsAffected = doc.nreturned || 0;
  } else if (rawOp === 'command') {
    if (command.find) {
      mappedOp = 'FIND';
      queryStr = JSON.stringify(command.filter || {});
      docsAffected = doc.nreturned || 0;
    } else if (command.aggregate) {
      mappedOp = 'AGGREGATE';
      queryStr = JSON.stringify(command.pipeline || []);
      docsAffected = doc.nreturned || 0;
    } else if (command.insert) {
      mappedOp = 'INSERT';
      queryStr = JSON.stringify(command.documents || {});
      docsAffected = doc.ninserted || 0;
    } else if (command.update) {
      mappedOp = 'UPDATE';
      queryStr = JSON.stringify(command.updates || {});
      docsAffected = doc.nMatched || 0;
    } else if (command.delete) {
      mappedOp = 'DELETE';
      queryStr = JSON.stringify(command.deletes || {});
      docsAffected = doc.ndeleted || 0;
    }
  } else if (rawOp === 'update') {
    mappedOp = 'UPDATE';
    queryStr = JSON.stringify(command);
    docsAffected = doc.nMatched || 0;
  } else if (rawOp === 'insert') {
    mappedOp = 'INSERT';
    queryStr = JSON.stringify(command);
    docsAffected = doc.ninserted || 0;
  } else if (rawOp === 'remove') {
    mappedOp = 'DELETE';
    queryStr = JSON.stringify(command);
    docsAffected = doc.ndeleted || 0;
  }

  let timestamp = new Date().toISOString();
  if (doc.ts) {
    if (typeof doc.ts === 'string') {
      timestamp = doc.ts;
    } else if (doc.ts.$date) {
      timestamp = typeof doc.ts.$date === 'string' 
        ? doc.ts.$date 
        : new Date(doc.ts.$date).toISOString();
    }
  }

  return {
    id: doc.opid ? String(doc.opid) : Math.random().toString(36).substring(7),
    op: mappedOp,
    ns: doc.ns || '',
    query: queryStr,
    duration: doc.millis || 0,
    docsAffected,
    timestamp,
    error: doc.err || doc.exception || undefined
  };
}

function aggregateQueries(entries: any[]): AggregatedQueryGroup[] {
  const groupsMap = new Map<string, AggregatedQueryGroup>();

  for (const entry of entries) {
    const { pattern, keys } = getQueryPattern(entry.op, entry.query);
    const key = `${entry.op} | ${entry.ns} | ${pattern}`;

    let group = groupsMap.get(key);
    if (!group) {
      group = {
        key,
        op: entry.op,
        ns: entry.ns,
        pattern,
        count: 0,
        durations: [],
        meanDuration: 0,
        p99Duration: 0,
        maxDuration: 0,
        totalDuration: 0,
        lastSeen: entry.timestamp,
        samples: [],
        keys
      };
      groupsMap.set(key, group);
    }

    group.count += 1;
    group.durations.push(entry.duration);
    group.totalDuration += entry.duration;
    if (entry.duration > group.maxDuration) {
      group.maxDuration = entry.duration;
    }
    if (new Date(entry.timestamp) > new Date(group.lastSeen)) {
      group.lastSeen = entry.timestamp;
    }
    
    if (group.samples.length < 3) {
      group.samples.push({
        query: entry.query,
        timestamp: entry.timestamp,
        duration: entry.duration,
        docsAffected: entry.docsAffected,
        error: entry.error
      });
    }
  }

  const result: AggregatedQueryGroup[] = [];
  groupsMap.forEach(group => {
    const sortedDurs = [...group.durations].sort((a, b) => a - b);
    const p99Idx = Math.max(0, Math.ceil(0.99 * sortedDurs.length) - 1);
    
    group.meanDuration = Math.round(group.totalDuration / group.count);
    group.p99Duration = sortedDurs[p99Idx];
    result.push(group);
  });

  return result;
}

function checkIndexCoverage(queryKeys: string[], existingIndexes: IndexInfo[]): { covered: boolean; recommendation: string[] | null } {
  if (queryKeys.length === 0) return { covered: true, recommendation: null };
  
  const firstQueryKey = queryKeys[0];
  const hasPrefixIndex = existingIndexes.some(idx => {
    const indexKeys = Object.keys(idx.key);
    return indexKeys[0] === firstQueryKey;
  });

  if (hasPrefixIndex) {
    return { covered: true, recommendation: null };
  }

  return { covered: false, recommendation: queryKeys };
}
