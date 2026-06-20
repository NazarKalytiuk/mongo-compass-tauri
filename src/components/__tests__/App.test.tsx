import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import App from "../../App";
import { ConnectionInfo } from "../../types";

// ── Mock child components ──────────────────────────────────────────────────────

// ConnectView receives onConnected — expose a handle so tests can fire it
let capturedOnConnected: ((info: ConnectionInfo, uri: string) => void) | null = null;

vi.mock("../ConnectView", () => ({
  default: ({ onConnected }: { onConnected: (info: ConnectionInfo, uri: string) => void }) => {
    capturedOnConnected = onConnected;
    return <div data-testid="connect-view">ConnectView</div>;
  },
}));

// HomeView receives connectionInfo, uri, onDisconnect — expose handle for disconnect
let capturedOnDisconnect: (() => void) | null = null;

vi.mock("../HomeView", () => ({
  default: ({
    connectionInfo,
    uri,
    onDisconnect,
  }: {
    connectionInfo: ConnectionInfo;
    uri: string;
    onDisconnect: () => void;
  }) => {
    capturedOnDisconnect = onDisconnect;
    return (
      <div data-testid="home-view">
        HomeView version={connectionInfo.version} uri={uri}
      </div>
    );
  },
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("App", () => {
  beforeEach(() => {
    capturedOnConnected = null;
    capturedOnDisconnect = null;
    vi.resetAllMocks();
  });

  it("renders ConnectView initially (not connected)", () => {
    render(<App />);
    expect(screen.getByTestId("connect-view")).toBeInTheDocument();
    expect(screen.queryByTestId("home-view")).not.toBeInTheDocument();
  });

  it("switches to HomeView after onConnected is called with valid info", async () => {
    render(<App />);

    // ConnectView should be mounted and have registered its callback
    expect(capturedOnConnected).not.toBeNull();

    const mockInfo: ConnectionInfo = {
      version: "7.0.0",
      databases: ["admin", "local"],
    };

    await act(async () => {
      capturedOnConnected!(mockInfo, "mongodb://localhost:27017");
    });

    expect(screen.queryByTestId("connect-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("home-view")).toBeInTheDocument();
  });

  it("passes the connection URI to HomeView", async () => {
    render(<App />);

    const mockInfo: ConnectionInfo = {
      version: "8.0.0",
      databases: ["mydb"],
    };

    await act(async () => {
      capturedOnConnected!(mockInfo, "mongodb://prod-server:27017");
    });

    expect(screen.getByText(/uri=mongodb:\/\/prod-server:27017/)).toBeInTheDocument();
  });

  it("passes the version from connectionInfo to HomeView", async () => {
    render(<App />);

    const mockInfo: ConnectionInfo = {
      version: "6.0.5",
      databases: [],
    };

    await act(async () => {
      capturedOnConnected!(mockInfo, "mongodb://host:27017");
    });

    expect(screen.getByText(/version=6\.0\.5/)).toBeInTheDocument();
  });

  it("returns to ConnectView when onDisconnect is called", async () => {
    render(<App />);

    const mockInfo: ConnectionInfo = {
      version: "7.0.0",
      databases: ["admin"],
    };

    await act(async () => {
      capturedOnConnected!(mockInfo, "mongodb://localhost:27017");
    });

    // Confirm we are now in HomeView
    expect(screen.getByTestId("home-view")).toBeInTheDocument();
    expect(capturedOnDisconnect).not.toBeNull();

    await act(async () => {
      capturedOnDisconnect!();
    });

    // Should go back to ConnectView
    expect(screen.getByTestId("connect-view")).toBeInTheDocument();
    expect(screen.queryByTestId("home-view")).not.toBeInTheDocument();
  });

  it("clears connectionInfo and uri after disconnect", async () => {
    render(<App />);

    await act(async () => {
      capturedOnConnected!(
        { version: "8.0.0", databases: ["admin"] },
        "mongodb://prod:27017"
      );
    });

    expect(screen.getByText(/prod/)).toBeInTheDocument();

    await act(async () => {
      capturedOnDisconnect!();
    });

    // ConnectView is back; no HomeView (and no stale prod uri leaking)
    expect(screen.getByTestId("connect-view")).toBeInTheDocument();
    expect(screen.queryByText(/prod/)).not.toBeInTheDocument();
  });

  it("allows reconnecting after a disconnect", async () => {
    render(<App />);

    // Connect
    await act(async () => {
      capturedOnConnected!({ version: "7.0.0", databases: [] }, "mongodb://host1:27017");
    });
    expect(screen.getByTestId("home-view")).toBeInTheDocument();

    // Disconnect
    await act(async () => {
      capturedOnDisconnect!();
    });
    expect(screen.getByTestId("connect-view")).toBeInTheDocument();

    // Reconnect with new info
    await act(async () => {
      capturedOnConnected!({ version: "9.0.0", databases: ["newdb"] }, "mongodb://host2:27017");
    });
    expect(screen.getByTestId("home-view")).toBeInTheDocument();
    expect(screen.getByText(/version=9\.0\.0/)).toBeInTheDocument();
  });
});
