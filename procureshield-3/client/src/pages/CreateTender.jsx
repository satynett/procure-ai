import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, UploadCloud } from "lucide-react";
import DocumentDropzone from "../components/DocumentDropzone.jsx";
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
  const [files, setFiles] = useState([]);
  const [uploadErrors, setUploadErrors] = useState([]);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function analyzeRfp() {
    if (!files.length) return setError("Upload at least one RFP document first.");
    setAnalyzing(true); setError(""); setMessage("");
    try {
      const analyzed = [];
      for (const file of files) {
        const content_base64 = await encodeFile(file);
        const result = await api.intelligencePdf({ filename:file.name, content_type:file.type || "application/pdf", content_base64 });
        if (result.extraction_status === "wrong_document") {
          throw new Error(result.message || `Wrong document: ${file.name} does not appear to be a valid procurement RFP.`);
        }
        analyzed.push({ ...result.requirements, rfp_text: result.text, extraction_status: result.extraction_status, filename: file.name });
      }
      const combined = analyzed.reduce((acc, item) => ({
        ...acc,
        eligibility_requirements: [...(acc.eligibility_requirements || []), ...(item.eligibility_requirements || [])],
        required_documents: [...new Set([...(acc.required_documents || []), ...(item.required_documents || [])])],
        technical_requirements: [...(acc.technical_requirements || []), ...(item.technical_requirements || [])],
        important_dates: [...new Set([...(acc.important_dates || []), ...(item.important_dates || [])])],
        rfp_text: [acc.rfp_text, item.rfp_text].filter(Boolean).join("

"),
      }), { eligibility_requirements: [], required_documents: [], technical_requirements: [], important_dates: [], rfp_text: "" });
      setParsed(combined);
      setMessage(`${files.length} RFP document${files.length !== 1 ? "s" : ""} analyzed. Review the extracted checklist before saving or publishing.`);
    } catch(e) { setError(e.message || "RFP analysis failed."); }
    finally { setAnalyzing(false); }
  }

  async function save(publish) {
    if (!files.length) return setError("Upload at least one RFP document first.");
    setBusy(true); setError(""); setMessage("");
    try {
      const rfp_documents = await Promise.all(files.map(async (file) => ({
        filename: file.name,
        content_type: file.type || "application/pdf",
        content_base64: await encodeFile(file),
      })));
      const result = await api.createTender({
        ...form,
        estimated_value: Number(form.estimated_value || 0),
        publish,
        rfp_filename: files[0].name,
        rfp_content_base64: rfp_documents[0].content_base64,
        rfp_documents,
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
        <div className="mt-5">
          <DocumentDropzone
            files={files}
            errors={uploadErrors}
            onChange={(next, rejected) => { setFiles(next); setUploadErrors(rejected); setParsed(null); }}
            label="Upload RFP documents"
            hint="Drag and drop multiple PDF, DOC or DOCX tender documents. Wrong file types are rejected immediately."
          />
          <button disabled={!files.length || analyzing} onClick={analyzeRfp} className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{analyzing ? "Analyzing RFPs…" : "Analyze RFPs"}</button>
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
        <button disabled={busy || !files.length} onClick={()=>save(false)} className="rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold disabled:opacity-50">Save Draft</button>
        <button disabled={busy || !files.length || !form.title || !form.department || !form.deadline} onClick={()=>save(true)} className="flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy && <Loader2 size={15} className="animate-spin"/>} Publish Tender</button>
      </div>
    </div>
  );
}

function Field({label,value,onChange,type="text",placeholder=""}) {
  return <label className="block"><span className="text-xs font-semibold text-slate-500">{label}</span><input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400"/></label>;
}
