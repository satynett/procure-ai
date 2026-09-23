import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, UploadCloud, FileText, CheckCircle2, Loader2 } from "lucide-react";
import { api } from "../api.js";

function encodeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CreateTender() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title:"", department:"", category:"IT Hardware", deadline:"", estimated_value:"" });
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function analyzeRfp() {
    if (!file) return setError("Upload the RFP PDF first.");
    setAnalyzing(true); setError(""); setMessage("");
    try {
      const content_base64 = await encodeFile(file);
      const result = await api.intelligencePdf({ filename:file.name, content_type:"application/pdf", content_base64 });
      setParsed({ ...result.requirements, rfp_text: result.text, extraction_status: result.extraction_status });
      setMessage("RFP analyzed. Review the extracted checklist before saving or publishing.");
    } catch(e) { setError(e.message || "RFP analysis failed."); }
    finally { setAnalyzing(false); }
  }

  async function save(publish) {
    if (!file) return setError("Upload the RFP PDF first.");
    setBusy(true); setError(""); setMessage("");
    try {
      const content_base64 = await encodeFile(file);
      const result = await api.createTender({
        ...form,
        estimated_value: Number(form.estimated_value || 0),
        publish,
        rfp_filename: file.name,
        rfp_content_base64: content_base64,
      });
      setParsed(result.tender);
      setMessage(publish ? "Tender published. It is now visible in the bidder portal." : "Draft saved. You can publish it from Tender Management.");
      if (publish) setTimeout(() => navigate("/app/officer"), 900);
    } catch (e) {
      setError(e.message || "Could not create tender.");
    } finally { setBusy(false); }
  }

  return (
    <div className="fade-in mx-auto max-w-4xl space-y-6">
      <div className="flex items-start gap-3">
        <button onClick={() => navigate("/app/officer")} className="rounded-lg border border-slate-200 bg-white p-2"><ArrowLeft size={17}/></button>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Tender Management</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Create New Tender</h1>
          <p className="mt-1 text-sm text-slate-500">Upload the official RFP, review extracted requirements, then save a draft or publish it.</p>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
        <h2 className="font-semibold">Tender details</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Tender title" value={form.title} onChange={v=>setForm({...form,title:v})} placeholder="Supply and Installation of..." />
          <Field label="Department" value={form.department} onChange={v=>setForm({...form,department:v})} placeholder="Department / Ministry" />
          <Field label="Category" value={form.category} onChange={v=>setForm({...form,category:v})} placeholder="IT Hardware" />
          <Field label="Deadline" type="date" value={form.deadline} onChange={v=>setForm({...form,deadline:v})} />
          <Field label="Government estimated value (₹)" type="number" value={form.estimated_value} onChange={v=>setForm({...form,estimated_value:v})} placeholder="5000000" />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-brand-50 p-2 text-brand-600"><UploadCloud size={20}/></div>
          <div><h2 className="font-semibold">Upload RFP</h2><p className="text-sm text-slate-500">The RFP belongs to the officer. The bidder only sees the published RFP.</p></div>
        </div>
        <div className="mt-5 rounded-xl border-2 border-dashed border-slate-200 p-8 text-center">
          <FileText className="mx-auto text-slate-400" size={30}/>
          <input className="mx-auto mt-4 block text-sm" type="file" accept=".pdf" onChange={e=>{setFile(e.target.files?.[0]||null);setParsed(null);}} />
          {file && <div className="mt-3 text-sm font-medium text-slate-700">{file.name}</div>}
          <p className="mt-2 text-xs text-slate-400">PDF only. Analyze it first so you can inspect the extracted checklist before publishing.</p>
          <button disabled={!file || analyzing} onClick={analyzeRfp} className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{analyzing ? "Analyzing RFP…" : "Analyze RFP"}</button>
        </div>
      </section>

      {parsed && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-card">
          <h2 className="font-semibold">Extracted checklist preview</h2>
          <p className="mt-1 text-sm text-slate-500">Review this before publishing. The parser is deterministic and human review remains required.</p>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {(parsed.required_documents || []).map(x=><div key={x} className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm"><CheckCircle2 size={16} className="text-emerald-600"/>{x}</div>)}
          </div>
          {parsed.eligibility_summary && <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{parsed.eligibility_summary}</div>}
        </section>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <button disabled={busy || !file} onClick={()=>save(false)} className="rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold disabled:opacity-50">Save Draft</button>
        <button disabled={busy || !file || !form.title || !form.department || !form.deadline} onClick={()=>save(true)} className="flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy && <Loader2 size={15} className="animate-spin"/>} Publish Tender</button>
      </div>
    </div>
  );
}

function Field({label,value,onChange,type="text",placeholder=""}) {
  return <label className="block"><span className="text-xs font-semibold text-slate-500">{label}</span><input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"/></label>;
}
