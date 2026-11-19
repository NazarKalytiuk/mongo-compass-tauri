import { Download, RefreshCw, X } from "lucide-react";
import { formatBytes, UpdateState } from "../updater";

interface UpdateNoticeProps {
  state: UpdateState;
  onInstall: () => void;
  onRestart: () => void;
  onDismiss: () => void;
}

/** Corner notice for update availability, download progress and restart. */
export default function UpdateNotice({ state, onInstall, onRestart, onDismiss }: UpdateNoticeProps) {
  if (state.kind === "idle" || (state.kind === "checking" && !state.manual)) return null;

  const dismissible = state.kind === "available" || state.kind === "upToDate" || state.kind === "error";

  return (
    <section
      aria-label="Updates"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-[#111827]/10 bg-white p-3 text-xs text-[#111827] shadow-lg"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          {state.kind === "checking" && <p>Checking for updates…</p>}

          {state.kind === "upToDate" && <p>You have the latest version.</p>}

          {state.kind === "error" && (
            <p role="alert" className="break-words text-[#DC2626]">
              Update failed: {state.message}
            </p>
          )}

          {state.kind === "available" && (
            <>
              <p className="font-semibold">Compass+ {state.version} is available</p>
              {state.notes && (
                <details>
                  <summary className="cursor-pointer text-[#5B6472]">What’s new</summary>
                  <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[#1F2937]">{state.notes}</div>
                </details>
              )}
              <button
                onClick={onInstall}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#F2673C] px-3 py-1.5 font-bold text-white hover:bg-[#D9491F]"
              >
                <Download className="h-3.5 w-3.5" /> Update
              </button>
            </>
          )}

          {state.kind === "downloading" && (
            <>
              <p>
                Downloading {state.version}… {formatBytes(state.received)}
                {state.total ? ` of ${formatBytes(state.total)}` : ""}
              </p>
              {state.total ? (
                <div
                  role="progressbar"
                  aria-label="Update download"
                  aria-valuemin={0}
                  aria-valuemax={state.total}
                  aria-valuenow={state.received}
                  className="h-1.5 overflow-hidden rounded bg-[#EBE7DF]"
                >
                  <div className="h-full bg-[#F2673C]" style={{ width: `${Math.min(100, (state.received / state.total) * 100)}%` }} />
                </div>
              ) : null}
            </>
          )}

          {state.kind === "ready" && (
            <>
              <p>Compass+ {state.version} is installed. Restart to use it.</p>
              <button
                onClick={onRestart}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#F2673C] px-3 py-1.5 font-bold text-white hover:bg-[#D9491F]"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Restart
              </button>
            </>
          )}
        </div>
        {dismissible && (
          <button onClick={onDismiss} aria-label="Dismiss update notice" className="rounded p-0.5 text-[#8A93A2] hover:bg-[#F0ECE5]">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </section>
  );
}
