import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ConnectView from "../ConnectView";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri invoke function
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));


/** Saved-connection passwords held by the fake credential store, by connection id. */
const vault = new Map<string, string>();

/** Mirrors src-tauri/src/secrets.rs `split_password`. */
function splitPassword(uri: string): [string, string | null] {
  const m = /^(mongodb(?:\+srv)?:\/\/[^:@/?]*):([^@/?]*)@/.exec(uri);
  return m ? [uri.replace(`${m[1]}:${m[2]}@`, `${m[1]}@`), m[2]!] : [uri, null];
}

/**
 * Fake backend: the connection-password commands behave like the real ones;
 * everything else goes to `impl`.
 */
function mockBackend(impl: (cmd: string, args: any) => unknown = () => null) {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args: any) => {
    switch (cmd) {
      case "strip_password":
        return splitPassword(args.uri)[0];
      case "save_connection_password": {
        const [stripped, password] = splitPassword(args.uri);
        if (password !== null) vault.set(args.connectionId, password);
        return stripped;
      }
      case "delete_connection_password":
        vault.delete(args.connectionId);
        return null;
      default:
        return impl(cmd, args);
    }
  });
}

const connected = (info: object) => mockBackend((cmd) => (cmd === "connect_db" ? info : null));

/** Lets chains of awaited invoke calls settle (timers are faked in this suite). */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

