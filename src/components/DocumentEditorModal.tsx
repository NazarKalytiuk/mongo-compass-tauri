import { useState, useEffect } from "react";
import { X, AlertCircle, Plus, Trash2, Braces, ListTree } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { detectType, formatBsonDate, getNumericValue } from "../bsonUtils";
import { validateAgainstSchema, ValidationError } from "../schemaValidation";

interface DocumentEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (docJson: string) => Promise<void>;
  documentData?: any; // If editing, otherwise undefined (insert mode)
  dbName?: string;
  collName?: string;
}

type FieldType = "string" | "number" | "boolean" | "null" | "date" | "objectId" | "object" | "array";

interface FieldRow {
  id: string;
  key: string;
  type: FieldType;
  value: any; // native for scalars; JSON string for object/array; ISO string for date; hex for objectId
}

const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "null", "date", "objectId", "object", "array"];

let rowCounter = 0;
const nextRowId = () => `row-${rowCounter++}`;

function detectFieldType(v: any): FieldType {
  const t = detectType(v);
  switch (t) {
    case "String": return "string";
    case "Number": return "number";
    case "Boolean": return "boolean";
    case "Null": return "null";
    case "Date": return "date";
    case "ObjectID": return "objectId";
    case "Array": return "array";
    default: return "object";
  }
}

function valueToRowValue(v: any, type: FieldType): any {
  switch (type) {
    case "string": return typeof v === "string" ? v : "";
    case "number": return getNumericValue(v);
    case "boolean": return Boolean(v);
    case "null": return null;
    case "date": return v && typeof v === "object" && "$date" in v ? formatBsonDate(v.$date) : new Date().toISOString();
    case "objectId": return v && typeof v === "object" && "$oid" in v ? v.$oid : "";
    case "object":
    case "array":
      try { return JSON.stringify(v ?? (type === "array" ? [] : {}), null, 2); }
      catch { return type === "array" ? "[]" : "{}"; }
  }
}

function rowToValue(row: FieldRow): any {
  switch (row.type) {
    case "string": return String(row.value ?? "");
    case "number": return Number(row.value ?? 0);
    case "boolean": return Boolean(row.value);
    case "null": return null;
    case "date": return { $date: row.value || new Date().toISOString() };
    case "objectId": return { $oid: row.value || "" };
    case "object":
    case "array":
      try { return JSON.parse(row.value || (row.type === "array" ? "[]" : "{}")); }
      catch { return row.type === "array" ? [] : {}; }
  }
}

function defaultValueForType(type: FieldType): any {
  switch (type) {
    case "string": return "";
    case "number": return 0;
    case "boolean": return false;
    case "null": return null;
    case "date": return new Date().toISOString();
    case "objectId": return "";
    case "object": return "{}";
    case "array": return "[]";
  }
}

function objectToRows(obj: any): FieldRow[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.keys(obj).map((key) => {
    const type = detectFieldType(obj[key]);
    return { id: nextRowId(), key, type, value: valueToRowValue(obj[key], type) };
  });
}

function rowsToObject(rows: FieldRow[]): Record<string, any> {
  const obj: Record<string, any> = {};
  for (const row of rows) {
    if (!row.key.trim()) continue;
    obj[row.key] = rowToValue(row);
  }
  return obj;
}

