import { useState, useEffect, useRef } from "react";
import { QueryLogEntry, TabState } from "../types";
import { 
  Search, Trash2, Star, PlayCircle, Clock, AlertTriangle, Database
} from "lucide-react";
import { getQueryLogs, toggleFavoriteQueryLog, clearQueryLogs } from "../queryLogger";

interface QueryLogViewProps {
  onReplay: (entry: QueryLogEntry) => void;
  activeTab: TabState;
}

export default function QueryLogView({ onReplay, activeTab }: QueryLogViewProps) {
  const [logs, setLogs] = useState<QueryLogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const refreshLogs = () => {
    setLogs(getQueryLogs());
  };

  useEffect(() => {
    refreshLogs();
    window.addEventListener("query_logs_updated", refreshLogs);
    return () => window.removeEventListener("query_logs_updated", refreshLogs);
  }, []);

  // Cmd+K focus listener
  useEffect(() => {
    const handleFocusSearch = () => {
      if (activeTab.activeSection === "query-log") {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("focus-search-input", handleFocusSearch);
    return () => window.removeEventListener("focus-search-input", handleFocusSearch);
  }, [activeTab.activeSection]);

  const parseSearchQuery = (filterText: string, log: QueryLogEntry): boolean => {
    if (!filterText.trim()) return true;
    const tokens = filterText.toLowerCase().split(/\s+/).filter(Boolean);

    return tokens.every((token) => {
      if (token.startsWith("coll:")) {
        const collName = token.substring(5);
        return log.ns.toLowerCase().includes(collName);
      }
      if (token.startsWith("plan:")) {
        const planName = token.substring(5);
        return log.query.toLowerCase().includes(planName);
      }
      if (token.startsWith("slow:") || token.startsWith(">=")) {
        const numStr = token.match(/\d+/)?.[0];
        if (numStr) {
          const threshold = parseInt(numStr);
          return log.duration >= threshold;
        }
      }
      return (
        log.op.toLowerCase().includes(token) ||
        log.ns.toLowerCase().includes(token) ||
        log.query.toLowerCase().includes(token) ||
        (log.error && log.error.toLowerCase().includes(token))
      );
    });
  };

  const filteredLogs = logs.filter((log) => {
    if (startTime) {
      const startMs = new Date(startTime).getTime();
      const logMs = new Date(log.timestamp).getTime();
      if (logMs < startMs) return false;
    }
    if (endTime) {
      const endMs = new Date(endTime).getTime();
      const logMs = new Date(log.timestamp).getTime();
      if (logMs > endMs) return false;
    }
    return parseSearchQuery(filter, log);
  });

  const formatTime = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return isoString;
    }
  };

  const getOpStyles = (op: QueryLogEntry['op']) => {
    switch (op) {
      case 'FIND':
        return 'bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0]';
      case 'INSERT':
        return 'bg-[#E0EBFB] text-[#1D4ED8] border-[#BFDBFE]';
      case 'UPDATE':
        return 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]';
      case 'DELETE':
        return 'bg-[#FEE2E2] text-[#991B1B] border-[#FCA5A5]';
      case 'AGGREGATE':
        return 'bg-[#F3E8FF] text-[#6B21A8] border-[#E9D5FF]';
      default:
        return 'bg-[#F4F1EC] text-[#5B6472] border-[#EBE7DF]';
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#FAFAF7] h-full overflow-hidden">
      {/* Search Toolbar */}
      <div className="p-4 bg-white border-b border-[#111827]/5 flex items-center gap-3 shrink-0 shadow-2xs select-none">
        <div className="flex-1 relative">
          <Search className="absolute left-3.5 top-2.5 w-4 h-4 text-[#8A93A2]" />
          <input
            ref={searchInputRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search log by terms, coll:users, plan:IXSCAN, >=100ms... (⌘K)"
            className="w-full text-xs pl-10 pr-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] font-semibold rounded-lg focus:outline-none focus:border-[#F2673C] focus:bg-white transition-all"
          />
        </div>
        <div className="text-[10px] text-[#8A93A2] uppercase font-bold shrink-0">
          Showing {filteredLogs.length} of {logs.length} operations
        </div>
        {logs.length > 0 && (
          <button
            onClick={() => {
              if (window.confirm("Are you sure you want to clear all query logs?")) {
                clearQueryLogs();
              }
            }}
            className="px-3 py-1.5 border border-[#EBE7DF] hover:bg-[#FEE2E2] hover:text-[#DC2626] rounded-lg text-xs font-bold transition-all text-[#5B6472] cursor-pointer flex items-center gap-1.5"
            title="Clear Log History"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Logs</span>
          </button>
        )}
      </div>

      {/* Time Range Toolbar Row */}
      <div className="px-4 py-2 bg-white border-b border-[#111827]/10 flex items-center gap-4 shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase font-bold text-[#8A93A2]">Time Range:</span>
          <input
            type="datetime-local"
            aria-label="Start Time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="text-[11px] px-2.5 py-1 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C] font-semibold"
          />
          <span className="text-[10px] font-bold text-[#8A93A2]">to</span>
          <input
            type="datetime-local"
            aria-label="End Time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="text-[11px] px-2.5 py-1 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C] font-semibold"
          />
        </div>
        {(startTime || endTime || filter) && (
          <button
            onClick={() => {
              setStartTime("");
              setEndTime("");
              setFilter("");
            }}
            className="text-[10px] font-bold text-[#F2673C] hover:text-[#D9491F] transition-colors cursor-pointer"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Logs layout */}
      <div className="flex-1 p-6 overflow-y-auto space-y-4">
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 border border-dashed border-[#111827]/10 rounded-xl bg-white select-none">
            <Database className="w-10 h-10 text-[#8A93A2] mb-3 opacity-60" />
            <h3 className="text-sm font-bold text-[#111827]">No Logged Operations</h3>
            <p className="text-xs text-[#8A93A2] max-w-sm mt-1">
              Operations like Find, Aggregate, or CRUD executed in tabs will be logged here automatically.
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className="bg-white p-4 rounded-xl border border-[#111827]/10 shadow-2xs flex flex-col gap-3">
              {/* Header Info */}
              <div className="flex items-center justify-between flex-wrap gap-2 select-none">
                <div className="flex items-center gap-2">
                  <div className={`px-2.5 py-0.5 rounded text-[10px] font-black border uppercase tracking-wider w-24 text-center shrink-0 ${getOpStyles(log.op)}`}>
                    {log.op}
                  </div>
                  <span className="text-[11px] text-[#8A93A2]">
                    Namespace: <strong className="font-bold text-[#1F2937]">{log.ns}</strong>
                  </span>
                </div>

                <div className="flex items-center gap-3 text-[10px] text-[#8A93A2] font-semibold">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {formatTime(log.timestamp)}
                  </span>
                  <span>{log.duration}ms duration</span>
                  {log.op === 'FIND' && <span>{log.docsAffected} docs affected</span>}
                  {log.op === 'AGGREGATE' && <span>{log.docsAffected} docs returned</span>}
                </div>
              </div>

              {/* Error Block */}
              {log.error && (
                <div className="bg-red-50 border border-red-100 text-red-700 p-2.5 rounded-lg flex items-start gap-2 text-[11px] font-semibold leading-relaxed">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <div className="break-all">{log.error}</div>
                </div>
              )}

              {/* Query Pre Code Block */}
              <pre className="text-[11px] font-mono text-[#5B6472] bg-[#FAFAF7] p-2.5 rounded-lg border border-[#111827]/5 overflow-x-auto select-all max-w-full leading-relaxed">
                {log.query}
              </pre>

              {/* Footer Actions */}
              <div className="flex justify-end gap-2 border-t border-[#111827]/5 pt-2 select-none">
                <button
                  onClick={() => toggleFavoriteQueryLog(log.id)}
                  className={`p-1.5 border rounded-lg transition-all cursor-pointer flex items-center gap-1 text-[11px] font-bold ${
                    log.isFavorite 
                      ? 'bg-amber-50 text-amber-500 border-amber-200' 
                      : 'border-[#EBE7DF] hover:bg-[#FAFAF7] text-[#5B6472]'
                  }`}
                  title={log.isFavorite ? "Unfavorite Query" : "Favorite Query"}
                >
                  <Star className={`w-3.5 h-3.5 ${log.isFavorite ? 'fill-amber-500' : ''}`} />
                  <span>{log.isFavorite ? "Favorited" : "Favorite"}</span>
                </button>
                <button
                  onClick={() => onReplay(log)}
                  className="px-3 py-1.5 border border-[#EBE7DF] hover:bg-[#FEEFE8] hover:text-[#D9491F] rounded-lg transition-all text-[11px] font-bold text-[#5B6472] cursor-pointer flex items-center gap-1"
                  title="Replay query in Explorer/Aggregations"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  <span>Replay Query</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
