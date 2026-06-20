import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getQueryLogs,
  saveQueryLogs,
  addQueryLog,
  toggleFavoriteQueryLog,
  clearQueryLogs,
  invokeWithLog,
} from "../../queryLogger";
import { QueryLogEntry } from "../../types";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const STORAGE_KEY = "compass_plus_query_logs";

function makeSampleEntry(overrides: Partial<QueryLogEntry> = {}): QueryLogEntry {
  return {
    id: "abc123",
    op: "FIND",
    ns: "testdb.col",
    query: '{"a":1}',
    duration: 10,
    docsAffected: 3,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── getQueryLogs ───────────────────────────────────────────────────────────────

describe("getQueryLogs", () => {
  it("returns empty array when localStorage is empty", () => {
    expect(getQueryLogs()).toEqual([]);
  });

  it("returns valid entries from localStorage", () => {
    const entry = makeSampleEntry();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([entry]));
    const result = getQueryLogs();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("abc123");
  });

  it("filters out entries missing required fields", () => {
    const valid = makeSampleEntry();
    const invalid = { id: "x", op: "FIND" }; // missing ns, query, duration, docsAffected, timestamp
    localStorage.setItem(STORAGE_KEY, JSON.stringify([valid, invalid]));
    const result = getQueryLogs();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("abc123");
  });

  it("returns empty array when stored value is not an array", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: "bar" }));
    expect(getQueryLogs()).toEqual([]);
  });

  it("returns empty array when stored JSON is malformed", () => {
    localStorage.setItem(STORAGE_KEY, "not valid json{{");
    expect(getQueryLogs()).toEqual([]);
  });

  it("filters out null items in the array", () => {
    const entry = makeSampleEntry();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([entry, null]));
    const result = getQueryLogs();
    expect(result).toHaveLength(1);
  });
});

// ── saveQueryLogs ──────────────────────────────────────────────────────────────

describe("saveQueryLogs", () => {
  it("persists logs to localStorage", () => {
    const entry = makeSampleEntry();
    saveQueryLogs([entry]);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("abc123");
  });

  it("truncates logs to 500 entries", () => {
    const entries = Array.from({ length: 600 }, (_, i) =>
      makeSampleEntry({ id: `id${i}` })
    );
    saveQueryLogs(entries);
    const result = getQueryLogs();
    expect(result).toHaveLength(500);
    expect(result[0].id).toBe("id0");
  });

  it("handles localStorage.setItem error gracefully", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveQueryLogs([makeSampleEntry()])).not.toThrow();
    spy.mockRestore();
  });
});

// ── addQueryLog ────────────────────────────────────────────────────────────────

