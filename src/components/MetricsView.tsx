import { useState, useEffect, useRef } from "react";
import {
  BarChart2, Play, Pause, AlertCircle
} from "lucide-react";
import { ServerStatusResult, ReplSetStatusResult } from "../types";
import { invoke } from "@tauri-apps/api/core";

interface MetricHistoryPoint {
  timestamp: number;
  ops: number;
  conns: number;
  mem: number;
  network: number;
  cacheHitRatio: number | null;
  replLag: number | null;
  wtCacheUsed: number | null;
  wtCacheMax: number | null;
}

export function MetricsView() {
  const [isPolling, setIsPolling] = useState(true);
  const [pollingInterval, setPollingInterval] = useState(5000);
  const [history, setHistory] = useState<MetricHistoryPoint[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const lastRawData = useRef<{
    timestamp: number;
    totalOps: number;
    networkBytes: number;
    wtCacheRequested: number | null;
    wtCacheRead: number | null;
  } | null>(null);

  const pollMetrics = async () => {
    try {
      const now = Date.now();
      const serverStatus: ServerStatusResult = await invoke("server_status");

      let replSetStatus: ReplSetStatusResult = {
        is_replica_set: false,
        my_state: null,
        lag_ms: null,
      };

      try {
        replSetStatus = await invoke("repl_set_status");
      } catch (replErr) {
        console.warn("Failed to get replica set status:", replErr);
      }

      setConnectionError(null);

      const totalOps =
        serverStatus.opcounters.insert +
        serverStatus.opcounters.query +
        serverStatus.opcounters.update +
        serverStatus.opcounters.delete +
        serverStatus.opcounters.getmore +
        serverStatus.opcounters.command;

      const networkBytes = serverStatus.network_bytes_in + serverStatus.network_bytes_out;
      const conns = serverStatus.connections.current;
      const mem = serverStatus.mem_resident_mb;
      const wtCacheUsed = serverStatus.wt_cache_used_bytes;
      const wtCacheMax = serverStatus.wt_cache_max_bytes;

      let opsRate = 0;
      let netRate = 0;
      let cacheHitRatio: number | null = null;

      if (lastRawData.current) {
        const dt = (now - lastRawData.current.timestamp) / 1000;
        if (dt > 0) {
          opsRate = Math.max(0, (totalOps - lastRawData.current.totalOps) / dt);
          netRate = Math.max(0, ((networkBytes - lastRawData.current.networkBytes) / 1024) / dt);

          if (
            serverStatus.wt_cache_pages_requested !== null &&
            serverStatus.wt_cache_pages_read !== null &&
            lastRawData.current.wtCacheRequested !== null &&
            lastRawData.current.wtCacheRead !== null
          ) {
            const requestedDelta =
              serverStatus.wt_cache_pages_requested - lastRawData.current.wtCacheRequested;
            const readDelta =
              serverStatus.wt_cache_pages_read - lastRawData.current.wtCacheRead;
            if (requestedDelta > 0) {
              cacheHitRatio = 100.0 * (1.0 - readDelta / requestedDelta);
            } else if (serverStatus.wt_cache_pages_requested > 0) {
              cacheHitRatio =
                100.0 *
                (1.0 - serverStatus.wt_cache_pages_read / serverStatus.wt_cache_pages_requested);
            } else {
              cacheHitRatio = 100.0;
            }
          }
        }
      } else if (
        serverStatus.wt_cache_pages_requested !== null &&
        serverStatus.wt_cache_pages_read !== null
      ) {
        cacheHitRatio =
          serverStatus.wt_cache_pages_requested > 0
            ? 100.0 *
              (1.0 -
                serverStatus.wt_cache_pages_read / serverStatus.wt_cache_pages_requested)
            : 100.0;
      }

      if (cacheHitRatio !== null) {
        cacheHitRatio = Math.max(0, Math.min(100, cacheHitRatio));
      }

      lastRawData.current = {
        timestamp: now,
        totalOps,
        networkBytes,
        wtCacheRequested: serverStatus.wt_cache_pages_requested,
        wtCacheRead: serverStatus.wt_cache_pages_read,
      };

      const newPoint: MetricHistoryPoint = {
        timestamp: now,
        ops: opsRate,
        conns,
        mem,
        network: netRate,
        cacheHitRatio,
        replLag: replSetStatus.is_replica_set ? (replSetStatus.lag_ms ?? 0) : null,
        wtCacheUsed,
        wtCacheMax,
      };

      setHistory((prev) => {
        const updated = [...prev, newPoint];
        return updated.length > 60 ? updated.slice(updated.length - 60) : updated;
      });
    } catch (err: any) {
      console.error("Failed to poll server metrics:", err);
      setConnectionError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!isPolling) return;
    pollMetrics();
    const intervalId = setInterval(pollMetrics, pollingInterval);
    return () => clearInterval(intervalId);
  }, [isPolling, pollingInterval]);

  const getSparklinePath = (
    values: number[],
    width = 100,
    height = 20,
    useZeroBaseline = true
  ): string => {
    if (values.length < 2) return "";
    const minVal = useZeroBaseline ? 0 : Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal;
    return values
      .map((val, idx) => {
        const x = (idx / (values.length - 1)) * width;
        const y = range === 0 ? height / 2 : height - ((val - minVal) / range) * height;
        return `${idx === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  const getAreaPath = (values: number[], width = 400, height = 100): string => {
    if (values.length < 2) return "";
    const points = values.map((val, idx) => {
      const x = (idx / (values.length - 1)) * width;
      const y = height - (val / 100) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M 0,${height} L ${points.join(" L ")} L ${width},${height} Z`;
  };

  const getLinePath = (values: number[], width = 400, height = 100): string => {
    if (values.length < 2) return "";
    return values
      .map((val, idx) => {
        const x = (idx / (values.length - 1)) * width;
        const y = height - (val / 100) * height;
        return `${idx === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  const latestPoint = history[history.length - 1];
  const opsValues = history.map((h) => h.ops);
  const connsValues = history.map((h) => h.conns);
  const memValues = history.map((h) => h.mem);
  const netValues = history.map((h) => h.network);
  const cacheHitValues = history.filter((h) => h.cacheHitRatio !== null).map((h) => h.cacheHitRatio!);
  const replLagValues = history.filter((h) => h.replLag !== null).map((h) => h.replLag!);

  const formatBytes = (bytes: number | null): string => {
    if (bytes === null || bytes === undefined) return "N/A";
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const sparkline = (values: number[], color: string, useZeroBaseline = true) => (
    <svg className="h-8 w-full" viewBox="0 0 100 20" preserveAspectRatio="none">
      {values.length >= 2 && (
        <path
          d={getSparklinePath(values, 100, 20, useZeroBaseline)}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );

  return (
    <div className="flex-1 p-6 bg-[#FAFAF7] overflow-y-auto space-y-6 select-none">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl border border-[#111827]/10 shadow-xs flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-sm font-bold text-[#111827]">Server Metrics</h2>
          <p className="text-[11px] text-[#8A93A2]">
            Real-time activity logs, diagnostic counters, memory, and performance monitoring.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg p-0.5 shadow-2xs">
            <button
              onClick={() => setIsPolling(!isPolling)}
              className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                isPolling
                  ? "bg-amber-600/10 text-amber-700 hover:bg-amber-600/20"
                  : "bg-green-600/10 text-green-700 hover:bg-green-600/20"
              }`}
            >
              {isPolling ? (
                <><Pause className="w-3 h-3" /><span>Pause</span></>
              ) : (
                <><Play className="w-3 h-3" /><span>Resume</span></>
              )}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase font-bold text-[#8A93A2]">Interval:</span>
              <select
                value={pollingInterval}
                onChange={(e) => setPollingInterval(Number(e.target.value))}
                className="text-xs bg-white border border-[#EBE7DF] rounded-lg px-2 py-1 font-bold text-[#1F2937] focus:outline-none focus:border-[#F2673C]"
              >
                <option value={1000}>1s</option>
                <option value={2000}>2s</option>
                <option value={5000}>5s</option>
                <option value={10000}>10s</option>
              </select>
            </div>
            {isPolling && (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-[#16A34A] rounded-full animate-pulse" />
                <span className="text-[10px] font-bold text-[#16A34A] uppercase tracking-wider">Live</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {connectionError && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3 text-xs shadow-2xs">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-bold">Metrics polling failed</h4>
            <p className="opacity-95 mt-1 leading-relaxed">
              Verify database server connection and administrative permissions.
            </p>
            <pre className="font-mono text-[10px] opacity-75 mt-1 bg-red-100/50 p-1.5 rounded border border-red-200/40 select-all overflow-x-auto">
              {connectionError}
            </pre>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {[
          { label: "Operations / Sec", value: latestPoint ? `${latestPoint.ops.toFixed(1)}/s` : "0.0/s", values: opsValues, color: "#F2673C" },
          { label: "Connections", value: latestPoint ? String(latestPoint.conns) : "0", values: connsValues, color: "#16A34A" },
          { label: "Resident Memory", value: latestPoint ? `${latestPoint.mem.toFixed(0)} MB` : "0 MB", values: memValues, color: "#2563EB", noZero: true },
          {
            label: "Network Rate",
            value: latestPoint
              ? latestPoint.network >= 1024
                ? `${(latestPoint.network / 1024).toFixed(1)} MB/s`
                : `${latestPoint.network.toFixed(1)} KB/s`
              : "0.0 KB/s",
            values: netValues,
            color: "#8B5CF6",
          },
          {
            label: "Cache Hit Ratio",
            value: latestPoint?.cacheHitRatio != null ? `${latestPoint.cacheHitRatio.toFixed(1)}%` : "N/A",
            values: cacheHitValues,
            color: "#0D9488",
          },
          {
            label: "Replica Set Lag",
            value: latestPoint?.replLag != null ? `${latestPoint.replLag} ms` : "N/A",
            values: replLagValues,
            color: "#EA580C",
          },
        ].map(({ label, value, values, color, noZero }) => (
          <div key={label} className="bg-white p-5 rounded-xl border border-[#111827]/10 shadow-2xs space-y-2">
            <span className="text-[10px] uppercase font-bold text-[#8A93A2] tracking-wider">{label}</span>
            <div className="text-2xl font-black text-[#111827] truncate">{value}</div>
            {sparkline(values, color, !noZero)}
          </div>
        ))}
      </div>

      {/* WT Cache chart */}
      <div className="bg-white p-6 rounded-xl border border-[#111827]/10 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <BarChart2 className="w-4 h-4 text-[#F2673C]" />
            <h3 className="text-xs font-bold text-[#111827]">WiredTiger Cache Efficiency</h3>
          </div>
          <span
            className={`text-[9px] font-bold px-2 py-0.5 rounded-md uppercase ${
              latestPoint?.cacheHitRatio != null
                ? latestPoint.cacheHitRatio >= 95
                  ? "bg-[#DCFCE7] text-[#15803D]"
                  : "bg-amber-100 text-amber-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {latestPoint?.cacheHitRatio != null
              ? `${latestPoint.cacheHitRatio.toFixed(1)}% Cache Hit Ratio`
              : "WiredTiger Unavailable"}
          </span>
        </div>
        <div className="h-48 bg-[#FAFAF7] rounded-xl border border-[#111827]/5 flex items-center justify-center text-xs text-[#8A93A2] relative overflow-hidden p-4">
          {cacheHitValues.length >= 2 ? (
            <svg className="absolute inset-0 w-full h-full p-2" viewBox="0 0 400 100" preserveAspectRatio="none">
              <line x1="0" y1="25" x2="400" y2="25" stroke="#111827" strokeOpacity="0.05" strokeDasharray="4" />
              <line x1="0" y1="50" x2="400" y2="50" stroke="#111827" strokeOpacity="0.05" strokeDasharray="4" />
              <line x1="0" y1="75" x2="400" y2="75" stroke="#111827" strokeOpacity="0.05" strokeDasharray="4" />
              <path d={getAreaPath(cacheHitValues)} fill="url(#gradient-chart)" stroke="none" />
              <path d={getLinePath(cacheHitValues)} fill="none" stroke="#0D9488" strokeWidth="2.5" strokeLinecap="round" />
              <defs>
                <linearGradient id="gradient-chart" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0D9488" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#0D9488" stopOpacity="0.0" />
                </linearGradient>
              </defs>
            </svg>
          ) : (
            <div className="flex flex-col items-center justify-center text-[#8A93A2] gap-1 z-10 select-none">
              <BarChart2 className="w-8 h-8 opacity-45 animate-pulse" />
              <span>Waiting for enough data points...</span>
            </div>
          )}
          {latestPoint?.wtCacheUsed != null && latestPoint?.wtCacheMax != null && (
            <div className="absolute left-4 top-4 bg-white/85 px-2.5 py-1.5 rounded-lg border border-[#111827]/10 flex flex-col pointer-events-none">
              <span className="text-[9px] font-bold text-[#8A93A2] uppercase">WT Cache Usage</span>
              <span className="text-sm font-black text-[#1F2937] mt-0.5">
                {formatBytes(latestPoint.wtCacheUsed)} / {formatBytes(latestPoint.wtCacheMax)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
