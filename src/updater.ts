/**
 * In-app updates from GitHub Releases.
 *
 * The updater plugin fetches latest.json from the endpoint in tauri.conf.json and
 * verifies the downloaded artifact against the embedded minisign public key.
 * Installing replaces the app on disk; it only runs the new version after the
 * user chooses to restart, so open work is never cut off.
 */
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

/** Automatic checks: shortly after launch, then periodically. */
export const FIRST_CHECK_DELAY_MS = 5_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 30_000;

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking"; manual: boolean }
  | { kind: "upToDate" }
  | { kind: "available"; version: string; notes: string | null }
  | { kind: "downloading"; version: string; received: number; total: number | null }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

/** Asks the update server for a newer release; null when up to date. */
export function findUpdate(): Promise<Update | null> {
  return check({ timeout: CHECK_TIMEOUT_MS });
}

/**
 * Downloads and installs `update`, reporting progress. Channel messages and the
 * command's reply travel separately, so progress may still arrive after the
 * promise resolved; it is ignored then.
 */
export async function installUpdate(
  update: Update,
  onProgress: (received: number, total: number | null) => void
): Promise<void> {
  let received = 0;
  let total: number | null = null;
  let finished = false;
  try {
    await update.downloadAndInstall((event) => {
      if (finished) return;
      if (event.event === "Started") total = event.data.contentLength ?? null;
      else if (event.event === "Progress") received += event.data.chunkLength;
      onProgress(received, total);
    });
  } finally {
    finished = true;
  }
}

export function restartApp(): Promise<void> {
  return relaunch();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
