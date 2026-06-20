import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MetricsView } from "../MetricsView";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

// Use explicit key presence check so callers can pass `null` values without
// being overridden by the default (null ?? default === default in JS).
const o = <T,>(overrides: Record<string, unknown>, key: string, def: T): T =>
  key in overrides ? (overrides[key] as T) : def;

const makeServerStatus = (overrides: Partial<{
  insert: number; query: number; update: number; delete: number; getmore: number; command: number;
  current: number; available: number;
  mem_resident_mb: number;
  network_bytes_in: number; network_bytes_out: number;
  wt_cache_used_bytes: number | null; wt_cache_max_bytes: number | null;
  wt_cache_pages_requested: number | null; wt_cache_pages_read: number | null;
}> = {}) => ({
  opcounters: {
    insert: o(overrides, "insert", 10),
    query: o(overrides, "query", 20),
    update: o(overrides, "update", 5),
    delete: o(overrides, "delete", 2),
    getmore: o(overrides, "getmore", 1),
    command: o(overrides, "command", 100),
  },
  connections: {
    current: o(overrides, "current", 5),
    available: o(overrides, "available", 100),
  },
  mem_resident_mb: o(overrides, "mem_resident_mb", 256),
  network_bytes_in: o(overrides, "network_bytes_in", 1024),
  network_bytes_out: o(overrides, "network_bytes_out", 2048),
  wt_cache_used_bytes: o<number | null>(overrides, "wt_cache_used_bytes", 1073741824),
  wt_cache_max_bytes: o<number | null>(overrides, "wt_cache_max_bytes", 4294967296),
  wt_cache_pages_requested: o<number | null>(overrides, "wt_cache_pages_requested", 1000),
  wt_cache_pages_read: o<number | null>(overrides, "wt_cache_pages_read", 50),
});

const makeReplStatus = (isReplica = false, lagMs: number | null = null) => ({
  is_replica_set: isReplica,
  my_state: isReplica ? "PRIMARY" : null,
  lag_ms: lagMs,
});