export default function DocumentEditorModal({
  isOpen,
  onClose,
  onSave,
  documentData,
  dbName,
  collName,
}: DocumentEditorModalProps) {
  const [jsonText, setJsonText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validator, setValidator] = useState<any | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [mode, setMode] = useState<"json" | "fields">("json");
  const [rows, setRows] = useState<FieldRow[]>([]);

  useEffect(() => {
    if (isOpen) {
      if (documentData) {
        try {
          setJsonText(JSON.stringify(documentData, null, 2));
        } catch (e) {
          setJsonText(String(documentData));
        }
      } else {
        setJsonText(JSON.stringify({
          name: "Sample Document",
          status: "active",
          createdAt: { "$date": new Date().toISOString() }
        }, null, 2));
      }
      setError(null);
      setValidationErrors([]);
      setMode("json");
    }
  }, [isOpen, documentData]);

  // Load Validator schema on modal open
  useEffect(() => {
    if (isOpen && dbName && collName) {
      invoke<any>("get_collection_validator", { dbName, collName })
        .then((res) => {
          setValidator(res);
        })
        .catch((err) => {
          console.error("Failed to load collection validator:", err);
          setValidator(null);
        });
    } else {
      setValidator(null);
    }
  }, [isOpen, dbName, collName]);

  // Live validator effect runs when JSON text or schema changes
  useEffect(() => {
    if (!validator) {
      setValidationErrors([]);
      return;
    }
    try {
      const parsed = JSON.parse(jsonText);
      const errors = validateAgainstSchema(parsed, validator);
      setValidationErrors(errors);
    } catch (e) {
      setValidationErrors([]);
    }
  }, [jsonText, validator]);

  if (!isOpen) return null;

  // Original top-level values for change highlighting in edit mode
  const originalValues: Record<string, string> = {};
  if (documentData && typeof documentData === "object") {
    Object.keys(documentData).forEach((k) => {
      try { originalValues[k] = JSON.stringify(documentData[k]); } catch { originalValues[k] = ""; }
    });
  }

  const syncRowsToJson = (nextRows: FieldRow[]) => {
    setRows(nextRows);
    try {
      setJsonText(JSON.stringify(rowsToObject(nextRows), null, 2));
    } catch {
      // keep previous text on serialization failure
    }
  };

  const switchToFields = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Field editor supports a single JSON object only.");
        return;
      }
      setRows(objectToRows(parsed));
      setError(null);
      setMode("fields");
    } catch (err: any) {
      setError(`Cannot switch to field editor — invalid JSON: ${err.message}`);
    }
  };

  const switchToJson = () => {
    setMode("json");
  };

  const updateRow = (id: string, patch: Partial<FieldRow>) => {
    const next = rows.map((r) => {
      if (r.id !== id) return r;
      const merged = { ...r, ...patch };
      // When type changes, reset value to a sensible default for the new type
      if (patch.type && patch.type !== r.type) {
        merged.value = defaultValueForType(patch.type);
      }
      return merged;
    });
    syncRowsToJson(next);
  };

  const addRow = () => {
    syncRowsToJson([...rows, { id: nextRowId(), key: "", type: "string", value: "" }]);
  };

  const removeRow = (id: string) => {
    syncRowsToJson(rows.filter((r) => r.id !== id));
  };

  const rowChangeState = (row: FieldRow): "new" | "changed" | null => {
    if (!documentData) return null;
    if (!(row.key in originalValues)) return row.key.trim() ? "new" : null;
    try {
      return JSON.stringify(rowToValue(row)) !== originalValues[row.key] ? "changed" : null;
    } catch {
      return null;
    }
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (err: any) {
      setError(`Format failed: ${err.message}`);
    }
  };

  const handleSave = async () => {
    setError(null);
    try {
      JSON.parse(jsonText);
    } catch (err: any) {
      setError(`Invalid JSON syntax: ${err.message}`);
      return;
    }

    setSaving(true);
    try {
      await onSave(jsonText);
      onClose();
    } catch (err: any) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleInsertAndClone = async () => {
    setError(null);
    try {
      JSON.parse(jsonText);
    } catch (err: any) {
      setError(`Invalid JSON syntax: ${err.message}`);
      return;
    }

    setSaving(true);
    try {
      await onSave(jsonText);
      try {
        const parsed = JSON.parse(jsonText);
        if (parsed && typeof parsed === "object") {
          delete parsed._id;
          setJsonText(JSON.stringify(parsed, null, 2));
          if (mode === "fields") setRows(objectToRows(parsed));
        }
      } catch {
        // Fallback if parsing fails
      }
    } catch (err: any) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-[#111827]/10 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#F4F1EC] border-b border-[#111827]/10">
          <div className="flex flex-col">
            <h3 className="font-bold text-sm text-[#111827]">
              {documentData ? "Edit Document" : "Insert Document"}
            </h3>
            <p className="text-[10px] text-[#5B6472]">
              Use Extended JSON format for special types like dates and object IDs.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Mode toggle */}
            <div className="flex border border-[#EBE7DF] bg-white rounded-lg p-0.5 shadow-2xs">
              <button
                onClick={switchToJson}
                className={`px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-colors ${
                  mode === "json" ? "bg-[#EBE7DF] text-[#111827]" : "text-[#8A93A2] hover:text-[#5B6472]"
                }`}
                title="JSON editor"
              >
                <Braces className="w-3.5 h-3.5" /> JSON
              </button>
              <button
                onClick={switchToFields}
                className={`px-2 py-1 rounded-md text-[10px] font-bold flex items-center gap-1 transition-colors ${
                  mode === "fields" ? "bg-[#EBE7DF] text-[#111827]" : "text-[#8A93A2] hover:text-[#5B6472]"
                }`}
                title="Field-by-field editor"
              >
                <ListTree className="w-3.5 h-3.5" /> Fields
              </button>
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-[#EBE7DF] rounded-md text-[#5B6472] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content & Editor */}
        <div className="p-6 flex-1 flex flex-col gap-4 overflow-y-auto">
          {error && (
            <div className="bg-[#FEE2E2] border border-[#DC2626]/10 text-[#721C24] p-3 rounded-lg flex gap-2 text-xs">
              <AlertCircle className="w-4 h-4 text-[#DC2626] shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {mode === "json" ? (
            <div className="flex-1 min-h-[250px] flex flex-col">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[#5B6472] mb-1.5">
                Document Buffer (JSON)
              </label>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                className="flex-1 p-4 bg-[#1B1F27] text-[#E6E6E6] font-mono text-xs rounded-lg border border-[#232833] focus:outline-none resize-none leading-relaxed"
                spellCheck={false}
              />
            </div>
          ) : (
            <div className="flex-1 min-h-[250px] flex flex-col">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#5B6472]">
                  Fields ({rows.length})
                </label>
                <button
                  onClick={addRow}
                  className="px-2 py-1 text-[10px] font-bold border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] rounded-md flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add Field
                </button>
              </div>
              <div className="flex-1 overflow-y-auto border border-[#111827]/10 rounded-lg divide-y divide-[#111827]/5">
                {rows.length === 0 ? (
                  <div className="text-center py-10 text-xs text-[#8A93A2]">No fields. Click "Add Field" to start.</div>
                ) : (
                  rows.map((row) => {
                    const change = rowChangeState(row);
                    return (
                      <div
                        key={row.id}
                        className={`flex items-start gap-2 p-2 text-xs ${
                          change === "new" ? "bg-emerald-50" : change === "changed" ? "bg-amber-50" : "bg-white"
                        }`}
                      >
                        <input
                          type="text"
                          value={row.key}
                          onChange={(e) => updateRow(row.id, { key: e.target.value })}
                          placeholder="field"
                          className="w-32 shrink-0 px-2 py-1.5 border border-[#EBE7DF] bg-[#FAFAF7] font-mono rounded-md focus:outline-none focus:border-[#F2673C]"
                        />
                        <select
                          value={row.type}
                          onChange={(e) => updateRow(row.id, { type: e.target.value as FieldType })}
                          className="w-24 shrink-0 px-1.5 py-1.5 border border-[#EBE7DF] bg-white font-semibold rounded-md focus:outline-none focus:border-[#F2673C] cursor-pointer"
                        >
                          {FIELD_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        <div className="flex-1 min-w-0">
                          {row.type === "boolean" ? (
                            <select
                              value={String(row.value)}
                              onChange={(e) => updateRow(row.id, { value: e.target.value === "true" })}
                              className="w-full px-2 py-1.5 border border-[#EBE7DF] bg-white rounded-md focus:outline-none focus:border-[#F2673C] cursor-pointer"
                            >
                              <option value="true">true</option>
                              <option value="false">false</option>
                            </select>
                          ) : row.type === "null" ? (
                            <span className="inline-block px-2 py-1.5 text-[#8A93A2] italic">null</span>
                          ) : row.type === "object" || row.type === "array" ? (
                            <textarea
                              value={row.value}
                              onChange={(e) => updateRow(row.id, { value: e.target.value })}
                              rows={2}
                              className="w-full px-2 py-1.5 border border-[#EBE7DF] bg-[#1B1F27] text-[#E6E6E6] font-mono rounded-md focus:outline-none focus:border-[#F2673C] resize-y"
                              spellCheck={false}
                            />
                          ) : row.type === "number" ? (
                            <input
                              type="number"
                              value={row.value}
                              onChange={(e) => updateRow(row.id, { value: e.target.value })}
                              className="w-full px-2 py-1.5 border border-[#EBE7DF] bg-[#FAFAF7] font-mono rounded-md focus:outline-none focus:border-[#F2673C]"
                            />
                          ) : (
                            <input
                              type="text"
                              value={row.value}
                              onChange={(e) => updateRow(row.id, { value: e.target.value })}
                              placeholder={row.type === "date" ? "ISO date string" : row.type === "objectId" ? "24-char hex" : "value"}
                              className="w-full px-2 py-1.5 border border-[#EBE7DF] bg-[#FAFAF7] font-mono rounded-md focus:outline-none focus:border-[#F2673C]"
                            />
                          )}
                        </div>
                        <button
                          onClick={() => removeRow(row.id)}
                          aria-label="Remove field"
                          className="p-1.5 shrink-0 text-[#8A93A2] hover:text-[#DC2626] hover:bg-[#FEE2E2] rounded-md transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Validation Status Block */}
          {validator && (
            <div className="border border-[#111827]/10 rounded-lg overflow-hidden text-xs bg-[#FAFAF7]">
              <div className="px-3 py-2 bg-[#F4F1EC] border-b border-[#111827]/10 flex items-center justify-between font-bold text-[10px] uppercase text-[#5B6472]">
                <span>Schema Validation Linter</span>
                {validationErrors.length === 0 ? (
                  <span className="text-green-600 font-bold flex items-center gap-1">✓ Valid</span>
                ) : (
                  <span className="text-[#F2673C] font-bold">{validationErrors.length} Issue(s)</span>
                )}
              </div>
              <div className="p-3 max-h-[120px] overflow-y-auto space-y-1.5 font-semibold">
                {validationErrors.length === 0 ? (
                  <p className="text-green-600 text-xs flex items-center gap-1.5">
                    Document matches the collection's $jsonSchema validation rules.
                  </p>
                ) : (
                  validationErrors.map((err, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 text-xs text-[#721C24]">
                      <AlertCircle className="w-3.5 h-3.5 text-[#F2673C] shrink-0 mt-0.5" />
                      <div>
                        {err.path && (
                          <span className="font-mono text-[10px] bg-[#EBE7DF] px-1 py-0.5 rounded text-[#111827] mr-1">
                            {err.path}
                          </span>
                        )}
                        <span className="text-[#5B6472]">{err.message}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#F4F1EC] border-t border-[#111827]/10">
          <div className="flex items-center gap-3">
            <button
              onClick={handleFormat}
              disabled={mode === "fields"}
              className="px-3 py-1.5 border border-[#EBE7DF] hover:bg-[#EBE7DF] disabled:opacity-40 disabled:cursor-not-allowed text-[#5B6472] font-semibold text-xs rounded-md transition-colors"
            >
              Format Document
            </button>

            {/* Charset & Line ending pills */}
            <div className="flex items-center gap-1.5 text-[9px] font-mono text-[#5B6472] bg-[#EBE7DF]/50 px-2 py-1 rounded-md border border-[#EBE7DF]/30 select-none">
              <span>UTF-8</span>
              <span className="w-1 h-1 rounded-full bg-[#5B6472]/40"></span>
              <span>{jsonText.includes("\r\n") ? "CRLF" : "LF"}</span>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-md transition-colors"
            >
              Cancel
            </button>
            {!documentData && (
              <button
                onClick={handleInsertAndClone}
                disabled={saving}
                className="px-4 py-2 border border-[#F2673C] text-[#F2673C] hover:bg-[#F2673C]/5 disabled:border-[#8A93A2] disabled:text-[#8A93A2] font-bold text-xs rounded-md transition-colors"
              >
                Insert & Clone
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-[#F2673C] text-white hover:bg-[#D9491F] disabled:bg-[#8A93A2] font-bold text-xs rounded-md transition-all flex items-center gap-1.5"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
