import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import App from "../../App";
import { findUpdate, installUpdate, restartApp } from "../../updater";

// ConnectView exposes the update props so tests can drive a manual check.
vi.mock("../ConnectView", () => ({
  default: ({ appVersion, onCheckUpdates }: { appVersion?: string | null; onCheckUpdates?: () => void }) => (
    <div>
      <span>version={appVersion ?? "?"}</span>
      <button onClick={onCheckUpdates}>Check for updates</button>
    </div>
  ),
}));
vi.mock("../HomeView", () => ({ default: () => <div /> }));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.2.0") }));

vi.mock("../../updater", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../updater")>();
  return { ...actual, findUpdate: vi.fn(), installUpdate: vi.fn(), restartApp: vi.fn(async () => {}) };
});

const fakeUpdate = (version: string, body?: string) =>
  ({ version, body, close: vi.fn(async () => {}) }) as unknown as import("@tauri-apps/plugin-updater").Update;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe("App – in-app updates", () => {
  beforeEach(() => {
    vi.mocked(findUpdate).mockReset();
    vi.mocked(installUpdate).mockReset();
    vi.mocked(restartApp).mockClear();
  });

  it("shows the running version and reports when it is the latest", async () => {
    vi.mocked(findUpdate).mockResolvedValue(null);
    render(<App />);
    await settle();
    expect(screen.getByText("version=0.2.0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await settle();
    expect(screen.getByText("You have the latest version.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss update notice" }));
    expect(screen.queryByText("You have the latest version.")).not.toBeInTheDocument();
  });

  it("downloads with progress and restarts only when asked", async () => {
    vi.mocked(findUpdate).mockResolvedValue(fakeUpdate("0.3.0", "- Faster saves\n"));
    let report: (received: number, total: number | null) => void = () => {};
    let finish: () => void = () => {};
    vi.mocked(installUpdate).mockImplementation((_u, onProgress) => {
      report = onProgress;
      return new Promise<void>((resolve) => (finish = resolve));
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await settle();
    expect(screen.getByText("Compass+ 0.3.0 is available")).toBeInTheDocument();
    fireEvent.click(screen.getByText("What’s new"));
    expect(screen.getByText("- Faster saves")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await act(async () => report(5 * 1024 * 1024, 10 * 1024 * 1024));
    expect(screen.getByText("Downloading 0.3.0… 5.0 MB of 10.0 MB")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(5 * 1024 * 1024));

    await act(async () => finish());
    expect(screen.getByText("Compass+ 0.3.0 is installed. Restart to use it.")).toBeInTheDocument();
    expect(restartApp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(restartApp).toHaveBeenCalledTimes(1);
  });

  it("reports a failed manual check and a failed install", async () => {
    vi.mocked(findUpdate).mockRejectedValueOnce(new Error("network unreachable"));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Update failed: network unreachable");

    vi.mocked(findUpdate).mockResolvedValue(fakeUpdate("0.3.0"));
    vi.mocked(installUpdate).mockRejectedValue(new Error("signature verification failed"));
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("Update failed: signature verification failed");
  });
});