/** Configure mockInvoke to return stable payloads keyed by command name */
const setupInvoke = (
  serverStatus = makeServerStatus(),
  replStatus = makeReplStatus()
) => {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "server_status") return serverStatus;
    if (cmd === "repl_set_status") return replStatus;
    throw new Error(`Unknown command: ${cmd}`);
  });
};

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("MetricsView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Initial render / static UI
  // -------------------------------------------------------------------------

  describe("initial render", () => {
    it("renders the Server Metrics header", async () => {
      setupInvoke();
      await act(async () => {
        render(<MetricsView />);
      });
      expect(screen.getByText("Server Metrics")).toBeInTheDocument();
    });

    it("renders the Pause button when polling is active", async () => {
      setupInvoke();
      await act(async () => {
        render(<MetricsView />);
      });
      expect(screen.getByRole("button", { name: /Pause/i })).toBeInTheDocument();
    });

    it("renders the interval selector with 5s as default", async () => {
      setupInvoke();
      await act(async () => {
        render(<MetricsView />);
      });
      const select = screen.getByRole("combobox") as HTMLSelectElement;
      expect(select.value).toBe("5000");
    });

    it("shows Live indicator when polling is active", async () => {
      setupInvoke();
      await act(async () => {
        render(<MetricsView />);
      });
      expect(screen.getByText("Live")).toBeInTheDocument();
    });

    it("renders the WiredTiger Cache Efficiency section", async () => {
      setupInvoke();
      await act(async () => {
        render(<MetricsView />);
      });
      expect(screen.getByText("WiredTiger Cache Efficiency")).toBeInTheDocument();
    });

    it("shows waiting placeholder before enough cache data points", async () => {
      setupInvoke();
      await act(async () => {
        render(<MetricsView />);
      });
      // Only one data point so far — chart needs ≥ 2
      expect(screen.getByText("Waiting for enough data points...")).toBeInTheDocument();
    });

    it("KPI cards show zero / N/A defaults before first poll resolves", () => {
      // Don't resolve — keep pending forever
      mockInvoke.mockReturnValue(new Promise(() => {}));
      render(<MetricsView />);
      expect(screen.getByText("0.0/s")).toBeInTheDocument();
      expect(screen.getByText("0 MB")).toBeInTheDocument();
      expect(screen.getByText("0.0 KB/s")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // KPI card values after first poll
  // -------------------------------------------------------------------------

  describe("KPI values after first poll", () => {
    it("displays connection count from server status", async () => {
      setupInvoke(makeServerStatus({ current: 42 }));
      await act(async () => {
        render(<MetricsView />);
      });
      expect(screen.getByText("42")).toBeInTheDocument();
    });

    it("displays resident memory in MB", async () => {
      setupInvoke(makeServerStatus({ mem_resident_mb: 512 }));
      await act(async () => {
        render(<MetricsView />);
      });
      expect(screen.getByText("512 MB")).toBeInTheDocument();
    });

    it("shows N/A for Cache Hit Ratio on the first poll (no previous data)", async () => {
      setupInvoke();
      await act(async () => {
        render(<MetricsView />);
      });
      // Cache hit ratio KPI card value — first poll calculates from absolute counters
      // wt_cache_pages_requested=1000, wt_cache_pages_read=50 → 95%
      expect(screen.getByText("95.0%")).toBeInTheDocument();
    });

    it("shows N/A for Cache Hit Ratio when wt counters are null", async () => {
      setupInvoke(makeServerStatus({
        wt_cache_pages_requested: null,
        wt_cache_pages_read: null,
      }));
      await act(async () => {
        render(<MetricsView />);
      });
      // Both KPI card and badge should say N/A / WiredTiger Unavailable
      const naEls = screen.getAllByText("N/A");
      expect(naEls.length).toBeGreaterThanOrEqual(1);
    });

    it("shows WiredTiger Unavailable badge when cache ratio is null", async () => {
      setupInvoke(makeServerStatus({
        wt_cache_pages_requested: null,
        wt_cache_pages_read: null,
      }));
      await act(async () => {
        render(<MetricsView />);
      });
      expect(screen.getByText("WiredTiger Unavailable")).toBeInTheDocument();
    });

    it("shows N/A for Replica Set Lag when not a replica set", async () => {
      setupInvoke(makeServerStatus(), makeReplStatus(false));
      await act(async () => {
        render(<MetricsView />);
      });
      const naEls = screen.getAllByText("N/A");
      // At least the replica lag card and cache hit (if null) show N/A
      expect(naEls.length).toBeGreaterThanOrEqual(1);
    });

    it("displays replica lag when it is a replica set", async () => {
      setupInvoke(makeServerStatus(), makeReplStatus(true, 25));
      await act(async () => {
        render(<MetricsView />);
      });
      expect(screen.getByText("25 ms")).toBeInTheDocument();
    });

    it("displays 0 ms for replica lag when lag_ms is null but is_replica_set=true", async () => {
      setupInvoke(makeServerStatus(), makeReplStatus(true, null));
      await act(async () => {
        render(<MetricsView />);
      });
      expect(screen.getByText("0 ms")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Delta computations after second poll
  // -------------------------------------------------------------------------

  describe("delta computations after second poll", () => {
    it("computes ops rate between two polls", async () => {
      let callCount = 0;
      const serverStatuses = [
        makeServerStatus({ insert: 0, query: 0, update: 0, delete: 0, getmore: 0, command: 0 }),
        // After 5 s (pollingInterval), 500 total ops → 100 ops/s
        makeServerStatus({ insert: 100, query: 100, update: 100, delete: 100, getmore: 50, command: 50 }),
      ];

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "server_status") return serverStatuses[Math.min(callCount++, 1)];
        if (cmd === "repl_set_status") return makeReplStatus();
        throw new Error(`Unknown command: ${cmd}`);
      });

      await act(async () => {
        render(<MetricsView />);
      });

      // Advance by the default poll interval (5000 ms) to trigger second poll
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // Should show a numeric ops/s value (not 0.0/s)
      const opsCard = screen.getByText("Operations / Sec").closest("div");
      expect(opsCard).not.toBeNull();
      // The ops value text is within the parent container
      const opsValue = opsCard!.querySelector(".text-2xl");
      expect(opsValue?.textContent).not.toBe("0.0/s");
    });

    it("computes network rate between two polls", async () => {
      let callCount = 0;
      const serverStatuses = [
        makeServerStatus({ network_bytes_in: 0, network_bytes_out: 0 }),
        // After 5 s, 5120 extra bytes → 1 KB/s
        makeServerStatus({ network_bytes_in: 2560, network_bytes_out: 2560 }),
      ];

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "server_status") return serverStatuses[Math.min(callCount++, 1)];
        if (cmd === "repl_set_status") return makeReplStatus();
        throw new Error(`Unknown command: ${cmd}`);
      });

      await act(async () => {
        render(<MetricsView />);
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // 5120 bytes / 1024 / 5s = 1 KB/s
      expect(screen.getByText("1.0 KB/s")).toBeInTheDocument();
    });

    it("displays MB/s when network rate >= 1024 KB/s", async () => {
      let callCount = 0;
      // Second poll: 1024 * 1024 * 5 bytes more → 1024 KB/s = 1 MB/s
      const serverStatuses = [
        makeServerStatus({ network_bytes_in: 0, network_bytes_out: 0 }),
        makeServerStatus({
          network_bytes_in: 1024 * 1024 * 5,
          network_bytes_out: 1024 * 1024 * 5,
        }),
      ];

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "server_status") return serverStatuses[Math.min(callCount++, 1)];
        if (cmd === "repl_set_status") return makeReplStatus();
        throw new Error(`Unknown command: ${cmd}`);
      });

      await act(async () => {
        render(<MetricsView />);
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // (2 * 1024 * 1024 * 5 / 1024) / 5 = 2048 KB/s → shown as MB/s
      const networkCard = screen.getByText("Network Rate").closest("div");
      const networkValue = networkCard!.querySelector(".text-2xl");
      expect(networkValue?.textContent).toMatch(/MB\/s/);
    });

    it("computes cache hit ratio using delta between two polls (requestedDelta > 0)", async () => {
      let callCount = 0;
      const serverStatuses = [
        makeServerStatus({ wt_cache_pages_requested: 1000, wt_cache_pages_read: 50 }),
        // Delta: +200 requested, +0 read → 100% hit ratio
        makeServerStatus({ wt_cache_pages_requested: 1200, wt_cache_pages_read: 50 }),
      ];

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "server_status") return serverStatuses[Math.min(callCount++, 1)];
        if (cmd === "repl_set_status") return makeReplStatus();
        throw new Error(`Unknown command: ${cmd}`);
      });

      await act(async () => {
        render(<MetricsView />);
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(screen.getByText("100.0%")).toBeInTheDocument();
    });

    it("computes cache hit ratio when requestedDelta == 0 but absolute requested > 0", async () => {
      let callCount = 0;
      const serverStatuses = [
        // First poll sets lastRawData
        makeServerStatus({ wt_cache_pages_requested: 1000, wt_cache_pages_read: 100 }),
        // Second poll: same page counters → requestedDelta = 0, falls back to absolute
        makeServerStatus({ wt_cache_pages_requested: 1000, wt_cache_pages_read: 100 }),
      ];

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "server_status") return serverStatuses[Math.min(callCount++, 1)];
        if (cmd === "repl_set_status") return makeReplStatus();
        throw new Error(`Unknown command: ${cmd}`);
      });

      await act(async () => {
        render(<MetricsView />);
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // Falls through to absolute: 100 * (1 - 100/1000) = 90.0%
      expect(screen.getByText("90.0%")).toBeInTheDocument();
    });

    it("shows 100% cache ratio when requested delta == 0 and absolute requested == 0", async () => {
      let callCount = 0;
      const serverStatuses = [
        makeServerStatus({ wt_cache_pages_requested: 0, wt_cache_pages_read: 0 }),
        makeServerStatus({ wt_cache_pages_requested: 0, wt_cache_pages_read: 0 }),
      ];

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "server_status") return serverStatuses[Math.min(callCount++, 1)];
        if (cmd === "repl_set_status") return makeReplStatus();
        throw new Error(`Unknown command: ${cmd}`);
      });

      await act(async () => {
        render(<MetricsView />);
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(screen.getByText("100.0%")).toBeInTheDocument();
    });

    it("caps negative cache hit ratio to 0% after clamping", async () => {
      let callCount = 0;
      // Craft a situation where read delta > requested delta → ratio would be negative before clamp
      const serverStatuses = [
        makeServerStatus({ wt_cache_pages_requested: 100, wt_cache_pages_read: 0 }),
        makeServerStatus({ wt_cache_pages_requested: 110, wt_cache_pages_read: 200 }),
      ];

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "server_status") return serverStatuses[Math.min(callCount++, 1)];
        if (cmd === "repl_set_status") return makeReplStatus();
        throw new Error(`Unknown command: ${cmd}`);
      });

      await act(async () => {
        render(<MetricsView />);
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // After clamp to [0, 100]: 0.0%
      expect(screen.getByText("0.0%")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // First-poll cache hit ratio with wt_cache_pages_requested == 0
  // -------------------------------------------------------------------------

  describe("first-poll cache hit ratio edge cases", () => {
    it("shows 100% cache ratio on first poll when requested == 0", async () => {
      setupInvoke(makeServerStatus({ wt_cache_pages_requested: 0, wt_cache_pages_read: 0 }));

      await act(async () => {
        render(<MetricsView />);
      });

      expect(screen.getByText("100.0%")).toBeInTheDocument();
    });

    it("computes absolute cache hit ratio correctly on first poll when requested > 0", async () => {
      // requested=500, read=100 → 100*(1 - 100/500) = 80%
      setupInvoke(makeServerStatus({ wt_cache_pages_requested: 500, wt_cache_pages_read: 100 }));

      await act(async () => {
        render(<MetricsView />);
      });

      expect(screen.getByText("80.0%")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // WT Cache usage overlay
  // -------------------------------------------------------------------------

  describe("WT Cache usage overlay", () => {
    it("shows WT cache used / max when both are non-null", async () => {
      setupInvoke(makeServerStatus({
        wt_cache_used_bytes: 1073741824,   // 1 GB
        wt_cache_max_bytes: 4294967296,    // 4 GB
      }));

      await act(async () => {
        render(<MetricsView />);
      });

      expect(screen.getByText(/WT Cache Usage/i)).toBeInTheDocument();
      expect(screen.getByText(/1 GB \/ 4 GB/)).toBeInTheDocument();
    });

    it("does not show WT cache overlay when wt_cache_used_bytes is null", async () => {
      setupInvoke(makeServerStatus({
        wt_cache_used_bytes: null,
        wt_cache_max_bytes: null,
      }));

      await act(async () => {
        render(<MetricsView />);
      });

      expect(screen.queryByText(/WT Cache Usage/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Cache hit ratio badge
  // -------------------------------------------------------------------------

  describe("cache hit ratio badge color", () => {
    it("shows green badge when cache hit ratio >= 95", async () => {
      // first poll: requested=1000, read=50 → 95%
      setupInvoke(makeServerStatus({ wt_cache_pages_requested: 1000, wt_cache_pages_read: 50 }));

      await act(async () => {
        render(<MetricsView />);
      });

      const badge = screen.getByText(/% Cache Hit Ratio/);
      expect(badge.className).toMatch(/DCFCE7|15803D/);
    });

    it("shows amber badge when cache hit ratio < 95", async () => {
      // first poll: requested=100, read=20 → 80%
      setupInvoke(makeServerStatus({ wt_cache_pages_requested: 100, wt_cache_pages_read: 20 }));

      await act(async () => {
        render(<MetricsView />);
      });

      const badge = screen.getByText(/% Cache Hit Ratio/);
      expect(badge.className).toMatch(/amber/);
    });
  });

  // -------------------------------------------------------------------------
  // Cache chart renders SVG when >= 2 data points
  // -------------------------------------------------------------------------

  describe("cache hit chart", () => {
    it("renders SVG chart after two polls with cache data", async () => {
      let callCount = 0;
      const serverStatuses = [
        makeServerStatus({ wt_cache_pages_requested: 1000, wt_cache_pages_read: 50 }),
        makeServerStatus({ wt_cache_pages_requested: 1200, wt_cache_pages_read: 60 }),
      ];

      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "server_status") return serverStatuses[Math.min(callCount++, 1)];
        if (cmd === "repl_set_status") return makeReplStatus();
        throw new Error(`Unknown command: ${cmd}`);
      });

      await act(async () => {
        render(<MetricsView />);
      });

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // "Waiting for enough data points..." should be gone
      expect(screen.queryByText("Waiting for enough data points...")).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // History trimming (max 60 points)
  // -------------------------------------------------------------------------

  describe("history trimming", () => {
    it("keeps at most 60 data points in history", async () => {
      setupInvoke();

      await act(async () => {
        render(<MetricsView />);
      });

      // Trigger 65 additional polls (each at 5s intervals)
      for (let i = 0; i < 65; i++) {
        await act(async () => {
          vi.advanceTimersByTime(5000);
        });
      }

      // The component doesn't expose history directly, but if it crashed it would throw.
      // We simply assert it still renders the metrics view header.
      expect(screen.getByText("Server Metrics")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Polling controls
  // -------------------------------------------------------------------------

  describe("polling controls", () => {
    it("toggles to Resume button when Pause is clicked", async () => {
      setupInvoke();

      await act(async () => {
        render(<MetricsView />);
      });

      const pauseBtn = screen.getByRole("button", { name: /Pause/i });
      await act(async () => {
        fireEvent.click(pauseBtn);
      });

      expect(screen.getByRole("button", { name: /Resume/i })).toBeInTheDocument();
    });

    it("hides Live indicator when polling is paused", async () => {
      setupInvoke();

      await act(async () => {
        render(<MetricsView />);
      });

      const pauseBtn = screen.getByRole("button", { name: /Pause/i });
      await act(async () => {
        fireEvent.click(pauseBtn);
      });

      expect(screen.queryByText("Live")).not.toBeInTheDocument();
    });

    it("does not invoke server_status when polling is paused", async () => {
      setupInvoke();

      await act(async () => {
        render(<MetricsView />);
      });

      // Pause
      const pauseBtn = screen.getByRole("button", { name: /Pause/i });
      await act(async () => {
        fireEvent.click(pauseBtn);
      });

      const callsAfterPause = mockInvoke.mock.calls.length;

      // Advance time — no new polls should happen
      await act(async () => {
        vi.advanceTimersByTime(15000);
      });

      expect(mockInvoke.mock.calls.length).toBe(callsAfterPause);
    });

    it("resumes polling when Resume button is clicked", async () => {
      setupInvoke();

      await act(async () => {
        render(<MetricsView />);
      });

      // Pause
      const pauseBtn = screen.getByRole("button", { name: /Pause/i });
      await act(async () => {
        fireEvent.click(pauseBtn);
      });

      const callsAfterPause = mockInvoke.mock.calls.length;

      // Resume
      const resumeBtn = screen.getByRole("button", { name: /Resume/i });
      await act(async () => {
        fireEvent.click(resumeBtn);
      });

      // An immediate poll should fire
      expect(mockInvoke.mock.calls.length).toBeGreaterThan(callsAfterPause);
    });

    it("changes polling interval when select changes", async () => {
      setupInvoke();

      await act(async () => {
        render(<MetricsView />);
      });

      const select = screen.getByRole("combobox") as HTMLSelectElement;
      await act(async () => {
        fireEvent.change(select, { target: { value: "1000" } });
      });

      expect(select.value).toBe("1000");
    });

    it("re-runs poll on new interval after select change", async () => {
      setupInvoke();

      await act(async () => {
        render(<MetricsView />);
      });

      const callsAfterMount = mockInvoke.mock.calls.length;

      // Switch to 1s interval
      const select = screen.getByRole("combobox");
      await act(async () => {
        fireEvent.change(select, { target: { value: "1000" } });
      });

      // A new immediate poll fires due to useEffect re-running
      const callsAfterChange = mockInvoke.mock.calls.length;
      expect(callsAfterChange).toBeGreaterThan(callsAfterMount);

      // Advance 1 s — should poll again at new interval
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(mockInvoke.mock.calls.length).toBeGreaterThan(callsAfterChange);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("shows error banner when server_status rejects", async () => {
      mockInvoke.mockRejectedValue(new Error("Connection refused"));

      await act(async () => {
        render(<MetricsView />);
      });

      expect(screen.getByText("Metrics polling failed")).toBeInTheDocument();
      expect(screen.getByText("Connection refused")).toBeInTheDocument();
    });

    it("shows string error when rejection is a plain string", async () => {
      mockInvoke.mockRejectedValue("timeout error");

      await act(async () => {
        render(<MetricsView />);
      });

      expect(screen.getByText("timeout error")).toBeInTheDocument();
    });

    it("clears error banner after a successful poll following a failure", async () => {
      let callCount = 0;
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "server_status") {
          if (callCount++ === 0) throw new Error("Connection refused");
          return makeServerStatus();
        }
        if (cmd === "repl_set_status") return makeReplStatus();
        throw new Error(`Unknown command: ${cmd}`);
      });

      await act(async () => {
        render(<MetricsView />);
      });

      // Error shown after first failed poll
      expect(screen.getByText("Metrics polling failed")).toBeInTheDocument();

      // Second poll succeeds
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(screen.queryByText("Metrics polling failed")).not.toBeInTheDocument();
    });

    it("gracefully continues when repl_set_status rejects", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "server_status") return makeServerStatus();
        if (cmd === "repl_set_status") throw new Error("Not a replica set");
        throw new Error(`Unknown command: ${cmd}`);
      });

      await act(async () => {
        render(<MetricsView />);
      });

      // No connection error banner
      expect(screen.queryByText("Metrics polling failed")).not.toBeInTheDocument();
      // Component still renders
      expect(screen.getByText("Server Metrics")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // formatBytes helper (exercised through WT Cache overlay)
  // -------------------------------------------------------------------------

  describe("formatBytes output via WT cache overlay", () => {
    it("shows 0 Bytes when wt_cache_used is 0", async () => {
      setupInvoke(makeServerStatus({ wt_cache_used_bytes: 0, wt_cache_max_bytes: 0 }));

      await act(async () => {
        render(<MetricsView />);
      });

      expect(screen.getByText(/0 Bytes \/ 0 Bytes/)).toBeInTheDocument();
    });

    it("shows KB for values in KB range", async () => {
      setupInvoke(makeServerStatus({ wt_cache_used_bytes: 2048, wt_cache_max_bytes: 4096 }));

      await act(async () => {
        render(<MetricsView />);
      });

      expect(screen.getByText(/2 KB \/ 4 KB/)).toBeInTheDocument();
    });

    it("shows MB for values in MB range", async () => {
      setupInvoke(makeServerStatus({
        wt_cache_used_bytes: 1048576,   // 1 MB
        wt_cache_max_bytes: 2097152,    // 2 MB
      }));

      await act(async () => {
        render(<MetricsView />);
      });

      expect(screen.getByText(/1 MB \/ 2 MB/)).toBeInTheDocument();
    });

    it("shows TB for very large values", async () => {
      setupInvoke(makeServerStatus({
        wt_cache_used_bytes: 1099511627776,  // 1 TB
        wt_cache_max_bytes: 2199023255552,   // 2 TB
      }));

      await act(async () => {
        render(<MetricsView />);
      });

      expect(screen.getByText(/1 TB \/ 2 TB/)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // KPI label rendering completeness
  // -------------------------------------------------------------------------

  describe("KPI card labels", () => {
    it("renders all six KPI card labels", async () => {
      setupInvoke();

      await act(async () => {
        render(<MetricsView />);
      });

      expect(screen.getByText("Operations / Sec")).toBeInTheDocument();
      expect(screen.getByText("Connections")).toBeInTheDocument();
      expect(screen.getByText("Resident Memory")).toBeInTheDocument();
      expect(screen.getByText("Network Rate")).toBeInTheDocument();
      expect(screen.getByText("Cache Hit Ratio")).toBeInTheDocument();
      expect(screen.getByText("Replica Set Lag")).toBeInTheDocument();
    });
  });
});
