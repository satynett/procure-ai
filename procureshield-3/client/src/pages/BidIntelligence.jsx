import React, { useMemo, useState } from "react";
import { api } from "../api.js";

const fallbackTender = {
  eligibility_requirements: [
    { requirement: "Minimum 3 years experience", type: "experience", mandatory: true },
    { requirement: "Valid GST registration", type: "tax", mandatory: true },
    { requirement: "PAN information", type: "identity", mandatory: true },
  ],
  required_documents: ["GST certificate", "PAN card", "Experience certificate"],
};

function encodeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Status({ value }) {
  const cls = value === "pass" ? "bg-emerald-50 text-emerald-700"
    : value === "missing" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
  return <span className={"rounded-full px-2 py-1 text-xs font-semibold " + cls}>{value}</span>;
}

export default function BidIntelligence() {
  const [file, setFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [bidderFiles, setBidderFiles] = useState([]);
  const [documentChecks, setDocumentChecks] = useState([]);
  const [bidder, setBidder] = useState({
    company_name: "", pan: "", gstin: "", years_experience: "", turnover: "", udyam: "", documents: []
  });
  const [eligibility, setEligibility] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const requirements = analysis?.requirements || fallbackTender;
  const canCheck = useMemo(() => bidder.company_name.trim().length > 0, [bidder.company_name]);

  async function analyzeTender() {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const content_base64 = await encodeFile(file);
      const result = await api.intelligencePdf({ filename: file.name, content_base64 });
      setAnalysis(result); setEligibility(null);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function validateBidderDocuments() {
    if (!bidderFiles.length) return;
    setBusy(true); setError("");
    try {
      const results = [];
      for (const file of bidderFiles) {
        const content_base64 = await encodeFile(file);
        const result = await api.intelligenceValidateDocument({ filename: file.name, content_type: file.type || "application/pdf", content_base64 });
        results.push({ ...result, filename: file.name });
      }
      setDocumentChecks(results);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function checkEligibility() {
    setBusy(true); setError("");
    try {
      const result = await api.intelligenceEligibility({
        tender: requirements,
        bidder: {
          ...bidder,
          years_experience: bidder.years_experience === "" ? null : Number(bidder.years_experience),
          turnover: bidder.turnover === "" ? null : Number(bidder.turnover),
        },
      });
      setEligibility(result);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">North-Star Prototype</div>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Bid Intelligence</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tender document → requirements → bidder self-check. Network risk remains powered by the existing analytics engine.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">1. Tender / RFP analysis</h2>
        <p className="mt-1 text-sm text-slate-500">Upload a PDF. Text is extracted locally; scanned documents are flagged for OCR.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input type="file" accept=".pdf,application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} className="block w-full text-sm" />
          <button disabled={!file || busy} onClick={analyzeTender} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Analyzing..." : "Extract & Analyze"}
          </button>
        </div>
        {analysis && (
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-4 md:col-span-2">
              <div className="text-xs font-semibold uppercase text-slate-500">Extracted text</div>
              <div className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-sm text-slate-700">{analysis.text || "No text extracted."}</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="font-medium">{analysis.filename}</div>
              <div className="mt-2 text-sm text-slate-500">{analysis.pages} page(s)</div>
              <div className="mt-2 text-sm">{analysis.ocr_required ? "⚠ OCR may be required" : "✓ Text extraction available"}</div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">2. Extracted requirements</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(requirements.eligibility_requirements || []).map((r, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="text-sm font-medium text-slate-800">{r.requirement}</div>
              <div className="mt-1 text-xs text-slate-500">{r.type} · {r.mandatory ? "mandatory" : "detected requirement"}</div>
            </div>
          ))}
          {(requirements.required_documents || []).map((d, i) => (
            <div key={"d-" + i} className="rounded-lg border border-slate-200 p-3 text-sm">📄 {d}</div>
          ))}
          {(requirements.technical_requirements || []).map((r, i) => (
            <div key={"t-" + i} className="rounded-lg border border-slate-200 p-3">
              <div className="text-sm font-medium text-slate-800">{r.requirement}</div>
              <div className="mt-1 text-xs text-slate-500">{r.type} · {r.mandatory ? "mandatory" : "detected requirement"}</div>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Compliance checklist</div>
          <div className="mt-3 space-y-2">
            {[
              ...(requirements.eligibility_requirements || []),
              ...(requirements.technical_requirements || []),
              ...(requirements.required_documents || []).map(document => ({ requirement: "Document: " + document, type: "document" })),
            ].map((item, i) => (
              <div key={"c-" + i} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                <span className="text-sm text-slate-700">{item.requirement}</span>
                <span className="text-xs font-semibold text-amber-700">Pending bidder check</span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-4 text-xs text-amber-700">Prototype extraction is deterministic and explainable; human review is required before procurement decisions.</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">3. Bidder eligibility pre-check</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[
            ["company_name", "Company name"], ["pan", "PAN"], ["gstin", "GSTIN"],
            ["udyam", "Udyam"], ["years_experience", "Years of experience"], ["turnover", "Turnover"],
          ].map(([key, label]) => (
            <label key={key} className="text-sm text-slate-600">{label}
              <input value={bidder[key]} onChange={e => setBidder({ ...bidder, [key]: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
            </label>
          ))}
        </div>
        <label className="mt-4 block text-sm text-slate-600">Documents supplied (comma separated)
          <input value={bidder.documents.join(", ")}
            onChange={e => setBidder({ ...bidder, documents: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <button disabled={!canCheck || busy} onClick={checkEligibility}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Run self-check
        </button>

        {eligibility && (
          <div className="mt-5 rounded-lg border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="text-xs text-slate-500">Eligibility pre-check</div><div className="text-xl font-bold">{eligibility.eligibility_score}%</div></div>
              <div className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700">{eligibility.status}</div>
            </div>
            <div className="mt-4 space-y-2">
              {eligibility.checks.map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
                  <span className="text-sm">{c.requirement}<span className="ml-2 text-xs text-slate-500">{c.evidence}</span></span>
                  <Status value={c.status} />
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-amber-700">{eligibility.message}</p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">4. Network risk</h2>
        <p className="mt-1 text-sm text-slate-500">
          The existing Graph/GNN engine stays isolated. Use Risk Analysis or Bidder Network for network evidence and review-priority scoring.
        </p>
      </section>
    </div>
  );
}      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">1. RFP & Bidder Document Upload</h2>
        <p className="mt-1 text-sm text-slate-500">Upload the tender first, then upload bidder documents for the generated compliance checklist.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">RFP / Tender</div>
            <h3 className="mt-1 font-semibold text-slate-900">Generate checklist</h3>
            <input type="file" accept=".pdf,application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} className="mt-4 block w-full text-sm" />
            <button disabled={!file || busy} onClick={analyzeTender} className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Analyzing..." : "Extract & Analyze"}</button>
            {analysis && <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><b>{analysis.filename}</b><div className="text-slate-500">{analysis.pages} page(s)</div></div>}
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Bidder Documents</div>
            <h3 className="mt-1 font-semibold text-slate-900">Upload supporting documents</h3>
            <input type="file" accept=".pdf,application/pdf" multiple onChange={e => setBidderFiles(Array.from(e.target.files || []))} className="mt-4 block w-full text-sm" />
            {bidderFiles.length > 0 && <div className="mt-3 space-y-1">{bidderFiles.map((f, i) => <div key={i} className="text-sm text-slate-700">📄 {f.name}</div>)}</div>}
            <button disabled={!bidderFiles.length || busy} onClick={validateBidderDocuments} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Checking..." : "Check Bidder Documents"}</button>
            {documentChecks.length > 0 && <div className="mt-3 space-y-2">{documentChecks.map((d, i) => <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span>{d.filename}</span><Status value={d.status === "valid" ? "pass" : "needs_review"} /></div>)}</div>}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">2. Extracted requirements</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {(requirements.eligibility_requirements || []).map((r, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="text-sm font-medium text-slate-800">{r.requirement}</div>
              <div className="mt-1 text-xs text-slate-500">{r.type} · {r.mandatory ? "mandatory" : "detected requirement"}</div>
            </div>
          ))}
          {(requirements.required_documents || []).map((d, i) => (
            <div key={"d-" + i} className="rounded-lg border border-slate-200 p-3 text-sm">📄 {d}</div>
          ))}
          {(requirements.technical_requirements || []).map((r, i) => (
            <div key={"t-" + i} className="rounded-lg border border-slate-200 p-3">
              <div className="text-sm font-medium text-slate-800">{r.requirement}</div>
              <div className="mt-1 text-xs text-slate-500">{r.type} · {r.mandatory ? "mandatory" : "detected requirement"}</div>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Compliance checklist</div>
          <div className="mt-3 space-y-2">
            {[
              ...(requirements.eligibility_requirements || []),
              ...(requirements.technical_requirements || []),
              ...(requirements.required_documents || []).map(document => ({ requirement: "Document: " + document, type: "document" })),
            ].map((item, i) => (
              <div key={"c-" + i} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                <span className="text-sm text-slate-700">{item.requirement}</span>
                <span className="text-xs font-semibold text-amber-700">Pending bidder check</span>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-4 text-xs text-amber-700">Prototype extraction is deterministic and explainable; human review is required before procurement decisions.</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">3. Bidder eligibility pre-check</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {[
            ["company_name", "Company name"], ["pan", "PAN"], ["gstin", "GSTIN"],
            ["udyam", "Udyam"], ["years_experience", "Years of experience"], ["turnover", "Turnover"],
          ].map(([key, label]) => (
            <label key={key} className="text-sm text-slate-600">{label}
              <input value={bidder[key]} onChange={e => setBidder({ ...bidder, [key]: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
            </label>
          ))}
        </div>
        <label className="mt-4 block text-sm text-slate-600">Documents supplied (comma separated)
          <input value={bidder.documents.join(", ")}
            onChange={e => setBidder({ ...bidder, documents: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        </label>
        <button disabled={!canCheck || busy} onClick={checkEligibility}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Run self-check
        </button>

        {eligibility && (
          <div className="mt-5 rounded-lg border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="text-xs text-slate-500">Eligibility pre-check</div><div className="text-xl font-bold">{eligibility.eligibility_score}%</div></div>
              <div className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700">{eligibility.status}</div>
            </div>
            <div className="mt-4 space-y-2">
              {eligibility.checks.map((c, i) => (
                <div key={i} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
                  <span className="text-sm">{c.requirement}<span className="ml-2 text-xs text-slate-500">{c.evidence}</span></span>
                  <Status value={c.status} />
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-amber-700">{eligibility.message}</p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">4. Network risk</h2>
        <p className="mt-1 text-sm text-slate-500">
          The existing Graph/GNN engine stays isolated. Use Risk Analysis or Bidder Network for network evidence and review-priority scoring.
        </p>
      </section>
    </div>
  );
}
