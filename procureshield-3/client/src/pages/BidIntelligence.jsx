import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { ArrowLeft, FileCheck2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
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

  useEffect(() => {
    api.tenders("Open")
      .then((res) => {
        const open = res.tenders || [];
        setTenders(open);
        if (open.length) setSelectedTenderId(open[0].tender_id);
      })
      .catch((e) => setError(e.message || "Unable to load tenders."))
      .finally(() => setLoadingTenders(false));
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
            message: e.message || "Wrong document: this file could not be validated."
          });
        }
      }
      setChecks(results);
    } catch (e) {
      setError(e.message || "Document check failed.");
    } finally {
      setBusy(false);
    }
  }

  const detected = [...new Set(checks.flatMap((c) => c.detected_documents || []))];
  const checklist = (selectedTender?.required_documents || []).map((requirement) => {
    const candidates = aliases[requirement] || [requirement];
    const matched = candidates.some((candidate) => detected.includes(candidate));
    return { requirement, matched };
  });
  const matched = checklist.filter((x) => x.matched).length;
  const missing = checklist.length - matched;
  const valid = checks.filter((c) => c.status === "valid").length;
  const wrong = checks.filter((c) => c.status === "wrong_document").length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start gap-3">
        <button onClick={() => navigate("/bidder")} className="rounded-lg border border-slate-200 bg-white p-2">
          <ArrowLeft size={17}/>
        </button>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Bidder Portal</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Check My Documents</h1>
          <p className="mt-1 text-sm text-slate-500">Select the tender you are preparing for, then check your documents against that tender's published checklist.</p>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Checking documents for tender</label>
        <select
          value={selectedTenderId}
          onChange={(e) => { setSelectedTenderId(e.target.value); setChecks([]); }}
          disabled={loadingTenders}
          className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium"
        >
          {loadingTenders ? <option>Loading tenders…</option> : tenders.map((t) => (
            <option key={t.tender_id} value={t.tender_id}>{t.tender_id} — {t.title}</option>
          ))}
        </select>
        {selectedTender && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
            <div className="font-semibold text-slate-800">{selectedTender.title}</div>
            <div className="mt-1 text-xs text-slate-500">{selectedTender.department} · Deadline {selectedTender.deadline}</div>
            <div className="mt-2 text-xs text-slate-600">{selectedTender.eligibility_summary}</div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-brand-50 p-2 text-brand-600"><FileCheck2 size={20}/></div>
          <div>
            <h2 className="font-semibold">Tender-specific document check</h2>
            <p className="mt-1 text-sm text-slate-500">The RFP remains officer-published. You upload only your own supporting documents.</p>
          </div>
        </div>

        <div className="mt-5">
          <DocumentDropzone files={files} errors={uploadErrors}
            onChange={(next, rejected) => { setFiles(next); setUploadErrors(rejected); setChecks([]); }}
            label="Upload your bid documents"
            hint="Drag and drop multiple GST, PAN, Udyam, experience, turnover, ISO, OEM, EMD and other supporting documents."
          />
          <button disabled={!files.length || !selectedTender || busy} onClick={checkDocuments} className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Checking…" : "Check Against This Tender"}
          </button>
        </div>
      </section>

      {checks.length > 0 && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-semibold">Your tender checklist</h2>
                <p className="mt-1 text-sm text-slate-500">Comparison against {selectedTender.tender_id} — {selectedTender.title}</p>
              </div>
              <div className="text-sm font-semibold">{matched}/{checklist.length} requirements matched</div>
            </div>

            <div className="mt-4 space-y-2">
              {checklist.map((item) => (
                <div key={item.requirement} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {item.matched ? <CheckCircle2 size={16} className="text-emerald-600"/> : <XCircle size={16} className="text-red-500"/>}
                    {item.requirement}
                  </div>
                  <Status value={item.matched ? "matched" : "missing"} />
                </div>
              ))}
            </div>

            {missing > 0 && (
              <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle size={15}/>
                {missing} tender requirement{missing !== 1 ? "s" : ""} still need matching documents before you submit.
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="font-semibold">Document validation results</h2>
                <p className="mt-1 text-sm text-slate-500">Each uploaded file is inspected before the tender checklist is matched.</p>
              </div>
              <div className="text-sm font-semibold">{valid}/{checks.length} files readable{wrong ? ` · ${wrong} wrong document${wrong !== 1 ? "s" : ""}` : ""}</div>
            </div>
            <div className="mt-4 space-y-2">
              {checks.map((doc,i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <div>
                    <div className="text-sm font-medium">{doc.filename}</div>
                    <div className="mt-1 text-xs text-slate-500">{doc.detected_documents?.join(", ") || doc.message || "Document inspected."}</div>
                  </div>
                  <Status value={doc.status}/>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">Sandbox prototype. This is a pre-bid matching aid; official eligibility still requires procurement-officer verification.</div>
    </div>
  );
}
