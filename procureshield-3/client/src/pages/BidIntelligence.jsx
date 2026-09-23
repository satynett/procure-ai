import React, { useState } from "react";
import { api } from "../api.js";
import { ArrowLeft, FileCheck2, UploadCloud, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";

function encodeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Status({ value }) {
  const cls = value === "valid" || value === "pass" ? "bg-emerald-50 text-emerald-700"
    : value === "missing" ? "bg-red-50 text-red-700"
    : "bg-amber-50 text-amber-700";
  const label = value === "valid" || value === "pass" ? "✓ Looks valid" : value === "missing" ? "✕ Missing" : "⚠ Needs review";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>;
}

export default function BidIntelligence() {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [checks, setChecks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function checkDocuments() {
    if (!files.length) return;
    setBusy(true); setError(""); setChecks([]);
    try {
      const results = [];
      for (const file of files) {
        const content_base64 = await encodeFile(file);
        const result = await api.intelligenceValidateDocument({
          filename: file.name,
          content_type: file.type || "application/pdf",
          content_base64
        });
        results.push({ ...result, filename: file.name });
      }
      setChecks(results);
    } catch (e) {
      setError(e.message || "Document check failed.");
    } finally {
      setBusy(false);
    }
  }

  const valid = checks.filter((c) => c.status === "valid").length;
  const review = checks.length - valid;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start gap-3">
        <button onClick={() => navigate("/bidder")} className="rounded-lg border border-slate-200 bg-white p-2"><ArrowLeft size={17}/></button>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Bidder Portal</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Check My Documents</h1>
          <p className="mt-1 text-sm text-slate-500">Upload your own documents to check whether they look complete and valid before bidding.</p>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-brand-50 p-2 text-brand-600"><FileCheck2 size={20}/></div>
          <div><h2 className="font-semibold">Document self-check</h2><p className="mt-1 text-sm text-slate-500">This page does not ask for an RFP. RFPs are uploaded and published by procurement officers.</p></div>
        </div>

        <div className="mt-5 rounded-lg border-2 border-dashed border-slate-200 p-8 text-center">
          <UploadCloud className="mx-auto text-slate-400" size={28}/>
          <h3 className="mt-2 font-semibold">Upload your documents</h3>
          <p className="mt-1 text-sm text-slate-500">GST, PAN, Udyam, experience, turnover, ISO, OEM authorization, EMD and other supporting PDFs.</p>
          <input type="file" multiple accept=".pdf,.doc,.docx" onChange={e=>setFiles(Array.from(e.target.files||[]))} className="mx-auto mt-4 block max-w-md text-sm"/>
          {files.length>0 && <div className="mx-auto mt-3 max-w-lg space-y-1 text-left">{files.map((f,i)=><div key={i} className="rounded bg-slate-50 px-3 py-2 text-sm">📄 {f.name}</div>)}</div>}
          <button disabled={!files.length||busy} onClick={checkDocuments} className="mt-4 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy?"Checking…":"Check My Documents"}</button>
        </div>
      </section>

      {checks.length>0 && <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="font-semibold">Document check results</h2><p className="mt-1 text-sm text-slate-500">These are pre-bid review signals, not a final procurement decision.</p></div>
          <div className="text-sm font-semibold">{valid}/{checks.length} look valid</div>
        </div>
        <div className="mt-4 space-y-2">{checks.map((doc,i)=><div key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3"><div><div className="text-sm font-medium">{doc.filename}</div><div className="mt-1 text-xs text-slate-500">{doc.detected_documents?.join(", ") || doc.message || "Document inspected."}</div></div><Status value={doc.status}/></div>)}</div>
        {review>0 && <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle size={15}/> Review the flagged documents and correct them before submitting a bid.</div>}
      </section>}

      <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">Sandbox prototype. The officer-published RFP is only visible from a tender's details; bidders cannot upload or replace the RFP.</div>
    </div>
  );
}
