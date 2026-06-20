import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Folder, Plus, Trash2, Search, ExternalLink, Database,
  ArrowUpDown, AlertTriangle, HelpCircle, Loader2, Info, Eye, Layers
} from "lucide-react";

interface CollectionStats {
  name: string;
  document_count: number;
  storage_size: number;
  index_count: number;
  is_capped: boolean;
  is_view: boolean;
}

interface DatabaseCollectionsViewProps {
  dbName: string;
  onSelectCollection: (dbName: string, collName: string) => void;
  onCollectionsChanged: (droppedCollName?: string) => Promise<string[]>;
  onDropDatabase?: (dbName: string) => Promise<void>;
}

export default function DatabaseCollectionsView({
  dbName,
  onSelectCollection,
  onCollectionsChanged,
  onDropDatabase,
}: DatabaseCollectionsViewProps) {
  const [stats, setStats] = useState<CollectionStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Create collection modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newCollName, setNewCollName] = useState("");
  const [isCapped, setIsCapped] = useState(false);
  const [cappedSize, setCappedSize] = useState<number | "">("");
  const [hasMaxDocs, setHasMaxDocs] = useState(false);
  const [maxDocs, setMaxDocs] = useState<number | "">("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Drop collection modal state
  const [isDropOpen, setIsDropOpen] = useState(false);
  const [collToDrop, setCollToDrop] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [dropError, setDropError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  // Create view modal state
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [viewSource, setViewSource] = useState("");
  const [viewPipeline, setViewPipeline] = useState('[\n  { "$match": {} }\n]');
  const [viewError, setViewError] = useState<string | null>(null);
  const [creatingView, setCreatingView] = useState(false);

  // Drop database modal state
  const [isDropDbOpen, setIsDropDbOpen] = useState(false);
  const [confirmDbName, setConfirmDbName] = useState("");
  const [dropDbError, setDropDbError] = useState<string | null>(null);
  const [droppingDb, setDroppingDb] = useState(false);

  // Sorting
  const [sortField, setSortField] = useState<keyof CollectionStats>("name");
  const [sortAsc, setSortAsc] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const result: CollectionStats[] = await invoke("get_collections_stats", { dbName });
      setStats(result);
    } catch (err: any) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [dbName]);

  const handleSort = (field: keyof CollectionStats) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollName.trim()) {
      setCreateError("Collection name is required");
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      await invoke("create_collection", {
        dbName,
        name: newCollName.trim(),
        capped: isCapped,
        size: isCapped && cappedSize !== "" ? Number(cappedSize) : null,
        max: isCapped && hasMaxDocs && maxDocs !== "" ? Number(maxDocs) : null,
      });

      // Update sidebar and local stats
      await onCollectionsChanged();
      await fetchStats();

      // Reset form & close
      setNewCollName("");
      setIsCapped(false);
      setCappedSize("");
      setHasMaxDocs(false);
      setMaxDocs("");
      setIsCreateOpen(false);
    } catch (err: any) {
      setCreateError(String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleDropCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collToDrop) return;
    if (confirmName !== collToDrop) {
      setDropError("Confirmation name does not match");
      return;
    }

    setDropping(true);
    setDropError(null);

    try {
      await invoke("drop_collection", {
        dbName,
        collName: collToDrop,
      });

      // Update sidebar and local stats
      await onCollectionsChanged(collToDrop);
      await fetchStats();

      // Close modal
      setIsDropOpen(false);
      setCollToDrop(null);
      setConfirmName("");
    } catch (err: any) {
      setDropError(String(err));
    } finally {
      setDropping(false);
    }
  };

  const handleCreateView = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewName.trim() || !viewSource.trim()) {
      setViewError("View name and source collection are required");
      return;
    }
    try {
      JSON.parse(viewPipeline);
    } catch (err: any) {
      setViewError(`Invalid pipeline JSON: ${err.message}`);
      return;
    }
    setCreatingView(true);
    setViewError(null);
    try {
      await invoke("create_view", {
        dbName,
        viewName: viewName.trim(),
        source: viewSource.trim(),
        pipelineStr: viewPipeline,
      });
      await onCollectionsChanged();
      await fetchStats();
      setViewName("");
      setViewSource("");
      setViewPipeline('[\n  { "$match": {} }\n]');
      setIsViewOpen(false);
    } catch (err: any) {
      setViewError(String(err));
    } finally {
      setCreatingView(false);
    }
  };

  const handleDropDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmDbName !== dbName) {
      setDropDbError("Confirmation name does not match");
      return;
    }
    if (!onDropDatabase) return;
    setDroppingDb(true);
    setDropDbError(null);
    try {
      await onDropDatabase(dbName);
      setIsDropDbOpen(false);
      setConfirmDbName("");
    } catch (err: any) {
      setDropDbError(String(err));
      setDroppingDb(false);
    }
  };

  // Filter & sort collections list
  const safeStats = Array.isArray(stats) ? stats : [];
  const filteredStats = safeStats
    .filter((s) => s && typeof s.name === "string" && s.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === "string" && typeof valB === "string") {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }

      // numbers / booleans
      const numA = Number(valA || 0);
      const numB = Number(valB || 0);
      return sortAsc ? numA - numB : numB - numA;
    });

  // Calculate aggregates
  const totalDocuments = safeStats.reduce((acc, curr) => acc + (curr?.document_count || 0), 0);
  const totalStorageSize = safeStats.reduce((acc, curr) => acc + (curr?.storage_size || 0), 0);
  const totalIndexes = safeStats.reduce((acc, curr) => acc + (curr?.index_count || 0), 0);

  return (
    <div className="flex flex-col h-full bg-[#FAFAF7] overflow-y-auto select-text p-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#111827]/10 pb-6 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-[#F2673C]/10 text-[#F2673C] rounded-xl">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#111827] flex items-center gap-2">
              <span>{dbName}</span>
              <span className="text-xs bg-[#EBE7DF] text-[#5B6472] px-2 py-0.5 rounded-full font-medium">
                Database
              </span>
            </h1>
            <p className="text-xs text-[#8A93A2] mt-1">
              Explore collections, view storage statistics, and manage database resources.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              setViewError(null);
              setViewSource(safeStats.find((s) => !s.is_view)?.name || "");
              setIsViewOpen(true);
            }}
            className="flex items-center justify-center gap-2 px-3 py-2 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] text-xs font-bold rounded-lg transition-all cursor-pointer"
          >
            <Layers className="w-4 h-4" />
            <span>Create View</span>
          </button>
          {onDropDatabase && (
            <button
              onClick={() => {
                setDropDbError(null);
                setConfirmDbName("");
                setIsDropDbOpen(true);
              }}
              className="flex items-center justify-center gap-2 px-3 py-2 border border-[#DC2626]/20 hover:bg-[#DC2626]/10 text-[#DC2626] text-xs font-bold rounded-lg transition-all cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Drop DB</span>
            </button>
          )}
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-[#F2673C] hover:bg-[#D9491F] text-white text-xs font-bold rounded-lg transition-all shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Collection</span>
          </button>
        </div>
      </div>

      {/* Aggregate Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-[#111827]/10 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] uppercase tracking-wider font-bold text-[#8A93A2]">Collections</span>
          <span className="text-2xl font-extrabold text-[#111827] mt-2">{safeStats.length}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-[#111827]/10 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] uppercase tracking-wider font-bold text-[#8A93A2]">Total Documents</span>
          <span className="text-2xl font-extrabold text-[#111827] mt-2">{totalDocuments.toLocaleString()}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-[#111827]/10 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] uppercase tracking-wider font-bold text-[#8A93A2]">Total Storage Size</span>
          <span className="text-2xl font-extrabold text-[#111827] mt-2">{formatBytes(totalStorageSize)}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-[#111827]/10 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] uppercase tracking-wider font-bold text-[#8A93A2]">Total Indexes</span>
          <span className="text-2xl font-extrabold text-[#111827] mt-2">{totalIndexes}</span>
        </div>
      </div>

      {/* Database Error State */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-sm">Failed to Load Database Stats</h4>
            <p className="text-xs mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Search and Table Area */}
      <div className="bg-white rounded-xl border border-[#111827]/10 shadow-sm overflow-hidden flex flex-col flex-1 min-h-[300px]">
        {/* Search header */}
        <div className="p-4 border-b border-[#111827]/10 bg-[#F4F1EC]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#8A93A2]">
              <Search className="w-4 h-4" />
            </span>
            <input
              type="text"
              placeholder="Search collections..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 bg-white border border-[#111827]/15 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#F2673C] focus:border-[#F2673C] placeholder-[#8A93A2] text-[#111827]"
            />
          </div>
          <span className="text-xs text-[#5B6472] font-semibold">
            Showing {filteredStats.length} collections
          </span>
        </div>

        {/* Collections Table */}
        <div className="flex-1 overflow-x-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#5B6472]">
              <Loader2 className="w-8 h-8 animate-spin text-[#F2673C] mb-2" />
              <span className="text-xs">Loading collection statistics...</span>
            </div>
          ) : filteredStats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#5B6472]">
              <Folder className="w-12 h-12 text-[#8A93A2] mb-3 opacity-60" />
              <p className="text-sm font-bold">No Collections Found</p>
              <p className="text-xs mt-1">Create a collection to get started with this database.</p>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#FAFAF7] text-[#5B6472] font-bold border-b border-[#111827]/10">
                  <th
                    className="p-4 cursor-pointer hover:bg-[#EBE7DF]/50 select-none"
                    onClick={() => handleSort("name")}
                  >
                    <div className="flex items-center gap-1">
                      <span>Collection Name</span>
                      <ArrowUpDown className="w-3.5 h-3.5 text-[#8A93A2]" />
                    </div>
                  </th>
                  <th
                    className="p-4 cursor-pointer hover:bg-[#EBE7DF]/50 select-none text-right"
                    onClick={() => handleSort("document_count")}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Documents</span>
                      <ArrowUpDown className="w-3.5 h-3.5 text-[#8A93A2]" />
                    </div>
                  </th>
                  <th
                    className="p-4 cursor-pointer hover:bg-[#EBE7DF]/50 select-none text-right"
                    onClick={() => handleSort("storage_size")}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Storage Size</span>
                      <ArrowUpDown className="w-3.5 h-3.5 text-[#8A93A2]" />
                    </div>
                  </th>
                  <th
                    className="p-4 cursor-pointer hover:bg-[#EBE7DF]/50 select-none text-right"
                    onClick={() => handleSort("index_count")}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Indexes</span>
                      <ArrowUpDown className="w-3.5 h-3.5 text-[#8A93A2]" />
                    </div>
                  </th>
                  <th
                    className="p-4 cursor-pointer hover:bg-[#EBE7DF]/50 select-none"
                    onClick={() => handleSort("is_capped")}
                  >
                    <div className="flex items-center gap-1">
                      <span>Type</span>
                      <ArrowUpDown className="w-3.5 h-3.5 text-[#8A93A2]" />
                    </div>
                  </th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#111827]/5">
                {filteredStats.map((coll) => (
                  <tr key={coll.name} className="hover:bg-[#FBEBE5]/10 group transition-colors">
                    <td className="p-4 font-semibold text-[#111827]">
                      <button
                        onClick={() => onSelectCollection(dbName, coll.name)}
                        className="flex items-center gap-2 hover:text-[#D9491F] text-left transition-colors cursor-pointer"
                      >
                        <Folder className="w-4 h-4 text-[#F2673C] shrink-0" />
                        <span>{coll.name}</span>
                      </button>
                    </td>
                    <td className="p-4 text-right tabular-nums text-[#1F2937]">
                      {coll.document_count.toLocaleString()}
                    </td>
                    <td className="p-4 text-right tabular-nums text-[#1F2937]">
                      {formatBytes(coll.storage_size)}
                    </td>
                    <td className="p-4 text-right tabular-nums text-[#1F2937]">
                      {coll.index_count}
                    </td>
                    <td className="p-4">
                      {coll.is_view ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EDE9FE] text-[#6D28D9]">
                          <Eye className="w-3 h-3" /> View
                        </span>
                      ) : coll.is_capped ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FEEFE8] text-[#D9491F]">
                          Capped
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E8F5E9] text-[#2E7D32]">
                          Standard
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => onSelectCollection(dbName, coll.name)}
                          className="p-1.5 hover:bg-[#F2673C]/10 text-[#5B6472] hover:text-[#F2673C] rounded-lg transition-colors cursor-pointer"
                          title="Open Collection"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            setCollToDrop(coll.name);
                            setConfirmName("");
                            setDropError(null);
                            setIsDropOpen(true);
                          }}
                          className="p-1.5 hover:bg-[#DC2626]/10 text-[#5B6472] hover:text-[#DC2626] rounded-lg transition-colors cursor-pointer"
                          title="Drop Collection"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* CREATE COLLECTION MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-xl border border-[#111827]/10 shadow-2xl w-full max-w-md overflow-hidden animate-slideUp">
            <div className="bg-[#F4F1EC] px-6 py-4 border-b border-[#111827]/10 flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#111827]">Create Collection</h3>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-[#8A93A2] hover:text-[#111827] text-xs font-semibold"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleCreateCollection} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-[#5B6472] mb-1">
                  Collection Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. users_new"
                  value={newCollName}
                  onChange={(e) => setNewCollName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#111827]/15 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#F2673C] focus:border-[#F2673C] text-[#111827]"
                />
              </div>

              {/* Capped Options */}
              <div className="border border-[#111827]/10 rounded-lg p-3 space-y-3 bg-[#FAFAF7]">
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-[#1F2937]">
                  <input
                    type="checkbox"
                    checked={isCapped}
                    onChange={(e) => setIsCapped(e.target.checked)}
                    className="rounded text-[#F2673C] focus:ring-[#F2673C] h-4 w-4 border-[#111827]/15"
                  />
                  <span>Capped Collection</span>
                  <span title="A fixed-size collection that automatically overwrites its oldest entries when it reaches its maximum size.">
                    <HelpCircle className="w-3.5 h-3.5 text-[#8A93A2]" />
                  </span>
                </label>

                {isCapped && (
                  <div className="space-y-3 pl-6 animate-fadeIn">
                    <div>
                      <label className="block font-bold text-[#5B6472] mb-1">
                        Maximum Size (bytes) *
                      </label>
                      <input
                        type="number"
                        required={isCapped}
                        min={4096}
                        placeholder="e.g. 4096"
                        value={cappedSize}
                        onChange={(e) => setCappedSize(e.target.value ? Number(e.target.value) : "")}
                        className="w-full px-3 py-2 bg-white border border-[#111827]/15 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#F2673C] focus:border-[#F2673C] text-[#111827]"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer font-medium text-[#5B6472]">
                        <input
                          type="checkbox"
                          checked={hasMaxDocs}
                          onChange={(e) => setHasMaxDocs(e.target.checked)}
                          className="rounded text-[#F2673C] focus:ring-[#F2673C] h-3.5 w-3.5 border-[#111827]/15"
                        />
                        <span>Limit number of documents</span>
                      </label>

                      {hasMaxDocs && (
                        <div>
                          <label className="block font-medium text-[#5B6472] mb-1">
                            Max Documents *
                          </label>
                          <input
                            type="number"
                            required={hasMaxDocs}
                            min={1}
                            placeholder="e.g. 5000"
                            value={maxDocs}
                            onChange={(e) => setMaxDocs(e.target.value ? Number(e.target.value) : "")}
                            className="w-full px-3 py-2 bg-white border border-[#111827]/15 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#F2673C] focus:border-[#F2673C] text-[#111827]"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {createError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-tight">{createError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 border border-[#111827]/15 hover:bg-[#EBE7DF] text-[#5B6472] rounded-lg font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 bg-[#F2673C] hover:bg-[#D9491F] disabled:bg-[#F2673C]/50 text-white rounded-lg font-bold transition-all cursor-pointer"
                >
                  {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Create Collection</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DROP CONFIRMATION MODAL */}
      {isDropOpen && collToDrop && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-xl border border-[#111827]/10 shadow-2xl w-full max-w-md overflow-hidden animate-slideUp">
            <div className="bg-red-50 px-6 py-4 border-b border-red-200 flex items-center justify-between">
              <h3 className="font-bold text-sm text-red-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Drop Collection</span>
              </h3>
              <button
                onClick={() => {
                  setIsDropOpen(false);
                  setCollToDrop(null);
                }}
                className="text-red-700 hover:text-red-900 text-xs font-semibold"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleDropCollection} className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-red-50 text-red-800 rounded-lg flex gap-2 border border-red-200">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="leading-tight">
                  <p className="font-bold">This action cannot be undone!</p>
                  <p className="mt-1">
                    You are about to drop the collection <span className="font-bold underline">{collToDrop}</span>.
                    All documents and indexes in this collection will be permanently deleted.
                  </p>
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#5B6472] mb-1">
                  Type the name of the collection to confirm: <span className="font-bold text-[#111827]">{collToDrop}</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder={collToDrop}
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#111827]/15 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 text-[#111827]"
                />
              </div>

              {dropError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-tight">{dropError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsDropOpen(false);
                    setCollToDrop(null);
                  }}
                  className="px-4 py-2 border border-[#111827]/15 hover:bg-[#EBE7DF] text-[#5B6472] rounded-lg font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={confirmName !== collToDrop || dropping}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 bg-[#DC2626] hover:bg-[#B91C1C] disabled:bg-red-200 disabled:text-red-400 disabled:cursor-not-allowed text-white rounded-lg font-bold transition-all cursor-pointer"
                >
                  {dropping && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Drop Collection</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE VIEW MODAL */}
      {isViewOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-xl border border-[#111827]/10 shadow-2xl w-full max-w-lg overflow-hidden animate-slideUp">
            <div className="bg-[#F4F1EC] px-6 py-4 border-b border-[#111827]/10 flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#111827] flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#6D28D9]" /> Create View
              </h3>
              <button onClick={() => setIsViewOpen(false)} className="text-[#8A93A2] hover:text-[#111827] text-xs font-semibold">
                Close
              </button>
            </div>
            <form onSubmit={handleCreateView} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-[#5B6472] mb-1">View Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. active_users"
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#111827]/15 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#F2673C] focus:border-[#F2673C] text-[#111827]"
                />
              </div>
              <div>
                <label className="block font-bold text-[#5B6472] mb-1">Source Collection *</label>
                <select
                  required
                  value={viewSource}
                  onChange={(e) => setViewSource(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#111827]/15 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#F2673C] focus:border-[#F2673C] text-[#111827] cursor-pointer"
                >
                  <option value="" disabled>Select a collection…</option>
                  {safeStats.filter((s) => !s.is_view).map((s) => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-bold text-[#5B6472] mb-1">Pipeline (JSON array)</label>
                <textarea
                  value={viewPipeline}
                  onChange={(e) => setViewPipeline(e.target.value)}
                  rows={6}
                  className="w-full p-3 bg-[#1B1F27] text-[#E6E6E6] font-mono rounded-lg border border-[#232833] focus:outline-none resize-y"
                  spellCheck={false}
                />
              </div>

              {viewError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-tight">{viewError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsViewOpen(false)}
                  className="px-4 py-2 border border-[#111827]/15 hover:bg-[#EBE7DF] text-[#5B6472] rounded-lg font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingView}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 bg-[#F2673C] hover:bg-[#D9491F] disabled:bg-[#F2673C]/50 text-white rounded-lg font-bold transition-all cursor-pointer"
                >
                  {creatingView && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Create View</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DROP DATABASE MODAL */}
      {isDropDbOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-xl border border-[#111827]/10 shadow-2xl w-full max-w-md overflow-hidden animate-slideUp">
            <div className="bg-red-50 px-6 py-4 border-b border-red-200 flex items-center justify-between">
              <h3 className="font-bold text-sm text-red-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Drop Database</span>
              </h3>
              <button onClick={() => setIsDropDbOpen(false)} className="text-red-700 hover:text-red-900 text-xs font-semibold">
                Close
              </button>
            </div>
            <form onSubmit={handleDropDatabase} className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-red-50 text-red-800 rounded-lg flex gap-2 border border-red-200">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="leading-tight">
                  <p className="font-bold">This action cannot be undone!</p>
                  <p className="mt-1">
                    You are about to drop the database <span className="font-bold underline">{dbName}</span> and
                    all of its collections, documents, and indexes.
                  </p>
                </div>
              </div>
              <div>
                <label className="block font-bold text-[#5B6472] mb-1">
                  Type the database name to confirm: <span className="font-bold text-[#111827]">{dbName}</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder={dbName}
                  value={confirmDbName}
                  onChange={(e) => setConfirmDbName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#111827]/15 rounded-lg focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 text-[#111827]"
                />
              </div>

              {dropDbError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-tight">{dropDbError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsDropDbOpen(false)}
                  className="px-4 py-2 border border-[#111827]/15 hover:bg-[#EBE7DF] text-[#5B6472] rounded-lg font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={confirmDbName !== dbName || droppingDb}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 bg-[#DC2626] hover:bg-[#B91C1C] disabled:bg-red-200 disabled:text-red-400 disabled:cursor-not-allowed text-white rounded-lg font-bold transition-all cursor-pointer"
                >
                  {droppingDb && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Drop Database</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
