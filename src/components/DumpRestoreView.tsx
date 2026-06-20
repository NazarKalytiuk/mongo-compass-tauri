import { useState, useEffect, useRef } from "react";
import {
  Loader2, Download, Upload, Check, AlertCircle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface DumpRestoreViewProps {
  activeDb?: string;
  activeColl?: string;
  databases?: string[];
}

interface DumpRestorePreset {
  id: string;
  name: string;
  pane: "dump" | "restore";
  db: string;
  collection: string;
  outPath?: string;
  gzip?: boolean;
  oplog?: boolean;
  numParallelCollections?: number;
  inPath?: string;
  drop?: boolean;
  noIndexRestore?: boolean;
  maintainInsertionOrder?: boolean;
  stopOnError?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function DumpRestoreView({
  activeDb = "",
  activeColl = "",
  databases = [],
}: DumpRestoreViewProps) {
  const [activePane, setActivePane] = useState<"dump" | "restore">("dump");
  const [inProgress, setInProgress] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Form selections
  const [selectedDb, setSelectedDb] = useState(activeDb);
  const [selectedColl, setSelectedColl] = useState(activeColl);
  const [collectionsList, setCollectionsList] = useState<string[]>([]);

  // Dump options
  const [outPath, setOutPath] = useState("/Users/nazarkalituk/Desktop/dumps");
  const [gzip, setGzip] = useState(true);
  const [oplog, setOplog] = useState(false);
  const [numParallelCollections, setNumParallelCollections] = useState(4);

  // Restore options
  const [inPath, setInPath] = useState("");
  const [drop, setDrop] = useState(false);
  const [noIndexRestore, setNoIndexRestore] = useState(false);
  const [maintainInsertionOrder, setMaintainInsertionOrder] = useState(true);
  const [stopOnError, setStopOnError] = useState(false);

  // Presets & Dry run & Size estimate states
  const [presetsList, setPresetsList] = useState<DumpRestorePreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [newPresetName, setNewPresetName] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [estimatedSize, setEstimatedSize] = useState<number | null>(null);

  const [logs, setLogs] = useState<string[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Load presets from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("mongo_compass_dump_presets");
    if (saved) {
      try {
        setPresetsList(JSON.parse(saved));
      } catch (e) {
        setPresetsList([]);
      }
    }
  }, []);

  // Fetch estimated size when db/collection changes
  useEffect(() => {
    if (selectedDb && selectedColl) {
      invoke<number>("get_collection_size", { dbName: selectedDb, collName: selectedColl })
        .then((size) => setEstimatedSize(size))
        .catch(() => setEstimatedSize(null));
    } else {
      setEstimatedSize(null);
    }
  }, [selectedDb, selectedColl]);

  // Sync collections when db changes
  useEffect(() => {
    if (selectedDb) {
      invoke<string[]>("list_collections", { dbName: selectedDb })
        .then((res) => setCollectionsList(Array.isArray(res) ? res : []))
        .catch(() => setCollectionsList([]));
    } else {
      setCollectionsList([]);
    }
  }, [selectedDb]);

  // Sync with active tab
  useEffect(() => {
    setSelectedDb(activeDb);
    setSelectedColl(activeColl);
  }, [activeDb, activeColl]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [logs]);

  // Tauri event listeners for streaming logs
  useEffect(() => {
    let unlistenDump: (() => void) | null = null;
    let unlistenRestore: (() => void) | null = null;

    const setup = async () => {
      unlistenDump = await listen<{ text: string }>("dump-log", (e) =>
        setLogs((prev) => [...prev, e.payload.text])
      );
      unlistenRestore = await listen<{ text: string }>("restore-log", (e) =>
        setLogs((prev) => [...prev, e.payload.text])
      );
    };
    setup();

    return () => {
      unlistenDump?.();
      unlistenRestore?.();
    };
  }, []);

  const handleSavePreset = () => {
    if (!newPresetName.trim()) return;
    const isNew = !selectedPresetId;
    const presetId = selectedPresetId || Math.random().toString(36).substring(7);

    const newPreset: DumpRestorePreset = {
      id: presetId,
      name: newPresetName.trim(),
      pane: activePane,
      db: selectedDb,
      collection: selectedColl,
      ...(activePane === "dump"
        ? { outPath, gzip, oplog, numParallelCollections }
        : { inPath, drop, noIndexRestore, maintainInsertionOrder, stopOnError }),
    };

    let updated: DumpRestorePreset[];
    if (isNew) {
      updated = [...presetsList, newPreset];
    } else {
      updated = presetsList.map((p) => (p.id === presetId ? newPreset : p));
    }

    setPresetsList(updated);
    localStorage.setItem("mongo_compass_dump_presets", JSON.stringify(updated));
    setSelectedPresetId(presetId);
  };

  const handleLoadPreset = (id: string) => {
    setSelectedPresetId(id);
    if (!id) {
      setNewPresetName("");
      return;
    }
    const preset = presetsList.find((p) => p.id === id);
    if (!preset) return;

    setNewPresetName(preset.name);
    setSelectedDb(preset.db);
    setSelectedColl(preset.collection);
    
    if (preset.pane !== activePane) {
      setActivePane(preset.pane);
    }

    if (preset.pane === "dump") {
      if (preset.outPath !== undefined) setOutPath(preset.outPath);
      if (preset.gzip !== undefined) setGzip(preset.gzip);
      if (preset.oplog !== undefined) setOplog(preset.oplog);
      if (preset.numParallelCollections !== undefined) setNumParallelCollections(preset.numParallelCollections);
    } else {
      if (preset.inPath !== undefined) setInPath(preset.inPath);
      if (preset.drop !== undefined) setDrop(preset.drop);
      if (preset.noIndexRestore !== undefined) setNoIndexRestore(preset.noIndexRestore);
      if (preset.maintainInsertionOrder !== undefined) setMaintainInsertionOrder(preset.maintainInsertionOrder);
      if (preset.stopOnError !== undefined) setStopOnError(preset.stopOnError);
    }
  };

  const handleDeletePreset = () => {
    if (!selectedPresetId) return;
    const updated = presetsList.filter((p) => p.id !== selectedPresetId);
    setPresetsList(updated);
    localStorage.setItem("mongo_compass_dump_presets", JSON.stringify(updated));
    setSelectedPresetId("");
    setNewPresetName("");
  };

  const triggerProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    setInProgress(true);
    setIsSuccess(false);
    setErrorText(null);
    setLogs([]);

    try {
      if (activePane === "dump") {
        setLogs([`[Compass+] Starting database dump to: ${outPath}...`]);
        await invoke("run_mongodump", {
          db: selectedDb || null,
          collection: selectedColl || null,
          outPath,
          gzip,
          oplog,
          numParallelCollections: numParallelCollections > 0 ? numParallelCollections : null,
          dryRun,
        });
        setIsSuccess(true);
        setLogs((prev) => [...prev, "[Compass+] Database dump completed successfully!"]);
      } else {
        if (!inPath.trim()) throw new Error("Source archive/directory path is required.");
        setLogs([`[Compass+] Starting database restore from: ${inPath}...`]);
        await invoke("run_mongorestore", {
          inPath,
          db: selectedDb || null,
          collection: selectedColl || null,
          drop,
          noIndexRestore,
          maintainInsertionOrder,
          stopOnError,
          dryRun,
        });
        setIsSuccess(true);
        setLogs((prev) => [...prev, "[Compass+] Database restore completed successfully!"]);
      }
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setErrorText(errMsg);
      setLogs((prev) => [...prev, `[Compass+] Error: ${errMsg}`]);
    } finally {
      setInProgress(false);
    }
  };

  const switchPane = (pane: "dump" | "restore") => {
    setActivePane(pane);
    setIsSuccess(false);
    setErrorText(null);
    setLogs([]);
  };

  return (
    <div className="flex-1 flex flex-col bg-[#FAFAF7] h-full overflow-hidden">
      {/* Pane tabs */}
      <div className="bg-[#F4F1EC] border-b border-[#111827]/10 flex items-center shrink-0">
        {(["dump", "restore"] as const).map((pane) => (
          <button
            key={pane}
            onClick={() => switchPane(pane)}
            className={`px-5 py-3 text-xs font-bold border-r border-[#111827]/10 flex items-center gap-2 transition-colors cursor-pointer ${
              activePane === pane
                ? "bg-[#FAFAF7] text-[#F2673C] border-b-2 border-b-[#F2673C]"
                : "text-[#5B6472] hover:bg-[#EBE7DF]/50 hover:text-[#111827]"
            }`}
          >
            {pane === "dump" ? (
              <><Download className="w-3.5 h-3.5" /><span>mongodump (Export Database)</span></>
            ) : (
              <><Upload className="w-3.5 h-3.5" /><span>mongorestore (Import Archive)</span></>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 p-6 overflow-y-auto max-w-2xl w-full mx-auto">
        <form
          onSubmit={triggerProcess}
          className="bg-white p-6 rounded-xl border border-[#111827]/10 shadow-xs space-y-5"
        >
          <h3 className="text-sm font-bold text-[#111827] border-b border-[#111827]/5 pb-2">
            {activePane === "dump" ? "Configure Dump Parameters" : "Configure Restore Parameters"}
          </h3>

          {/* Presets Toolbar */}
          <div className="bg-[#F4F1EC]/60 p-4 rounded-xl border border-[#111827]/5 space-y-3">
            <h4 className="text-[10px] uppercase font-bold text-[#8A93A2] tracking-wider">Configuration Presets</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="presets-select" className="text-[10px] uppercase font-bold text-[#8A93A2]">
                  Load Preset
                </label>
                <select
                  id="presets-select"
                  value={selectedPresetId}
                  onChange={(e) => handleLoadPreset(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-[#EBE7DF] bg-white rounded-lg focus:outline-none focus:border-[#F2673C] font-semibold"
                >
                  <option value="">-- Select a Preset --</option>
                  {presetsList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.pane === "dump" ? "Dump" : "Restore"})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="preset-name-input" className="text-[10px] uppercase font-bold text-[#8A93A2]">
                  Preset Name
                </label>
                <div className="flex gap-2">
                  <input
                    id="preset-name-input"
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    placeholder="e.g. My Backup Preset"
                    className="flex-1 text-xs px-3 py-2 border border-[#EBE7DF] bg-white rounded-lg focus:outline-none focus:border-[#F2673C]"
                  />
                  <button
                    type="button"
                    onClick={handleSavePreset}
                    disabled={!newPresetName.trim()}
                    className="px-3.5 py-2 bg-[#F2673C] text-white hover:bg-[#D9491F] disabled:bg-[#F2673C]/50 font-bold text-xs rounded-lg transition-colors cursor-pointer shadow-2xs"
                  >
                    Save
                  </button>
                  {selectedPresetId && (
                    <button
                      type="button"
                      onClick={handleDeletePreset}
                      className="px-3 py-2 bg-red-600 text-white hover:bg-red-700 font-bold text-xs rounded-lg transition-colors cursor-pointer shadow-2xs"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {/* DB & Collection selectors */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="dump-db-select" className="text-[10px] uppercase font-bold text-[#8A93A2]">
                  Database (Optional)
                </label>
                <select
                  id="dump-db-select"
                  value={selectedDb}
                  onChange={(e) => { setSelectedDb(e.target.value); setSelectedColl(""); }}
                  className="w-full text-xs px-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C] font-semibold"
                >
                  <option value="">-- All Databases --</option>
                  {databases.map((db) => <option key={db} value={db}>{db}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="dump-coll-select" className="text-[10px] uppercase font-bold text-[#8A93A2]">
                  Collection (Optional)
                </label>
                <select
                  id="dump-coll-select"
                  value={selectedColl}
                  disabled={!selectedDb}
                  onChange={(e) => setSelectedColl(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C] font-semibold disabled:opacity-50"
                >
                  <option value="">-- All Collections --</option>
                  {collectionsList.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {estimatedSize !== null && (
                  <div className="text-[10px] text-[#5B6472] font-semibold mt-1 font-mono">
                    <span>Estimated Size: {formatBytes(estimatedSize)}</span>
                    {gzip && (
                      <span className="ml-1.5 text-emerald-600">
                        (Compressed: ~{formatBytes(Math.round(estimatedSize * 0.25))})
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Pane-specific options */}
            {activePane === "dump" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="dump-out-path" className="text-[10px] uppercase font-bold text-[#8A93A2]">
                    Output Path Directory
                  </label>
                  <input
                    id="dump-out-path"
                    type="text"
                    value={outPath}
                    onChange={(e) => setOutPath(e.target.value)}
                    placeholder="e.g. /Users/you/Desktop/dumps"
                    className="w-full text-xs px-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C] font-mono"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-1">
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#1F2937] cursor-pointer">
                    <input
                      type="checkbox"
                      aria-label="Enable Gzip Compression"
                      checked={gzip}
                      onChange={(e) => setGzip(e.target.checked)}
                      className="accent-[#F2673C] w-4 h-4 rounded"
                    />
                    <span>Enable Gzip Compression</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#1F2937] cursor-pointer">
                    <input
                      type="checkbox"
                      aria-label="Dump Oplog (--oplog)"
                      checked={oplog}
                      onChange={(e) => setOplog(e.target.checked)}
                      className="accent-[#F2673C] w-4 h-4 rounded"
                    />
                    <span>Dump Oplog (--oplog)</span>
                  </label>
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#1F2937] col-span-2">
                    <span className="shrink-0">Parallel Collections:</span>
                    <input
                      type="number"
                      min="1"
                      max="16"
                      value={numParallelCollections}
                      onChange={(e) => setNumParallelCollections(parseInt(e.target.value) || 1)}
                      className="w-16 text-xs px-2 py-1 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C] text-center"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="restore-in-path" className="text-[10px] uppercase font-bold text-[#8A93A2]">
                    Source BSON / GZ Archive Path
                  </label>
                  <input
                    id="restore-in-path"
                    type="text"
                    value={inPath}
                    onChange={(e) => setInPath(e.target.value)}
                    placeholder="e.g. /Users/you/Desktop/dumps/store_db"
                    className="w-full text-xs px-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C] font-mono"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-1">
                  {[
                    { label: "Drop collection before restore (--drop)", state: drop, setter: setDrop },
                    { label: "Skip indexes restoring (--noIndexRestore)", state: noIndexRestore, setter: setNoIndexRestore },
                    { label: "Maintain insertion order", state: maintainInsertionOrder, setter: setMaintainInsertionOrder },
                    { label: "Stop on error (--stopOnError)", state: stopOnError, setter: setStopOnError },
                  ].map(({ label, state, setter }) => (
                    <label key={label} className="flex items-center gap-2 text-xs font-semibold text-[#1F2937] cursor-pointer">
                      <input
                        type="checkbox"
                        aria-label={label}
                        checked={state}
                        onChange={(e) => setter(e.target.checked)}
                        className="accent-[#F2673C] w-4 h-4 rounded"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="pt-2 flex items-center justify-between border-t border-[#111827]/5">
            <div className="text-[10px] text-[#8A93A2] font-semibold font-mono">
              {activePane === "dump"
                ? "Parallel dump enabled"
                : "Restores collections, indexes, and BSON data"}
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-semibold text-[#1F2937] cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="Dry Run Only"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  className="accent-[#F2673C] w-4 h-4 rounded"
                />
                <span>Dry Run Only</span>
              </label>
              <button
                type="submit"
                disabled={inProgress}
                className="px-5 py-2 bg-[#F2673C] text-white hover:bg-[#D9491F] disabled:bg-[#F2673C]/50 font-bold text-xs rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                {inProgress ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" />Processing...</>
                ) : activePane === "dump" ? (
                  <><Download className="w-3.5 h-3.5" />Run mongodump</>
                ) : (
                  <><Upload className="w-3.5 h-3.5" />Run mongorestore</>
                )}
              </button>
            </div>
          </div>
        </form>

        {errorText && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3 text-xs shadow-2xs mt-4">
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-bold">Process execution failed</h4>
              <p className="opacity-95 mt-1 leading-relaxed">{errorText}</p>
            </div>
          </div>
        )}

        {(inProgress || logs.length > 0) && (
          <div className="mt-4 bg-[#1B1F27] border border-[#232833] p-4 rounded-xl font-mono text-[10px] text-[#E6E6E6] space-y-1 shadow-md max-h-[200px] overflow-y-auto select-text">
            {logs.map((log, index) => (
              <p
                key={index}
                className={
                  log.startsWith("[Compass+] Error:")
                    ? "text-red-400"
                    : log.startsWith("[Compass+]")
                    ? "text-amber-500 font-bold"
                    : "text-[#E6E6E6]"
                }
              >
                {log}
              </p>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}

        {isSuccess && (
          <div className="mt-4 bg-[#DCFCE7] border border-[#16A34A]/20 p-4 rounded-xl flex gap-3 text-xs text-[#15803D] animate-fadeIn font-semibold">
            <Check className="w-5 h-5 text-[#16A34A] shrink-0" />
            <div>
              <p className="font-bold">
                {activePane === "dump" ? "Database dump finished!" : "Database restore finished!"}
              </p>
              <p className="text-[10px] opacity-80 mt-0.5">
                Output logs generated, files saved successfully.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
