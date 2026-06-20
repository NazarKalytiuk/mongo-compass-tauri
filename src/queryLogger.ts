import { QueryLogEntry } from "./types";
import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "compass_plus_query_logs";

export function getQueryLogs(): QueryLogEntry[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => 
      item &&
      typeof item.id === "string" &&
      typeof item.op === "string" &&
      typeof item.ns === "string" &&
      typeof item.query === "string" &&
      typeof item.duration === "number" &&
      typeof item.docsAffected === "number" &&
      typeof item.timestamp === "string"
    );
  } catch (e) {
    console.error("Failed to load query logs:", e);
    return [];
  }
}

export function saveQueryLogs(logs: QueryLogEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, 500)));
  } catch (e) {
    console.error("Failed to save query logs:", e);
  }
}

export function addQueryLog(entry: Omit<QueryLogEntry, "id" | "timestamp">) {
  const logs = getQueryLogs();
  const fullEntry: QueryLogEntry = {
    ...entry,
    id: Math.random().toString(36).substring(7),
    timestamp: new Date().toISOString(),
  };
  logs.unshift(fullEntry);
  saveQueryLogs(logs);
  window.dispatchEvent(new CustomEvent("query_logs_updated"));
}

export function toggleFavoriteQueryLog(id: string) {
  const logs = getQueryLogs();
  const index = logs.findIndex((l) => l.id === id);
  if (index !== -1) {
    logs[index].isFavorite = !logs[index].isFavorite;
    saveQueryLogs(logs);
    window.dispatchEvent(new CustomEvent("query_logs_updated"));
  }
}

export function clearQueryLogs() {
  saveQueryLogs([]);
  window.dispatchEvent(new CustomEvent("query_logs_updated"));
}

export async function invokeWithLog<T>(
  op: QueryLogEntry['op'],
  ns: string,
  commandName: string,
  args: Record<string, any>,
  queryStrForLog: string,
  docsAffectedCountSelector?: (result: T) => number
): Promise<T> {
  const startTime = performance.now();
  try {
    const result = await invoke<T>(commandName, args);
    const duration = Math.round(performance.now() - startTime);
    const docsAffected = docsAffectedCountSelector ? docsAffectedCountSelector(result) : 1;
    
    addQueryLog({
      op,
      ns,
      query: queryStrForLog,
      duration,
      docsAffected,
    });
    
    return result;
  } catch (err: any) {
    const duration = Math.round(performance.now() - startTime);
    addQueryLog({
      op,
      ns,
      query: queryStrForLog,
      duration,
      docsAffected: 0,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
