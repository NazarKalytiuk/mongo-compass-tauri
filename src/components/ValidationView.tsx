import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ShieldCheck, Wand2, Loader2, AlertCircle, Check, Play, FileWarning,
} from "lucide-react";
import { analyzeDocuments } from "../schemaAnalyzer";
import { generateJsonSchema, validateAgainstSchema } from "../schemaValidation";

interface ValidationViewProps {
  dbName: string;
  collName: string;
}

type ValidationLevel = "off" | "moderate" | "strict";
type ValidationAction = "error" | "warn";

interface PreviewResult {
  total: number;
  passing: number;
  failing: number;
  failingExamples: Array<{ doc: any; errors: string[] }>;
}

export default function ValidationView({ dbName, collName }: ValidationViewProps) {
  const [validatorText, setValidatorText] = useState("{}");
  const [level, setLevel] = useState<ValidationLevel>("strict");
  const [action, setAction] = useState<ValidationAction>("error");

  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Load the current validator on collection change
  useEffect(() => {
    setLoading(true);
    setApplyError(null);
    setApplySuccess(false);
    setPreview(null);
    invoke<any>("get_collection_validator", { dbName, collName })
      .then((res) => {
        setValidatorText(res ? JSON.stringify(res, null, 2) : "{}");
      })
      .catch((err) => {
        console.error("Failed to load validator:", err);
        setValidatorText("{}");
      })
      .finally(() => setLoading(false));
  }, [dbName, collName]);

  const handleGenerate = async () => {
    setGenerating(true);
    setApplyError(null);
    try {
      const result: any = await invoke("find_documents", {
        dbName,
        collName,
        filterStr: "{}",
        sortStr: "{}",
        projectionStr: "{}",
        limit: 200,
        skip: 0,
      });
      const docs = result?.documents || [];
      if (docs.length === 0) {
        setApplyError("No sample documents available to generate rules from.");
        return;
      }
      const analysis = analyzeDocuments(docs);
      const schema = generateJsonSchema(analysis);
      setValidatorText(JSON.stringify(schema, null, 2));
    } catch (err: any) {
      setApplyError(`Generate failed: ${String(err)}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    setApplyError(null);
    setApplySuccess(false);
    let parsed: any;
    try {
      parsed = JSON.parse(validatorText);
    } catch (err: any) {
      setApplyError(`Invalid JSON syntax: ${err.message}`);
      return;
    }

    setApplying(true);
    try {
      await invoke("set_collection_validator", {
        dbName,
        collName,
        validatorJson: JSON.stringify(parsed),
        validationLevel: level,
        validationAction: action,
      });
      setApplySuccess(true);
      setTimeout(() => setApplySuccess(false), 3000);
    } catch (err: any) {
      setApplyError(String(err));
    } finally {
      setApplying(false);
    }
  };

  const handlePreview = async () => {
    setPreviewError(null);
    setPreview(null);
    let parsed: any;
    try {
      parsed = JSON.parse(validatorText);
    } catch (err: any) {
      setPreviewError(`Invalid JSON syntax: ${err.message}`);
      return;
    }

    setPreviewing(true);
    try {
      const result: any = await invoke("find_documents", {
        dbName,
        collName,
        filterStr: "{}",
        sortStr: "{}",
        projectionStr: "{}",
        limit: 100,
        skip: 0,
      });
      const docs: any[] = result?.documents || [];
      let passing = 0;
      const failingExamples: PreviewResult["failingExamples"] = [];
      for (const doc of docs) {
        const errors = validateAgainstSchema(doc, parsed);
        if (errors.length === 0) {
          passing++;
        } else if (failingExamples.length < 10) {
          failingExamples.push({ doc, errors: errors.map((e) => `${e.path || "(root)"}: ${e.message}`) });
        }
      }
      setPreview({
        total: docs.length,
        passing,
        failing: docs.length - passing,
        failingExamples,
      });
    } catch (err: any) {
      setPreviewError(String(err));
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#FAFAF7] overflow-y-auto select-text p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#111827]/10 pb-6 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-[#F2673C]/10 text-[#F2673C] rounded-xl">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#111827]">Schema Validation</h1>
            <p className="text-xs text-[#8A93A2] mt-1">
              Author <code className="font-mono">$jsonSchema</code> / MQL rules for{" "}
              <code className="font-mono font-bold text-[#1F2937]">{dbName}.{collName}</code>.
            </p>
          </div>
        </div>
        <button
          onClick={handleApply}
          disabled={applying || loading}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-[#F2673C] hover:bg-[#D9491F] disabled:bg-[#F2673C]/50 text-white text-xs font-bold rounded-lg transition-all shadow-sm shrink-0 cursor-pointer"
        >
          {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          <span>Apply Validation Rules</span>
        </button>
      </div>

      {applySuccess && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg flex items-center gap-2 text-xs font-semibold">
          <Check className="w-4 h-4" /> Validation rules applied successfully.
        </div>
      )}
      {applyError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-start gap-2 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{applyError}</span>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="px-3 py-2 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
          title="Generate $jsonSchema rules from a sample of existing documents"
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          Generate Rules from Sample
        </button>

        <div className="flex items-center gap-1.5">
          <label className="text-[10px] font-bold uppercase text-[#8A93A2]">Level</label>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as ValidationLevel)}
            className="text-xs bg-white border border-[#EBE7DF] rounded-lg px-2.5 py-1.5 font-bold text-[#1F2937] focus:outline-none focus:border-[#F2673C] cursor-pointer"
          >
            <option value="off">off</option>
            <option value="moderate">moderate</option>
            <option value="strict">strict</option>
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label className="text-[10px] font-bold uppercase text-[#8A93A2]">Action</label>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as ValidationAction)}
            className="text-xs bg-white border border-[#EBE7DF] rounded-lg px-2.5 py-1.5 font-bold text-[#1F2937] focus:outline-none focus:border-[#F2673C] cursor-pointer"
          >
            <option value="error">error</option>
            <option value="warn">warn</option>
          </select>
        </div>

        <button
          onClick={handlePreview}
          disabled={previewing}
          className="px-3 py-2 border border-[#EBE7DF] hover:bg-[#EBE7DF] text-[#5B6472] font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ml-auto"
          title="Validate a sample of documents against the current rules"
        >
          {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          Test Against Sample
        </button>
      </div>

      {/* Editor */}
      <div className="flex flex-col flex-1 min-h-[300px] gap-4 lg:flex-row">
        <div className="flex flex-col flex-1 min-h-[260px]">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-[#5B6472] mb-1.5">
            Validator Document (JSON)
          </label>
          {loading ? (
            <div className="flex-1 flex items-center justify-center bg-white border border-[#111827]/10 rounded-lg text-[#5B6472]">
              <Loader2 className="w-6 h-6 animate-spin text-[#F2673C]" />
            </div>
          ) : (
            <textarea
              value={validatorText}
              onChange={(e) => setValidatorText(e.target.value)}
              className="flex-1 p-4 bg-[#1B1F27] text-[#E6E6E6] font-mono text-xs rounded-lg border border-[#232833] focus:outline-none resize-none leading-relaxed min-h-[260px]"
              spellCheck={false}
            />
          )}
        </div>

        {/* Preview panel */}
        <div className="flex flex-col flex-1 min-h-[260px]">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-[#5B6472] mb-1.5">
            Sample Validation Preview
          </label>
          <div className="flex-1 bg-white border border-[#111827]/10 rounded-lg p-4 overflow-y-auto">
            {previewError ? (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-start gap-2 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{previewError}</span>
              </div>
            ) : !preview ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-[#8A93A2]">
                <FileWarning className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-xs font-semibold">No preview yet</p>
                <p className="text-[10px] mt-1">Click "Test Against Sample" to validate existing documents.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-[#FAFAF7] border border-[#111827]/5 rounded-lg p-2 text-center">
                    <div className="text-lg font-extrabold text-[#111827]">{preview.total}</div>
                    <div className="text-[9px] uppercase font-bold text-[#8A93A2]">Sampled</div>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-center">
                    <div className="text-lg font-extrabold text-emerald-700">{preview.passing}</div>
                    <div className="text-[9px] uppercase font-bold text-emerald-600">Passing</div>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
                    <div className="text-lg font-extrabold text-red-700">{preview.failing}</div>
                    <div className="text-[9px] uppercase font-bold text-red-600">Failing</div>
                  </div>
                </div>

                {preview.failingExamples.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold uppercase text-[#8A93A2]">Failing examples</h4>
                    {preview.failingExamples.map((ex, idx) => (
                      <div key={idx} className="border border-red-200 rounded-lg overflow-hidden">
                        <div className="bg-red-50 px-2 py-1.5 space-y-0.5">
                          {ex.errors.map((e, eIdx) => (
                            <div key={eIdx} className="text-[10px] text-red-700 font-mono flex items-start gap-1">
                              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                              <span>{e}</span>
                            </div>
                          ))}
                        </div>
                        <pre className="p-2 bg-[#1B1F27] text-[#E6E6E6] font-mono text-[10px] overflow-x-auto max-h-24">
                          {JSON.stringify(ex.doc, null, 1)}
                        </pre>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
