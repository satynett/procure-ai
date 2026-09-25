import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import {
  ArrowLeft,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  BrainCircuit,
  ExternalLink,
  ShieldCheck
} from "lucide-react";
import DocumentDropzone from "../components/DocumentDropzone.jsx";
import { useNavigate } from "react-router-dom";

function encodeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function displayRequirement(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return value.requirement || value.type || value.source || "Requirement";
  }
  return String(value ?? "");
}

function requirementList(value) {
  if (Array.isArray(value)) return value.map(displayRequirement).filter(Boolean);
  if (value && typeof value === "object") return [displayRequirement(value)];
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

const aliases = {
  "GST certificate": ["GST certificate"],
  "PAN card": ["PAN card"],
  "Udyam/MSME certificate": ["Udyam/MSME certificate"],
  "Experience certificate": ["Experience certificate"],
  "Work order": ["Work order"],
  "Financial statement": ["Financial statement", "Turnover proof"],
  "Turnover proof": ["Financial statement", "Turnover proof"],
  "Balance sheet": ["Balance sheet", "Financial statement"],
  "Certificate of incorporation": ["Certificate of incorporation"],
  "EMD proof": ["EMD / Bid Security proof", "EMD proof"],
  "EMD / Bid Security proof": ["EMD / Bid Security proof", "EMD proof"],
  "ISO 9001": ["ISO certificate", "ISO 9001"],
  "ISO certificate": ["ISO certificate", "ISO 9001"],
  "OEM authorization": ["Authorization / OEM certificate", "OEM authorization"],
  "Authorization / OEM certificate": ["Authorization / OEM certificate", "OEM authorization"],
  "Quality certificate": ["Quality certificate"],
};

function Status({ value }) {
  const cls = value === "valid" || value === "matched"
    ? "bg-emerald-50 text-emerald-700"
    : value === "missing" || value === "wrong_document"
      ? "bg-red-50 text-red-700"
      : "bg-amber-50 text-amber-700";
  const label = value === "valid" || value === "matched"
    ? "✓ Matched"
    : value === "missing"
      ? "✕ Missing"
      : value === "wrong_document"
        ? "✕ Wrong document"
        : "⚠ Needs review";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>;
}

export default function BidIntelligence() {
  const navigate = useNavigate();
  const [tenders, setTenders] = useState([]);
  const [selectedTenderId, setSelectedTenderId] = useState("");
  const [files, setFiles] = useState([]);
  const [checks, setChecks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loadingTenders, setLoadingTenders] = useState(true);
  const [error, setError] = useState("");
  const [uploadErrors, setUploadErrors] = useState([]);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);

  const loadOpenTenders = async ({ preserveSelection = true } = {}) => {
    try {
      const res = await api.tenders("Open");
      const open = res.tenders || [];
      setTenders(open);
      setSelectedTenderId((current) => {
        if (preserveSelection && current && open.some((t) => t.tender_id === current)) return current;
        return open[0]?.tender_id || "";
      });
      setError("");
    } catch (e) {
      setError(e.message || "Unable to load tenders.");
    } finally {
      setLoadingTenders(false);
    }
  };

  useEffect(() => {
    loadOpenTenders({ preserveSelection: false });
    const refresh = () => loadOpenTenders();
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, []);

  const selectedTender = useMemo(
    () => tenders.find((t) => t.tender_id === selectedTenderId) || null,
    [tenders, selectedTenderId]
  );

  async function checkDocuments() {
    if (!files.length || !selectedTender) return;
    setBusy(true);
    setError("");
    setChecks([]);
    setAiAnalysis(null);

    try {
      const results = [];
      for (const file of files) {
        try {
          const content_base64 = await encodeFile(file);
          const result = await api.intelligenceValidateDocument({
            filename: file.name,
            content_type: file.type || "application/pdf",
            content_base64
          });
          results.push({ ...result, filename: file.name });
        } catch (e) {
          results.push({
            filename: file.name,
            status: "wrong_document",
            detected_documents: [],
            text: "",
            message: e.message || "Wrong document: this file could not be validated."
          });
        }
      }
      setChecks(results);
      await runAIAnalysis(results);
    } catch (e) {
      setError(e.message || "Document check failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runAIAnalysis(results) {
    if (!selectedTender) return;
    setAiBusy(true);

    const readable = results.filter((item) => item.status === "valid");
    const requiredDocuments = requirementList(selectedTender.required_documents);\n    const missingRequirements = requiredDocuments.filter((requirement) => {
      const candidates = aliases[requirement] || [requirement];
      return !readable.some((doc) =>
        candidates.some((candidate) => (doc.detected_documents || []).includes(candidate))
      );
    });

    try {
      const documentText = readable
        .map((doc) => `--- ${doc.filename} ---\n${doc.text || doc.detected_documents?.join(", ") || ""}`)
        .join("\n\n")
        .slice(0, 30000);

      if (documentText) {
        const result = await api.intelligenceAIDocumentCheck({
          filename: readable.map((d) => d.filename).join(", "),
          document_text: documentText,
          requirements: requiredDocuments,
          tender_id: selectedTender.tender_id
        });

        setAiAnalysis({
          ...(result || {}),
          fallbackMissing: missingRequirements,
          fallbackMatched: requiredDocuments.length - missingRequirements.length,
          readableCount: readable.length,
          wrongCount: results.filter((d) => d.status === "wrong_document").length
        });
      } else {
        setAiAnalysis({
          fallbackMissing: missingRequirements,
          fallbackMatched: (selectedTender.required_documents || []).length - missingRequirements.length,
          readableCount: readable.length,
          wrongCount: results.filter((d) => d.status === "wrong_document").length,
          message: "No readable bidder document was available for AI analysis."
        });
      }
    } catch (e) {
      setAiAnalysis({
        fallbackMissing: missingRequirements,
        fallbackMatched: (selectedTender.required_documents || []).length - missingRequirements.length,
        readableCount: readable.length,
        wrongCount: results.filter((d) => d.status === "wrong_document").length,
        message: "AI analysis could not be completed. The checklist result above remains available."
      });
    } finally {
      setAiBusy(false);
    }
  }

  const detected = [...new Set(checks.flatMap((c) => requirementList(c.detected_documents)))];
  const checklist = requirementList(selectedTender?.required_documents).map((requirement) => {
    const candidates = aliases[requirement] || [requirement];
    const evidence = checks.find((doc) =>
      doc.status === "valid" &&
      candidates.some((candidate) => (doc.detected_documents || []).includes(candidate))
    );
    return { requirement, matched: Boolean(evidence), evidence: evidence?.filename || "" };
  });
  const matched = checklist.filter((x) => x.matched).length;
  const missing = checklist.length - matched;
  const valid = checks.filter((c) => c.status === "valid").length;
  const wrong = checks.filter((c) => c.status === "wrong_document").length;

  const rfpPdfUrl = selectedTender?.rfp_content_base64
    ? `data:application/pdf;base64,${selectedTender.rfp_content_base64}`
    : null;

  const resetTender = (id) => {
    setSelectedTenderId(id);
    setFiles([]);
    setChecks([]);
    setAiAnalysis(null);
    setUploadErrors([]);
    setError("");
  };

  return (
    <div className="min-h-screen bg-slate-100/80 py-6"><div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start gap-3">
        <button onClick={() => navigate("/bidder")} className="rounded-lg border border-slate-200 bg-white p-2">
          <ArrowLeft size={17}/>
        </button>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Bidder Portal</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Check My Documents</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review the tender requirements, inspect the published RFP, then check your supporting documents before submission.
          </p>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-l-4 border-emerald-600 bg-gradient-to-r from-slate-800 to-slate-700 px-5 py-4"><div className="text-xs font-bold uppercase tracking-wider text-emerald-300">Government Procurement Portal</div><div className="mt-1 text-lg font-semibold text-white">Tender Document Compliance</div></div><div className="p-5"><div className="flex items-center justify-between gap-3"><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Select published tender</label><button type="button" onClick={() => loadOpenTenders()} className="text-xs font-semibold text-brand-600 hover:underline">Refresh tenders</button></div>
        <select
          value={selectedTenderId}
          onChange={(e) => resetTender(e.target.value)}
          disabled={loadingTenders}
          className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium"
        >
          {loadingTenders ? <option>Loading tenders…</option> : tenders.map((t) => (
            <option key={t.tender_id} value={t.tender_id}>{t.tender_id} — {t.title}</option>
          ))}
        </select></div>
      </section>

      {selectedTender && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><FileCheck2 size={20}/></div>
              <div>
                <h2 className="font-semibold text-slate-900">1. Upload your supporting documents</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Upload your documents first. Multiple PDF, DOC and DOCX files are supported, with drag-and-drop and per-file validation.
                </p>
              </div>
            </div>

            <div className="mt-5">
              <DocumentDropzone
                files={files}
                errors={uploadErrors}
                onChange={(next, rejected) => {
                  setFiles(next);
                  setUploadErrors(rejected);
                  setChecks([]);
                  setAiAnalysis(null);
                }}
                label="Drag and drop your bid documents here"
                hint="Upload GST, PAN, Udyam, experience, turnover, ISO, OEM, EMD and other supporting documents."
              />
              <button
                disabled={!files.length || !selectedTender || busy}
                onClick={checkDocuments}
                className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Checking documents…" : "Check Against This Tender"}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-brand-50 p-2 text-brand-600"><ShieldCheck size={20}/></div>
              <div>
                <h2 className="font-semibold text-slate-900">2. What the tender needs</h2>
                <p className="mt-1 text-sm text-slate-500">The officer-published eligibility, technical and supporting-document requirements for this tender.</p>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-800">{selectedTender.title}</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">{selectedTender.eligibility_summary}</p>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {requirementList(selectedTender.eligibility_requirements).map((item) => (
                <div key={item} className="flex gap-2 rounded-lg border border-slate-100 p-3 text-sm text-slate-700">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-brand-600"/>
                  <span>{item}</span>
                </div>
              ))}
              {requirementList(selectedTender.technical_requirements).map((item) => (
                <div key={`technical-${item}`} className="flex gap-2 rounded-lg border border-slate-100 p-3 text-sm text-slate-700">
                  <FileCheck2 size={16} className="mt-0.5 shrink-0 text-brand-600"/>
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <div className="mt-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Required documents</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {requirementList(selectedTender.required_documents).map((item) => (
                  <span key={item} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">{item}</span>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {checks.length > 0 && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900">4. Requirement ↔ Evidence matching</h2>
                <p className="mt-1 text-sm text-slate-500">Each tender requirement is matched against evidence detected in your uploaded documents.</p>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700">{matched}/{checklist.length} matched</div>
            </div>

            <div className="mt-4 space-y-2">
              {checklist.map((item) => (
                <div key={item.requirement} className="grid gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 sm:grid-cols-[1.1fr_1fr_auto] sm:items-center">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    {item.matched ? <CheckCircle2 size={17} className="text-emerald-600"/> : <XCircle size={17} className="text-red-500"/>}
                    {item.requirement}
                  </div>
                  <div className="text-xs text-slate-500">
                    <span className="font-medium text-slate-600">Bidder evidence:</span> {item.evidence || "No matching document detected"}
                  </div>
                  <Status value={item.matched ? "matched" : "missing"} />
                </div>
              ))}
            </div>

            {missing > 0 && (
              <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle size={15} className="shrink-0"/>
                <span>{missing} tender requirement{missing !== 1 ? "s" : ""} still need matching documents before you submit.</span>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900">5. Match with sandbox data</h2>
                <p className="mt-1 text-sm text-slate-500">The prototype compares detected bidder-document types with its synthetic sandbox procurement dataset and validation rules.</p>
              </div>
              <div className="text-sm font-semibold text-slate-700">{valid}/{checks.length} readable{wrong ? ` · ${wrong} wrong document${wrong !== 1 ? "s" : ""}` : ""}</div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs text-slate-500">Sandbox documents detected</div>
                <div className="mt-1 text-xl font-bold text-slate-900">{detected.length}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <div className="text-xs text-slate-500">Readable uploads</div>
                <div className="mt-1 text-xl font-bold text-slate-900">{valid}/{checks.length}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <div className="text-xs text-slate-500">Sandbox validation</div>
                <div className="mt-1 text-xl font-bold text-slate-900">{wrong ? "Needs attention" : "Passed"}</div>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {checks.map((doc, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{doc.filename}</div>
                    <div className="mt-1 text-xs text-slate-500">{doc.detected_documents?.join(", ") || doc.message || "Document inspected."}</div>
                  </div>
                  <Status value={doc.status}/>
                </div>
              ))}
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3 p-6">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-blue-50 p-2 text-blue-700"><FileText size={20}/></div>
                <div>
                  <h2 className="font-semibold text-slate-900">6. Actual published RFP</h2>
                  <p className="mt-1 text-sm text-slate-500">Review the source tender document after seeing how your uploaded evidence matched the sandbox checklist.</p>
                </div>
              </div>
              {rfpPdfUrl && (
                <a href={rfpPdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
                  Open PDF <ExternalLink size={14}/>
                </a>
              )}
            </div>
            <div className="border-t border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 px-1 text-xs font-medium text-slate-500">{selectedTender.rfp_filename || "Published RFP.pdf"}</div>
              {rfpPdfUrl ? (
                <iframe title={selectedTender.rfp_filename || "Published RFP"} src={rfpPdfUrl} className="h-[520px] w-full rounded-lg border border-slate-200 bg-white" />
              ) : (
                <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-lg bg-white p-4 text-sm leading-6 text-slate-600">
                  {selectedTender.rfp_text || selectedTender.eligibility_summary || "No RFP preview is available."}
                </pre>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-blue-50 p-2 text-blue-700"><BrainCircuit size={20}/></div>
              <div>
                <h2 className="font-semibold text-slate-900">7. AI analysis</h2>
                <p className="mt-1 text-sm text-slate-500">A concise pre-bid explanation of what matched and what still needs attention.</p>
              </div>
            </div>

            {aiBusy ? (
              <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Analysing the uploaded evidence against the tender requirements…</div>
            ) : aiAnalysis ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">Requirements matched</div>
                    <div className="mt-1 text-xl font-bold text-slate-900">{matched}/{checklist.length}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">Readable documents</div>
                    <div className="mt-1 text-xl font-bold text-slate-900">{valid}/{checks.length}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-4">
                    <div className="text-xs text-slate-500">Needs attention</div>
                    <div className="mt-1 text-xl font-bold text-slate-900">{missing + wrong}</div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                  {aiAnalysis.narrative || aiAnalysis.summary || aiAnalysis.message || (
                    <>
                      The uploaded documents provide evidence for <strong>{matched}</strong> of <strong>{checklist.length}</strong> tender requirements.
                      {missing > 0 ? <> <strong>{missing}</strong> requirement{missing !== 1 ? "s" : ""} still need matching evidence.</> : " All listed document requirements have matching evidence."}
                      {wrong > 0 ? <> <strong>{wrong}</strong> uploaded file{wrong !== 1 ? "s were" : " was"} flagged as wrong or unreadable.</> : null}
                    </>
                  )}
                </div>

                {missing > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">Action required</div>
                    <div className="mt-2 text-sm text-amber-900">
                      Upload evidence for: <strong>{checklist.filter((x) => !x.matched).map((x) => x.requirement).join(", ")}</strong>.
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">AI analysis will appear after document checking.</div>
            )}
          </section>
        </>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-200/70 p-4 text-xs text-slate-600">
        Sandbox prototype. This is a pre-bid matching aid; official eligibility still requires procurement-officer verification.
      </div>
    </div>
    </div>
  );
}
