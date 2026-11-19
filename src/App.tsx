import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import ConnectView from "./components/ConnectView";
import HomeView from "./components/HomeView";
import UpdateNotice from "./components/UpdateNotice";
import { ConnectionInfo } from "./types";
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  findUpdate,
  installUpdate,
  restartApp,
  UpdateState,
} from "./updater";
import "./App.css";

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ kind: "idle" });
  // The update found by the last check; it holds a backend resource until closed.
  const pendingUpdate = useRef<Update | null>(null);
  const updateRef = useRef(update);
  updateRef.current = update;

  const handleCheckUpdates = async (manual: boolean) => {
    const current = updateRef.current.kind;
    if (current === "checking" || current === "downloading" || current === "ready") return;
    const before = updateRef.current;
    setUpdate({ kind: "checking", manual });
    try {
      const found = await findUpdate();
      await pendingUpdate.current?.close().catch(() => {});
      pendingUpdate.current = found;
      if (found) setUpdate({ kind: "available", version: found.version, notes: found.body?.trim() || null });
      else setUpdate(manual ? { kind: "upToDate" } : { kind: "idle" });
    } catch (e) {
      // Automatic checks stay quiet (offline laptops are normal); manual ones report.
      if (manual) setUpdate({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      else setUpdate(before.kind === "available" ? before : { kind: "idle" });
    }
  };

  const handleInstallUpdate = async () => {
    const found = pendingUpdate.current;
    if (!found) return;
    setUpdate({ kind: "downloading", version: found.version, received: 0, total: null });
    try {
      await installUpdate(found, (received, total) =>
        setUpdate({ kind: "downloading", version: found.version, received, total })
      );
      setUpdate({ kind: "ready", version: found.version });
    } catch (e) {
      setUpdate({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleDismissUpdate = () => setUpdate({ kind: "idle" });

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
    // Dev builds are not installed bundles, so updating them is meaningless.
    if (!import.meta.env.PROD) return;
    const first = setTimeout(() => void handleCheckUpdates(false), FIRST_CHECK_DELAY_MS);
    const every = setInterval(() => void handleCheckUpdates(false), CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
    // Runs once; the handlers read the latest state through refs.
  }, []);

  const handleConnected = (info: ConnectionInfo) => {
    setConnectionInfo(info);
    setIsConnected(true);
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setConnectionInfo(null);
  };

  const notice = (
    <UpdateNotice
      state={update}
      onInstall={() => void handleInstallUpdate()}
      onRestart={() => void restartApp()}
      onDismiss={handleDismissUpdate}
    />
  );

  if (isConnected && connectionInfo) {
    return (
      <>
        <HomeView connectionInfo={connectionInfo} uri={connectionInfo.display_uri} onDisconnect={handleDisconnect} />
        {notice}
      </>
    );
  }

  return (
    <>
      <ConnectView
        onConnected={handleConnected}
        appVersion={appVersion}
        checkingForUpdates={update.kind === "checking"}
        onCheckUpdates={() => void handleCheckUpdates(true)}
      />
      {notice}
    </>
  );
}
