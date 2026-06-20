import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import DatabaseCollectionsView from "../DatabaseCollectionsView";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("DatabaseCollectionsView", () => {
  const mockStats = [
    { name: "users", document_count: 1500, storage_size: 204800, index_count: 2, is_capped: false },
    { name: "logs", document_count: 50000, storage_size: 8192000, index_count: 1, is_capped: true },
    { name: "products", document_count: 250, storage_size: 40960, index_count: 3, is_capped: false },
  ];

  const mockOnSelectCollection = vi.fn();
  const mockOnCollectionsChanged = vi.fn().mockResolvedValue(["users", "logs", "products"]);

  beforeEach(() => {
    vi.resetAllMocks();
    mockOnCollectionsChanged.mockResolvedValue(["users", "logs", "products"]);
  });

  it("renders loader initially and then stats and collection table", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    // Loader is shown
    expect(screen.getByText(/Loading collection statistics.../)).toBeInTheDocument();

    // Wait for api resolution
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText(/Loading collection statistics.../)).not.toBeInTheDocument();

    // Check DB header
    expect(screen.getByText("test_db")).toBeInTheDocument();

    // Check aggregates
    expect(screen.getByText("Collections").nextElementSibling).toHaveTextContent("3");
    expect(screen.getByText("Total Documents").nextElementSibling).toHaveTextContent("51,750");
    expect(screen.getByText("Total Storage Size").nextElementSibling).toHaveTextContent("8.05 MB");
    expect(screen.getByText("Total Indexes").nextElementSibling).toHaveTextContent("6");

    // Check table elements
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("logs")).toBeInTheDocument();
    expect(screen.getByText("products")).toBeInTheDocument();
  });

  it("filters collections by search term", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Search for "prod"
    const searchInput = screen.getByPlaceholderText("Search collections...");
    fireEvent.change(searchInput, { target: { value: "prod" } });

    expect(screen.getByText("products")).toBeInTheDocument();
    expect(screen.queryByText("users")).not.toBeInTheDocument();
    expect(screen.queryByText("logs")).not.toBeInTheDocument();
  });

  it("triggers onSelectCollection when collection link or action button is clicked", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const productsLink = screen.getByRole("button", { name: "products" });
    fireEvent.click(productsLink);

    expect(mockOnSelectCollection).toHaveBeenCalledWith("test_db", "products");
  });

  it("opens create collection modal and submits data", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "create_collection") return null;
      return null;
    });

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Click "Create Collection" to open modal
    const createBtn = screen.getByRole("button", { name: /Create Collection/i });
    fireEvent.click(createBtn);

    expect(screen.getByRole("heading", { name: "Create Collection" })).toBeInTheDocument();

    // Fill out form
    const input = screen.getByPlaceholderText("e.g. users_new");
    fireEvent.change(input, { target: { value: "invoices" } });

    // Submit form
    const createBtns = screen.getAllByRole("button", { name: /Create Collection/i });
    const submitBtn = createBtns.find((btn) => btn.getAttribute("type") === "submit");
    expect(submitBtn).toBeDefined();
    fireEvent.click(submitBtn!);

    await act(async () => {
      await Promise.resolve();
    });

    // Verify invoke call
    expect(invoke).toHaveBeenCalledWith("create_collection", {
      dbName: "test_db",
      name: "invoices",
      capped: false,
      size: null,
      max: null,
    });

    // Verify callback
    expect(mockOnCollectionsChanged).toHaveBeenCalled();

    // Modal is closed
    expect(screen.queryByRole("heading", { name: "Create Collection" })).not.toBeInTheDocument();
  });

  it("opens drop collection modal, requires typing confirmation name, and submits deletion", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "drop_collection") return null;
      return null;
    });

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Find drop button (trash icon) for users
    const trashButtons = screen.getAllByTitle("Drop Collection");
    // Click trash button for 'users' (first one in stats since they are sorted)
    // Sorted order in UI: logs, products, users.
    // Index 0: logs, Index 1: products, Index 2: users
    fireEvent.click(trashButtons[2]);

    // Modal should be open
    expect(screen.getByRole("heading", { name: "Drop Collection" })).toBeInTheDocument();

    const confirmInput = screen.getByPlaceholderText("users");
    const dropBtns = screen.getAllByRole("button", { name: "Drop Collection" });
    const dropBtn = dropBtns.find((btn) => btn.getAttribute("type") === "submit");
    expect(dropBtn).toBeDefined();

    // Drop button should be disabled initially
    expect(dropBtn).toBeDisabled();

    // Type incorrect name
    fireEvent.change(confirmInput, { target: { value: "user" } });
    expect(dropBtn).toBeDisabled();

    // Type correct name
    fireEvent.change(confirmInput, { target: { value: "users" } });
    expect(dropBtn).not.toBeDisabled();

    // Submit
    fireEvent.click(dropBtn!);

    await act(async () => {
      await Promise.resolve();
    });

    // Verify invoke call
    expect(invoke).toHaveBeenCalledWith("drop_collection", {
      dbName: "test_db",
      collName: "users",
    });

    expect(mockOnCollectionsChanged).toHaveBeenCalledWith("users");

    // Modal closed
    expect(screen.queryByRole("heading", { name: "Drop Collection" })).not.toBeInTheDocument();
  });

  // ---- Additional tests to reach ≥90% coverage ----

  it("shows error banner when fetching stats fails", async () => {
    vi.mocked(invoke).mockRejectedValue("Connection refused");

    render(
      <DatabaseCollectionsView
        dbName="fail_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Failed to Load Database Stats")).toBeInTheDocument();
    expect(screen.getByText("Connection refused")).toBeInTheDocument();
  });

  it("shows empty state when no collections exist", async () => {
    vi.mocked(invoke).mockResolvedValue([]);

    render(
      <DatabaseCollectionsView
        dbName="empty_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("No Collections Found")).toBeInTheDocument();
    expect(screen.getByText("Create a collection to get started with this database.")).toBeInTheDocument();
  });

  it("shows empty state when search term matches nothing", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const searchInput = screen.getByPlaceholderText("Search collections...");
    fireEvent.change(searchInput, { target: { value: "zzznomatch" } });

    expect(screen.getByText("No Collections Found")).toBeInTheDocument();
    expect(screen.getByText("Showing 0 collections")).toBeInTheDocument();
  });

  it("sorts collections by name ascending on first click and descending on second", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Default sort is name asc — rows should be logs, products, users
    const nameSortBtn = screen.getByRole("columnheader", { name: /Collection Name/i });

    // Second click → descending (users, products, logs)
    fireEvent.click(nameSortBtn);

    // Third column header click toggles back
    const allRows = screen.getAllByRole("row");
    // row 0 is header; row 1 should now be "users" (desc)
    expect(allRows[1]).toHaveTextContent("users");
    expect(allRows[2]).toHaveTextContent("products");
    expect(allRows[3]).toHaveTextContent("logs");
  });

  it("sorts collections by document_count", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Click Documents header → asc (products 250, users 1500, logs 50000)
    const docSortBtn = screen.getByRole("columnheader", { name: /Documents/i });
    fireEvent.click(docSortBtn);

    const allRows = screen.getAllByRole("row");
    expect(allRows[1]).toHaveTextContent("products");
    expect(allRows[2]).toHaveTextContent("users");
    expect(allRows[3]).toHaveTextContent("logs");

    // Second click → desc
    fireEvent.click(docSortBtn);
    const allRowsDesc = screen.getAllByRole("row");
    expect(allRowsDesc[1]).toHaveTextContent("logs");
    expect(allRowsDesc[2]).toHaveTextContent("users");
    expect(allRowsDesc[3]).toHaveTextContent("products");
  });

  it("sorts collections by storage_size and index_count", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Sort by Storage Size ascending
    const storageSortBtn = screen.getByRole("columnheader", { name: /Storage Size/i });
    fireEvent.click(storageSortBtn);

    let rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("products");
    expect(rows[3]).toHaveTextContent("logs");

    // Sort by Indexes ascending
    const indexSortBtn = screen.getByRole("columnheader", { name: /Indexes/i });
    fireEvent.click(indexSortBtn);

    rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("logs");
    expect(rows[3]).toHaveTextContent("products");
  });

  it("sorts collections by is_capped boolean field", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Sort by Type (is_capped)
    const typeSortBtn = screen.getByRole("columnheader", { name: /Type/i });
    fireEvent.click(typeSortBtn);

    // false=0 before true=1 in asc: users(false), products(false), logs(true) — but order among false ones may vary
    const rows = screen.getAllByRole("row");
    // last row should be logs (is_capped=true → numericValue 1)
    expect(rows[3]).toHaveTextContent("logs");

    // Descending
    fireEvent.click(typeSortBtn);
    const rowsDesc = screen.getAllByRole("row");
    expect(rowsDesc[1]).toHaveTextContent("logs");
  });

  it("clicking Open Collection (ExternalLink) button calls onSelectCollection", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const openButtons = screen.getAllByTitle("Open Collection");
    fireEvent.click(openButtons[0]); // "logs" is first after default name-asc sort

    expect(mockOnSelectCollection).toHaveBeenCalledWith("test_db", "logs");
  });

  it("shows capped and standard badges in collection type column", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Capped")).toBeInTheDocument();
    expect(screen.getAllByText("Standard").length).toBeGreaterThan(0);
  });

  it("formats zero storage size as '0 B'", async () => {
    const statsWithZero = [
      { name: "empty_coll", document_count: 0, storage_size: 0, index_count: 0, is_capped: false },
    ];
    vi.mocked(invoke).mockResolvedValue(statsWithZero);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // 0 B appears in the Total Storage Size card
    expect(screen.getAllByText("0 B").length).toBeGreaterThan(0);
  });

  it("formats large storage size with GB unit", async () => {
    const gbStats = [
      { name: "huge_coll", document_count: 1000000, storage_size: 2 * 1024 * 1024 * 1024, index_count: 5, is_capped: false },
    ];
    vi.mocked(invoke).mockResolvedValue(gbStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // 2 GB should appear
    expect(screen.getAllByText("2 GB").length).toBeGreaterThan(0);
  });

  it("shows create collection modal error when empty name is submitted", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Open modal
    const openCreateBtn = screen.getByRole("button", { name: /Create Collection/i });
    fireEvent.click(openCreateBtn);

    // Try to submit without filling the name (set to whitespace)
    const input = screen.getByPlaceholderText("e.g. users_new");
    fireEvent.change(input, { target: { value: "   " } });

    const createBtns = screen.getAllByRole("button", { name: /Create Collection/i });
    const submitBtn = createBtns.find((btn) => btn.getAttribute("type") === "submit");
    fireEvent.click(submitBtn!);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Collection name is required")).toBeInTheDocument();
    // invoke for create should not have been called
    expect(invoke).not.toHaveBeenCalledWith("create_collection", expect.anything());
  });

  it("shows create collection modal error when invoke throws", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "create_collection") throw new Error("Name already exists");
      return null;
    });

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const openCreateBtn = screen.getByRole("button", { name: /Create Collection/i });
    fireEvent.click(openCreateBtn);

    const input = screen.getByPlaceholderText("e.g. users_new");
    fireEvent.change(input, { target: { value: "duplicatecoll" } });

    const createBtns = screen.getAllByRole("button", { name: /Create Collection/i });
    const submitBtn = createBtns.find((btn) => btn.getAttribute("type") === "submit");
    fireEvent.click(submitBtn!);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Name already exists/)).toBeInTheDocument();
    // Modal stays open
    expect(screen.getByRole("heading", { name: "Create Collection" })).toBeInTheDocument();
  });

  it("creates a capped collection with size and max docs options", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "create_collection") return null;
      return null;
    });

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Open modal
    const openCreateBtn = screen.getByRole("button", { name: /Create Collection/i });
    fireEvent.click(openCreateBtn);

    // Fill name
    const input = screen.getByPlaceholderText("e.g. users_new");
    fireEvent.change(input, { target: { value: "events_cap" } });

    // Enable capped
    const cappedCheckbox = screen.getByRole("checkbox", { name: /Capped Collection/i });
    fireEvent.click(cappedCheckbox);

    // Set max size
    const sizeInput = screen.getByPlaceholderText("e.g. 4096");
    fireEvent.change(sizeInput, { target: { value: "8192" } });

    // Enable max docs
    const maxDocsCheckbox = screen.getByRole("checkbox", { name: /Limit number of documents/i });
    fireEvent.click(maxDocsCheckbox);

    // Set max docs
    const maxDocsInput = screen.getByPlaceholderText("e.g. 5000");
    fireEvent.change(maxDocsInput, { target: { value: "1000" } });

    // Submit
    const createBtns = screen.getAllByRole("button", { name: /Create Collection/i });
    const submitBtn = createBtns.find((btn) => btn.getAttribute("type") === "submit");
    fireEvent.click(submitBtn!);

    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith("create_collection", {
      dbName: "test_db",
      name: "events_cap",
      capped: true,
      size: 8192,
      max: 1000,
    });
  });

  it("creates a capped collection with size but no max docs", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "create_collection") return null;
      return null;
    });

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Open modal
    const openCreateBtn = screen.getByRole("button", { name: /Create Collection/i });
    fireEvent.click(openCreateBtn);

    const input = screen.getByPlaceholderText("e.g. users_new");
    fireEvent.change(input, { target: { value: "capped_no_max" } });

    // Enable capped
    const cappedCheckbox = screen.getByRole("checkbox", { name: /Capped Collection/i });
    fireEvent.click(cappedCheckbox);

    // Set max size
    const sizeInput = screen.getByPlaceholderText("e.g. 4096");
    fireEvent.change(sizeInput, { target: { value: "4096" } });

    // hasMaxDocs stays false, so no max docs input needed
    const createBtns = screen.getAllByRole("button", { name: /Create Collection/i });
    const submitBtn = createBtns.find((btn) => btn.getAttribute("type") === "submit");
    fireEvent.click(submitBtn!);

    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith("create_collection", {
      dbName: "test_db",
      name: "capped_no_max",
      capped: true,
      size: 4096,
      max: null,
    });
  });

  it("closes create collection modal via Close button", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Open modal
    const openCreateBtn = screen.getByRole("button", { name: /Create Collection/i });
    fireEvent.click(openCreateBtn);

    expect(screen.getByRole("heading", { name: "Create Collection" })).toBeInTheDocument();

    // Click Close button
    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);

    expect(screen.queryByRole("heading", { name: "Create Collection" })).not.toBeInTheDocument();
  });

  it("closes create collection modal via Cancel button", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const openCreateBtn = screen.getByRole("button", { name: /Create Collection/i });
    fireEvent.click(openCreateBtn);

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole("heading", { name: "Create Collection" })).not.toBeInTheDocument();
  });

  it("closes drop collection modal via Close button", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      return null;
    });

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const trashButtons = screen.getAllByTitle("Drop Collection");
    fireEvent.click(trashButtons[0]);

    expect(screen.getByRole("heading", { name: "Drop Collection" })).toBeInTheDocument();

    // Find Close button inside the drop modal header
    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);

    expect(screen.queryByRole("heading", { name: "Drop Collection" })).not.toBeInTheDocument();
  });

  it("closes drop collection modal via Cancel button", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      return null;
    });

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const trashButtons = screen.getAllByTitle("Drop Collection");
    fireEvent.click(trashButtons[0]);

    expect(screen.getByRole("heading", { name: "Drop Collection" })).toBeInTheDocument();

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole("heading", { name: "Drop Collection" })).not.toBeInTheDocument();
  });

  it("shows drop collection error when confirmation name does not match", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      return null;
    });

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Open drop modal for logs (first in asc)
    const trashButtons = screen.getAllByTitle("Drop Collection");
    fireEvent.click(trashButtons[0]); // logs

    expect(screen.getByRole("heading", { name: "Drop Collection" })).toBeInTheDocument();

    // Type the wrong name then submit via direct form submit bypass using fireEvent.submit
    const form = screen.getByPlaceholderText("logs").closest("form")!;
    const confirmInput = screen.getByPlaceholderText("logs");
    fireEvent.change(confirmInput, { target: { value: "wrong_name" } });

    // Force submit the form (bypasses disabled attribute)
    fireEvent.submit(form);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Confirmation name does not match")).toBeInTheDocument();
  });

  it("shows drop error when invoke throws during drop", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd, _args) => {
      if (cmd === "get_collections_stats") return mockStats;
      if (cmd === "drop_collection") throw new Error("Drop failed");
      return null;
    });

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const trashButtons = screen.getAllByTitle("Drop Collection");
    fireEvent.click(trashButtons[0]); // logs

    const confirmInput = screen.getByPlaceholderText("logs");
    fireEvent.change(confirmInput, { target: { value: "logs" } });

    const dropBtns = screen.getAllByRole("button", { name: "Drop Collection" });
    const dropBtn = dropBtns.find((btn) => btn.getAttribute("type") === "submit");
    fireEvent.click(dropBtn!);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Drop failed/)).toBeInTheDocument();
    // Modal stays open
    expect(screen.getByRole("heading", { name: "Drop Collection" })).toBeInTheDocument();
  });

  it("re-fetches stats when dbName prop changes", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    const { rerender } = render(
      <DatabaseCollectionsView
        dbName="db_one"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith("get_collections_stats", { dbName: "db_one" });

    vi.mocked(invoke).mockResolvedValue([
      { name: "other_coll", document_count: 10, storage_size: 1024, index_count: 1, is_capped: false },
    ]);

    rerender(
      <DatabaseCollectionsView
        dbName="db_two"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledWith("get_collections_stats", { dbName: "db_two" });
    expect(screen.getByText("other_coll")).toBeInTheDocument();
  });

  it("handles non-array stats response gracefully", async () => {
    // invoke returns null instead of array
    vi.mocked(invoke).mockResolvedValue(null);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    // safeStats falls back to []
    expect(screen.getByText("No Collections Found")).toBeInTheDocument();
    expect(screen.getByText("Collections").nextElementSibling).toHaveTextContent("0");
  });

  it("sorts by name asc on same-field re-click toggles to desc", async () => {
    vi.mocked(invoke).mockResolvedValue(mockStats);

    render(
      <DatabaseCollectionsView
        dbName="test_db"
        onSelectCollection={mockOnSelectCollection}
        onCollectionsChanged={mockOnCollectionsChanged}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const nameSortBtn = screen.getByRole("columnheader", { name: /Collection Name/i });

    // Default is name asc: logs, products, users
    let rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("logs");

    // First click — same field → toggle to desc: users, products, logs
    fireEvent.click(nameSortBtn);
    rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("users");
    expect(rows[3]).toHaveTextContent("logs");

    // Second click → asc again
    fireEvent.click(nameSortBtn);
    rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("logs");
  });
});
