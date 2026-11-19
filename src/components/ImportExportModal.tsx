import { useState, useRef } from "react";
import { X, AlertCircle, Check, Loader2, Upload, Download, FileText } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { numberKind, numberText } from "../bsonUtils";

interface ImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  dbName: string;
  collName: string;
  queryFilter: string;
  querySort: string;
  queryProjection: string;
  currentPageDocs: any[];
  onRefresh: () => void;
}

export default function ImportExportModal({
  isOpen,
  onClose,
  dbName,
  collName,
  queryFilter,
  querySort,
  queryProjection,
  currentPageDocs,
  onRefresh,
}: ImportExportModalProps) {
  const [activeTab, setActiveTab] = useState<"import" | "export">("import");
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [successText, setSuccessText] = useState<string | null>(null);

  // Import states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<"json" | "ndjson" | "csv" | "unknown">("unknown");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Export states
  const [exportFormat, setExportFormat] = useState<"json" | "ndjson" | "csv">("json");
  const [exportScope, setExportScope] = useState<"page" | "query">("page");

  if (!isOpen) return null;

  // Simple, robust comma-delimited parser supporting quoted fields
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current);
    return result.map(s => s.replace(/^"|"$/g, '').replace(/""/g, '"'));
  };

  const parseCSV = (text: string): any[] => {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
    if (lines.length === 0) return [];
    const headers = parseCSVLine(lines[0]);
    const results: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      const obj: any = {};
      headers.forEach((header, index) => {
        const rawVal = values[index] !== undefined ? values[index].trim() : "";
        if (rawVal.toLowerCase() === "true") obj[header] = true;
        else if (rawVal.toLowerCase() === "false") obj[header] = false;
        else if (rawVal === "null") obj[header] = null;
        else if (!isNaN(Number(rawVal)) && rawVal !== "") obj[header] = Number(rawVal);
        else obj[header] = rawVal;
      });
      results.push(obj);
    }
    return results;
  };

  const jsonToCSV = (docs: any[]): string => {
    if (docs.length === 0) return "";
    const keys = new Set<string>();
    docs.forEach(doc => {
      Object.keys(doc).forEach(k => keys.add(k));
    });
    const headers = Array.from(keys);

    const csvRows = [];
    csvRows.push(headers.map(h => `"${h.replace(/"/g, '""')}"`).join(","));

    docs.forEach(doc => {
      const values = headers.map(header => {
        const val = doc[header];
        if (val === null || val === undefined) return "";
        // Int64, integral doubles and decimals arrive wrapped ({"$numberLong": …}); CSV gets their digits.
        if (numberKind(val) !== null) return `"${numberText(val)}"`;
        if (typeof val === "object") return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
        return `"${String(val).replace(/"/g, '""')}"`;
      });
      csvRows.push(values.join(","));
    });

    return csvRows.join("\n");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorText(null);
    setSuccessText(null);
    const file = e.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      setDetectedFormat("unknown");
      return;
    }
    setSelectedFile(file);
    const name = file.name.toLowerCase();
    if (name.endsWith(".json")) {
      setDetectedFormat("json");
    } else if (name.endsWith(".ndjson") || name.endsWith(".jsonl")) {
      setDetectedFormat("ndjson");
    } else if (name.endsWith(".csv")) {
      setDetectedFormat("csv");
    } else {
      setDetectedFormat("unknown");
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorText("Please select a file to import.");
      return;
    }

    setLoading(true);
    setErrorText(null);
    setSuccessText(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        let parsedDocs: any[] = [];

        if (detectedFormat === "json") {
          const parsed = JSON.parse(text);
          parsedDocs = Array.isArray(parsed) ? parsed : [parsed];
        } else if (detectedFormat === "ndjson") {
          const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
          parsedDocs = lines.map((line, idx) => {
            try {
              return JSON.parse(line);
            } catch (err: any) {
              throw new Error(`Syntax error at NDJSON line ${idx + 1}: ${err.message}`);
            }
          });
        } else if (detectedFormat === "csv") {
          parsedDocs = parseCSV(text);
        } else {
          try {
            const parsed = JSON.parse(text);
            parsedDocs = Array.isArray(parsed) ? parsed : [parsed];
          } catch (e) {
            const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
            parsedDocs = lines.map(line => JSON.parse(line));
          }
        }

        if (parsedDocs.length === 0) {
          throw new Error("No valid documents found in file.");
        }

        const insertedIds = await invoke<string[]>("insert_many", {
          dbName,
          collName,
          docs: parsedDocs,
        });

        setSuccessText(`Successfully imported ${insertedIds.length} document(s) into ${dbName}.${collName}!`);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        onRefresh();
      } catch (err: any) {
        setErrorText(err.message || String(err));
      } finally {
        setLoading(false);
      }
    };

    reader.onerror = () => {
      setErrorText("Failed to read file.");
      setLoading(false);
    };

    reader.readAsText(selectedFile);
  };

  const handleExportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorText(null);
    setSuccessText(null);

    try {
      let docsToExport: any[] = [];
      if (exportScope === "page") {
        docsToExport = currentPageDocs;
      } else {
        const result = await invoke<{ documents: any[] }>("find_documents", {
          dbName,
          collName,
          filterStr: queryFilter,
          sortStr: querySort,
          projectionStr: queryProjection,
          limit: 0,
          skip: 0,
        });
        docsToExport = result.documents || [];
      }

      if (docsToExport.length === 0) {
        throw new Error("No documents found to export.");
      }

      let content = "";
      let mimeType = "text/plain";
      let extension = "txt";

      if (exportFormat === "json") {
        content = JSON.stringify(docsToExport, null, 2);
        mimeType = "application/json";
        extension = "json";
      } else if (exportFormat === "ndjson") {
        content = docsToExport.map(d => JSON.stringify(d)).join("\n");
        mimeType = "application/x-ndjson";
        extension = "ndjson";
      } else if (exportFormat === "csv") {
        content = jsonToCSV(docsToExport);
        mimeType = "text/csv";
        extension = "csv";
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${collName}_export_${Date.now()}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccessText(`Exported ${docsToExport.length} document(s) successfully!`);
    } catch (err: any) {
      setErrorText(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-[#111827]/10 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#F4F1EC] border-b border-[#111827]/10">
          <div className="flex flex-col">
            <h3 className="font-bold text-sm text-[#111827]">
              Import / Export Data
            </h3>
            <p className="text-[10px] text-[#5B6472]">
              Active target: {dbName}.{collName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[#EBE7DF] rounded-md text-[#5B6472] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#111827]/10 bg-[#FAFAF7]">
          <button
            onClick={() => { setActiveTab("import"); setErrorText(null); setSuccessText(null); }}
            className={`flex-1 py-2 text-xs font-bold transition-colors border-b-2 flex items-center justify-center gap-1.5 ${
              activeTab === "import"
                ? "border-b-[#F2673C] text-[#F2673C] bg-white"
                : "border-b-transparent text-[#5B6472] hover:text-[#111827]"
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            Import Files
          </button>
          <button
            onClick={() => { setActiveTab("export"); setErrorText(null); setSuccessText(null); }}
            className={`flex-1 py-2 text-xs font-bold transition-colors border-b-2 flex items-center justify-center gap-1.5 ${
              activeTab === "export"
                ? "border-b-[#F2673C] text-[#F2673C] bg-white"
                : "border-b-transparent text-[#5B6472] hover:text-[#111827]"
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            Export Collection
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 space-y-4">
          {errorText && (
            <div className="bg-[#FEE2E2] border border-[#DC2626]/10 text-[#721C24] p-3 rounded-lg flex gap-2 text-xs font-semibold animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-[#DC2626] shrink-0" />
              <span>{errorText}</span>
            </div>
          )}

          {successText && (
            <div className="bg-[#DCFCE7] border border-[#16A34A]/10 text-[#15803D] p-3 rounded-lg flex gap-2 text-xs font-semibold animate-fadeIn">
              <Check className="w-4 h-4 text-[#16A34A] shrink-0" />
              <span>{successText}</span>
            </div>
          )}

          {activeTab === "import" ? (
            <form onSubmit={handleImportSubmit} className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] uppercase font-bold text-[#8A93A2]">
                  Select Import File
                </label>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-[#111827]/10 hover:border-[#F2673C]/60 rounded-xl p-6 text-center cursor-pointer transition-colors bg-[#FAFAF7]"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".json,.ndjson,.jsonl,.csv"
                    className="hidden"
                  />
                  <FileText className="w-8 h-8 text-[#8A93A2] mx-auto mb-2" />
                  {selectedFile ? (
                    <div>
                      <p className="text-xs font-bold text-[#111827] truncate max-w-xs mx-auto">
                        {selectedFile.name}
                      </p>
                      <p className="text-[10px] text-[#8A93A2] mt-0.5 font-mono">
                        {(selectedFile.size / 1024).toFixed(1)} KB | Format: <span className="font-bold text-[#F2673C] uppercase">{detectedFormat}</span>
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-bold text-[#5B6472]">
                        Click to select a data file
                      </p>
                      <p className="text-[10px] text-[#8A93A2] mt-0.5">
                        Supports .json, .ndjson, .jsonl, .csv
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#111827]/5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !selectedFile || detectedFormat === "unknown"}
                  className="px-4 py-2 bg-[#F2673C] text-white hover:bg-[#D9491F] disabled:bg-[#8A93A2] font-bold text-xs rounded-md transition-all flex items-center gap-1.5"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      Run Import
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleExportSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase font-bold text-[#8A93A2]">
                    Export Format
                  </label>
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as any)}
                    className="w-full text-xs px-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C] font-semibold"
                  >
                    <option value="json">JSON Array</option>
                    <option value="ndjson">NDJSON (JSON Lines)</option>
                    <option value="csv">CSV (Comma Separated)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase font-bold text-[#8A93A2]">
                    Export Range Scope
                  </label>
                  <select
                    value={exportScope}
                    onChange={(e) => setExportScope(e.target.value as any)}
                    className="w-full text-xs px-3 py-2 border border-[#EBE7DF] bg-[#FAFAF7] rounded-lg focus:outline-none focus:border-[#F2673C] font-semibold"
                  >
                    <option value="page">Current Page Results</option>
                    <option value="query">All Query Matches</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#111827]/5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-[#F2673C] text-white hover:bg-[#D9491F] disabled:bg-[#8A93A2] font-bold text-xs rounded-md transition-all flex items-center gap-1.5"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5" />
                      Run Export
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
