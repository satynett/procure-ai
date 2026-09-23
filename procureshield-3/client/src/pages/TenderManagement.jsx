import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, FileText, Users, ClipboardCheck, ShieldAlert, History,
  Award, Ban, Trash2, ExternalLink, CheckCircle2, XCircle, AlertTriangle, Loader2
} from "lucide-react";
import { api } from "../api.js";

const money = (n) => n == null || Number.isNaN(Number(n)) ? "—" : "₹" + Number(n).toLocaleString("en-IN");
const statusClass = (s) => s === "Verified" ? "bg-emerald-50 text-emerald-700" : s === "Rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";

export default function TenderManagement() {
  const { tenderId } = useParams();
  const navigate = useNavigate();
  const [data,setData]=useState(null);
  const [tab,setTab]=useState("overview");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [selectedBid,setSelectedBid]=useState("");
  const [bidderHistory,setBidderHistory]=useState(null);
  const [awardAmount,setAwardAmount]=useState("");
  const [aiExpanded,setAiExpanded]=useState(false);

  async function load() {
    try { setError(""); setData(await api.officerTenderDetail(tenderId)); }
    catch(e){ setError(e.message || "Unable to load tender."); }
  }
  useEffect(()=>{load();},[tenderId]);

  async function action(action, extra={}) {
    setBusy(true); setError("");
    try { await api.updateTender(tenderId,{action,...extra}); await load(); }
    catch(e){setError(e.message || "Tender action failed.");}
    finally{setBusy(false);}
  }

  async function remove() {
    if (!window.confirm("Permanently remove this draft/withdrawn tender?")) return;
    setBusy(true);
    try { await api.deleteTender(tenderId); navigate("/app/officer"); }
    catch(e){setError(e.message || "Tender could not be removed."); setBusy(false);}
  }

  if (!data) return <div className="flex h-64 items-center justify-center text-slate-400"><Loader2 className="animate-spin"/></div>;
  const t=data.tender, bids=data.bids || [];
  async function openBidderHistory(bidderId) {
    try { setBidderHistory(await api.bidderDetail(bidderId)); } catch(e) { setError(e.message || "Unable to load bidder history."); }
  }

  function viewRfp() {
    if (!t.rfp_content_base64) return;
    const win=window.open();
    if(win) { win.document.write('<iframe style="width:100%;height:100%;border:0" src="data:application/pdf;base64,'+t.rfp_content_base64+'"></iframe>'); }
  }

  return (
    <div className="fade-in mx-auto max-w-7xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button onClick={()=>navigate("/app/officer")} className="rounded-lg border border-slate-200 bg-white p-2"><ArrowLeft size={17}/></button>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">{t.tender_id}</div>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">{t.title}</h1>
            <p className="mt-1 text-sm text-slate-500">{t.department} · {t.category}</p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold">{t.status}</span>
          {t.status === "Draft" && <button onClick={()=>action("publish")} disabled={busy} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white">Publish</button>}
          {t.status === "Open" && <button onClick={()=>action("close")} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold">Close Tender</button>}
          {["Draft","Open"].includes(t.status) && <button onClick={()=>action("withdraw")} disabled={busy} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700"><Ban size={14} className="mr-1 inline"/>Withdraw</button>}
          {["Draft","Withdrawn"].includes(t.status) && <button onClick={remove} disabled={busy} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"><Trash2 size={14} className="mr-1 inline"/>Remove</button>}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="Bids" value={data.stats.total_bids}/>
        <Metric label="Verified" value={data.stats.verified}/>
        <Metric label="Needs review" value={data.stats.needs_review}/>
        <Metric label="Government estimate" value={money(t.estimated_value)}/>
        <Metric label="Lowest quote" value={money(data.stats.lowest_quote)}/>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        <Tab active={tab==="overview"} onClick={()=>setTab("overview")} icon={FileText}>Overview</Tab>
        <Tab active={tab==="rfp"} onClick={()=>setTab("rfp")} icon={ClipboardCheck}>RFP & Checklist</Tab>
        <Tab active={tab==="bidders"} onClick={()=>setTab("bidders")} icon={Users}>Bidders</Tab>
        <Tab active={tab==="compliance"} onClick={()=>setTab("compliance")} icon={CheckCircle2}>Compliance</Tab>
        <Tab active={tab==="risk"} onClick={()=>setTab("risk")} icon={ShieldAlert}>Risk</Tab>
        <Tab active={tab==="audit"} onClick={()=>setTab("audit")} icon={History}>Audit</Tab>
      </div>

      {tab==="overview" && <Overview t={t} data={data} bids={bids} onBidders={()=>setTab("bidders")} />}
      {tab==="rfp" && <RfpTab t={t} onView={viewRfp} />}
      {tab==="bidders" && <BiddersTab bids={bids} t={t} onHistory={openBidderHistory} onAward={(bid)=>{setSelectedBid(bid.bid_id);setAwardAmount(String(bid.quoted_amount||""));setTab("overview");}} />}
      {tab==="compliance" && <ComplianceTab bids={bids} />}
      {tab==="risk" && <RiskTab bids={bids} onOpenBid={(id)=>navigate("/app/bid-verification/"+encodeURIComponent(id))} />}
      {tab==="audit" && <AuditTab tenderId={t.tender_id} />}

      {bidderHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div><div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Bidder History</div><h2 className="mt-1 text-xl font-bold">{bidderHistory.bidder?.company_name || "Bidder"}</h2><p className="mt-1 text-sm text-slate-500">{bidderHistory.bidder?.email || "—"} · {bidderHistory.bidder?.gst_number || "—"}</p></div>
              <button onClick={()=>setBidderHistory(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">Close</button>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-4">
              <Info label="Email" value={bidderHistory.bidder?.email || "—"}/>
              <Info label="Phone" value={bidderHistory.bidder?.phone_masked || bidderHistory.bidder?.phone || "—"}/>
              <Info label="GSTIN" value={bidderHistory.bidder?.gst_number || "—"}/>
              <Info label="MSME" value={bidderHistory.bidder?.msme_status || "—"}/>
            </div>
            <h3 className="mt-6 font-semibold">Previous tender participation</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="p-3">Tender</th><th className="p-3">Submitted</th><th className="p-3">Bid amount</th><th className="p-3">Status</th></tr></thead>
              <tbody>{(bidderHistory.bids||[]).map(b=><tr key={b.bid_id} className="border-b border-slate-100"><td className="p-3"><div className="font-medium">{b.tender_id}</div><div className="text-xs text-slate-500">{b.category}</div></td><td className="p-3">{b.submission_date||"—"}</td><td className="p-3 font-semibold">{money(b.bid_amount)}</td><td className="p-3">{b.verification_status||"—"}</td></tr>)}</tbody></table>
            </div>
            <p className="mt-4 text-xs text-slate-500">Historical bids come from the shared bid dataset. Government estimated/award values are shown on each tender's management page.</p>
          </div>
        </div>
      )}

      {selectedBid && t.status !== "Awarded" && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><h2 className="font-semibold text-emerald-900">Award selected bidder</h2><p className="mt-1 text-sm text-emerald-800">Selected bid: {selectedBid}. Record the final accepted award amount separately from the bidder quote.</p></div>
            <div className="flex gap-2">
              <input value={awardAmount} onChange={e=>setAwardAmount(e.target.value)} className="w-40 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm" placeholder="Award amount"/>
              <button onClick={()=>action("award",{bid_id:selectedBid,award_amount:Number(awardAmount||0)})} disabled={busy} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"><Award size={15} className="mr-1 inline"/>Confirm Award</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({label,value}){return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><div className="text-lg font-bold text-slate-900">{value}</div><div className="mt-1 text-xs text-slate-500">{label}</div></div>}
function Tab({active,onClick,icon:Icon,children}){return <button onClick={onClick} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${active?"bg-brand-600 text-white":"bg-white text-slate-600 hover:bg-slate-100"}`}><Icon size={15}/>{children}</button>}

function Overview({t,data,bids,onBidders}) {
 return <div className="grid gap-5 lg:grid-cols-3">
   <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card lg:col-span-2">
     <h2 className="font-semibold">Tender overview</h2>
     <div className="mt-4 grid gap-3 sm:grid-cols-2">
       <Info label="Tender ID" value={t.tender_id}/><Info label="Published" value={t.published_at ? new Date(t.published_at).toLocaleString() : "—"}/>
       <Info label="Deadline" value={t.deadline || t.closing_date || "—"}/><Info label="Government estimated value" value={money(t.estimated_value)}/>
       <Info label="Award amount" value={money(t.award_amount)}/><Info label="Winner" value={t.winner_name || "Not awarded"}/>
     </div>
     <div className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{t.eligibility_summary || "Officer checklist review required."}</div>
   </section>
   <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
     <h2 className="font-semibold">Bid snapshot</h2>
     <div className="mt-4 space-y-3 text-sm">
       <Row label="Total bids" value={data.stats.total_bids}/><Row label="Verified" value={data.stats.verified}/><Row label="Needs review" value={data.stats.needs_review}/><Row label="Lowest quote" value={money(data.stats.lowest_quote)}/><Row label="Highest quote" value={money(data.stats.highest_quote)}/>
     </div>
     <button onClick={onBidders} className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white">View bidder history</button>
   </section>
 </div>;
}

function RfpTab({t,onView}) {
 const ai=t.ai_analysis;
 return <div className="space-y-5">
   <div className="grid gap-5 lg:grid-cols-2">
     <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
       <h2 className="font-semibold">Published RFP</h2><p className="mt-1 text-sm text-slate-500">{t.rfp_filename}</p>
       <button onClick={onView} className="mt-4 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold"><ExternalLink size={15} className="mr-1 inline"/>Open RFP PDF</button>
     </section>
     <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
       <h2 className="font-semibold">Extracted requirements</h2>
       <div className="mt-4 space-y-2">
         {(t.required_documents||[]).map(x=><div key={x} className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm"><CheckCircle2 size={15} className="text-emerald-600"/>{x}</div>)}
         {(t.eligibility_requirements||[]).map(x=><div key={x.requirement} className="rounded-lg border border-slate-100 p-3 text-sm"><b>{x.requirement}</b><div className="text-xs text-slate-500">{x.type}</div></div>)}
       </div>
     </section>
   </div>
   <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
     <div className="flex flex-wrap items-start justify-between gap-3">
       <div>
         <div className="flex items-center gap-2"><h2 className="font-semibold">AI RFP Understanding</h2>{ai?.enabled && <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">OpenRouter · {ai.model}</span>}</div>
         <p className="mt-1 text-sm text-slate-500">AI interprets the extracted RFP; deterministic requirements remain the compliance source.</p>
       </div>
       {ai && <button onClick={()=>setAiExpanded(v=>!v)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold">{aiExpanded?"Hide details":"View AI details"}</button>}
     </div>
     {!ai && <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">AI analysis is not available for this tender. The deterministic parser remains active.</div>}
     {ai?.enabled && <div className="mt-4 space-y-4">
       <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-700">{ai.summary || "No AI summary available."}</div>
       {aiExpanded && <div className="grid gap-4 lg:grid-cols-2">
         <AiList title="AI eligibility interpretation" items={ai.eligibility_requirements||[]} />
         <AiList title="AI technical interpretation" items={ai.technical_requirements||[]} />
         <AiDocs items={ai.required_documents||[]} />
         <AiUncertainties items={ai.uncertainties||[]} />
       </div>}
     </div>}
   </section>
 </div>;
}
function AiList({title,items}){return <section className="rounded-lg border border-slate-100 p-4"><h3 className="text-sm font-semibold">{title}</h3><div className="mt-3 space-y-2">{items.length?items.map((x,i)=><div key={i} className="rounded-lg bg-slate-50 p-3 text-sm"><div className="font-medium text-slate-800">{x.requirement}</div><div className="mt-1 text-xs text-slate-500">{x.type}{x.mandatory===false?" · conditional":" · mandatory"}{x.minimum_value!=null?" · min "+x.minimum_value+" "+(x.unit||""):""}</div></div>):<div className="text-sm text-slate-400">No items detected.</div>}</div></section>}
function AiDocs({items}){return <section className="rounded-lg border border-slate-100 p-4"><h3 className="text-sm font-semibold">AI-required documents</h3><div className="mt-3 flex flex-wrap gap-2">{items.length?items.map(x=><span key={x} className="rounded-full bg-slate-50 px-3 py-1.5 text-xs text-slate-600">{x}</span>):<span className="text-sm text-slate-400">No documents detected.</span>}</div></section>}
function AiUncertainties({items}){return <section className="rounded-lg border border-amber-100 bg-amber-50/50 p-4"><h3 className="text-sm font-semibold text-amber-900">AI review flags</h3><div className="mt-3 space-y-2">{items.length?items.map((x,i)=><div key={i} className="flex gap-2 text-sm text-amber-900"><AlertTriangle size={15} className="mt-0.5 shrink-0"/><span>{x}</span></div>):<div className="text-sm text-amber-800">No uncertainties detected.</div>}</div></section>}

function BiddersTab({bids,t,onAward,onHistory}) {
 return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
   <div className="flex items-center justify-between"><div><h2 className="font-semibold">Bidder participation & history</h2><p className="mt-1 text-sm text-slate-500">Email, quote, government estimate, verification and risk are shown for this tender.</p></div></div>
   <div className="mt-4 overflow-x-auto">
    <table className="min-w-full text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="p-3">Bidder</th><th className="p-3">Email</th><th className="p-3">Submitted</th><th className="p-3">Bidder quote</th><th className="p-3">Gov. estimate</th><th className="p-3">Status</th><th className="p-3">Risk</th><th className="p-3"></th></tr></thead>
    <tbody>{bids.length ? bids.map(b=><tr key={b.bid_id} className="border-b border-slate-100 align-top"><td className="p-3"><button onClick={()=>onHistory(b.bidder_id)} className="text-left"><div className="font-semibold text-brand-700 hover:underline">{b.bidder_name}</div><div className="text-xs text-slate-500">{b.gst_number}</div><div className="mt-1 text-[11px] text-brand-600">View bidder history</div></button></td><td className="p-3">{b.bidder_email}</td><td className="p-3">{b.submission_date||"—"}</td><td className="p-3 font-semibold">{money(b.quoted_amount)}</td><td className="p-3">{money(b.government_estimated_value)}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClass(b.verification_status)}`}>{b.verification_status}</span></td><td className="p-3">{b.risk_score}/100 · {b.risk_category}</td><td className="p-3"><button onClick={()=>onAward(b)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold">Select for Award</button></td></tr>):<tr><td colSpan="8" className="p-8 text-center text-sm text-slate-400">No bids have been submitted for this tender yet.</td></tr>}</tbody></table>
   </div>
   <p className="mt-4 text-xs text-slate-500">A bidder's full cross-tender history remains available through Bid Verification and Bidder Network. This table is the history for the selected tender.</p>
 </section>;
}

function ComplianceTab({bids}) {
 return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card"><h2 className="font-semibold">Final compliance comparison</h2><p className="mt-1 text-sm text-slate-500">Requirement-by-requirement comparison generated for each submitted bid.</p><div className="mt-4 space-y-3">{bids.length?bids.map(b=><div key={b.bid_id} className="rounded-lg border border-slate-100 p-4"><div className="flex justify-between gap-3"><div className="font-semibold">{b.bidder_name}</div><div className="text-sm font-bold">{b.finalComparison?.score ?? "—"}%</div></div><div className="mt-2 text-xs text-slate-500">{b.verification_status} · Bid {money(b.quoted_amount)}</div></div>):<Empty/>}</div></section>;
}
function RiskTab({bids,onOpenBid}){return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card"><h2 className="font-semibold">Risk review</h2><p className="mt-1 text-sm text-slate-500">Relationship risk is a review signal, not a finding of wrongdoing.</p><div className="mt-4 space-y-2">{bids.length?bids.map(b=><button key={b.bid_id} onClick={()=>onOpenBid(b.bid_id)} className="flex w-full items-center justify-between rounded-lg border border-slate-100 p-3 text-left hover:bg-slate-50"><span><b>{b.bidder_name}</b><span className="ml-2 text-xs text-slate-500">{b.bid_id}</span></span><span className="text-sm font-semibold">{b.risk_score}/100 · {b.risk_category}</span></button>):<Empty/>}</div></section>}
function AuditTab({tenderId}){const [log,setLog]=useState([]);useEffect(()=>{api.auditLog().then(x=>setLog((x.log||[]).filter(e=>e.tender_id===tenderId)));},[tenderId]);return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card"><h2 className="font-semibold">Tender audit timeline</h2><div className="mt-4 space-y-3">{log.length?log.map(x=><div key={x.id} className="border-l-2 border-brand-200 pl-4"><div className="text-sm font-semibold">{x.action}</div><div className="text-xs text-slate-500">{new Date(x.timestamp).toLocaleString()} · {x.officer}</div></div>):<Empty/>}</div></section>}
function Info({label,value}){return <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-400">{label}</div><div className="mt-1 text-sm font-semibold text-slate-700">{value}</div></div>}
function Row({label,value}){return <div className="flex justify-between border-b border-slate-100 pb-2"><span className="text-slate-500">{label}</span><b>{value}</b></div>}
function Empty(){return <div className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-400">No data available for this tender.</div>}
