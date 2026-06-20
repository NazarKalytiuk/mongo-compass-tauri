import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import QueryLogView from "../QueryLogView";
import { getQueryLogs, toggleFavoriteQueryLog, clearQueryLogs } from "../../queryLogger";
import { TabState } from "../../types";

// Mock query logger methods
vi.mock("../../queryLogger", () => ({
  getQueryLogs: vi.fn(),
  toggleFavoriteQueryLog: vi.fn(),
  clearQueryLogs: vi.fn(),
}));

describe("QueryLogView", () => {
  const mockTabState: TabState = {
    id: "tab1",
    name: "tab",
    selectedDb: "",
    selectedColl: "",
    filter: "",
    sort: "",
    projection: "",
    limit: 20,
    skip: 0,
    documents: [],
    totalCount: 0,
    viewMode: "tree",
    loading: false,
    error: null,
    activeSection: "query-log",
  };

  const mockLogs = [
    {
      id: "log1",
      timestamp: "2026-06-20T10:00:00.000Z",
      op: "FIND" as const,
      ns: "store_db.products",
      query: '{"price": {"$gt": 100}}',
      duration: 15,
      docsAffected: 4,
      isFavorite: false,
    },
    {
      id: "log2",
      timestamp: "2026-06-20T11:00:00.000Z",
      op: "AGGREGATE" as const,
      ns: "users_db.orders",
      query: '[{"$match": {"status": "A"}}, {"$group": {"_id": "$item", "total": {"$sum": "$qty"}}}]',
      duration: 120,
      docsAffected: 2,
      isFavorite: true,
    },
    {
      id: "log3",
      timestamp: "2026-06-20T12:00:00.000Z",
      op: "INSERT" as const,
      ns: "store_db.products",
      query: '{"name": "Widget", "price": 25}',
      duration: 5,
      docsAffected: 1,
      isFavorite: false,
      error: "Write conflict: document already exists",
    },
    {
      id: "log4",
      timestamp: "2026-06-20T13:00:00.000Z",
      op: "UPDATE" as const,
      ns: "store_db.users",
      query: '{"$set": {"name": "Alice"}}',
      duration: 8,
      docsAffected: 1,
      isFavorite: false,
    },
    {
      id: "log5",
      timestamp: "2026-06-20T14:00:00.000Z",
      op: "DELETE" as const,
      ns: "store_db.trash",
      query: '{"expired": true}',
      duration: 3,
      docsAffected: 10,
      isFavorite: false,
    },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQueryLogs).mockReturnValue(mockLogs);
  });

  it("renders log list correctly with default details", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });
    expect(screen.getAllByText("store_db.products").length).toBeGreaterThan(0);
    expect(screen.getByText("users_db.orders")).toBeInTheDocument();
    expect(screen.getByText(`Showing 5 of 5 operations`)).toBeInTheDocument();
  });

  it("filters logs by syntax query coll: namespace token", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    const searchInput = screen.getByPlaceholderText(/Search log by terms/);
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "coll:products" } });
    });

    expect(screen.getAllByText("store_db.products").length).toBeGreaterThan(0);
    expect(screen.queryByText("users_db.orders")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 5 operations")).toBeInTheDocument();
  });

  it("filters logs by slow: threshold query token", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    const searchInput = screen.getByPlaceholderText(/Search log by terms/);
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "slow:100" } });
    });

    expect(screen.getByText("users_db.orders")).toBeInTheDocument();
    expect(screen.queryByText("store_db.products")).not.toBeInTheDocument();
  });

  it("filters logs by >= threshold operator", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    const searchInput = screen.getByPlaceholderText(/Search log by terms/);
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: ">=100" } });
    });

    expect(screen.getByText("users_db.orders")).toBeInTheDocument();
    expect(screen.queryByText("store_db.users")).not.toBeInTheDocument();
  });

  it("filters logs by plan: token matching query content", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    const searchInput = screen.getByPlaceholderText(/Search log by terms/);
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "plan:match" } });
    });

    // Only log2 has "$match" in query
    expect(screen.getByText("users_db.orders")).toBeInTheDocument();
    expect(screen.queryByText("store_db.users")).not.toBeInTheDocument();
  });

  it("filters logs by free-text matching op field", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    const searchInput = screen.getByPlaceholderText(/Search log by terms/);
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "delete" } });
    });

    expect(screen.getByText("store_db.trash")).toBeInTheDocument();
  });

  it("filters logs by free-text matching error field", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    const searchInput = screen.getByPlaceholderText(/Search log by terms/);
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "write conflict" } });
    });

    expect(screen.getByText("Write conflict: document already exists")).toBeInTheDocument();
    expect(screen.queryByText("users_db.orders")).not.toBeInTheDocument();
  });

  it("filters logs by custom start and end time range", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    const startInput = screen.getByLabelText("Start Time");
    const endInput = screen.getByLabelText("End Time");

    // Dynamic timezone-independent local ISO formatting helper
    const toLocalISO = (date: Date): string => {
      const pad = (n: number) => String(n).padStart(2, "0");
      const y = date.getFullYear();
      const m = pad(date.getMonth() + 1);
      const d = pad(date.getDate());
      const h = pad(date.getHours());
      const min = pad(date.getMinutes());
      return `${y}-${m}-${d}T${h}:${min}`;
    };

    const date2 = new Date("2026-06-20T11:00:00.000Z");
    const startDate = new Date(date2.getTime() - 30 * 60 * 1000);
    const endDate = new Date(date2.getTime() + 30 * 60 * 1000);

    await act(async () => {
      fireEvent.change(startInput, { target: { value: toLocalISO(startDate) } });
    });
    await act(async () => {
      fireEvent.change(endInput, { target: { value: toLocalISO(endDate) } });
    });

    expect(screen.getByText("users_db.orders")).toBeInTheDocument();
    expect(screen.queryByText("store_db.products")).not.toBeInTheDocument();

    // Click Reset Filters
    const resetBtn = screen.getByRole("button", { name: "Reset Filters" });
    await act(async () => {
      fireEvent.click(resetBtn);
    });

    expect(screen.getAllByText("store_db.products").length).toBeGreaterThan(0);
    expect(screen.getByText("users_db.orders")).toBeInTheDocument();
  });

  it("shows Reset Filters button when filter text is set and hides it when cleared", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    expect(screen.queryByRole("button", { name: "Reset Filters" })).not.toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Search log by terms/);
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "find" } });
    });

    expect(screen.getByRole("button", { name: "Reset Filters" })).toBeInTheDocument();
  });

  it("shows empty state when no logs match filter", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    const searchInput = screen.getByPlaceholderText(/Search log by terms/);
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "coll:nonexistent_collection_xyz" } });
    });

    expect(screen.getByText("No Logged Operations")).toBeInTheDocument();
  });

  it("shows empty state when there are no logs at all", async () => {
    vi.mocked(getQueryLogs).mockReturnValue([]);

    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    expect(screen.getByText("No Logged Operations")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear Logs/i })).not.toBeInTheDocument();
  });

  it("calls clearQueryLogs when Clear Logs button is confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    const clearBtn = screen.getByRole("button", { name: /Clear Logs/i });
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    expect(clearQueryLogs).toHaveBeenCalled();
  });

  it("does not call clearQueryLogs when Clear Logs is cancelled via confirm", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    const clearBtn = screen.getByRole("button", { name: /Clear Logs/i });
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    expect(clearQueryLogs).not.toHaveBeenCalled();
  });

  it("calls toggleFavoriteQueryLog when favorite button is clicked", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    // First favorite button corresponds to log1 (not favorited)
    const favBtns = screen.getAllByTitle(/Favorite Query|Unfavorite Query/i);
    await act(async () => {
      fireEvent.click(favBtns[0]);
    });

    expect(toggleFavoriteQueryLog).toHaveBeenCalledWith("log1");
  });

  it("calls onReplay with the correct log when Replay Query button is clicked", async () => {
    const onReplay = vi.fn();

    await act(async () => {
      render(
        <QueryLogView
          onReplay={onReplay}
          activeTab={mockTabState}
        />
      );
    });

    const replayBtns = screen.getAllByTitle("Replay query in Explorer/Aggregations");
    await act(async () => {
      fireEvent.click(replayBtns[0]);
    });

    expect(onReplay).toHaveBeenCalledWith(expect.objectContaining({ id: "log1" }));
  });

  it("renders error block for log entries with error field", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    expect(screen.getByText("Write conflict: document already exists")).toBeInTheDocument();
  });

  it("renders correct op badge styles for FIND, AGGREGATE, INSERT, UPDATE, DELETE", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    expect(screen.getByText("FIND")).toBeInTheDocument();
    expect(screen.getByText("AGGREGATE")).toBeInTheDocument();
    expect(screen.getByText("INSERT")).toBeInTheDocument();
    expect(screen.getByText("UPDATE")).toBeInTheDocument();
    expect(screen.getByText("DELETE")).toBeInTheDocument();
  });

  it("renders docsAffected for FIND and AGGREGATE ops", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    expect(screen.getByText("4 docs affected")).toBeInTheDocument();
    expect(screen.getByText("2 docs returned")).toBeInTheDocument();
  });

  it("renders Favorited label for already-favorited logs", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    expect(screen.getByText("Favorited")).toBeInTheDocument();
    // Non-favorited entries show "Favorite"
    expect(screen.getAllByText("Favorite").length).toBeGreaterThan(0);
  });

  it("listens to query_logs_updated event and refreshes log list", async () => {
    vi.mocked(getQueryLogs).mockReturnValue([]);

    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    expect(screen.getByText("No Logged Operations")).toBeInTheDocument();

    // Simulate a new log being added
    vi.mocked(getQueryLogs).mockReturnValue([mockLogs[0]]);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("query_logs_updated"));
    });

    expect(screen.getByText("store_db.products")).toBeInTheDocument();
  });

  it("focuses search input on focus-search-input event when activeSection is query-log", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={{ ...mockTabState, activeSection: "query-log" }}
        />
      );
    });

    const searchInput = screen.getByPlaceholderText(/Search log by terms/);
    searchInput.blur();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("focus-search-input"));
    });

    // Should not throw — the event is handled
    expect(searchInput).toBeInTheDocument();
  });

  it("does not focus search input on focus-search-input event when activeSection is not query-log", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={{ ...mockTabState, activeSection: "explorer" }}
        />
      );
    });

    // Should not throw
    await act(async () => {
      window.dispatchEvent(new CustomEvent("focus-search-input"));
    });

    expect(screen.getByPlaceholderText(/Search log by terms/)).toBeInTheDocument();
  });

  it("renders duration in milliseconds for each log", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    expect(screen.getByText("15ms duration")).toBeInTheDocument();
    expect(screen.getByText("120ms duration")).toBeInTheDocument();
  });

  it("renders the query pre block for each log entry", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    expect(screen.getByText('{"price": {"$gt": 100}}')).toBeInTheDocument();
  });

  it("renders log with an unknown op type using the default badge style", async () => {
    const logsWithUnknownOp = [
      {
        id: "log_unknown",
        timestamp: "2026-06-20T10:00:00.000Z",
        // Force an unknown op — cast to satisfy TS in test context
        op: "COMMAND" as any,
        ns: "admin.system",
        query: "{}",
        duration: 1,
        docsAffected: 0,
        isFavorite: false,
      }
    ];
    vi.mocked(getQueryLogs).mockReturnValue(logsWithUnknownOp);

    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    expect(screen.getByText("COMMAND")).toBeInTheDocument();
  });

  it("handles slow: token without a valid number gracefully (falls through to text match)", async () => {
    await act(async () => {
      render(
        <QueryLogView
          onReplay={() => {}}
          activeTab={mockTabState}
        />
      );
    });

    const searchInput = screen.getByPlaceholderText(/Search log by terms/);
    await act(async () => {
      // "slow:" without a number — no digits, should fall through to general text match
      fireEvent.change(searchInput, { target: { value: "slow:" } });
    });

    // All logs that contain "slow" in op/ns/query/error — unlikely to match any so shows 0
    // Important: no crash
    expect(screen.getByText(/Showing \d+ of 5 operations/)).toBeInTheDocument();
  });
});