describe("addQueryLog", () => {
  it("adds a new log entry with auto-generated id and timestamp", () => {
    addQueryLog({
      op: "FIND",
      ns: "db.col",
      query: "{}",
      duration: 5,
      docsAffected: 1,
    });
    const logs = getQueryLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBeTruthy();
    expect(logs[0].timestamp).toBeTruthy();
    expect(logs[0].op).toBe("FIND");
  });

  it("prepends new entries (most recent first)", () => {
    addQueryLog({ op: "FIND", ns: "db.col", query: "{}", duration: 1, docsAffected: 1 });
    addQueryLog({ op: "INSERT", ns: "db.col", query: "{}", duration: 2, docsAffected: 1 });
    const logs = getQueryLogs();
    expect(logs[0].op).toBe("INSERT");
    expect(logs[1].op).toBe("FIND");
  });

  it("dispatches query_logs_updated custom event", () => {
    const listener = vi.fn();
    window.addEventListener("query_logs_updated", listener);
    addQueryLog({ op: "DELETE", ns: "db.col", query: "{}", duration: 1, docsAffected: 0 });
    window.removeEventListener("query_logs_updated", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ── toggleFavoriteQueryLog ─────────────────────────────────────────────────────

describe("toggleFavoriteQueryLog", () => {
  it("marks an entry as favorite when it was not", () => {
    const entry = makeSampleEntry({ isFavorite: false });
    saveQueryLogs([entry]);
    toggleFavoriteQueryLog("abc123");
    const logs = getQueryLogs();
    expect(logs[0].isFavorite).toBe(true);
  });

  it("unmarks an entry that was already a favorite", () => {
    const entry = makeSampleEntry({ isFavorite: true });
    saveQueryLogs([entry]);
    toggleFavoriteQueryLog("abc123");
    const logs = getQueryLogs();
    expect(logs[0].isFavorite).toBe(false);
  });

  it("does nothing if the id does not exist", () => {
    const entry = makeSampleEntry();
    saveQueryLogs([entry]);
    toggleFavoriteQueryLog("nonexistent-id");
    const logs = getQueryLogs();
    expect(logs[0].isFavorite).toBeUndefined();
  });

  it("dispatches query_logs_updated event when toggling", () => {
    const entry = makeSampleEntry();
    saveQueryLogs([entry]);
    const listener = vi.fn();
    window.addEventListener("query_logs_updated", listener);
    toggleFavoriteQueryLog("abc123");
    window.removeEventListener("query_logs_updated", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch event when id is not found", () => {
    saveQueryLogs([makeSampleEntry()]);
    const listener = vi.fn();
    window.addEventListener("query_logs_updated", listener);
    toggleFavoriteQueryLog("no-such-id");
    window.removeEventListener("query_logs_updated", listener);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ── clearQueryLogs ─────────────────────────────────────────────────────────────

describe("clearQueryLogs", () => {
  it("removes all logs from storage", () => {
    saveQueryLogs([makeSampleEntry(), makeSampleEntry({ id: "x" })]);
    clearQueryLogs();
    expect(getQueryLogs()).toEqual([]);
  });

  it("dispatches query_logs_updated event", () => {
    const listener = vi.fn();
    window.addEventListener("query_logs_updated", listener);
    clearQueryLogs();
    window.removeEventListener("query_logs_updated", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ── invokeWithLog ──────────────────────────────────────────────────────────────

describe("invokeWithLog", () => {
  it("calls invoke with the correct command and args", async () => {
    mockInvoke.mockResolvedValue([{ _id: 1 }, { _id: 2 }]);
    await invokeWithLog("FIND", "db.col", "find_documents", { db: "db", col: "col" }, '{}');
    expect(mockInvoke).toHaveBeenCalledWith("find_documents", { db: "db", col: "col" });
  });

  it("returns the result from invoke", async () => {
    const mockResult = [{ _id: 1 }];
    mockInvoke.mockResolvedValue(mockResult);
    const result = await invokeWithLog("FIND", "db.col", "find_documents", {}, '{}');
    expect(result).toEqual(mockResult);
  });

  it("adds a query log entry on success", async () => {
    mockInvoke.mockResolvedValue([{ _id: 1 }]);
    await invokeWithLog("FIND", "db.col", "find_documents", {}, '{"name":"test"}');
    const logs = getQueryLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].op).toBe("FIND");
    expect(logs[0].ns).toBe("db.col");
    expect(logs[0].query).toBe('{"name":"test"}');
    expect(logs[0].docsAffected).toBe(1);
  });

  it("uses docsAffectedCountSelector when provided", async () => {
    const mockResult = [{ _id: 1 }, { _id: 2 }, { _id: 3 }];
    mockInvoke.mockResolvedValue(mockResult);
    await invokeWithLog(
      "FIND",
      "db.col",
      "find_documents",
      {},
      "{}",
      (res: typeof mockResult) => res.length
    );
    const logs = getQueryLogs();
    expect(logs[0].docsAffected).toBe(3);
  });

  it("adds a log entry with docsAffected=0 and error on failure", async () => {
    const err = new Error("connection refused");
    mockInvoke.mockRejectedValue(err);
    await expect(
      invokeWithLog("FIND", "db.col", "find_documents", {}, "{}")
    ).rejects.toThrow("connection refused");
    const logs = getQueryLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].docsAffected).toBe(0);
    expect(logs[0].error).toBe("connection refused");
  });

  it("records non-Error rejection as string in error field", async () => {
    mockInvoke.mockRejectedValue("timeout");
    await expect(
      invokeWithLog("AGGREGATE", "db.col", "run_pipeline", {}, "[]")
    ).rejects.toBe("timeout");
    const logs = getQueryLogs();
    expect(logs[0].error).toBe("timeout");
  });

  it("logs duration as a non-negative integer", async () => {
    mockInvoke.mockResolvedValue(null);
    await invokeWithLog("INSERT", "db.users", "insert_doc", {}, "{}");
    const logs = getQueryLogs();
    expect(logs[0].duration).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(logs[0].duration)).toBe(true);
  });

  it("still logs on error with duration as a non-negative integer", async () => {
    mockInvoke.mockRejectedValue(new Error("fail"));
    await expect(invokeWithLog("DELETE", "db.col", "delete_doc", {}, "{}")).rejects.toThrow();
    const logs = getQueryLogs();
    expect(logs[0].duration).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(logs[0].duration)).toBe(true);
  });
});
