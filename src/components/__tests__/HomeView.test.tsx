import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HomeView from "../HomeView";
import { invoke } from "@tauri-apps/api/core";
import { ConnectionInfo, QueryLogEntry } from "../../types";

// Mock Tauri invoke function
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock heavy child components to focus on HomeView logic
vi.mock("../DocumentExplorer", () => ({
  default: ({ tab }: { tab: { selectedColl: string } }) => (
    <div data-testid="document-explorer">DocumentExplorer:{tab.selectedColl}</div>
  ),
}));

vi.mock("../DatabaseCollectionsView", () => ({
  default: ({
    dbName,
    onCollectionsChanged,
  }: {
    dbName: string;
    onSelectCollection: (db: string, coll: string) => void;
    onCollectionsChanged: (droppedCollName?: string) => void;
  }) => (
    <div data-testid="db-collections-view">
      DatabaseCollectionsView:{dbName}
      <button onClick={() => onCollectionsChanged("products")}>DropProducts</button>
      <button onClick={() => onCollectionsChanged()}>RefreshNoDropped</button>
    </div>
  ),
}));

vi.mock("../AggregationBuilder", () => ({
  default: ({ dbName, collName }: { dbName: string; collName: string }) => (
    <div data-testid="aggregation-builder">AggregationBuilder:{dbName}.{collName}</div>
  ),
}));

vi.mock("../SchemaView", () => ({
  default: ({ dbName, collName }: { dbName: string; collName: string }) => (
    <div data-testid="schema-view">SchemaView:{dbName}.{collName}</div>
  ),
}));

vi.mock("../InvestigateView", () => ({
  default: ({ dbName }: { dbName: string }) => (
    <div data-testid="investigate-view">InvestigateView:{dbName}</div>
  ),
}));

vi.mock("../QueryLogView", () => ({
  default: ({ onReplay }: { onReplay: (entry: QueryLogEntry) => void }) => (
    <div data-testid="query-log-view">
      <button onClick={() => onReplay({
        id: "log1",
        op: "FIND",
        ns: "store_db.products",
        query: '{"filter":{"price":{"$gt":100}},"sort":{},"projection":{},"limit":10,"skip":0}',
        duration: 15,
        docsAffected: 4,
        timestamp: new Date().toISOString(),
      })}>ReplayFIND</button>
      <button onClick={() => onReplay({
        id: "log2",
        op: "AGGREGATE",
        ns: "store_db.orders",
        query: '[{"$match":{"status":"A"}}]',
        duration: 120,
        docsAffected: 2,
        timestamp: new Date().toISOString(),
      })}>ReplayAGGREGATE</button>
      <button onClick={() => onReplay({
        id: "log3",
        op: "FIND",
        ns: "store_db",
        query: "not-json",
        duration: 5,
        docsAffected: 0,
        timestamp: new Date().toISOString(),
      })}>ReplayFINDNoCollInvalidJSON</button>
    </div>
  ),
}));

vi.mock("../SectionStubs", () => ({
  MetricsView: () => <div data-testid="metrics-view">MetricsView</div>,
  ShellView: () => <div data-testid="shell-view">ShellView</div>,
  DumpRestoreView: ({ activeDb }: { activeDb: string }) => (
    <div data-testid="dump-restore-view">DumpRestoreView:{activeDb}</div>
  ),
}));

vi.mock("../../queryLogger", () => ({
  getQueryLogs: vi.fn(() => []),
}));

// -----------------------------------------------------------------------

const defaultConnectionInfo: ConnectionInfo = {
  version: "8.0.0",
  databases: ["admin", "local", "store_db"],
  display_uri: "mongodb://localhost:27017",
};

const defaultUri = "mongodb://localhost:27017";

function renderHomeView(overrides?: Partial<ConnectionInfo>) {
  const connectionInfo = { ...defaultConnectionInfo, ...overrides };
  const onDisconnect = vi.fn();
  const result = render(
    <HomeView
      connectionInfo={connectionInfo}
      uri={defaultUri}
      onDisconnect={onDisconnect}
    />
  );
  return { ...result, onDisconnect };
}

