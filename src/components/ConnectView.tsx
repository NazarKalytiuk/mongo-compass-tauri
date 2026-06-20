import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ConnectionPreset, ConnectionInfo } from "../types";
import { Database, Trash2, Link2, AlertCircle } from "lucide-react";

interface ConnectViewProps {
  onConnected: (info: ConnectionInfo, uri: string) => void;
}

const DEFAULT_PRESETS: ConnectionPreset[] = [
  {
    id: "local",
    name: "Local MongoDB",
    uri: "mongodb://localhost:27017",
    color: "#16A34A", // Success green
    createdAt: new Date().toISOString(),
  }
];

const ENV_COLORS = [
  { name: "Production", color: "#DC2626" }, // Crimson red
  { name: "Staging", color: "#D97706" },    // Amber orange
  { name: "Development", color: "#2563EB" },// Info blue
  { name: "Local", color: "#16A34A" },      // Success green
];

export default function ConnectView({ onConnected }: ConnectViewProps) {
  const [uri, setUri] = useState("mongodb://localhost:27017");
  const [name, setName] = useState("My MongoDB");
  const [envColor, setEnvColor] = useState(ENV_COLORS[3].color); // Default: Local (Green)
  const [presets, setPresets] = useState<ConnectionPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Timed diagnostics stages during connect
  const [diagStep, setDiagStep] = useState<string | null>(null);

  // Diagnostics and UI states
  const [diagnostics, setDiagnostics] = useState<any | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [savePreset, setSavePreset] = useState(true);
  const [selectedEnvFilter, setSelectedEnvFilter] = useState("All");

  // Load presets from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("mongo_compass_presets");
    if (saved) {
      try {
        setPresets(JSON.parse(saved));
      } catch (e) {
        setPresets(DEFAULT_PRESETS);
      }
    } else {
      setPresets(DEFAULT_PRESETS);
      localStorage.setItem("mongo_compass_presets", JSON.stringify(DEFAULT_PRESETS));
    }
  }, []);

  const handleConnect = async (targetUri: string) => {
    setLoading(true);
    setError(null);
    setDiagnostics(null);
    setDiagStep("DNS lookup & DNS SRV resolution...");

    const diagTimer = setTimeout(() => {
      setDiagStep("Establishing TCP handshake & TLS socket...");
    }, 800);

    const diagTimer2 = setTimeout(() => {
      setDiagStep("Authenticating credentials & running handshake...");
    }, 1800);

    try {
      const res: ConnectionInfo = await invoke("connect_db", { uri: targetUri });
      clearTimeout(diagTimer);
      clearTimeout(diagTimer2);
      setDiagStep(null);
      
      // Save preset if it's new and savePreset is checked
      if (savePreset) {
        const exists = presets.find((p) => p.uri === targetUri);
        if (!exists) {
          const newPreset: ConnectionPreset = {
            id: Math.random().toString(36).substring(7),
            name: name || "MongoDB Connection",
            uri: targetUri,
            color: envColor,
            createdAt: new Date().toISOString(),
          };
          const updated = [newPreset, ...presets].slice(0, 15);
          setPresets(updated);
          localStorage.setItem("mongo_compass_presets", JSON.stringify(updated));
        }
      }
      
      onConnected(res, targetUri);
    } catch (err) {
      clearTimeout(diagTimer);
      clearTimeout(diagTimer2);
      setDiagStep(null);
      setError(String(err));

      // Trigger diagnostics
      setDiagnosing(true);
      try {
        const diagRes = await invoke<any>("diagnose_uri", { uri: targetUri });
        setDiagnostics(diagRes);
      } catch (diagErr) {
        console.error("Failed to run diagnostics:", diagErr);
      } finally {
        setDiagnosing(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const deletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = presets.filter((p) => p.id !== id);
    setPresets(updated);
    localStorage.setItem("mongo_compass_presets", JSON.stringify(updated));
  };

  // Filter presets by active environment
  const filteredPresets = presets.filter((preset) => {
    if (selectedEnvFilter === "All") return true;
    const envObj = ENV_COLORS.find((e) => e.color === preset.color);
    return envObj ? envObj.name === selectedEnvFilter : false;
  });

  return (
    <div className="flex h-screen bg-[#F2EFEA] font-sans antialiased text-[#111827]">
      {/* Sidebar - Presets & History */}
      <div className="w-80 bg-[#F4F1EC] border-r border-[#111827]/10 flex flex-col justify-between">
        <div className="p-6 overflow-y-auto flex-1">
          <div className="flex items-center gap-2 mb-6">
            <div className="h-8 w-8 bg-gradient-to-tr from-[#F2673C] to-[#F38B3F] rounded-lg flex items-center justify-center shadow-md">
              <Database className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight">Compass+</h1>
              <p className="text-[10px] uppercase font-semibold text-[#5B6472] tracking-wider">Tauri / Rust Edition</p>
            </div>
          </div>

          <h2 className="text-[11px] font-bold text-[#5B6472] uppercase tracking-wider mb-2">
            Recent Connections
          </h2>

          {/* Environment Color Filter Pills */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {["All", ...ENV_COLORS.map(c => c.name)].map((envName) => {
              const matchedColorObj = ENV_COLORS.find(c => c.name === envName);
              const dotColor = matchedColorObj ? matchedColorObj.color : null;
              return (
                <button
                  key={envName}
                  type="button"
                  onClick={() => setSelectedEnvFilter(envName)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all duration-150 cursor-pointer ${
                    selectedEnvFilter === envName
                      ? "border-[#F2673C] bg-[#FEEFE8] text-[#D9491F]"
                      : "border-[#EBE7DF] bg-white text-[#5B6472] hover:bg-[#FAFAF7]"
                  }`}
                >
                  {dotColor && (
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: dotColor }}
                    />
                  )}
                  {envName}
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            {filteredPresets.length === 0 ? (
              <p className="text-xs text-[#8A93A2] italic p-3 text-center border border-dashed border-[#111827]/10 rounded-md">
                No recent connections
              </p>
            ) : (
              filteredPresets.map((preset) => (
                <div
                  key={preset.id}
                  onClick={() => {
                    setUri(preset.uri);
                    setName(preset.name);
                    setEnvColor(preset.color);
                  }}
                  className="group flex items-center justify-between p-3 bg-white hover:bg-[#F0ECE5] rounded-lg shadow-sm border border-l-4 border-t-[#111827]/5 border-r-[#111827]/5 border-b-[#111827]/5 cursor-pointer transition-all duration-200"
                  style={{ borderLeftColor: preset.color }}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="overflow-hidden">
                      <h3 className="text-xs font-semibold truncate text-[#111827]">
                        {preset.name}
                      </h3>
                      <p className="text-[10px] text-[#5B6472] truncate">
                        {preset.uri}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => deletePreset(preset.id, e)}
                    aria-label={`Delete preset ${preset.name}`}
                    className="p-1 hover:bg-[#DC2626]/10 text-[#8A93A2] hover:text-[#DC2626] rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="p-4 border-t border-[#111827]/10 bg-[#EBE7DF]/40 text-center">
          <p className="text-[10px] text-[#8A93A2]">
            Tauri v2 · React 19 · Rust 1.95
          </p>
        </div>
      </div>

      {/* Main Connection Panel */}
      <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
        <div className="w-full max-w-xl bg-white p-8 rounded-xl shadow-lg border border-[#111827]/5 flex flex-col gap-6">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#111827]">Connect to Database</h2>
            <p className="text-xs text-[#5B6472] mt-1">
              Connect to a local or remote MongoDB instance. Supports standard URI formats.{" "}
              <a
                href="https://www.mongodb.com/docs/manual/reference/connection-string/"
                target="_blank"
                rel="noreferrer"
                className="text-[#F2673C] hover:underline"
              >
                Read the URI guide ↗
              </a>
            </p>
          </div>

          {error && (
            <div className="bg-[#FEE2E2] border border-[#DC2626]/10 text-[#721C24] p-4 rounded-lg flex gap-3 text-xs">
              <AlertCircle className="w-5 h-5 text-[#DC2626] shrink-0" />
              <div>
                <span className="font-bold">Connection Error:</span> {error}
              </div>
            </div>
          )}

          {diagnosing && (
            <div className="bg-[#F4F1EC] border border-[#111827]/10 p-4 rounded-lg flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#F2673C] border-t-transparent shrink-0" />
                <span className="text-xs font-semibold text-[#111827]">Running connection diagnostics...</span>
              </div>
            </div>
          )}

          {diagnostics && (
            <div className="bg-white border border-[#111827]/10 rounded-xl p-5 shadow-xs space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#5B6472] border-b border-[#111827]/5 pb-2">
                Connection Diagnostics Report
              </h3>
              <div className="space-y-3.5">
                {[
                  {
                    label: "1. URI Syntax Check",
                    ok: diagnostics.uri_parse_ok,
                    err: diagnostics.uri_parse_error,
                  },
                  {
                    label: "2. DNS Resolution Probe",
                    ok: diagnostics.dns_resolve_ok,
                    err: diagnostics.dns_resolve_error,
                  },
                  {
                    label: "3. TCP Handshake Probe",
                    ok: diagnostics.tcp_connect_ok,
                    err: diagnostics.tcp_connect_error,
                  },
                  {
                    label: "4. MongoDB Authenticated Ping",
                    ok: diagnostics.auth_ok,
                    err: diagnostics.auth_error,
                  },
                ].map((step, idx) => {
                  const isSkipped = step.err?.includes("skipped");
                  return (
                    <div key={idx} className="flex items-start gap-3">
                      <div className="shrink-0 mt-0.5">
                        {step.ok ? (
                          <div className="h-4.5 w-4.5 bg-[#DCFCE7] text-[#16A34A] rounded-full flex items-center justify-center font-bold text-[10px]">
                            ✓
                          </div>
                        ) : isSkipped ? (
                          <div className="h-4.5 w-4.5 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center font-bold text-[10px]">
                            —
                          </div>
                        ) : (
                          <div className="h-4.5 w-4.5 bg-[#FEE2E2] text-[#DC2626] rounded-full flex items-center justify-center font-bold text-[10px]">
                            ✗
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-semibold ${step.ok ? "text-[#111827]" : isSkipped ? "text-[#8A93A2]" : "text-[#DC2626]"}`}>
                          {step.label}
                        </p>
                        {step.err && (
                          <p className="text-[10px] font-mono text-[#5B6472] mt-1 bg-[#FAFAF7] p-2 rounded border border-[#EBE7DF] overflow-x-auto whitespace-pre-wrap leading-relaxed">
                            {step.err}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {loading && diagStep && (
            <div className="bg-[#E0EBFB] border border-[#2563EB]/10 p-4 rounded-lg flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#2563EB] border-t-transparent shrink-0" />
                <span className="text-xs font-semibold text-[#1D4ED8]">Diagnosing connection phase...</span>
              </div>
              <p className="text-xs text-[#5B6472] pl-7 italic">{diagStep}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#5B6472] mb-1.5">
                Preset Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Development Database"
                className="w-full text-xs p-3 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C] focus:bg-white transition-all duration-200"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-[#5B6472] mb-1.5">
                Environment Color
              </label>
              <div className="flex gap-2">
                {ENV_COLORS.map((env) => (
                  <button
                    key={env.name}
                    type="button"
                    onClick={() => setEnvColor(env.color)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold border transition-all duration-200 ${
                      envColor === env.color
                        ? "border-[#F2673C] bg-[#FEEFE8] text-[#D9491F]"
                        : "border-[#EBE7DF] bg-[#FAFAF7] text-[#5B6472] hover:bg-[#F4F1EC]"
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shadow-inner"
                      style={{ backgroundColor: env.color }}
                    />
                    {env.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="connection-uri-input" className="block text-[11px] font-bold uppercase tracking-wider text-[#5B6472] mb-1.5">
                Connection URI String
              </label>
              <div className="relative">
                <input
                  id="connection-uri-input"
                  type="text"
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder="mongodb://localhost:27017"
                  className="w-full text-xs p-3 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg font-mono focus:outline-none focus:border-[#F2673C] focus:bg-white transition-all duration-200 pr-10"
                />
                <Link2 className="absolute right-3.5 top-3.5 h-4 w-4 text-[#8A93A2]" />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#111827]/5">
            <label className="flex items-center gap-2 text-xs font-semibold text-[#1F2937] cursor-pointer">
              <input
                type="checkbox"
                aria-label="Save this connection to presets"
                checked={savePreset}
                onChange={(e) => setSavePreset(e.target.checked)}
                className="accent-[#F2673C] w-4 h-4 rounded"
              />
              <span>Save to recent connections</span>
            </label>
            <button
              onClick={() => handleConnect(uri)}
              disabled={loading || !uri}
              className="px-6 py-3 bg-[#F2673C] text-white hover:bg-[#D9491F] disabled:bg-[#8A93A2] disabled:cursor-not-allowed font-bold text-xs rounded-lg shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
