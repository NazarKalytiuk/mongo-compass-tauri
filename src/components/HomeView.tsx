import { useState, useEffect } from "react";
import { ConnectionInfo, TabState, NavSection, QueryLogEntry } from "../types";
import { invoke } from "@tauri-apps/api/core";
import {
  Database, Folder, LogOut, ChevronDown, ChevronRight,
  Plus, X, Terminal, Activity, Sparkles, Layers, Search, Download, History,
  ShieldCheck, Loader2, AlertTriangle
} from "lucide-react";
import DocumentExplorer from "./DocumentExplorer";
import DatabaseCollectionsView from "./DatabaseCollectionsView";
import AggregationBuilder from "./AggregationBuilder";
import { MetricsView, ShellView, DumpRestoreView } from "./SectionStubs";
import SchemaView from "./SchemaView";
import ValidationView from "./ValidationView";
import QueryLogView from "./QueryLogView";
import InvestigateView from "./InvestigateView";
import { getQueryLogs } from "../queryLogger";

interface HomeViewProps {
  connectionInfo: ConnectionInfo;
  uri: string;
  onDisconnect: () => void;
}

export default function HomeView({ connectionInfo, uri, onDisconnect }: HomeViewProps) {
  const [databases, setDatabases] = useState<string[]>(connectionInfo.databases);
  const [collections, setCollections] = useState<Record<string, string[]>>({});
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());

  // Create-database modal state
  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [newDbName, setNewDbName] = useState("");
  const [newDbColl, setNewDbColl] = useState("");
  const [createDbError, setCreateDbError] = useState<string | null>(null);
  const [creatingDb, setCreatingDb] = useState(false);
  
  // Tabs management
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");

  const [queryLogCount, setQueryLogCount] = useState(0);

  // Sync Query Log Badge count
  useEffect(() => {
    const updateCount = () => {
      setQueryLogCount(getQueryLogs().length);
    };
    updateCount();
    window.addEventListener("query_logs_updated", updateCount);
    return () => window.removeEventListener("query_logs_updated", updateCount);
  }, []);

  // Global keydown handler for Cmd+K / Ctrl+K
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("focus-search-input"));
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // Schema analysis completed event listener
  useEffect(() => {
    const handleSchemaCompleted = (e: Event) => {
      const customEvent = e as CustomEvent;
      const fieldsCount = customEvent.detail?.fieldsCount;
      if (typeof fieldsCount === "number") {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId
              ? { ...t, schemaFieldsCount: fieldsCount }
              : t
          )
        );
      }
    };
    window.addEventListener("schema_analysis_completed", handleSchemaCompleted);
    return () => window.removeEventListener("schema_analysis_completed", handleSchemaCompleted);
  }, [activeTabId]);

  // Initialize with a default welcome tab
  useEffect(() => {
    const defaultTab: TabState = {
      id: "welcome",
      name: "Welcome",
      selectedDb: "",
      selectedColl: "",
      filter: "{}",
      sort: "{}",
      projection: "{}",
      limit: 20,
      skip: 0,
      documents: [],
      totalCount: 0,
      viewMode: "tree",
      loading: false,
      error: null,
      activeSection: "explorer",
    };
    setTabs([defaultTab]);
    setActiveTabId("welcome");
  }, []);

  const refreshCollections = async (dbName: string) => {
    try {
      const colList: string[] = await invoke("list_collections", { dbName });
      setCollections((prev) => ({ ...prev, [dbName]: colList }));
      return colList;
    } catch (err) {
      console.error(`Failed to load collections for ${dbName}:`, err);
      return [];
    }
  };

  const refreshDatabases = async () => {
    try {
      const list: string[] = await invoke("list_databases");
      setDatabases(list);
      return list;
    } catch (err) {
      console.error("Failed to refresh databases:", err);
      return databases;
    }
  };

  const handleCreateDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDbName.trim() || !newDbColl.trim()) {
      setCreateDbError("Database name and first collection name are required");
      return;
    }
    setCreatingDb(true);
    setCreateDbError(null);
    try {
      await invoke("create_database", { dbName: newDbName.trim(), collName: newDbColl.trim() });
      await refreshDatabases();
      setCreateDbOpen(false);
      setNewDbName("");
      setNewDbColl("");
    } catch (err: any) {
      setCreateDbError(String(err));
    } finally {
      setCreatingDb(false);
    }
  };

  const handleDropDatabase = async (dbName: string) => {
    await invoke("drop_database", { dbName });
    await refreshDatabases();
    setExpandedDbs((prev) => {
      const n = new Set(prev);
      n.delete(dbName);
      return n;
    });
    setCollections((prev) => {
      const n = { ...prev };
      delete n[dbName];
      return n;
    });
    setTabs((prev) =>
      prev.map((t) =>
        t.selectedDb === dbName
          ? { ...t, name: "New Tab", selectedDb: "", selectedColl: "", documents: [], totalCount: 0, error: null }
          : t
      )
    );
  };

  // Expand database and load collections from Tauri
  const toggleDb = async (dbName: string) => {
    const nextExpanded = new Set(expandedDbs);
    if (nextExpanded.has(dbName)) {
      nextExpanded.delete(dbName);
      setExpandedDbs(nextExpanded);
    } else {
      nextExpanded.add(dbName);
      setExpandedDbs(nextExpanded);
      
      // Load collections if not cached
      if (!collections[dbName]) {
        await refreshCollections(dbName);
      }
    }
  };

  const addTab = () => {
    if (tabs.length >= 8) {
      alert("Maximum tab cap of 8 tabs reached.");
      return;
    }
    const newId = Math.random().toString(36).substring(7);
    const newTab: TabState = {
      id: newId,
      name: "New Tab",
      selectedDb: "",
      selectedColl: "",
      filter: "{}",
      sort: "{}",
      projection: "{}",
      limit: 20,
      skip: 0,
      documents: [],
      totalCount: 0,
      viewMode: "tree",
      loading: false,
      error: null,
      activeSection: "explorer",
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newId);
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return; // Keep at least one tab

    const index = tabs.findIndex((t) => t.id === id);
    const nextTabs = tabs.filter((t) => t.id !== id);
    setTabs(nextTabs);

    if (activeTabId === id) {
      // Switch active tab
      const nextActiveIndex = Math.max(0, index - 1);
      setActiveTabId(nextTabs[nextActiveIndex].id);
    }
  };

  const selectCollection = async (dbName: string, collName: string) => {
    let targetTabId = activeTabId;
    
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id === targetTabId) {
          return {
            ...t,
            name: `${dbName}.${collName}`,
            selectedDb: dbName,
            selectedColl: collName,
            filter: "{}",
            sort: "{}",
            projection: "{}",
            limit: 20,
            skip: 0,
            loading: true,
            error: null,
            activeSection: "explorer",
          };
        }
        return t;
      })
    );

    // Run initial find query and fetch index count in parallel
    try {
      const [result, indexes]: [any, any] = await Promise.all([
        invoke("find_documents", {
          dbName,
          collName,
          filterStr: "{}",
          sortStr: "{}",
          projectionStr: "{}",
          limit: 20,
          skip: 0,
        }),
        invoke("list_indexes", {
          dbName,
          collName,
        }).catch((err) => {
          console.error("Failed to list indexes in selectCollection:", err);
          return [];
        })
      ]);

      setTabs((prevTabs) =>
        prevTabs.map((t) =>
          t.id === targetTabId
            ? {
                ...t,
                documents: result?.documents || [],
                totalCount: result?.total_count || 0,
                indexCount: Array.isArray(indexes) ? indexes.length : 0,
                loading: false,
              }
            : t
        )
      );
    } catch (err: any) {
      setTabs((prevTabs) =>
        prevTabs.map((t) =>
          t.id === targetTabId
            ? {
                ...t,
                loading: false,
                error: String(err),
              }
            : t
        )
      );
    }
  };

  const handleReplayQuery = async (entry: QueryLogEntry) => {
    const parts = entry.ns.split(".");
    const dbName = parts[0];
    const collName = parts[1] || "";
    
    let filter = "{}";
    let sort = "{}";
    let projection = "{}";
    let limit = 20;
    let skip = 0;
    let activeSection: NavSection = "explorer";
    
    if (entry.op === "FIND") {
      activeSection = "explorer";
      try {
        const parsed = JSON.parse(entry.query);
        filter = parsed.filter || "{}";
        sort = parsed.sort || "{}";
        projection = parsed.projection || "{}";
        limit = parsed.limit || 20;
        skip = parsed.skip || 0;
      } catch (e) {
        filter = entry.query;
      }
    } else if (entry.op === "AGGREGATE") {
      activeSection = "aggregations";
    }
    
    const targetTabId = activeTabId;
    
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id === targetTabId) {
          return {
            ...t,
            name: `${dbName}.${collName}`,
            selectedDb: dbName,
            selectedColl: collName,
            filter,
            sort,
            projection,
            limit,
            skip,
            loading: true,
            error: null,
            activeSection,
            pipeline: entry.op === "AGGREGATE" ? entry.query : undefined,
          };
        }
        return t;
      })
    );
    
    if (entry.op === "FIND" && collName) {
      try {
        const [result, indexes]: [any, any] = await Promise.all([
          invoke("find_documents", {
            dbName,
            collName,
            filterStr: filter,
            sortStr: sort,
            projectionStr: projection,
            limit,
            skip,
          }),
          invoke("list_indexes", {
            dbName,
            collName,
          }).catch((err) => {
            console.error("Failed to list indexes in handleReplayQuery:", err);
            return [];
          })
        ]);
        
        setTabs((prevTabs) =>
          prevTabs.map((t) =>
            t.id === targetTabId
              ? {
                  ...t,
                  documents: result?.documents || [],
                  totalCount: result?.total_count || 0,
                  indexCount: Array.isArray(indexes) ? indexes.length : 0,
                  loading: false,
                }
              : t
          )
        );
      } catch (err: any) {
        setTabs((prevTabs) =>
          prevTabs.map((t) =>
            t.id === targetTabId
              ? {
                  ...t,
                  loading: false,
                  error: String(err),
                }
              : t
          )
        );
      }
    }
  };

  const selectDatabase = (dbName: string) => {
    let targetTabId = activeTabId;
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id === targetTabId) {
          return {
            ...t,
            name: dbName,
            selectedDb: dbName,
            selectedColl: "",
            loading: false,
            error: null,
            activeSection: "explorer",
          };
        }
        return t;
      })
    );
  };

  const handleDbClick = async (dbName: string) => {
    if (!expandedDbs.has(dbName)) {
      await toggleDb(dbName);
    }
    selectDatabase(dbName);
  };

  const handleCollectionsChanged = async (dbName: string, droppedCollName?: string) => {
    const updatedCols = await refreshCollections(dbName);
    if (droppedCollName) {
      setTabs((prevTabs) =>
        prevTabs.map((t) => {
          if (t.selectedDb === dbName && t.selectedColl === droppedCollName) {
            return {
              ...t,
              name: dbName,
              selectedColl: "",
              documents: [],
              totalCount: 0,
              error: null,
            };
          }
          return t;
        })
      );
    }
    return updatedCols;
  };

  const updateActiveTab = (updatedFields: Partial<TabState>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, ...updatedFields } : t))
    );
  };

  const handleDisconnect = async () => {
    try {
      await invoke("disconnect_db");
      onDisconnect();
    } catch (err) {
      console.error(err);
      onDisconnect(); // Disconnect frontend anyway
    }
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const renderActiveSection = () => {
    if (!activeTab) return null;

    switch (activeTab.activeSection) {
      case 'explorer':
        if (!activeTab.selectedDb) {
          return (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#FAFAF7] h-full overflow-y-auto select-text">
              <div className="h-16 w-16 bg-gradient-to-tr from-[#F2673C] to-[#F38B3F] rounded-2xl flex items-center justify-center shadow-lg mb-6">
                <Database className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-xl font-bold text-[#111827]">Welcome to Compass+</h2>
              <p className="text-sm text-[#5B6472] max-w-sm mt-2">
                Select a database and collection from the sidebar browser to explore its documents.
              </p>
              <div className="mt-8 p-4 bg-[#F4F1EC] rounded-xl border border-[#111827]/5 text-left text-xs font-mono max-w-md w-full">
                <p className="font-bold text-[#1F2937] mb-1">💡 Pro-tips:</p>
                <ul className="list-disc list-inside space-y-1 text-[#5B6472]">
                  <li>Click a database to view collections</li>
                  <li>Open up to 8 tabs concurrently</li>
                  <li>Run MQL queries directly in the Filter box</li>
                  <li>Add/Edit documents with JSON validator checks</li>
                </ul>
              </div>
            </div>
          );
        } else if (!activeTab.selectedColl) {
          return (
            <DatabaseCollectionsView
              dbName={activeTab.selectedDb}
              onSelectCollection={selectCollection}
              onCollectionsChanged={(droppedCollName) => handleCollectionsChanged(activeTab.selectedDb, droppedCollName)}
              onDropDatabase={handleDropDatabase}
            />
          );
        } else {
          return (
            <DocumentExplorer
              tab={activeTab}
              onUpdateTab={updateActiveTab}
              activeDb={activeTab.selectedDb}
              activeColl={activeTab.selectedColl}
              serverVersion={connectionInfo.version}
            />
          );
        }

      case 'aggregations':
        if (!activeTab.selectedColl) {
          return (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#FAFAF7] h-full">
              <Sparkles className="w-10 h-10 text-[#8A93A2] mb-3 opacity-60 animate-pulse" />
              <h3 className="text-sm font-bold text-[#111827]">Aggregation Builder</h3>
              <p className="text-xs text-[#8A93A2] max-w-sm mt-1">
                Please select a database and collection from the sidebar to build aggregation pipelines.
              </p>
            </div>
          );
        }
        return <AggregationBuilder dbName={activeTab.selectedDb} collName={activeTab.selectedColl} tab={activeTab} serverVersion={connectionInfo.version} />;

      case 'schema':
        if (!activeTab.selectedColl) {
          return (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#FAFAF7] h-full">
              <Layers className="w-10 h-10 text-[#8A93A2] mb-3 opacity-60 animate-pulse" />
              <h3 className="text-sm font-bold text-[#111827]">Schema Analysis</h3>
              <p className="text-xs text-[#8A93A2] max-w-sm mt-1">
                Please select a database and collection from the sidebar to perform schema analysis.
              </p>
            </div>
          );
        }
        return <SchemaView dbName={activeTab.selectedDb} collName={activeTab.selectedColl} />;

      case 'validation':
        if (!activeTab.selectedColl) {
          return (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#FAFAF7] h-full">
              <ShieldCheck className="w-10 h-10 text-[#8A93A2] mb-3 opacity-60 animate-pulse" />
              <h3 className="text-sm font-bold text-[#111827]">Schema Validation</h3>
              <p className="text-xs text-[#8A93A2] max-w-sm mt-1">
                Please select a database and collection from the sidebar to author validation rules.
              </p>
            </div>
          );
        }
        return <ValidationView dbName={activeTab.selectedDb} collName={activeTab.selectedColl} />;

      case 'investigate':
        if (!activeTab.selectedDb) {
          return (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[#FAFAF7] h-full">
              <Search className="w-10 h-10 text-[#8A93A2] mb-3 opacity-60 animate-pulse" />
              <h3 className="text-sm font-bold text-[#111827]">Investigate Database</h3>
              <p className="text-xs text-[#8A93A2] max-w-sm mt-1">
                Please select a database from the sidebar to investigate indexes and operations.
              </p>
            </div>
          );
        }
        return <InvestigateView dbName={activeTab.selectedDb} collName={activeTab.selectedColl} />;

      case 'metrics':
        return <MetricsView />;

      case 'shell':
        return <ShellView activeDb={activeTab.selectedDb} />;

      case 'dump':
        return (
          <DumpRestoreView 
            activeDb={activeTab.selectedDb} 
            activeColl={activeTab.selectedColl} 
            databases={databases} 
          />
        );

      case 'query-log':
        return <QueryLogView onReplay={handleReplayQuery} activeTab={activeTab} />;

      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen bg-[#F2EFEA] font-sans antialiased text-[#111827] overflow-hidden">
      {/* SIDEBAR - Databases & Collections */}
      <div className="w-80 bg-[#F4F1EC] border-r border-[#111827]/10 flex flex-col justify-between shrink-0 h-full select-none">
        <div className="flex flex-col min-h-0 flex-1">
          {/* Active Connection Info Card */}
          <div className="p-4 border-b border-[#111827]/10 bg-white">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-[#16A34A] rounded-full animate-pulse shadow-sm" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#5B6472]">
                  Connected
                </span>
              </div>
              <button
                onClick={handleDisconnect}
                className="p-1 hover:bg-[#DC2626]/10 text-[#5B6472] hover:text-[#DC2626] rounded-md transition-colors"
                title="Disconnect"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
            <h3 className="text-xs font-bold truncate text-[#111827]">{uri}</h3>
            <p className="text-[10px] text-[#8A93A2] mt-0.5">
              MongoDB Server Build v{connectionInfo.version}
            </p>
          </div>

          {/* Navigation Sections list */}
          <div className="p-3 border-b border-[#111827]/10 bg-[#EBE7DF]/10 flex flex-col gap-1 shrink-0 select-none">
            <h2 className="text-[10px] font-bold text-[#5B6472] uppercase tracking-wider mb-1 px-2">
              Navigation
            </h2>
            <div className="space-y-0.5">
              {/* Explorer */}
              <button
                onClick={() => updateActiveTab({ activeSection: 'explorer' })}
                className={`w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-xs font-semibold transition-colors cursor-pointer text-left ${
                  activeTab?.activeSection === 'explorer'
                    ? "bg-[#FEEFE8] text-[#D9491F]"
                    : "text-[#5B6472] hover:bg-[#EBE7DF] hover:text-[#111827]"
                }`}
              >
                <Folder className="w-3.5 h-3.5 shrink-0" />
                <span>Explorer</span>
              </button>

              {/* Aggregations */}
              <button
                onClick={() => updateActiveTab({ activeSection: 'aggregations' })}
                className={`w-full flex items-center justify-between py-1.5 px-2 rounded-md text-xs font-semibold transition-colors cursor-pointer text-left ${
                  activeTab?.activeSection === 'aggregations'
                    ? "bg-[#FEEFE8] text-[#D9491F]"
                    : "text-[#5B6472] hover:bg-[#EBE7DF] hover:text-[#111827]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>Aggregations</span>
                </div>
                {!activeTab?.selectedColl && (
                  <span className="text-[9px] font-bold text-[#8A93A2]/60 px-1 py-0.5 bg-[#111827]/5 rounded">Req Coll</span>
                )}
              </button>

              {/* Schema Analysis */}
              <button
                onClick={() => updateActiveTab({ activeSection: 'schema' })}
                className={`w-full flex items-center justify-between py-1.5 px-2 rounded-md text-xs font-semibold transition-colors cursor-pointer text-left ${
                  activeTab?.activeSection === 'schema'
                    ? "bg-[#FEEFE8] text-[#D9491F]"
                    : "text-[#5B6472] hover:bg-[#EBE7DF] hover:text-[#111827]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>Schema Analysis</span>
                </div>
                {activeTab?.schemaFieldsCount !== undefined ? (
                  <span className="text-[10px] font-bold bg-[#16A34A] text-white px-1.5 py-0.5 rounded-full select-none shrink-0 shadow-2xs">
                    {activeTab.schemaFieldsCount}
                  </span>
                ) : (
                  !activeTab?.selectedColl && (
                    <span className="text-[9px] font-bold text-[#8A93A2]/60 px-1 py-0.5 bg-[#111827]/5 rounded">Req Coll</span>
                  )
                )}
              </button>

              {/* Schema Validation */}
              <button
                onClick={() => updateActiveTab({ activeSection: 'validation' })}
                className={`w-full flex items-center justify-between py-1.5 px-2 rounded-md text-xs font-semibold transition-colors cursor-pointer text-left ${
                  activeTab?.activeSection === 'validation'
                    ? "bg-[#FEEFE8] text-[#D9491F]"
                    : "text-[#5B6472] hover:bg-[#EBE7DF] hover:text-[#111827]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>Validation</span>
                </div>
                {!activeTab?.selectedColl && (
                  <span className="text-[9px] font-bold text-[#8A93A2]/60 px-1 py-0.5 bg-[#111827]/5 rounded">Req Coll</span>
                )}
              </button>

              {/* Investigate */}
              <button
                onClick={() => updateActiveTab({ activeSection: 'investigate' })}
                className={`w-full flex items-center justify-between py-1.5 px-2 rounded-md text-xs font-semibold transition-colors cursor-pointer text-left ${
                  activeTab?.activeSection === 'investigate'
                    ? "bg-[#FEEFE8] text-[#D9491F]"
                    : "text-[#5B6472] hover:bg-[#EBE7DF] hover:text-[#111827]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 shrink-0" />
                  <span>Investigate</span>
                </div>
                {activeTab?.indexCount !== undefined ? (
                  <span className="text-[10px] font-bold bg-[#2563EB] text-white px-1.5 py-0.5 rounded-full select-none shrink-0 shadow-2xs">
                    {activeTab.indexCount} idx
                  </span>
                ) : (
                  !activeTab?.selectedDb && (
                    <span className="text-[9px] font-bold text-[#8A93A2]/60 px-1 py-0.5 bg-[#111827]/5 rounded">Req DB</span>
                  )
                )}
              </button>

              {/* Metrics Monitor */}
              <button
                onClick={() => updateActiveTab({ activeSection: 'metrics' })}
                className={`w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-xs font-semibold transition-colors cursor-pointer text-left ${
                  activeTab?.activeSection === 'metrics'
                    ? "bg-[#FEEFE8] text-[#D9491F]"
                    : "text-[#5B6472] hover:bg-[#EBE7DF] hover:text-[#111827]"
                }`}
              >
                <Activity className="w-3.5 h-3.5 shrink-0" />
                <span>Metrics Monitor</span>
              </button>

              {/* mongosh Shell */}
              <button
                onClick={() => updateActiveTab({ activeSection: 'shell' })}
                className={`w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-xs font-semibold transition-colors cursor-pointer text-left ${
                  activeTab?.activeSection === 'shell'
                    ? "bg-[#FEEFE8] text-[#D9491F]"
                    : "text-[#5B6472] hover:bg-[#EBE7DF] hover:text-[#111827]"
                }`}
              >
                <Terminal className="w-3.5 h-3.5 shrink-0" />
                <span>mongosh Shell</span>
              </button>

              {/* Dump / Restore */}
              <button
                onClick={() => updateActiveTab({ activeSection: 'dump' })}
                className={`w-full flex items-center gap-2 py-1.5 px-2 rounded-md text-xs font-semibold transition-colors cursor-pointer text-left ${
                  activeTab?.activeSection === 'dump'
                    ? "bg-[#FEEFE8] text-[#D9491F]"
                    : "text-[#5B6472] hover:bg-[#EBE7DF] hover:text-[#111827]"
                }`}
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>Dump / Restore</span>
              </button>

              {/* Query Log */}
              <button
                onClick={() => updateActiveTab({ activeSection: 'query-log' })}
                className={`w-full flex items-center justify-between py-1.5 px-2 rounded-md text-xs font-semibold transition-colors cursor-pointer text-left ${
                  activeTab?.activeSection === 'query-log'
                    ? "bg-[#FEEFE8] text-[#D9491F]"
                    : "text-[#5B6472] hover:bg-[#EBE7DF] hover:text-[#111827]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <History className="w-3.5 h-3.5 shrink-0" />
                  <span>Query Log</span>
                </div>
                {queryLogCount > 0 && (
                  <span className="text-[10px] font-bold bg-[#F2673C] text-white px-1.5 py-0.5 rounded-full select-none shrink-0 shadow-2xs">
                    {queryLogCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Database Browser List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[10px] font-bold text-[#5B6472] uppercase tracking-wider">
                Databases
              </h2>
              <button
                onClick={() => {
                  setNewDbName("");
                  setNewDbColl("");
                  setCreateDbError(null);
                  setCreateDbOpen(true);
                }}
                className="p-1 hover:bg-[#EBE7DF] rounded-md text-[#5B6472] hover:text-[#111827] transition-colors cursor-pointer"
                title="Create Database"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1">
              {databases.map((db) => {
                const isExpanded = expandedDbs.has(db);
                const cols = collections[db] || [];
                return (
                  <div key={db} className="space-y-0.5">
                    {/* Database Node */}
                    <button
                      onClick={() => handleDbClick(db)}
                      className={`w-full flex items-center justify-between py-1.5 px-2 hover:bg-[#EBE7DF] rounded-md text-xs font-semibold transition-colors cursor-pointer text-left ${
                        activeTab?.selectedDb === db && !activeTab?.selectedColl
                          ? "bg-[#FEEFE8] text-[#D9491F]"
                          : "text-[#1F2937]"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Database className="w-3.5 h-3.5 text-[#F2673C] shrink-0" />
                        <span className="truncate">{db}</span>
                      </div>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDb(db);
                        }}
                        className="p-1 hover:bg-[#111827]/10 rounded-md transition-colors"
                        title={isExpanded ? "Collapse" : "Expand"}
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-[#8A93A2] shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-[#8A93A2] shrink-0" />
                        )}
                      </div>
                    </button>

                    {/* Collection Child Nodes */}
                    {isExpanded && (
                      <div className="pl-4 space-y-0.5 animate-fadeIn">
                        {cols.length === 0 ? (
                          <span className="block text-[10px] italic text-[#8A93A2] py-1 pl-4">
                            No collections
                          </span>
                        ) : (
                          cols.map((coll) => {
                            const isSelected =
                              activeTab?.selectedDb === db &&
                              activeTab?.selectedColl === coll;
                            return (
                              <button
                                key={coll}
                                onClick={() => selectCollection(db, coll)}
                                className={`w-full flex items-center gap-2 py-1 px-2.5 rounded-md text-[11px] transition-colors truncate ${
                                  isSelected
                                    ? "bg-[#FEEFE8] text-[#D9491F] font-bold"
                                    : "text-[#5B6472] hover:bg-[#EBE7DF] hover:text-[#111827]"
                                }`}
                              >
                                <Folder className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{coll}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* MAIN VIEWPORT - Tabs & Active Explorer */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* TABS BAR */}
        <div className="flex items-center bg-[#F4F1EC] border-b border-[#111827]/10 select-none shrink-0">
          <div className="flex flex-1 overflow-x-auto scrollbar-none">
            {tabs.map((t) => {
              const isActive = t.id === activeTabId;
              return (
                <div
                  key={t.id}
                  onClick={() => setActiveTabId(t.id)}
                  className={`group flex items-center gap-2 px-4 py-2 text-xs font-semibold border-r border-[#111827]/10 cursor-pointer transition-all shrink-0 ${
                    isActive
                      ? "bg-[#FAFAF7] text-[#111827] border-b-2 border-b-[#F2673C]"
                      : "bg-[#EBE7DF]/60 text-[#5B6472] hover:bg-[#EBE7DF]/90"
                  }`}
                  style={{ maxWidth: "160px" }}
                >
                  <span className="truncate flex-1">{t.name}</span>
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => closeTab(t.id, e)}
                      className="p-0.5 hover:bg-[#111827]/10 rounded-full text-[#8A93A2] group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={addTab}
            className="p-2.5 hover:bg-[#EBE7DF] text-[#5B6472] border-l border-[#111827]/10 shrink-0 transition-colors"
            title="Open New Tab"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* ACTIVE PANE */}
        <div className="flex-1 min-h-0 flex flex-col h-full overflow-hidden">
          {renderActiveSection()}
        </div>
      </div>

      {/* CREATE DATABASE MODAL */}
      {createDbOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-xl border border-[#111827]/10 shadow-2xl w-full max-w-md overflow-hidden animate-slideUp">
            <div className="bg-[#F4F1EC] px-6 py-4 border-b border-[#111827]/10 flex items-center justify-between">
              <h3 className="font-bold text-sm text-[#111827]">Create Database</h3>
              <button
                onClick={() => setCreateDbOpen(false)}
                className="text-[#8A93A2] hover:text-[#111827] text-xs font-semibold"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleCreateDatabase} className="p-6 space-y-4 text-xs">
              <p className="text-[11px] text-[#5B6472]">
                MongoDB creates a database lazily — provide a name and its first collection.
              </p>
              <div>
                <label className="block font-bold text-[#5B6472] mb-1">Database Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. analytics"
                  value={newDbName}
                  onChange={(e) => setNewDbName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#111827]/15 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#F2673C] focus:border-[#F2673C] text-[#111827]"
                />
              </div>
              <div>
                <label className="block font-bold text-[#5B6472] mb-1">First Collection Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. events"
                  value={newDbColl}
                  onChange={(e) => setNewDbColl(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#111827]/15 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#F2673C] focus:border-[#F2673C] text-[#111827]"
                />
              </div>

              {createDbError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="leading-tight">{createDbError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateDbOpen(false)}
                  className="px-4 py-2 border border-[#111827]/15 hover:bg-[#EBE7DF] text-[#5B6472] rounded-lg font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingDb}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 bg-[#F2673C] hover:bg-[#D9491F] disabled:bg-[#F2673C]/50 text-white rounded-lg font-bold transition-all cursor-pointer"
                >
                  {creatingDb && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Create Database</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