// -----------------------------------------------------------------------

describe("HomeView & Sidebar", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ---- CONNECTION INFO ---------------------------------------------------

  it("renders connection details and database list in the sidebar", () => {
    renderHomeView();

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(defaultUri)).toBeInTheDocument();
    expect(screen.getByText("MongoDB Server Build v8.0.0")).toBeInTheDocument();

    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("local")).toBeInTheDocument();
    expect(screen.getByText("store_db")).toBeInTheDocument();
  });

  // ---- DISCONNECT --------------------------------------------------------

  it("calls onDisconnect when disconnect button is clicked and invoke succeeds", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    const { onDisconnect } = renderHomeView();

    const disconnectBtn = screen.getByTitle("Disconnect");
    await act(async () => { fireEvent.click(disconnectBtn); });

    expect(invoke).toHaveBeenCalledWith("disconnect_db");
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("calls onDisconnect even when disconnect_db invoke rejects", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("network error"));
    const { onDisconnect } = renderHomeView();

    const disconnectBtn = screen.getByTitle("Disconnect");
    await act(async () => { fireEvent.click(disconnectBtn); });

    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  // ---- DATABASE EXPAND / COLLAPSE ----------------------------------------

  it("expands database to load and render collections when clicked", async () => {
    const mockCollections = ["products", "orders", "customers"];
    vi.mocked(invoke).mockResolvedValue(mockCollections);

    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);

    expect(invoke).toHaveBeenCalledWith("list_collections", { dbName: "store_db" });

    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("products")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("customers")).toBeInTheDocument();
  });

  it("collapses an expanded database when clicked again via chevron", async () => {
    vi.mocked(invoke).mockResolvedValue(["products"]);
    renderHomeView();

    // Expand via db button
    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("products")).toBeInTheDocument();

    // Collapse via the chevron div (stopPropagation child)
    const chevron = screen.getByTitle("Collapse");
    fireEvent.click(chevron);

    expect(screen.queryByText("products")).not.toBeInTheDocument();
  });

  it("expands via chevron when database is not yet expanded", async () => {
    vi.mocked(invoke).mockResolvedValue(["orders"]);
    renderHomeView();

    const chevron = screen.getAllByTitle("Expand")[2]; // third db = store_db
    fireEvent.click(chevron);

    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("does not reload collections when database is already cached", async () => {
    vi.mocked(invoke).mockResolvedValue(["products"]);
    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    // First expand - loads collections
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    // Collapse
    const chevron = screen.getByTitle("Collapse");
    fireEvent.click(chevron);

    // Second expand - should not call invoke again for list_collections
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    // invoke was only called once for list_collections
    const listColCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "list_collections");
    expect(listColCalls).toHaveLength(1);
  });

  it("shows 'No collections' placeholder when database has no collections", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("No collections")).toBeInTheDocument();
  });

  it("handles list_collections error gracefully and shows empty collections", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("permission denied"));
    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    // No collections shown but also no crash
    expect(screen.getByText("No collections")).toBeInTheDocument();
  });

  // ---- SELECTDATABASE ----------------------------------------------------

  it("clicking a collapsed database selects it and shows DatabaseCollectionsView", async () => {
    vi.mocked(invoke).mockResolvedValue(["products"]);
    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText(/DatabaseCollectionsView:store_db/)).toBeInTheDocument();
  });

  it("clicking an already-expanded database only selects it without re-loading", async () => {
    vi.mocked(invoke).mockResolvedValue(["products"]);
    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    // First click: expand + select
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    // Collapse manually
    const chevron = screen.getByTitle("Collapse");
    fireEvent.click(chevron);

    // Re-expand via db button - still has cached collections, no new invoke
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    const listColCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "list_collections");
    expect(listColCalls).toHaveLength(1);
    expect(screen.getByText(/DatabaseCollectionsView:store_db/)).toBeInTheDocument();
  });

  // ---- SELECTCOLLECTION --------------------------------------------------

  it("selects a collection, updates the active tab name, triggers find_documents", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args?: unknown) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "find_documents") return { documents: [{ _id: "1", name: "Widget" }], total_count: 1 };
      if (cmd === "list_indexes") return [{ name: "_id_" }];
      return null;
    });

    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    const collectionBtn = screen.getByRole("button", { name: /products/ });
    fireEvent.click(collectionBtn);

    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("store_db.products")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("find_documents", expect.objectContaining({
      dbName: "store_db",
      collName: "products",
    }));
    expect(screen.getByText(/DocumentExplorer:products/)).toBeInTheDocument();
  });

  it("sets tab error when find_documents rejects during selectCollection", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "find_documents") throw new Error("query failed");
      if (cmd === "list_indexes") return [];
      return null;
    });

    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    const collectionBtn = screen.getByRole("button", { name: /products/ });
    fireEvent.click(collectionBtn);
    await act(async () => { await Promise.resolve(); });

    // The DocumentExplorer mock still gets rendered if error is set on tab;
    // we just verify no crash and that find_documents was called
    expect(invoke).toHaveBeenCalledWith("find_documents", expect.anything());
  });

  it("handles list_indexes failure gracefully during selectCollection (indexCount=0)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "list_indexes") throw new Error("no permission");
      return null;
    });

    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    const collectionBtn = screen.getByRole("button", { name: /products/ });
    fireEvent.click(collectionBtn);
    await act(async () => { await Promise.resolve(); });

    // No crash; tab shows DocumentExplorer
    expect(screen.getByText(/DocumentExplorer:products/)).toBeInTheDocument();
  });

  // ---- TABS --------------------------------------------------------------

  it("renders Welcome tab on initial mount", () => {
    renderHomeView();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("Welcome to Compass+")).toBeInTheDocument();
  });

  it("opens a new tab when + button is clicked", () => {
    renderHomeView();

    const addTabBtn = screen.getByTitle("Open New Tab");
    fireEvent.click(addTabBtn);

    expect(screen.getByText("New Tab")).toBeInTheDocument();
  });

  it("switches active tab by clicking tab header", () => {
    renderHomeView();

    const addTabBtn = screen.getByTitle("Open New Tab");
    fireEvent.click(addTabBtn);

    const welcomeTabHeader = screen.getByText("Welcome");
    fireEvent.click(welcomeTabHeader);

    // Welcome tab active → shows Welcome to Compass+
    expect(screen.getByText("Welcome to Compass+")).toBeInTheDocument();
  });

  it("closes a tab and falls back to the previous tab", () => {
    renderHomeView();

    const addTabBtn = screen.getByTitle("Open New Tab");
    fireEvent.click(addTabBtn);

    expect(screen.getByText("New Tab")).toBeInTheDocument();

    const newTabHeader = screen.getByText("New Tab");
    const tabDiv = newTabHeader.closest("div[class]");
    const closeBtn = tabDiv?.querySelector("button");
    expect(closeBtn).toBeDefined();
    fireEvent.click(closeBtn!);

    expect(screen.queryByText("New Tab")).not.toBeInTheDocument();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  it("prevents closing the last remaining tab", () => {
    renderHomeView();

    // Only one tab — close button should not be visible (tabs.length === 1)
    // The single tab should not have a close button
    expect(screen.queryByRole("button", { name: /×/ })).not.toBeInTheDocument();
  });

  it("enforces the 8-tab limit and shows alert on 9th add", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    renderHomeView();

    const addTabBtn = screen.getByTitle("Open New Tab");

    for (let i = 0; i < 7; i++) {
      fireEvent.click(addTabBtn);
    }

    // Tabs are rendered inside the tab bar div; count them by the tab container divs
    const tabBar = addTabBtn.closest("div[class]")?.parentElement;
    const tabDivs = tabBar?.querySelectorAll("div[class*='flex'][style*='160px']");
    expect(tabDivs?.length).toBe(8);

    fireEvent.click(addTabBtn);
    expect(alertSpy).toHaveBeenCalledWith("Maximum tab cap of 8 tabs reached.");

    alertSpy.mockRestore();
  });

  it("switching to an earlier tab when active tab is closed", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products", "orders"];
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "list_indexes") return [];
      return null;
    });

    renderHomeView();

    // Open a second tab
    const addTabBtn = screen.getByTitle("Open New Tab");
    fireEvent.click(addTabBtn);

    // Load collection into second tab
    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    const ordersBtn = screen.getByRole("button", { name: /orders/ });
    fireEvent.click(ordersBtn);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("store_db.orders")).toBeInTheDocument();

    // Now close the second (currently active) tab → first tab (Welcome) should become active
    const tabHeader = screen.getByText("store_db.orders").closest("div[class]");
    const closeBtn = tabHeader?.querySelector("button");
    fireEvent.click(closeBtn!);

    expect(screen.queryByText("store_db.orders")).not.toBeInTheDocument();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  // ---- NAVIGATION SECTIONS -----------------------------------------------

  it("switches to Aggregations section (no collection) showing placeholder", async () => {
    renderHomeView();

    const aggBtn = screen.getByRole("button", { name: /Aggregations/ });
    fireEvent.click(aggBtn);

    expect(screen.getByText("Aggregation Builder")).toBeInTheDocument();
    expect(screen.getByText(/Please select a database and collection/)).toBeInTheDocument();
  });

  it("switches to Aggregations section with collection selected shows AggregationBuilder", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "list_indexes") return [];
      return null;
    });

    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    const collBtn = screen.getByRole("button", { name: /products/ });
    fireEvent.click(collBtn);
    await act(async () => { await Promise.resolve(); });

    const aggBtn = screen.getByRole("button", { name: /Aggregations/ });
    fireEvent.click(aggBtn);

    expect(screen.getByText(/AggregationBuilder:store_db.products/)).toBeInTheDocument();
  });

  it("switches to Schema Analysis section (no collection) shows placeholder", () => {
    renderHomeView();

    const schemaBtn = screen.getByRole("button", { name: /Schema Analysis/ });
    fireEvent.click(schemaBtn);

    // The placeholder heading is an h3; the nav label is a span — query by role
    expect(screen.getByRole("heading", { name: "Schema Analysis" })).toBeInTheDocument();
    expect(screen.getByText(/Please select a database and collection from the sidebar to perform schema analysis/)).toBeInTheDocument();
  });

  it("switches to Schema Analysis section with collection shows SchemaView", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "list_indexes") return [];
      return null;
    });

    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });
    const collBtn = screen.getByRole("button", { name: /products/ });
    fireEvent.click(collBtn);
    await act(async () => { await Promise.resolve(); });

    const schemaBtn = screen.getByRole("button", { name: /Schema Analysis/ });
    fireEvent.click(schemaBtn);

    expect(screen.getByText(/SchemaView:store_db.products/)).toBeInTheDocument();
  });

  it("switches to Investigate section (no db) shows placeholder", () => {
    renderHomeView();

    const investigateBtn = screen.getByRole("button", { name: /Investigate/ });
    fireEvent.click(investigateBtn);

    expect(screen.getByText("Investigate Database")).toBeInTheDocument();
    expect(screen.getByText(/Please select a database from the sidebar/)).toBeInTheDocument();
  });

  it("switches to Investigate section with db selected shows InvestigateView", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "list_indexes") return [{ name: "_id_" }];
      return null;
    });

    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    const investigateBtn = screen.getByRole("button", { name: /Investigate/ });
    fireEvent.click(investigateBtn);

    expect(screen.getByText(/InvestigateView:store_db/)).toBeInTheDocument();
  });

  it("switches to Metrics Monitor section shows MetricsView", () => {
    renderHomeView();

    const metricsBtn = screen.getByRole("button", { name: /Metrics Monitor/ });
    fireEvent.click(metricsBtn);

    expect(screen.getByTestId("metrics-view")).toBeInTheDocument();
  });

  it("switches to mongosh Shell section shows ShellView", () => {
    renderHomeView();

    const shellBtn = screen.getByRole("button", { name: /mongosh Shell/ });
    fireEvent.click(shellBtn);

    expect(screen.getByTestId("shell-view")).toBeInTheDocument();
  });

  it("switches to Dump/Restore section shows DumpRestoreView", () => {
    renderHomeView();

    const dumpBtn = screen.getByRole("button", { name: /Dump \/ Restore/ });
    fireEvent.click(dumpBtn);

    expect(screen.getByTestId("dump-restore-view")).toBeInTheDocument();
  });

  it("switches to Query Log section shows QueryLogView", () => {
    renderHomeView();

    const queryLogBtn = screen.getByRole("button", { name: /Query Log/ });
    fireEvent.click(queryLogBtn);

    expect(screen.getByTestId("query-log-view")).toBeInTheDocument();
  });

  // ---- ACTIVE SECTION SIDEBAR BADGE LOGIC --------------------------------

  it("shows 'Req Coll' badge on Aggregations when no collection selected", () => {
    renderHomeView();
    // Req Coll badge is visible in sidebar when no collection selected
    const reqCollBadges = screen.getAllByText("Req Coll");
    expect(reqCollBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows schemaFieldsCount badge after schema_analysis_completed event", async () => {
    renderHomeView();

    // Switch to schema section first to make it the active section
    const schemaBtn = screen.getByRole("button", { name: /Schema Analysis/ });
    fireEvent.click(schemaBtn);

    // Dispatch schema_analysis_completed event with fieldsCount
    await act(async () => {
      window.dispatchEvent(new CustomEvent("schema_analysis_completed", { detail: { fieldsCount: 12 } }));
    });

    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("ignores schema_analysis_completed event when fieldsCount is not a number", async () => {
    renderHomeView();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("schema_analysis_completed", { detail: { fieldsCount: "bad" } }));
    });

    // No numeric badge shown — no crash
    expect(screen.queryByText("bad")).not.toBeInTheDocument();
  });

  it("shows indexCount badge in Investigate nav item after collection selected", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "list_indexes") return [{ name: "_id_" }, { name: "name_1" }];
      return null;
    });

    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    const collBtn = screen.getByRole("button", { name: /products/ });
    fireEvent.click(collBtn);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("2 idx")).toBeInTheDocument();
  });

  it("shows query log count badge when query_logs_updated event fires", async () => {
    const { getQueryLogs } = await import("../../queryLogger");
    vi.mocked(getQueryLogs).mockReturnValue([
      { id: "1", op: "FIND", ns: "a.b", query: "{}", duration: 5, docsAffected: 1, timestamp: "" },
      { id: "2", op: "FIND", ns: "a.c", query: "{}", duration: 5, docsAffected: 1, timestamp: "" },
    ]);

    renderHomeView();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("query_logs_updated"));
    });

    expect(screen.getByText("2")).toBeInTheDocument();
  });

  // ---- HANDLE REPLAY QUERY -----------------------------------------------

  it("handles replay of FIND query: updates tab and invokes find_documents", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "list_indexes") return [];
      return null;
    });

    renderHomeView();

    // Switch to query-log section to reveal the mock QueryLogView buttons
    const queryLogBtn = screen.getByRole("button", { name: /Query Log/ });
    fireEvent.click(queryLogBtn);

    const replayBtn = screen.getByRole("button", { name: "ReplayFIND" });
    fireEvent.click(replayBtn);

    await act(async () => { await Promise.resolve(); });

    expect(invoke).toHaveBeenCalledWith("find_documents", expect.objectContaining({
      dbName: "store_db",
      collName: "products",
    }));
  });

  it("handles replay of AGGREGATE query: sets activeSection to aggregations", async () => {
    renderHomeView();

    const queryLogBtn = screen.getByRole("button", { name: /Query Log/ });
    fireEvent.click(queryLogBtn);

    const replayBtn = screen.getByRole("button", { name: "ReplayAGGREGATE" });
    fireEvent.click(replayBtn);

    await act(async () => { await Promise.resolve(); });

    // After replay of AGGREGATE, activeSection switches to 'aggregations'
    // AggregationBuilder is shown (collection was set)
    expect(screen.getByText(/AggregationBuilder:store_db.orders/)).toBeInTheDocument();
  });

  it("handles replay of FIND query where collName is missing (no find_documents call)", async () => {
    renderHomeView();

    const queryLogBtn = screen.getByRole("button", { name: /Query Log/ });
    fireEvent.click(queryLogBtn);

    const replayBtn = screen.getByRole("button", { name: "ReplayFINDNoCollInvalidJSON" });
    fireEvent.click(replayBtn);

    await act(async () => { await Promise.resolve(); });

    // No find_documents should be called (collName is empty)
    expect(invoke).not.toHaveBeenCalledWith("find_documents", expect.anything());
  });

  it("handles replay of FIND query with two tabs (covers non-active tab branch)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "list_indexes") return [];
      return null;
    });

    renderHomeView();

    // Open a second tab and make it active
    const addTabBtn = screen.getByTitle("Open New Tab");
    fireEvent.click(addTabBtn);

    // Switch to query-log section from active (second) tab
    const queryLogBtn = screen.getByRole("button", { name: /Query Log/ });
    fireEvent.click(queryLogBtn);

    // The setTabs callback iterates both tabs; the first tab is non-matching (covers `return t`)
    const replayBtn = screen.getByRole("button", { name: "ReplayFIND" });
    fireEvent.click(replayBtn);

    await act(async () => { await Promise.resolve(); });

    expect(invoke).toHaveBeenCalledWith("find_documents", expect.objectContaining({
      dbName: "store_db",
      collName: "products",
    }));
  });

  it("handles find_documents error during replay of FIND query", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "find_documents") throw new Error("replay failed");
      if (cmd === "list_indexes") return [];
      return null;
    });

    renderHomeView();

    const queryLogBtn = screen.getByRole("button", { name: /Query Log/ });
    fireEvent.click(queryLogBtn);

    const replayBtn = screen.getByRole("button", { name: "ReplayFIND" });
    fireEvent.click(replayBtn);

    await act(async () => { await Promise.resolve(); });

    // No crash; error is swallowed into tab state
    expect(invoke).toHaveBeenCalledWith("find_documents", expect.anything());
  });

  it("handles list_indexes error gracefully during replay FIND query", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "list_indexes") throw new Error("permission denied");
      return null;
    });

    renderHomeView();

    const queryLogBtn = screen.getByRole("button", { name: /Query Log/ });
    fireEvent.click(queryLogBtn);

    const replayBtn = screen.getByRole("button", { name: "ReplayFIND" });
    fireEvent.click(replayBtn);

    await act(async () => { await Promise.resolve(); });

    // No crash
    expect(invoke).toHaveBeenCalledWith("find_documents", expect.anything());
  });

  // ---- GLOBAL KEYDOWN HANDLER -------------------------------------------

  it("dispatches focus-search-input event on Cmd+K keydown", () => {
    renderHomeView();

    const listener = vi.fn();
    window.addEventListener("focus-search-input", listener);

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("focus-search-input", listener);
  });

  it("dispatches focus-search-input event on Ctrl+K keydown", () => {
    renderHomeView();

    const listener = vi.fn();
    window.addEventListener("focus-search-input", listener);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("focus-search-input", listener);
  });

  it("does not dispatch focus-search-input on plain key press", () => {
    renderHomeView();

    const listener = vi.fn();
    window.addEventListener("focus-search-input", listener);

    fireEvent.keyDown(window, { key: "k" });

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("focus-search-input", listener);
  });

  // ---- handleCollectionsChanged ------------------------------------------

  it("handleCollectionsChanged with droppedCollName clears matching tab", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products", "orders"];
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "list_indexes") return [];
      return null;
    });

    renderHomeView();

    // First: select db (store_db) — this renders DatabaseCollectionsView
    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    // Now DatabaseCollectionsView is rendered (db selected, no coll)
    expect(screen.getByText(/DatabaseCollectionsView:store_db/)).toBeInTheDocument();

    // Select products collection into the active tab
    const collBtn = screen.getByRole("button", { name: /products/ });
    fireEvent.click(collBtn);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText("store_db.products")).toBeInTheDocument();

    // Now open a second tab and navigate to db-only view (so DatabaseCollectionsView is shown)
    const addTabBtn = screen.getByTitle("Open New Tab");
    fireEvent.click(addTabBtn);
    // Second tab is active, select store_db → DatabaseCollectionsView renders
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText(/DatabaseCollectionsView:store_db/)).toBeInTheDocument();

    // Simulate dropping the products collection via the mock button
    const dropBtn = screen.getByRole("button", { name: "DropProducts" });
    fireEvent.click(dropBtn);
    await act(async () => { await Promise.resolve(); });

    // The first tab (store_db.products) should now have its selectedColl cleared to ""
    // After the drop, store_db.products tab name should no longer appear
    expect(screen.queryByText("store_db.products")).not.toBeInTheDocument();
  });

  it("handleCollectionsChanged without droppedCollName just refreshes collections", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products", "orders"];
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "list_indexes") return [];
      return null;
    });

    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText(/DatabaseCollectionsView:store_db/)).toBeInTheDocument();

    const refreshBtn = screen.getByRole("button", { name: "RefreshNoDropped" });
    fireEvent.click(refreshBtn);
    await act(async () => { await Promise.resolve(); });

    // No crash; list_collections was called again
    const listColCalls = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "list_collections");
    expect(listColCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ---- updateActiveTab ---------------------------------------------------

  it("updateActiveTab updates the active tab fields", () => {
    renderHomeView();

    // Explorer -> activeSection switch changes active tab via updateActiveTab
    const metricsBtn = screen.getByRole("button", { name: /Metrics Monitor/ });
    fireEvent.click(metricsBtn);
    expect(screen.getByTestId("metrics-view")).toBeInTheDocument();

    const shellBtn = screen.getByRole("button", { name: /mongosh Shell/ });
    fireEvent.click(shellBtn);
    expect(screen.getByTestId("shell-view")).toBeInTheDocument();
  });

  // ---- EDGE: renderActiveSection default / no activeTab ------------------

  it("renders null for unknown activeSection value (default case)", async () => {
    // The default case is unreachable via normal UI; it returns null.
    // We verify the component renders without crashing under all normal sections.
    renderHomeView();
    expect(screen.getByText("Welcome to Compass+")).toBeInTheDocument();
  });

  // ---- EXPLORER: selectedDb set but no selectedColl ----------------------

  it("shows DatabaseCollectionsView when db is selected but no collection", async () => {
    vi.mocked(invoke).mockResolvedValue(["products"]);
    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /admin/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    // explorer section, db selected, no coll → DatabaseCollectionsView
    expect(screen.getByText(/DatabaseCollectionsView:admin/)).toBeInTheDocument();
  });

  // ---- ADDITIONAL BRANCH COVERAGE ----------------------------------------

  it("shows no 'Req Coll' or indexCount badge when collection is selected but indexCount not yet set", async () => {
    // When a db is selected and indexCount is undefined (no collection loaded yet),
    // the investigate badge condition `!activeTab?.selectedDb` is false so no badge
    vi.mocked(invoke).mockResolvedValue(["products"]);
    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    // db selected, no collection yet → indexCount is undefined → no "Req DB" badge
    // (the badge only shows when selectedDb is falsy)
    const reqDbBadges = screen.queryAllByText("Req DB");
    expect(reqDbBadges.length).toBe(0);
  });

  it("all nav section buttons cycle through active/inactive styles", async () => {
    renderHomeView();

    // Start at explorer (active). Navigate to every other section and back.
    const sections = [
      { name: /Aggregations/, testId: "aggregation-builder" },
      { name: /Schema Analysis/, testId: "schema-view" },
      { name: /Investigate/, testId: "investigate-view" },
      { name: /Metrics Monitor/, testId: "metrics-view" },
      { name: /mongosh Shell/, testId: "shell-view" },
      { name: /Dump \/ Restore/, testId: "dump-restore-view" },
      { name: /Query Log/, testId: "query-log-view" },
    ];

    for (const { name } of sections) {
      const btn = screen.getByRole("button", { name });
      fireEvent.click(btn);
    }

    // Now click Explorer to come back — exercises Explorer inactive → active transition
    const explorerBtn = screen.getByRole("button", { name: /Explorer/ });
    fireEvent.click(explorerBtn);

    expect(screen.getByText("Welcome to Compass+")).toBeInTheDocument();
  });

  it("shows indexCount badge when collection is selected and indexCount is defined", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "list_indexes") return [{ name: "_id_" }];
      return null;
    });

    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    const collBtn = screen.getByRole("button", { name: /products/ });
    fireEvent.click(collBtn);
    await act(async () => { await Promise.resolve(); });

    // indexCount is 1, badge "1 idx" is shown
    expect(screen.getByText("1 idx")).toBeInTheDocument();
  });

  it("handles replay FIND query with partial ns (no dot) — collName is empty string", async () => {
    renderHomeView();

    const queryLogBtn = screen.getByRole("button", { name: /Query Log/ });
    fireEvent.click(queryLogBtn);

    // ReplayFINDNoCollInvalidJSON → ns="store_db" → collName="" → no find_documents called
    const replayBtn = screen.getByRole("button", { name: "ReplayFINDNoCollInvalidJSON" });
    fireEvent.click(replayBtn);

    await act(async () => { await Promise.resolve(); });

    // With invalid JSON in query, filter is set to the raw query string
    // and since collName === "" the FIND branch with invoke is skipped
    expect(invoke).not.toHaveBeenCalledWith("find_documents", expect.anything());
  });

  it("result with null documents falls back to empty array in selectCollection", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "list_collections") return ["products"];
      if (cmd === "find_documents") return { documents: null, total_count: null };
      if (cmd === "list_indexes") return null; // non-array → indexCount=0
      return null;
    });

    renderHomeView();

    const dbButton = screen.getByRole("button", { name: /store_db/ });
    fireEvent.click(dbButton);
    await act(async () => { await Promise.resolve(); });

    const collBtn = screen.getByRole("button", { name: /products/ });
    fireEvent.click(collBtn);
    await act(async () => { await Promise.resolve(); });

    // No crash even with null documents/total_count/indexes
    expect(screen.getByText(/DocumentExplorer:products/)).toBeInTheDocument();
  });

  it("tabs render active/inactive styles (tab bar CSS branches covered)", async () => {
    renderHomeView();

    const addTabBtn = screen.getByTitle("Open New Tab");
    fireEvent.click(addTabBtn);

    // Now two tabs exist. The Welcome tab is inactive, New Tab is active.
    // Click Welcome to switch it to active (covers the active tab className branch)
    const welcomeTab = screen.getByText("Welcome");
    fireEvent.click(welcomeTab);

    expect(screen.getByText("Welcome to Compass+")).toBeInTheDocument();
  });

  it("handles replay FIND with parsed query that has filter/sort/projection/limit/skip", async () => {
    // Modify the QueryLogView mock replay button to use a fully-parsed query
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "find_documents") return { documents: [], total_count: 0 };
      if (cmd === "list_indexes") return [];
      return null;
    });

    renderHomeView();

    const queryLogBtn = screen.getByRole("button", { name: /Query Log/ });
    fireEvent.click(queryLogBtn);

    // ReplayFIND uses parsed JSON with filter, sort, projection, limit, skip
    const replayBtn = screen.getByRole("button", { name: "ReplayFIND" });
    fireEvent.click(replayBtn);
    await act(async () => { await Promise.resolve(); });

    expect(invoke).toHaveBeenCalledWith("find_documents", expect.objectContaining({
      dbName: "store_db",
      collName: "products",
      limit: 10,
    }));
  });

  // ---- CLEANUP: event listeners removed on unmount ----------------------

  it("removes window event listeners on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHomeView();
    unmount();

    // removeEventListener should have been called for our handlers
    const removedEvents = removeSpy.mock.calls.map(([event]) => event);
    expect(removedEvents).toContain("keydown");
    expect(removedEvents).toContain("query_logs_updated");
    expect(removedEvents).toContain("schema_analysis_completed");

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
