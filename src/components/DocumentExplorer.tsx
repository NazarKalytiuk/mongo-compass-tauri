import { useState, useEffect, ReactNode, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TabState } from "../types";
import { invokeWithLog } from "../queryLogger";
import {
  Play, RotateCcw, ChevronDown, ChevronRight, LayoutGrid, FileCode,
  Plus, Edit, Trash2, ChevronLeft, Table, AlertCircle, Loader2, Database,
  Bookmark, History, X, Upload, Code, FileSearch, PencilLine
} from "lucide-react";
import DocumentEditorModal from "./DocumentEditorModal";
import ImportExportModal from "./ImportExportModal";
import CodeGeneratorModal from "./CodeGeneratorModal";
import ExplainPlanView from "./ExplainPlanView";
import { BulkWriteResult } from "../types";
import CodeEditor, { type CodeEditorHandle } from "./editor/CodeEditor";
import { createQueryAutocompleter } from "./editor/autocompleters";
import { useCollectionFields } from "./editor/useCollectionFields";

interface DocumentExplorerProps {
  tab: TabState;
  onUpdateTab: (updatedFields: Partial<TabState>) => void;
  activeDb: string;
  activeColl: string;
  serverVersion?: string;
}

export default function DocumentExplorer({
  tab,
  onUpdateTab,
  activeDb,
  activeColl,
  serverVersion,
}: DocumentExplorerProps) {
  const [isQueryExpanded, setIsQueryExpanded] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<any | undefined>(undefined);
  const [crudError, setCrudError] = useState<string | null>(null);
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [codeGeneratorOpen, setCodeGeneratorOpen] = useState(false);

  // Explain (find) state
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainPlan, setExplainPlan] = useState<any | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  // Bulk update / delete state
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [bulkUpdateText, setBulkUpdateText] = useState('{\n  "$set": {}\n}');
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkPreviewCount, setBulkPreviewCount] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // Index listings state for checking index coverage
  const [indexes, setIndexes] = useState<any[]>([]);
  useEffect(() => {
    if (activeDb && activeColl) {
      const run = async () => {
        try {
          const res = await invoke<any[]>("list_indexes", { dbName: activeDb, collName: activeColl });
          if (Array.isArray(res)) {
            setIndexes(res);
          }
        } catch (err) {
          console.error("Failed to load indexes in explorer:", err);
          setIndexes([]);
        }
      };
      run();
    }
  }, [activeDb, activeColl]);

  const checkIndexed = (doc: any): boolean => {
    if (!doc || !Array.isArray(indexes)) return false;
    const docKeys = Object.keys(doc);
    return indexes.some(idx => {
      if (idx.name === "_id_") return false;
      const indexKeys = Object.keys(idx.key || {});
      return indexKeys.some(k => docKeys.includes(k));
    });
  };

  // Saved Queries state and storage helpers
  interface SavedQuery {
    id: string;
    name: string;
    dbName: string;
    collName: string;
    filter: string;
    sort: string;
    projection: string;
    limit: number;
    skip: number;
    createdAt: string;
  }

  function validateSavedQueries(data: any): SavedQuery[] {
    if (!Array.isArray(data)) return [];
    return data.filter(item => {
      return (
        item &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        typeof item.dbName === "string" &&
        typeof item.collName === "string" &&
        typeof item.filter === "string" &&
        typeof item.sort === "string" &&
        typeof item.projection === "string" &&
        typeof item.limit === "number" &&
        typeof item.skip === "number" &&
        typeof item.createdAt === "string"
      );
    }) as SavedQuery[];
  }

  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [showSavedQueriesDrawer, setShowSavedQueriesDrawer] = useState(false);
  const [showSaveQueryModal, setShowSaveQueryModal] = useState(false);
  const [queryName, setQueryName] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("mongo_compass_saved_queries");
    if (saved) {
      try {
        setSavedQueries(validateSavedQueries(JSON.parse(saved)));
      } catch (e) {
        setSavedQueries([]);
      }
    }
  }, []);

  const handleSaveQuery = () => {
    if (!queryName.trim()) return;

    const newQuery: SavedQuery = {
      id: Math.random().toString(36).substring(7),
      name: queryName.trim(),
      dbName: activeDb,
      collName: activeColl,
      filter,
      sort,
      projection,
      limit,
      skip,
      createdAt: new Date().toISOString(),
    };

    const updated = [newQuery, ...savedQueries];
    setSavedQueries(updated);
    localStorage.setItem("mongo_compass_saved_queries", JSON.stringify(updated));
    setQueryName("");
    setShowSaveQueryModal(false);
  };

  const handleDeleteQuery = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedQueries.filter(q => q.id !== id);
    setSavedQueries(updated);
    localStorage.setItem("mongo_compass_saved_queries", JSON.stringify(updated));
  };

  const handleLoadQuery = (saved: SavedQuery) => {
    setFilter(saved.filter);
    setSort(saved.sort);
    setProjection(saved.projection);
    setLimit(saved.limit);
    setSkip(saved.skip);
    setShowSavedQueriesDrawer(false);

    // Run find with the loaded settings
    onUpdateTab({ loading: true, error: null });
    invokeWithLog<any>(
      "FIND",
      `${activeDb}.${activeColl}`,
      "find_documents",
      {
        dbName: activeDb,
        collName: activeColl,
        filterStr: saved.filter,
        sortStr: saved.sort,
        projectionStr: saved.projection,
        limit: saved.limit,
        skip: saved.skip,
      },
      JSON.stringify({ filter: saved.filter, sort: saved.sort, projection: saved.projection, limit: saved.limit, skip: saved.skip }),
      (res: any) => res?.documents?.length || 0
    )
      .then((result: any) => {
        onUpdateTab({
          documents: result?.documents || [],
          totalCount: result?.total_count || 0,
          filter: saved.filter,
          sort: saved.sort,
          projection: saved.projection,
          limit: saved.limit,
          skip: saved.skip,
          loading: false,
        });
      })
      .catch((err) => {
        onUpdateTab({ loading: false, error: String(err) });
      });
  };

  const filterInputRef = useRef<CodeEditorHandle>(null);

  useEffect(() => {
    const handleFocusSearch = () => {
      if (tab.activeSection === "explorer") {
        filterInputRef.current?.focus();
        filterInputRef.current?.selectAll();
      }
    };
    window.addEventListener("focus-search-input", handleFocusSearch);
    return () => window.removeEventListener("focus-search-input", handleFocusSearch);
  }, [tab.activeSection]);

  // Field-name + operator completions for the query editors.
  const { fields } = useCollectionFields(activeDb, activeColl);
  const queryCompleter = useMemo(
    () => createQueryAutocompleter({ fields, serverVersion }),
    [fields, serverVersion]
  );

  // Local query state matching tab parameters
  const [filter, setFilter] = useState(tab.filter);
  const [sort, setSort] = useState(tab.sort);
  const [projection, setProjection] = useState(tab.projection);
  const [limit, setLimit] = useState(tab.limit);
  const [skip, setSkip] = useState(tab.skip);
  // Sync state if active database or collection changes
  useEffect(() => {
    setFilter(tab.filter);
    setSort(tab.sort);
    setProjection(tab.projection);
    setLimit(tab.limit);
    setSkip(tab.skip);
  }, [tab.selectedDb, tab.selectedColl, tab.filter, tab.sort, tab.projection, tab.limit, tab.skip]);

  const executeFind = async (newSkip = skip, newLimit = limit) => {
    onUpdateTab({ loading: true, error: null });
    try {
      const result: any = await invokeWithLog(
        "FIND",
        `${activeDb}.${activeColl}`,
        "find_documents",
        {
          dbName: activeDb,
          collName: activeColl,
          filterStr: filter,
          sortStr: sort,
          projectionStr: projection,
          limit: newLimit,
          skip: newSkip,
        },
        JSON.stringify({ filter, sort, projection, limit: newLimit, skip: newSkip }),
        (res: any) => res?.documents?.length || 0
      );
      onUpdateTab({
        documents: result?.documents || [],
        totalCount: result?.total_count || 0,
        filter,
        sort,
        projection,
        limit: newLimit,
        skip: newSkip,
        loading: false,
      });
    } catch (err: any) {
      onUpdateTab({
        loading: false,
        error: String(err),
      });
    }
  };

  const handleReset = () => {
    setFilter("{}");
    setSort("{}");
    setProjection("{}");
    setLimit(20);
    setSkip(0);
    // Execute directly with reset values
    onUpdateTab({ loading: true, error: null });
    invokeWithLog<any>(
      "FIND",
      `${activeDb}.${activeColl}`,
      "find_documents",
      {
        dbName: activeDb,
        collName: activeColl,
        filterStr: "{}",
        sortStr: "{}",
        projectionStr: "{}",
        limit: 20,
        skip: 0,
      },
      JSON.stringify({ filter: "{}", sort: "{}", projection: "{}", limit: 20, skip: 0 }),
      (res: any) => res?.documents?.length || 0
    )
      .then((result: any) => {
        onUpdateTab({
          documents: result?.documents || [],
          totalCount: result?.total_count || 0,
          filter: "{}",
          sort: "{}",
          projection: "{}",
          limit: 20,
          skip: 0,
          loading: false,
        });
      })
      .catch((err) => {
        onUpdateTab({ loading: false, error: String(err) });
      });
  };

  const handleDelete = async (doc: any) => {
    if (!window.confirm("Are you sure you want to delete this document?")) return;
    try {
      const idJson = JSON.stringify(doc._id);
      await invokeWithLog<any>(
        "DELETE",
        `${activeDb}.${activeColl}`,
        "delete_document",
        {
          dbName: activeDb,
          collName: activeColl,
          idJson,
        },
        idJson
      );
      executeFind();
    } catch (err: any) {
      setCrudError(`Delete failed: ${err}`);
    }
  };

  const handleExplain = async () => {
    setExplainOpen(true);
    setExplainLoading(true);
    setExplainError(null);
    setExplainPlan(null);
    try {
      const plan = await invoke<any>("explain_find", {
        dbName: activeDb,
        collName: activeColl,
        filterStr: filter,
        sortStr: sort,
        projectionStr: projection,
        limit,
        skip,
      });
      setExplainPlan(plan);
    } catch (err: any) {
      setExplainError(err instanceof Error ? err.message : String(err));
    } finally {
      setExplainLoading(false);
    }
  };

  const openBulkUpdate = async () => {
    setBulkError(null);
    setBulkResult(null);
    setBulkPreviewCount(null);
    setBulkUpdateOpen(true);
    try {
      const count = await invoke<number>("count_documents", {
        dbName: activeDb,
        collName: activeColl,
        filterJson: filter,
      });
      setBulkPreviewCount(count);
    } catch (err: any) {
      setBulkError(String(err));
    }
  };

  const openBulkDelete = async () => {
    setBulkError(null);
    setBulkResult(null);
    setBulkPreviewCount(null);
    setBulkDeleteOpen(true);
    try {
      const count = await invoke<number>("count_documents", {
        dbName: activeDb,
        collName: activeColl,
        filterJson: filter,
      });
      setBulkPreviewCount(count);
    } catch (err: any) {
      setBulkError(String(err));
    }
  };

  const handleBulkUpdate = async () => {
    setBulkError(null);
    setBulkResult(null);
    try {
      JSON.parse(bulkUpdateText);
    } catch (err: any) {
      setBulkError(`Invalid update JSON: ${err.message}`);
      return;
    }
    setBulkBusy(true);
    try {
      const res = await invokeWithLog<BulkWriteResult>(
        "UPDATE",
        `${activeDb}.${activeColl}`,
        "update_many",
        {
          dbName: activeDb,
          collName: activeColl,
          filterJson: filter,
          updateJson: bulkUpdateText,
        },
        JSON.stringify({ q: filter, u: bulkUpdateText, multi: true }),
        (r: BulkWriteResult) => r?.modified_count ?? 0
      );
      setBulkResult(`Matched ${res.matched_count}, modified ${res.modified_count} document(s).`);
      executeFind(0);
    } catch (err: any) {
      setBulkError(String(err));
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    setBulkError(null);
    setBulkResult(null);
    setBulkBusy(true);
    try {
      const deleted = await invokeWithLog<number>(
        "DELETE",
        `${activeDb}.${activeColl}`,
        "delete_many",
        {
          dbName: activeDb,
          collName: activeColl,
          filterJson: filter,
        },
        JSON.stringify({ q: filter, multi: true }),
        (n: number) => n ?? 0
      );
      setBulkResult(`Deleted ${deleted} document(s).`);
      executeFind(0);
    } catch (err: any) {
      setBulkError(String(err));
    } finally {
      setBulkBusy(false);
    }
  };

  const handleSaveDoc = async (docJson: string) => {
    try {
      if (editingDoc) {
        // Edit mode: replace the whole document so removed fields are removed
        // in the database too. Values keep their BSON types via Extended JSON.
        const idJson = JSON.stringify(editingDoc._id);
        const parsed = JSON.parse(docJson);
        await invokeWithLog<any>(
          "UPDATE",
          `${activeDb}.${activeColl}`,
          "replace_document",
          {
            dbName: activeDb,
            collName: activeColl,
            idJson,
            docJson,
          },
          JSON.stringify({ q: { _id: editingDoc._id }, u: parsed })
        );
      } else {
        // Insert mode
        await invokeWithLog<any>(
          "INSERT",
          `${activeDb}.${activeColl}`,
          "insert_document",
          {
            dbName: activeDb,
            collName: activeColl,
            docJson,
          },
          docJson
        );
      }
      executeFind();
    } catch (err: any) {
      throw new Error(err);
    }
  };

  const handlePageChange = (direction: 'next' | 'prev') => {
    const nextSkip = direction === 'next' ? skip + limit : Math.max(0, skip - limit);
    setSkip(nextSkip);
    executeFind(nextSkip);
  };

  const handlePageSizeChange = (newLimit: number) => {
    setLimit(newLimit);
    setSkip(0);
    executeFind(0, newLimit);
  };

  // Render dynamic table header keys
  const getUniqueKeys = (docs: any[] | undefined) => {
    const keys = new Set<string>();
    if (!docs || !Array.isArray(docs)) return [];
    docs.forEach(d => {
      if (d && typeof d === 'object') {
        Object.keys(d).forEach(k => keys.add(k));
      }
    });
    return Array.from(keys);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FAFAF7] overflow-hidden">
          {/* 1. MQL Query Bar */}
      <div className="p-4 bg-white border-b border-[#111827]/10 flex flex-col gap-3 shadow-xs shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex-1 flex flex-wrap gap-2">
            <div className="flex-1 min-w-[260px] relative flex items-center pl-16 pr-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus-within:border-[#F2673C] focus-within:bg-white transition-all duration-200">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#8A93A2] uppercase pointer-events-none">Filter</span>
              <CodeEditor
                ref={filterInputRef}
                value={filter}
                onChange={setFilter}
                language="json"
                theme="light"
                singleLine
                completer={queryCompleter}
                onRun={() => executeFind(0)}
                placeholder={'e.g. { "status": "active" }'}
                ariaLabel="Filter"
                className="flex-1 min-w-0"
              />
            </div>
            <button
              onClick={() => executeFind(0)}
              className="px-4 py-2 bg-[#F2673C] text-white hover:bg-[#D9491F] font-bold text-xs rounded-lg flex items-center gap-1.5 transition-colors shadow-xs shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Find
            </button>
            <button
              onClick={handleReset}
              className="px-3 py-2 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
            <button
              onClick={() => setShowSaveQueryModal(true)}
              className="px-3 py-2 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
              title="Save current query parameters"
            >
              <Bookmark className="w-3.5 h-3.5" />
              Save Query
            </button>
            <button
              onClick={() => setShowSavedQueriesDrawer(true)}
              className="px-3 py-2 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
              title="View saved queries"
            >
              <History className="w-3.5 h-3.5" />
              Saved
            </button>
            <button
              onClick={() => setCodeGeneratorOpen(true)}
              className="px-3 py-2 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
              title="Generate copy-pasteable driver code"
            >
              <Code className="w-3.5 h-3.5" />
              Export Code
            </button>
            <button
              onClick={handleExplain}
              className="px-3 py-2 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
              title="Explain this find query"
            >
              <FileSearch className="w-3.5 h-3.5" />
              Explain
            </button>
            <button
              onClick={openBulkUpdate}
              className="px-3 py-2 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
              title="Update all documents matching the filter"
            >
              <PencilLine className="w-3.5 h-3.5" />
              Update Many
            </button>
            <button
              onClick={openBulkDelete}
              className="px-3 py-2 border border-[#EBE7DF] hover:bg-[#FEE2E2] hover:text-[#DC2626] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
              title="Delete all documents matching the filter"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Many
            </button>
          </div>
          <button
            onClick={() => setIsQueryExpanded(!isQueryExpanded)}
            className="p-2 border border-[#EBE7DF] hover:bg-[#EBE7DF] rounded-lg text-[#5B6472] transition-colors shrink-0"
          >
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isQueryExpanded ? "rotate-180" : ""}`} />
          </button>
        </div>

        {/* Extended Query Parameters Drawer */}
        {isQueryExpanded && (
          <div className="grid grid-cols-4 gap-3 pt-1 border-t border-[#111827]/5 animate-fadeIn">
            <div className="relative flex items-center pl-12 pr-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus-within:border-[#F2673C] focus-within:bg-white transition-all">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-[#8A93A2] uppercase pointer-events-none">Sort</span>
              <CodeEditor
                value={sort}
                onChange={setSort}
                language="json"
                theme="light"
                singleLine
                completer={queryCompleter}
                onRun={() => executeFind(0)}
                placeholder={'{ "createdAt": -1 }'}
                ariaLabel="Sort"
                className="flex-1 min-w-0"
              />
            </div>
            <div className="relative flex items-center pl-16 pr-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus-within:border-[#F2673C] focus-within:bg-white transition-all">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-[#8A93A2] uppercase pointer-events-none">Project</span>
              <CodeEditor
                value={projection}
                onChange={setProjection}
                language="json"
                theme="light"
                singleLine
                completer={queryCompleter}
                onRun={() => executeFind(0)}
                placeholder={'{ "password": 0 }'}
                ariaLabel="Project"
                className="flex-1 min-w-0"
              />
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-2.5 text-[9px] font-bold text-[#8A93A2] uppercase">Limit</span>
              <input
                type="number"
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value) || 20)}
                className="w-full text-xs pl-14 pr-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] font-mono rounded-lg focus:outline-none focus:border-[#F2673C] focus:bg-white transition-all"
              />
            </div>
            <div className="relative">
              <span className="absolute left-3.5 top-2.5 text-[9px] font-bold text-[#8A93A2] uppercase">Skip</span>
              <input
                type="number"
                value={skip}
                onChange={(e) => setSkip(parseInt(e.target.value) || 0)}
                className="w-full text-xs pl-12 pr-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] font-mono rounded-lg focus:outline-none focus:border-[#F2673C] focus:bg-white transition-all"
              />
            </div>
          </div>
        )}
      </div>

      {/* 2. Results Toolbar */}
      <div className="px-6 py-3 bg-[#F4F1EC] border-b border-[#111827]/10 flex items-center justify-between shadow-inner shrink-0">
        <div className="text-xs text-[#5B6472] flex items-center gap-2.5">
          {tab.totalCount > 0 ? (
            <>
              <span>
                Documents <span className="font-bold text-[#111827]">{skip + 1}</span> -{" "}
                <span className="font-bold text-[#111827]">
                  {Math.min(skip + (tab.documents || []).length, tab.totalCount)}
                </span>{" "}
                of <span className="font-bold text-[#111827]">{tab.totalCount}</span>
              </span>
            </>
          ) : (
            <span>No documents found</span>
          )}
          {tab.loading && (tab.documents || []).length > 0 && (
            <span className="text-[#F2673C] font-semibold flex items-center gap-1 animate-pulse uppercase text-[10px] tracking-wider">
              <Loader2 className="w-3 h-3 animate-spin" /> Fetching...
            </span>
          )}
        </div>

        {crudError && (
          <div className="text-xs text-[#DC2626] font-semibold flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" />
            {crudError}
          </div>
        )}

        <div className="flex items-center gap-4">
          {/* View Toggle */}
          <div className="flex border border-[#EBE7DF] bg-white rounded-lg p-0.5 shadow-2xs">
            <button
              onClick={() => onUpdateTab({ viewMode: 'tree' })}
              className={`p-1.5 rounded-md transition-colors ${tab.viewMode === 'tree' ? "bg-[#EBE7DF] text-[#111827]" : "text-[#8A93A2] hover:text-[#5B6472]"}`}
              title="Tree View"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => onUpdateTab({ viewMode: 'table' })}
              className={`p-1.5 rounded-md transition-colors ${tab.viewMode === 'table' ? "bg-[#EBE7DF] text-[#111827]" : "text-[#8A93A2] hover:text-[#5B6472]"}`}
              title="Table View"
            >
              <Table className="w-4 h-4" />
            </button>
            <button
              onClick={() => onUpdateTab({ viewMode: 'json' })}
              className={`p-1.5 rounded-md transition-colors ${tab.viewMode === 'json' ? "bg-[#EBE7DF] text-[#111827]" : "text-[#8A93A2] hover:text-[#5B6472]"}`}
              title="JSON View"
            >
              <FileCode className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => setImportExportOpen(true)}
            className="px-3.5 py-1.5 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Import / Export
          </button>

          <button
            onClick={() => {
              setEditingDoc(undefined);
              setEditorOpen(true);
            }}
            className="px-3.5 py-1.5 bg-[#F2673C] text-white hover:bg-[#D9491F] font-bold text-xs rounded-lg flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Insert Document
          </button>
        </div>
      </div>

      {/* 3. Document Content Area */}
      <div className="flex-1 overflow-auto p-6 flex flex-col min-h-0 relative">
        {tab.loading && (tab.documents || []).length === 0 ? (
          <div className="absolute inset-0 bg-[#FAFAF7]/60 flex items-center justify-center z-10 animate-fadeIn">
            <div className="flex items-center gap-2 text-[#5B6472]">
              <Loader2 className="w-5 h-5 animate-spin text-[#F2673C]" />
              <span className="text-xs font-semibold">Loading documents...</span>
            </div>
          </div>
        ) : null}

        {tab.error ? (
          <div className="bg-[#FEE2E2] border border-[#DC2626]/10 text-[#721C24] p-4 rounded-lg flex gap-3 text-xs">
            <AlertCircle className="w-5 h-5 text-[#DC2626] shrink-0" />
            <div>
              <span className="font-bold">Database Error:</span> {tab.error}
            </div>
          </div>
        ) : (tab.documents || []).length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-[#111827]/10 rounded-lg">
            <Database className="w-8 h-8 text-[#8A93A2] mb-3" />
            <p className="text-sm font-semibold text-[#5B6472]">No documents matched the query</p>
            <p className="text-xs text-[#8A93A2] mt-1">Try relaxing your MQL filter parameters</p>
          </div>
        ) : tab.viewMode === 'json' ? (
          /* JSON View Mode */
          <div className="bg-[#1B1F27] p-6 rounded-xl border border-[#232833] font-mono text-xs text-[#E6E6E6] space-y-4 shadow-md overflow-x-auto">
            {(tab.documents || []).map((doc, idx) => (
              <div key={idx} className="group relative border-b border-[#232833]/60 pb-4 last:border-b-0 last:pb-0">
                {/* Actions overlay */}
                <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-[#232833] p-1 rounded-md border border-[#111827]/10 shadow-md z-10">
                  <button
                    onClick={() => {
                      setEditingDoc(doc);
                      setEditorOpen(true);
                    }}
                    aria-label="Edit document"
                    className="p-1 hover:bg-[#1B1F27] text-[#8A93A2] hover:text-[#F2673C] rounded cursor-pointer"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(doc)}
                    aria-label="Delete document"
                    className="p-1 hover:bg-[#1B1F27] text-[#8A93A2] hover:text-[#DC2626] rounded cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Header row with metadata and tags */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-[#232833]/50 text-xs text-[#8A93A2] select-none">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                      Document {idx + 1 + skip}
                    </span>
                    <span>•</span>
                    <span>{Object.keys(doc).length} fields</span>
                    <span>•</span>
                    <span>{getDocSize(doc)}</span>
                    {checkIndexed(doc) && (
                      <>
                        <span>•</span>
                        <span className="text-emerald-400 font-bold bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-900/50 text-[9px]">
                          indexed
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mr-16">
                    {detectTags(doc).map((badge, bIdx) => (
                      <span key={bIdx} className={`px-1.5 py-0.5 text-[9px] font-bold rounded-md border ${badge.colorClass}`}>
                        {badge.label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* JSON Gutter & Code */}
                <div className="flex font-mono text-[11px] leading-relaxed bg-[#1B1F27] rounded-lg border border-[#232833]/30 overflow-hidden">
                  {(() => {
                    const html = highlightJson(JSON.stringify(doc, null, 2));
                    const htmlLines = html.split("\n");
                    return (
                      <>
                        <div className="select-none text-right text-[#5B6472]/70 pr-3 border-r border-[#232833] mr-3 font-mono text-[11px] leading-relaxed min-w-[2.5rem] bg-[#1E232B] py-3">
                          {htmlLines.map((_, i) => (
                            <div key={i} className="h-4.5">{i + 1}</div>
                          ))}
                        </div>
                        <pre className="flex-1 overflow-x-auto whitespace-pre select-text font-mono text-[11px] leading-relaxed py-3 pr-3">
                          {htmlLines.map((lineHtml, i) => (
                            <div 
                              key={i} 
                              className="h-4.5"
                              dangerouslySetInnerHTML={{ __html: lineHtml || "&nbsp;" }} 
                            />
                          ))}
                        </pre>
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}

            {/* Skeletons for JSON view during transition */}
            {tab.loading && (
              <div className="group relative border-b border-[#232833]/60 pb-4 last:border-b-0 last:pb-0 animate-pulse">
                <div className="flex font-mono text-[11px] leading-relaxed bg-[#1B1F27] rounded-lg border border-[#232833]/30 overflow-hidden">
                  <div className="select-none text-right text-[#5B6472]/30 pr-3 border-r border-[#232833] mr-3 font-mono text-[11px] leading-relaxed min-w-[2.5rem] bg-[#1E232B] py-3 space-y-1">
                    <div className="h-4">1</div>
                    <div className="h-4">2</div>
                    <div className="h-4">3</div>
                    <div className="h-4">4</div>
                  </div>
                  <div className="flex-1 space-y-2 py-4 pr-3">
                    <div className="h-3.5 bg-slate-700/50 rounded w-1/4" />
                    <div className="h-3.5 bg-slate-700/50 rounded w-1/2" />
                    <div className="h-3.5 bg-slate-700/50 rounded w-1/3" />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : tab.viewMode === 'table' ? (
          /* Table View Mode */
          <div className="bg-white rounded-xl border border-[#111827]/10 overflow-hidden shadow-xs shrink-0 select-text">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#F4F1EC] border-b border-[#111827]/10 font-bold text-[#5B6472]">
                    <th className="p-3 w-16 text-center">Actions</th>
                    {getUniqueKeys(tab.documents).map((key) => (
                      <th key={key} className="p-3 font-semibold text-[#111827]">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#111827]/5">
                  {(tab.documents || []).map((doc, idx) => {
                    const keys = getUniqueKeys(tab.documents);
                    return (
                      <tr key={idx} className="hover:bg-[#FAFAF7]">
                        <td className="p-3 text-center flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => {
                              setEditingDoc(doc);
                              setEditorOpen(true);
                            }}
                            aria-label="Edit document"
                            className="p-1 text-[#8A93A2] hover:text-[#F2673C] hover:bg-[#F4F1EC] rounded cursor-pointer"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(doc)}
                            aria-label="Delete document"
                            className="p-1 text-[#8A93A2] hover:text-[#DC2626] hover:bg-[#FEE2E2] rounded cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                        {keys.map((key) => {
                          const val = doc ? doc[key] : undefined;
                          return (
                            <td key={key} className="p-3 font-mono text-[11px] max-w-xs truncate">
                              {renderTableCellValue(val)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}

                  {/* Skeletons for Table view during transition */}
                  {tab.loading && (
                    <>
                      <tr className="animate-pulse bg-[#FAFAF7]/30">
                        <td className="p-3 text-center">
                          <div className="h-4 w-8 bg-slate-200 rounded mx-auto" />
                        </td>
                        {getUniqueKeys(tab.documents).map((key) => (
                          <td key={key} className="p-3">
                            <div className="h-3.5 bg-slate-200 rounded w-2/3" />
                          </td>
                        ))}
                      </tr>
                      <tr className="animate-pulse bg-[#FAFAF7]/30">
                        <td className="p-3 text-center">
                          <div className="h-4 w-8 bg-slate-200 rounded mx-auto" />
                        </td>
                        {getUniqueKeys(tab.documents).map((key) => (
                          <td key={key} className="p-3">
                            <div className="h-3.5 bg-slate-200 rounded w-1/2" />
                          </td>
                        ))}
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Tree View Mode */
          <div className="bg-white p-6 rounded-xl border border-[#111827]/10 shadow-xs flex flex-col gap-4 select-text">
            {(tab.documents || []).map((doc, idx) => (
              <div
                key={idx}
                className="group relative border border-[#111827]/5 hover:border-[#111827]/10 rounded-lg p-4 bg-[#FAFAF7]/50 hover:bg-[#FAFAF7] transition-all animate-fadeIn"
              >
                {/* Actions overlay */}
                <div className="absolute right-3 top-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-[#111827]/10 rounded-md p-1 shadow-md z-10">
                  <button
                    onClick={() => {
                      setEditingDoc(doc);
                      setEditorOpen(true);
                    }}
                    aria-label="Edit document"
                    className="p-1 hover:bg-[#F4F1EC] text-[#8A93A2] hover:text-[#F2673C] rounded transition-colors cursor-pointer"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(doc)}
                    aria-label="Delete document"
                    className="p-1 hover:bg-[#FEE2E2] text-[#8A93A2] hover:text-[#DC2626] rounded transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Header row with metadata and tags */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-[#111827]/5 text-xs text-[#5B6472] select-none">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-[#8A93A2] uppercase tracking-wider">
                      Document {idx + 1 + skip}
                    </span>
                    <span className="text-[#8A93A2]">•</span>
                    <span>{Object.keys(doc).length} fields</span>
                    <span className="text-[#8A93A2]">•</span>
                    <span>{getDocSize(doc)}</span>
                    {checkIndexed(doc) && (
                      <>
                        <span className="text-[#8A93A2]">•</span>
                        <span className="text-green-700 font-medium flex items-center gap-0.5 bg-green-50 px-1.5 py-0.5 rounded border border-green-150 text-[10px]">
                          indexed
                        </span>
                      </>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-1.5 mr-16">
                    {detectTags(doc).map((badge, bIdx) => (
                      <span key={bIdx} className={`px-1.5 py-0.5 text-[9px] font-bold rounded-md border ${badge.colorClass}`}>
                        {badge.label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Collapsible tree representation */}
                {doc && <BsonTreeObject value={doc} isRoot={true} />}
              </div>
            ))}

            {/* Skeletons for Tree view during transition */}
            {tab.loading && (
              <>
                <div className="border border-[#111827]/5 rounded-lg p-4 bg-[#FAFAF7]/30 animate-pulse space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[#111827]/5">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-16 bg-slate-200 rounded" />
                      <div className="h-3 w-3 bg-slate-200 rounded-full" />
                      <div className="h-3 w-20 bg-slate-200 rounded" />
                    </div>
                    <div className="h-4 w-12 bg-slate-200 rounded" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-3.5 bg-slate-200 rounded w-1/3" />
                    <div className="h-3.5 bg-slate-200 rounded w-2/3" />
                  </div>
                </div>
                <div className="border border-[#111827]/5 rounded-lg p-4 bg-[#FAFAF7]/30 animate-pulse space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[#111827]/5">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-16 bg-slate-200 rounded" />
                      <div className="h-3 w-3 bg-slate-200 rounded-full" />
                      <div className="h-3 w-20 bg-slate-200 rounded" />
                    </div>
                    <div className="h-4 w-12 bg-slate-200 rounded" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-3.5 bg-slate-200 rounded w-1/4" />
                    <div className="h-3.5 bg-slate-200 rounded w-1/2" />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 4. Pagination Controller Footer */}
      <div className="px-6 py-3 bg-[#F4F1EC] border-t border-[#111827]/10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => handlePageChange('prev')}
            disabled={skip === 0 || tab.loading}
            className="px-3 py-1.5 border border-[#EBE7DF] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#EBE7DF] bg-white text-[#5B6472] text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous Page
          </button>

          <span className="text-xs text-[#5B6472]">
            Page <span className="font-bold text-[#111827]">{Math.floor(skip / limit) + 1}</span>
          </span>

          <button
            onClick={() => handlePageChange('next')}
            disabled={skip + (tab.documents || []).length >= tab.totalCount || tab.loading}
            className="px-3 py-1.5 border border-[#EBE7DF] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#EBE7DF] bg-white text-[#5B6472] text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
          >
            Next Page
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Page size options */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase font-bold text-[#8A93A2] tracking-wider select-none">Page size:</span>
          <select
            value={limit}
            onChange={(e) => handlePageSizeChange(Number(e.target.value))}
            className="text-xs bg-white border border-[#EBE7DF] rounded-lg px-2.5 py-1.5 font-bold text-[#1F2937] focus:outline-none focus:border-[#F2673C] cursor-pointer"
          >
            <option value="20">20 docs</option>
            <option value="50">50 docs</option>
            <option value="100">100 docs</option>
          </select>
        </div>
      </div>

      {/* Insert / Edit Modal */}
      <DocumentEditorModal
        isOpen={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSave={handleSaveDoc}
        documentData={editingDoc}
        dbName={activeDb}
        collName={activeColl}
      />

      {/* Import / Export Modal */}
      <ImportExportModal
        isOpen={importExportOpen}
        onClose={() => setImportExportOpen(false)}
        dbName={activeDb}
        collName={activeColl}
        queryFilter={filter}
        querySort={sort}
        queryProjection={projection}
        currentPageDocs={tab.documents || []}
        onRefresh={() => {
          executeFind(0);
        }}
      />

      {/* Code Generator Modal */}
      <CodeGeneratorModal
        isOpen={codeGeneratorOpen}
        onClose={() => setCodeGeneratorOpen(false)}
        dbName={activeDb}
        collName={activeColl}
        queryType="find"
        queryData={{
          filter,
          sort,
          projection,
          limit,
          skip,
        }}
      />

      {/* Save Query Modal */}
      {showSaveQueryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-xl border border-[#111827]/10 p-6 shadow-2xl w-full max-w-md animate-scaleIn select-text">
            <h3 className="text-sm font-bold text-[#111827] mb-2">Save Find Query</h3>
            <p className="text-xs text-[#5B6472] mb-4">
              Enter a custom name to save these parameters for the collection <code className="font-mono bg-[#FAFAF7] px-1 py-0.5 rounded border border-[#111827]/5 font-semibold">{activeDb}.{activeColl}</code>.
            </p>
            <input
              type="text"
              value={queryName}
              onChange={(e) => setQueryName(e.target.value)}
              placeholder="e.g. Active NY Users"
              className="w-full text-xs px-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C] focus:bg-white transition-all mb-4"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveQuery();
              }}
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => {
                  setShowSaveQueryModal(false);
                  setQueryName("");
                }}
                className="px-3 py-1.5 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveQuery}
                disabled={!queryName.trim()}
                className="px-4 py-1.5 bg-[#F2673C] text-white hover:bg-[#D9491F] disabled:bg-[#F2673C]/50 font-bold rounded-lg transition-colors shadow-2xs cursor-pointer"
              >
                Save Query
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Saved Queries Drawer */}
      {showSavedQueriesDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-xs transition-opacity animate-fadeIn">
          {/* Backdrop click to close */}
          <div className="flex-1" onClick={() => setShowSavedQueriesDrawer(false)} />
          
          {/* Drawer Container */}
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-slideInRight select-text">
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#111827]/10 flex items-center justify-between bg-[#FAFAF7]">
              <div>
                <h3 className="text-sm font-bold text-[#111827]">Saved Queries</h3>
                <p className="text-[10px] text-[#8A93A2] mt-0.5">
                  Saved find queries for <code className="font-mono font-bold text-[#1F2937]">{activeDb}.{activeColl}</code>.
                </p>
              </div>
              <button
                onClick={() => setShowSavedQueriesDrawer(false)}
                className="p-1.5 hover:bg-[#111827]/5 rounded-lg text-[#5B6472] hover:text-[#111827] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {savedQueries.filter(q => q.dbName === activeDb && q.collName === activeColl).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center text-[#8A93A2]">
                  <History className="w-8 h-8 mb-2 opacity-50" />
                  <p className="text-xs font-semibold">No saved queries yet</p>
                  <p className="text-[10px] text-[#8A93A2]/80 mt-1">Configure your search and click "Save" to keep it.</p>
                </div>
              ) : (
                savedQueries
                  .filter(q => q.dbName === activeDb && q.collName === activeColl)
                  .map((q) => (
                    <div
                      key={q.id}
                      className="group flex flex-col p-4 bg-[#FAFAF7] hover:bg-[#F4F1EC]/40 rounded-xl border border-[#111827]/5 shadow-xs transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="overflow-hidden">
                          <h4 className="text-xs font-bold text-[#111827] truncate">
                            {q.name}
                          </h4>
                          <div className="mt-2 space-y-1 font-mono text-[10px] text-[#5B6472] select-text">
                            <div><span className="font-bold text-[#1F2937]">filter:</span> {q.filter}</div>
                            {q.sort !== "{}" && <div><span className="font-bold text-[#1F2937]">sort:</span> {q.sort}</div>}
                            {q.projection !== "{}" && <div><span className="font-bold text-[#1F2937]">project:</span> {q.projection}</div>}
                            {q.limit !== 20 && <div><span className="font-bold text-[#1F2937]">limit:</span> {q.limit}</div>}
                            {q.skip !== 0 && <div><span className="font-bold text-[#1F2937]">skip:</span> {q.skip}</div>}
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleDeleteQuery(q.id, e)}
                          title="Delete saved query"
                          className="p-1 hover:bg-red-50 text-[#8A93A2] hover:text-[#DC2626] rounded-md transition-colors shrink-0 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="mt-4 flex items-center justify-between text-[10px] border-t border-[#111827]/5 pt-3 select-none">
                        <span className="text-[#8A93A2]">
                          Saved {new Date(q.createdAt).toLocaleDateString()}
                        </span>
                        <button
                          onClick={() => handleLoadQuery(q)}
                          className="px-3 py-1.5 text-[10px] font-bold bg-[#F2673C] text-white hover:bg-[#D9491F] rounded-md transition-colors shadow-2xs cursor-pointer"
                        >
                          Replay Query
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
      {/* Explain Plan Sheet */}
      {explainOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-xs animate-fadeIn">
          <div className="flex-1" onClick={() => setExplainOpen(false)} />
          <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col animate-slideInRight select-text">
            <div className="px-6 py-4 border-b border-[#111827]/10 flex items-center justify-between bg-[#FAFAF7]">
              <div>
                <h3 className="text-sm font-bold text-[#111827]">Find Query Explain Plan</h3>
                <p className="text-[10px] text-[#8A93A2] mt-0.5">Execution plan for the current filter / sort / projection.</p>
              </div>
              <button
                onClick={() => setExplainOpen(false)}
                aria-label="Close explain drawer"
                className="p-1.5 hover:bg-[#111827]/5 rounded-lg text-[#5B6472] hover:text-[#111827] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {explainLoading ? (
                <div className="flex flex-col items-center justify-center py-24 text-[#5B6472]">
                  <Loader2 className="w-8 h-8 animate-spin text-[#F2673C] mb-2" />
                  <span className="text-xs">Generating explain plan...</span>
                </div>
              ) : explainError ? (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-3 text-xs">
                  <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold">Explain execution failed</h4>
                    <p className="opacity-95 mt-1 leading-relaxed">{explainError}</p>
                  </div>
                </div>
              ) : explainPlan ? (
                <ExplainPlanView explain={explainPlan} />
              ) : (
                <div className="text-center py-24 text-xs text-[#8A93A2]">No explain plan generated.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Update Modal */}
      {bulkUpdateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-xl border border-[#111827]/10 p-6 shadow-2xl w-full max-w-lg animate-scaleIn select-text">
            <h3 className="text-sm font-bold text-[#111827] mb-1 flex items-center gap-2">
              <PencilLine className="w-4 h-4 text-[#F2673C]" /> Update Multiple Documents
            </h3>
            <p className="text-xs text-[#5B6472] mb-3">
              Applies an update to <span className="font-bold">all</span> documents matching the current filter on{" "}
              <code className="font-mono bg-[#FAFAF7] px-1 py-0.5 rounded border border-[#111827]/5 font-semibold">{activeDb}.{activeColl}</code>.
            </p>
            <div className="mb-3">
              <label className="block text-[10px] font-bold uppercase text-[#8A93A2] mb-1">Filter (read-only)</label>
              <pre className="text-[11px] font-mono bg-[#FAFAF7] border border-[#EBE7DF] rounded-lg p-2 overflow-x-auto">{filter}</pre>
            </div>
            <div className="mb-3">
              <label className="block text-[10px] font-bold uppercase text-[#8A93A2] mb-1">Update (with operators e.g. $set)</label>
              <textarea
                value={bulkUpdateText}
                onChange={(e) => setBulkUpdateText(e.target.value)}
                rows={5}
                className="w-full p-3 bg-[#1B1F27] text-[#E6E6E6] font-mono text-xs rounded-lg border border-[#232833] focus:outline-none resize-y"
                spellCheck={false}
              />
            </div>
            {bulkPreviewCount !== null && !bulkResult && (
              <div className="mb-3 text-xs text-[#5B6472] bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                This will affect <span className="font-bold">{bulkPreviewCount}</span> document(s).
              </div>
            )}
            {bulkResult && (
              <div className="mb-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2">{bulkResult}</div>
            )}
            {bulkError && (
              <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{bulkError}</div>
            )}
            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setBulkUpdateOpen(false)}
                className="px-3 py-1.5 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={handleBulkUpdate}
                disabled={bulkBusy}
                className="px-4 py-1.5 bg-[#F2673C] text-white hover:bg-[#D9491F] disabled:bg-[#F2673C]/50 font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {bulkBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Run Update
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {bulkDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white rounded-xl border border-[#111827]/10 p-6 shadow-2xl w-full max-w-lg animate-scaleIn select-text">
            <h3 className="text-sm font-bold text-red-700 mb-1 flex items-center gap-2">
              <Trash2 className="w-4 h-4" /> Delete Multiple Documents
            </h3>
            <p className="text-xs text-[#5B6472] mb-3">
              Permanently deletes <span className="font-bold">all</span> documents matching the current filter on{" "}
              <code className="font-mono bg-[#FAFAF7] px-1 py-0.5 rounded border border-[#111827]/5 font-semibold">{activeDb}.{activeColl}</code>.
            </p>
            <div className="mb-3">
              <label className="block text-[10px] font-bold uppercase text-[#8A93A2] mb-1">Filter (read-only)</label>
              <pre className="text-[11px] font-mono bg-[#FAFAF7] border border-[#EBE7DF] rounded-lg p-2 overflow-x-auto">{filter}</pre>
            </div>
            {filter.trim() === "{}" && !bulkResult && (
              <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5" />
                Empty filter — this will delete the entire collection's documents.
              </div>
            )}
            {bulkPreviewCount !== null && !bulkResult && (
              <div className="mb-3 text-xs text-[#5B6472] bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                This will delete <span className="font-bold">{bulkPreviewCount}</span> document(s).
              </div>
            )}
            {bulkResult && (
              <div className="mb-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2">{bulkResult}</div>
            )}
            {bulkError && (
              <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{bulkError}</div>
            )}
            <div className="flex justify-end gap-2 text-xs">
              <button
                onClick={() => setBulkDeleteOpen(false)}
                className="px-3 py-1.5 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold rounded-lg transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkBusy}
                className="px-4 py-1.5 bg-[#DC2626] text-white hover:bg-[#B91C1C] disabled:bg-red-300 font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {bulkBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Run Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// BSON Type Helpers to prevent rendering raw BSON objects
function isBsonNumber(val: any): boolean {
  if (val && typeof val === "object") {
    return "$numberLong" in val || "$numberInt" in val || "$numberDouble" in val || "$numberDecimal" in val;
  }
  return false;
}

function getBsonNumberValue(val: any): string {
  if (val && typeof val === "object") {
    if ("$numberLong" in val) return String(val.$numberLong);
    if ("$numberInt" in val) return String(val.$numberInt);
    if ("$numberDouble" in val) return String(val.$numberDouble);
    if ("$numberDecimal" in val) return String(val.$numberDecimal);
  }
  return "";
}

function formatBsonDate(dateVal: any): string {
  if (typeof dateVal === "string") {
    return dateVal;
  }
  if (typeof dateVal === "number") {
    return new Date(dateVal).toISOString();
  }
  if (dateVal && typeof dateVal === "object" && "$numberLong" in dateVal) {
    const ms = Number(dateVal.$numberLong);
    return new Date(ms).toISOString();
  }
  return String(dateVal);
}

// Helper: formats a table cell value depending on type, showing custom tags for BSON objects
function renderTableCellValue(val: any): ReactNode {
  if (val === null) return <span className="text-[#8A93A2] italic">null</span>;
  if (typeof val === "boolean") return <span className="text-[#8B5CF6] font-bold">{val ? "true" : "false"}</span>;
  if (typeof val === "number") return <span className="text-[#D97706]">{val}</span>;
  if (typeof val === "string") return <span className="text-[#16A34A]">"{val}"</span>;

  // Handle BSON Numbers
  if (isBsonNumber(val)) {
    return <span className="text-[#D97706]">{getBsonNumberValue(val)}</span>;
  }
  
  // Handle Object ID representation
  if (val && typeof val === "object" && "$oid" in val && typeof val.$oid === "string") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 bg-[#E0EBFB] text-[#1D4ED8] text-[9px] font-bold uppercase rounded-md">
        oid:{val.$oid.length >= 18 ? val.$oid.substring(18) : val.$oid}
      </span>
    );
  }
  
  // Handle Date representation
  if (val && typeof val === "object" && "$date" in val) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 bg-[#DCFCE7] text-[#15803D] text-[9px] font-bold uppercase rounded-md">
        date:{formatBsonDate(val.$date)}
      </span>
    );
  }

  // Fallback for nested objects
  if (typeof val === "object") return <span className="text-[#5B6472]">{JSON.stringify(val)}</span>;
  return String(val);
}

// Collapsible tree component for Bson structures
interface BsonTreeObjectProps {
  value: any;
  isRoot?: boolean;
}

export function BsonTreeObject({ value, isRoot = false }: BsonTreeObjectProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    isRoot ? { _root: true } : {}
  );

  const toggleExpand = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderNodeValue = (key: string, val: any): ReactNode => {
    if (val === null) {
      return <span className="text-[#8A93A2] italic ml-1">null</span>;
    }
    if (typeof val === "boolean") {
      return <span className="text-[#8B5CF6] font-bold ml-1">{val ? "true" : "false"}</span>;
    }
    if (typeof val === "number") {
      return <span className="text-[#D97706] ml-1">{val}</span>;
    }
    if (typeof val === "string") {
      return <span className="text-[#16A34A] ml-1">"{val}"</span>;
    }

    // Handle BSON Numbers
    if (isBsonNumber(val)) {
      return <span className="text-[#D97706] ml-1">{getBsonNumberValue(val)}</span>;
    }

    // Special formats
    if (val && typeof val === "object" && "$oid" in val) {
      const oidStr = typeof val.$oid === "string" ? val.$oid : JSON.stringify(val.$oid);
      return (
        <span className="inline-flex items-center ml-1 px-1.5 py-0.5 bg-[#E0EBFB] text-[#1D4ED8] text-[9px] font-bold uppercase rounded-md leading-none">
          {`ObjectId("${oidStr}")`}
        </span>
      );
    }
    if (val && typeof val === "object" && "$date" in val) {
      return (
        <span className="inline-flex items-center ml-1 px-1.5 py-0.5 bg-[#DCFCE7] text-[#15803D] text-[9px] font-bold uppercase rounded-md leading-none">
          {`ISODate("${formatBsonDate(val.$date)}")`}
        </span>
      );
    }

    // Nested object
    const isExpanded = expanded[key];
    const isArray = Array.isArray(val);
    const size = isArray ? val.length : Object.keys(val).length;
    
    return (
      <div className="inline-block">
        <button
          onClick={() => toggleExpand(key)}
          className="inline-flex items-center text-[#5B6472] hover:text-[#111827] focus:outline-none ml-1 font-semibold"
        >
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
          <span className="text-[#8A93A2] text-[10px] ml-0.5 uppercase tracking-wide">
            {isArray ? `Array(${size})` : `Object(${size} keys)`}
          </span>
        </button>

        {isExpanded && (
          <div className="pl-4 border-l border-[#111827]/5 mt-1 space-y-1">
            {isArray ? (
              val.map((item: any, idx: number) => {
                const isComplexItem = item && typeof item === "object" && !("$oid" in item) && !("$date" in item);
                return (
                  <div key={idx} className={`flex flex-wrap ${isComplexItem ? "items-start" : "items-center"} text-[11px] font-mono`}>
                    <span className="text-[#8A93A2]">{idx}:</span>
                    {renderNodeValue(`${key}_${idx}`, item)}
                  </div>
                );
              })
            ) : (
              Object.keys(val).map((subKey) => {
                const isComplexSub = val[subKey] && typeof val[subKey] === "object" && !("$oid" in val[subKey]) && !("$date" in val[subKey]);
                return (
                  <div key={subKey} className={`flex flex-wrap ${isComplexSub ? "items-start" : "items-center"} text-[11px] font-mono`}>
                    <span className="text-[#1F2937] font-semibold">{subKey}:</span>
                    {renderNodeValue(`${key}_${subKey}`, val[subKey])}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  };

  if (isRoot) {
    return (
      <div className="space-y-1 font-mono text-[11px] select-text">
        {Object.keys(value).map((key) => {
          const isComplex = value[key] && typeof value[key] === "object" && !("$oid" in value[key]) && !("$date" in value[key]);
          return (
            <div key={key} className={`flex flex-wrap ${isComplex ? "items-start" : "items-center"} leading-relaxed`}>
              <span className="text-[#1F2937] font-bold select-all">{key}:</span>
              {renderNodeValue(`_root_${key}`, value[key])}
            </div>
          );
        })}
      </div>
    );
  }

  return null;
}

function getDocSize(doc: any): string {
  if (!doc) return "0 B";
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(doc)).length;
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  } catch {
    return "N/A";
  }
}

interface Badge {
  label: string;
  colorClass: string;
}

function detectTags(doc: any): Badge[] {
  const badges: Badge[] = [];
  if (!doc || typeof doc !== "object") return badges;
  
  // Status check
  if (typeof doc.status === "string") {
    const s = doc.status.toLowerCase();
    let color = "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-800";
    if (s === "active" || s === "verified" || s === "completed" || s === "success") {
      color = "bg-green-100 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900/50";
    } else if (s === "pending" || s === "waiting" || s === "trialing") {
      color = "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50";
    } else if (s === "inactive" || s === "suspended" || s === "failed" || s === "cancelled") {
      color = "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50";
    }
    badges.push({ label: doc.status, colorClass: color });
  }
  
  // Tier check
  if (typeof doc.tier === "string") {
    const t = doc.tier.toLowerCase();
    let color = "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900/50";
    if (t === "pro" || t === "premium" || t === "enterprise") {
      color = "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900/50";
    }
    badges.push({ label: doc.tier, colorClass: color });
  }
  
  // 2FA check
  const twoFactor = doc.twoFactorEnabled ?? doc.twoFactor ?? doc["2fa"];
  if (twoFactor !== undefined) {
    if (twoFactor === true || String(twoFactor).toLowerCase() === "enabled" || String(twoFactor).toLowerCase() === "active") {
      badges.push({ label: "2FA Enabled", colorClass: "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900/50" });
    } else if (twoFactor === false || String(twoFactor).toLowerCase() === "disabled") {
      badges.push({ label: "2FA Disabled", colorClass: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50" });
    } else if (String(twoFactor).toLowerCase() === "pending") {
      badges.push({ label: "2FA Pending", colorClass: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900/50" });
    }
  }
  
  // Role check
  if (typeof doc.role === "string") {
    badges.push({ label: doc.role, colorClass: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/50" });
  }
  
  // Trial check
  if (doc.trial === true || doc.trialing === true) {
    badges.push({ label: "trialing", colorClass: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50" });
  }
  
  return badges.slice(0, 3);
}

const highlightJson = (text: string) => {
  if (!text) return "";
  let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const stringRegex = /"(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"/g;
  html = html.replace(stringRegex, (match, offset, fullText) => {
    const remainingText = fullText.substring(offset + match.length);
    const isKey = /^\s*:/.test(remainingText);
    if (isKey) return `<span class="text-[#818CF8] font-medium">${match}</span>`;
    if (match.startsWith('"$') || match.startsWith('"$$')) return `<span class="text-[#F2673C] font-semibold">${match}</span>`;
    return `<span class="text-[#34D399]">${match}</span>`;
  });
  html = html.replace(/\b(\d+(\.\d+)?)\b(?=(?:[^"]*"[^"]*")*[^"]*$)/g, '<span class="text-[#F59E0B]">$1</span>');
  html = html.replace(/\b(true|false|null)\b(?=(?:[^"]*"[^"]*")*[^"]*$)/g, '<span class="text-[#A78BFA] font-bold">$1</span>');
  return html;
};