describe("ConnectView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vault.clear();
    mockBackend();
    vi.useFakeTimers();
    // Clear localStorage preset history
    localStorage.clear();
  });

  it("renders connection form correctly with default local URI", () => {
    render(<ConnectView onConnected={() => {}} />);
    
    expect(screen.getByText("Connect to Database")).toBeInTheDocument();
    expect(screen.getByLabelText("Connection URI String")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("mongodb://localhost:27017")).toHaveValue("mongodb://localhost:27017");
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("calls onConnected callback when connection is successful", async () => {
    const mockOnConnected = vi.fn();
    const mockConnectionInfo = {
      version: "8.0.0",
      databases: ["admin", "local", "users"],
    };

    // Mock successful database connection
    connected(mockConnectionInfo);

    render(<ConnectView onConnected={mockOnConnected} />);

    const connectBtn = screen.getByRole("button", { name: "Connect" });
    fireEvent.click(connectBtn);

    // Should immediately show loading indicator
    expect(screen.getByText("Connecting...")).toBeInTheDocument();
    expect(screen.getByText("DNS lookup & DNS SRV resolution...")).toBeInTheDocument();

    // Resolve promise
    await settle();

    expect(invoke).toHaveBeenCalledWith("connect_db", { uri: "mongodb://localhost:27017", connectionId: null });
    expect(mockOnConnected).toHaveBeenCalledWith(mockConnectionInfo);
  });

  it("displays timed diagnostics phases when connection takes time", async () => {
    mockBackend((cmd) => (cmd === "connect_db" ? new Promise(() => {}) : null)); // Never resolves to keep loading active

    render(<ConnectView onConnected={() => {}} />);

    const connectBtn = screen.getByRole("button", { name: "Connect" });
    fireEvent.click(connectBtn);

    // Phase 1 (instant)
    expect(screen.getByText("DNS lookup & DNS SRV resolution...")).toBeInTheDocument();

    // Advance timer to 1000ms (triggers Phase 2)
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Establishing TCP handshake & TLS socket...")).toBeInTheDocument();

    // Advance timer to 2000ms (triggers Phase 3)
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Authenticating credentials & running handshake...")).toBeInTheDocument();
  });

  it("displays error banner when connection fails", async () => {
    const errorMsg = "Auth failed: Authentication failed.";
    mockBackend(() => {
      throw errorMsg;
    });

    render(<ConnectView onConnected={() => {}} />);

    const connectBtn = screen.getByRole("button", { name: "Connect" });
    fireEvent.click(connectBtn);

    // Resolve promise with rejection
    await settle();

    // Check if error is displayed
    expect(screen.getByText(new RegExp(errorMsg))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).not.toBeDisabled();
  });

  it("loads presets from localStorage and displays them in the sidebar", () => {
    const mockPresets = [
      {
        id: "prod-db",
        name: "Prod Database",
        uri: "mongodb://prod-url:27017",
        color: "#DC2626",
        createdAt: new Date().toISOString(),
      },
    ];
    localStorage.setItem("mongo_compass_presets", JSON.stringify(mockPresets));

    render(<ConnectView onConnected={() => {}} />);

    expect(screen.getByText("Prod Database")).toBeInTheDocument();
    expect(screen.getByText("mongodb://prod-url:27017")).toBeInTheDocument();
  });

  it("populates connection fields when clicking on a preset in the sidebar", () => {
    const mockPresets = [
      {
        id: "prod-db",
        name: "Prod Database",
        uri: "mongodb://prod-url:27017",
        color: "#DC2626",
        createdAt: new Date().toISOString(),
      },
    ];
    localStorage.setItem("mongo_compass_presets", JSON.stringify(mockPresets));

    render(<ConnectView onConnected={() => {}} />);

    const presetItem = screen.getByText("Prod Database");
    fireEvent.click(presetItem);

    expect(screen.getByPlaceholderText("mongodb://localhost:27017")).toHaveValue("mongodb://prod-url:27017");
    expect(screen.getByPlaceholderText("e.g., Development Database")).toHaveValue("Prod Database");
  });

  it("removes preset from UI and localStorage when clicking delete icon", () => {
    const mockPresets = [
      {
        id: "prod-db",
        name: "Prod Database",
        uri: "mongodb://prod-url:27017",
        color: "#DC2626",
        createdAt: new Date().toISOString(),
      },
    ];
    localStorage.setItem("mongo_compass_presets", JSON.stringify(mockPresets));

    render(<ConnectView onConnected={() => {}} />);

    expect(screen.getByText("Prod Database")).toBeInTheDocument();

    const deleteBtn = screen.getByRole("button", { name: "Delete preset Prod Database" });
    fireEvent.click(deleteBtn);

    expect(screen.queryByText("Prod Database")).not.toBeInTheDocument();
    
    const stored = JSON.parse(localStorage.getItem("mongo_compass_presets") || "[]");
    expect(stored).toHaveLength(0);
  });

  it("displays diagnostics report when connection fails", async () => {
    const errorMsg = "Connection failed.";
    mockBackend(async (cmd) => {
      if (cmd === "connect_db") {
        throw new Error(errorMsg);
      }
      if (cmd === "diagnose_uri") {
        return {
          uri_parse_ok: true,
          uri_parse_error: null,
          dns_resolve_ok: false,
          dns_resolve_error: "DNS resolve failed",
          tcp_connect_ok: false,
          tcp_connect_error: "TCP connection skipped",
          auth_ok: false,
          auth_error: "Auth skipped",
        };
      }
      return null;
    });

    render(<ConnectView onConnected={() => {}} />);

    const connectBtn = screen.getByRole("button", { name: "Connect" });
    fireEvent.click(connectBtn);

    await settle();

    // wait for diagnose_uri promise to resolve
    await settle();

    expect(screen.getByText("Connection Diagnostics Report")).toBeInTheDocument();
    expect(screen.getByText("1. URI Syntax Check")).toBeInTheDocument();
    expect(screen.getByText("2. DNS Resolution Probe")).toBeInTheDocument();
    expect(screen.getByText("DNS resolve failed")).toBeInTheDocument();
  });

  it("filters presets by environment color filter pill in sidebar", async () => {
    const mockPresets = [
      {
        id: "prod-db",
        name: "Prod Database",
        uri: "mongodb://prod-url:27017",
        color: "#DC2626", // Production color
        createdAt: new Date().toISOString(),
      },
      {
        id: "local-db",
        name: "Local Database",
        uri: "mongodb://localhost:27017",
        color: "#16A34A", // Local color
        createdAt: new Date().toISOString(),
      },
    ];
    localStorage.setItem("mongo_compass_presets", JSON.stringify(mockPresets));

    render(<ConnectView onConnected={() => {}} />);

    // Both are initially visible
    expect(screen.getByText("Prod Database")).toBeInTheDocument();
    expect(screen.getByText("Local Database")).toBeInTheDocument();

    // Click Production pill
    const prodPill = screen.getAllByRole("button", { name: "Production" })[0];
    await act(async () => {
      fireEvent.click(prodPill);
    });

    // Only Prod Database should be visible
    expect(screen.getByText("Prod Database")).toBeInTheDocument();
    expect(screen.queryByText("Local Database")).not.toBeInTheDocument();

    // Click All pill
    const allPill = screen.getByRole("button", { name: "All" });
    await act(async () => {
      fireEvent.click(allPill);
    });

    // Both visible again
    expect(screen.getByText("Prod Database")).toBeInTheDocument();
    expect(screen.getByText("Local Database")).toBeInTheDocument();
  });

  it("respects the save Preset checkbox and does not save connection when unchecked", async () => {
    const mockOnConnected = vi.fn();
    connected({
      version: "8.0.0",
      databases: ["admin"],
    });

    render(<ConnectView onConnected={mockOnConnected} />);

    // Uncheck save checkbox
    const checkbox = screen.getByLabelText("Save this connection to presets");
    expect(checkbox).toBeChecked();
    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect(checkbox).not.toBeChecked();

    const connectBtn = screen.getByRole("button", { name: "Connect" });
    fireEvent.click(connectBtn);

    await settle();

    // Preset should not be in localStorage (except default Local MongoDB if set by default)
    const stored = JSON.parse(localStorage.getItem("mongo_compass_presets") || "[]");
    const found = stored.find((p: any) => p.uri === "mongodb://localhost:27017" && p.id !== "local");
    expect(found).toBeUndefined();
  });

  it("falls back to DEFAULT_PRESETS when localStorage contains invalid JSON", () => {
    // Line 49-52 branch: JSON.parse throws — catch sets DEFAULT_PRESETS
    localStorage.setItem("mongo_compass_presets", "{ not valid json {{");

    render(<ConnectView onConnected={() => {}} />);

    // DEFAULT_PRESETS includes 'Local MongoDB'
    expect(screen.getByText("Local MongoDB")).toBeInTheDocument();
  });

  it("saves a new preset to localStorage on successful connect with a non-duplicate URI", async () => {
    // Line 92 branch: savePreset=true, URI does not already exist in presets
    const mockOnConnected = vi.fn();
    connected({ version: "8.0.0", databases: [] });

    render(<ConnectView onConnected={mockOnConnected} />);

    // Change URI to something not in DEFAULT_PRESETS
    const uriInput = screen.getByLabelText("Connection URI String");
    fireEvent.change(uriInput, { target: { value: "mongodb://newhost:27017" } });

    const connectBtn = screen.getByRole("button", { name: "Connect" });
    fireEvent.click(connectBtn);

    await settle();

    const stored = JSON.parse(localStorage.getItem("mongo_compass_presets") || "[]");
    expect(stored.some((p: any) => p.uri === "mongodb://newhost:27017")).toBe(true);
  });

  it("does not create a duplicate preset when URI already exists in presets", async () => {
    const mockOnConnected = vi.fn();
    const existingPresets = [
      {
        id: "existing",
        name: "Existing Connection",
        uri: "mongodb://localhost:27017",
        color: "#16A34A",
        createdAt: new Date().toISOString(),
      },
    ];
    localStorage.setItem("mongo_compass_presets", JSON.stringify(existingPresets));

    connected({ version: "8.0.0", databases: [] });

    render(<ConnectView onConnected={mockOnConnected} />);

    // Connect with a URI that already has a preset
    const connectBtn = screen.getByRole("button", { name: "Connect" });
    fireEvent.click(connectBtn);

    await settle();

    const stored = JSON.parse(localStorage.getItem("mongo_compass_presets") || "[]");
    const dupes = stored.filter((p: any) => p.uri === "mongodb://localhost:27017");
    expect(dupes).toHaveLength(1);
  });

  it("updates the preset name input when typing in the name field", () => {
    // Line 343: onChange handler for the name input
    render(<ConnectView onConnected={() => {}} />);

    const nameInput = screen.getByPlaceholderText("e.g., Development Database");
    fireEvent.change(nameInput, { target: { value: "Custom Name" } });

    expect(nameInput).toHaveValue("Custom Name");
  });

  it("updates the URI input when typing in the connection URI field", () => {
    // Lines 358-384 region: onChange on the URI input
    render(<ConnectView onConnected={() => {}} />);

    const uriInput = screen.getByLabelText("Connection URI String");
    fireEvent.change(uriInput, { target: { value: "mongodb://custom:27017" } });

    expect(uriInput).toHaveValue("mongodb://custom:27017");
  });

  it("changes environment color when clicking env color buttons", () => {
    // Lines 358-372: env color picker buttons onClick
    render(<ConnectView onConnected={() => {}} />);

    // Click "Production" env color button (there are two — one in filter pills, one in color picker)
    // The color picker buttons in the main panel do NOT have an aria-label; use getAllByRole and pick the second one
    const productionButtons = screen.getAllByRole("button", { name: /^Production$/ });
    // The second button (index 1) is in the env color picker section (not the filter pill)
    fireEvent.click(productionButtons[1]);

    // After clicking Production, the selected color should be #DC2626.
    // The button that was clicked should now have the active styling text class
    // We verify by checking that "Production" button now has the active border class substring
    const activeBtn = productionButtons[1];
    expect(activeBtn.className).toContain("border-[#F2673C]");
  });

  it("falls back to showing diagnostics error if diagnose_uri invoke also fails", async () => {
    // Line 108-110: catch in the diagnose_uri call
    mockBackend(async (cmd) => {
      if (cmd === "connect_db") throw new Error("Connection refused");
      if (cmd === "diagnose_uri") throw new Error("Diagnostics unavailable");
      return null;
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<ConnectView onConnected={() => {}} />);

    const connectBtn = screen.getByRole("button", { name: "Connect" });
    fireEvent.click(connectBtn);

    await settle();
    await settle();

    // Error banner should be shown for the original connection failure
    expect(screen.getByText(/Connection refused/)).toBeInTheDocument();
    // diagnose_uri failure should be logged (not thrown)
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to run diagnostics:",
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it("uses 'MongoDB Connection' as fallback name when name field is empty on save", async () => {
    // Line 85: name || "MongoDB Connection" fallback
    connected({ version: "8.0.0", databases: [] });

    render(<ConnectView onConnected={() => {}} />);

    // Clear the name input
    const nameInput = screen.getByPlaceholderText("e.g., Development Database");
    fireEvent.change(nameInput, { target: { value: "" } });

    // Change URI so it's not a duplicate
    const uriInput = screen.getByLabelText("Connection URI String");
    fireEvent.change(uriInput, { target: { value: "mongodb://empty-name:27017" } });

    const connectBtn = screen.getByRole("button", { name: "Connect" });
    fireEvent.click(connectBtn);

    await settle();

    const stored = JSON.parse(localStorage.getItem("mongo_compass_presets") || "[]");
    const saved = stored.find((p: any) => p.uri === "mongodb://empty-name:27017");
    expect(saved).toBeDefined();
    expect(saved.name).toBe("MongoDB Connection");
  });

  it("shows diagnostics skipped step marker for steps with 'skipped' in error text", async () => {
    // Line 290-299: isSkipped branch in diagnostics report
    mockBackend(async (cmd) => {
      if (cmd === "connect_db") throw new Error("fail");
      if (cmd === "diagnose_uri") {
        return {
          uri_parse_ok: false,
          uri_parse_error: "bad URI",
          dns_resolve_ok: false,
          dns_resolve_error: "skipped due to parse error",
          tcp_connect_ok: false,
          tcp_connect_error: "skipped",
          auth_ok: false,
          auth_error: "skipped",
        };
      }
      return null;
    });

    render(<ConnectView onConnected={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await settle();
    await settle();

    expect(screen.getByText("Connection Diagnostics Report")).toBeInTheDocument();
    expect(screen.getByText("skipped due to parse error")).toBeInTheDocument();
  });

  it("filters presets matching unknown color as unmatched environment", async () => {
    // Line 128-129: envObj is null (color doesn't match any ENV_COLORS) -> returns false
    const mockPresets = [
      {
        id: "custom-color",
        name: "Custom Color DB",
        uri: "mongodb://custom:27017",
        color: "#AABBCC", // Not in ENV_COLORS
        createdAt: new Date().toISOString(),
      },
      {
        id: "prod-db",
        name: "Prod Database",
        uri: "mongodb://prod:27017",
        color: "#DC2626",
        createdAt: new Date().toISOString(),
      },
    ];
    localStorage.setItem("mongo_compass_presets", JSON.stringify(mockPresets));

    render(<ConnectView onConnected={() => {}} />);

    // When "Production" filter is active, custom-color preset should be hidden
    const prodPills = screen.getAllByRole("button", { name: "Production" });
    fireEvent.click(prodPills[0]);

    expect(screen.getByText("Prod Database")).toBeInTheDocument();
    expect(screen.queryByText("Custom Color DB")).not.toBeInTheDocument();
  });

  // ── Passwords live in the OS credential store, never in localStorage ─────────

  describe("connection passwords", () => {
    const info = { version: "8.0.0", databases: [], display_uri: "mongodb://alice:****@db:27017" };
    const stored = () => JSON.parse(localStorage.getItem("mongo_compass_presets") || "[]");

    it("moves passwords saved by older versions into the credential store", async () => {
      localStorage.setItem(
        "mongo_compass_presets",
        JSON.stringify([{ id: "old", name: "Old Prod", uri: "mongodb://alice:s3cret@db:27017/app", color: "#DC2626", createdAt: "" }])
      );
      render(<ConnectView onConnected={() => {}} />);
      await settle();

      expect(vault.get("old")).toBe("s3cret");
      expect(stored()).toEqual([expect.objectContaining({ id: "old", uri: "mongodb://alice@db:27017/app", hasPassword: true })]);
      expect(localStorage.getItem("mongo_compass_presets")).not.toContain("s3cret");
      expect(screen.getByText("mongodb://alice@db:27017/app")).toBeInTheDocument();
      expect(screen.getByLabelText("Password saved in the system keychain")).toBeInTheDocument();
    });

    it("saves a typed password to the credential store and only the bare URI to localStorage", async () => {
      const onConnected = vi.fn();
      connected(info);
      render(<ConnectView onConnected={onConnected} />);
      fireEvent.change(screen.getByLabelText("Connection URI String"), { target: { value: "mongodb://alice:s3cret@db:27017" } });
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      await settle();

      expect(invoke).toHaveBeenCalledWith("connect_db", { uri: "mongodb://alice:s3cret@db:27017", connectionId: null });
      const saved = stored().find((p: any) => p.uri === "mongodb://alice@db:27017");
      expect(saved).toEqual(expect.objectContaining({ hasPassword: true }));
      expect(vault.get(saved.id)).toBe("s3cret");
      expect(localStorage.getItem("mongo_compass_presets")).not.toContain("s3cret");
      expect(onConnected).toHaveBeenCalledWith(info);
    });

    it("connects a saved connection by id so the backend fills in its password", async () => {
      localStorage.setItem(
        "mongo_compass_presets",
        JSON.stringify([{ id: "prod", name: "Prod", uri: "mongodb://alice@db:27017", hasPassword: true, color: "#DC2626", createdAt: "" }])
      );
      connected(info);
      render(<ConnectView onConnected={() => {}} />);
      fireEvent.click(screen.getByText("Prod"));
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      await settle();
      expect(invoke).toHaveBeenCalledWith("connect_db", { uri: "mongodb://alice@db:27017", connectionId: "prod" });
    });

    it("does not use a saved password once the URI is edited", async () => {
      localStorage.setItem(
        "mongo_compass_presets",
        JSON.stringify([{ id: "prod", name: "Prod", uri: "mongodb://alice@db:27017", hasPassword: true, color: "#DC2626", createdAt: "" }])
      );
      connected(info);
      render(<ConnectView onConnected={() => {}} />);
      fireEvent.click(screen.getByText("Prod"));
      fireEvent.change(screen.getByLabelText("Connection URI String"), { target: { value: "mongodb://alice@other:27017" } });
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      await settle();
      expect(invoke).toHaveBeenCalledWith("connect_db", { uri: "mongodb://alice@other:27017", connectionId: null });
    });

    it("forgets the stored password when a saved connection is deleted", async () => {
      vault.set("prod", "s3cret");
      localStorage.setItem(
        "mongo_compass_presets",
        JSON.stringify([{ id: "prod", name: "Prod", uri: "mongodb://alice@db:27017", hasPassword: true, color: "#DC2626", createdAt: "" }])
      );
      render(<ConnectView onConnected={() => {}} />);
      fireEvent.click(screen.getByRole("button", { name: "Delete preset Prod" }));
      await settle();
      expect(vault.has("prod")).toBe(false);
    });
  });
});
