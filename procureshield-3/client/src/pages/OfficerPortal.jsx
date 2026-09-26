import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ClipboardCheck, Users, AlertTriangle, FileText, ArrowRight, Loader2, CheckCircle2, CircleDot } from "lucide-react";
import { api } from "../api.js";
import { formatDateTime } from "../constants.js";

export default function OfficerPortal() {
  const navigate=useNavigate();
  const [tenders,setTenders]=useState([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);

  const load=()=>api.tenders().then(r=>setTenders(r.tenders||[])).catch(e=>setError(e.message||"Could not load tenders.")).finally(()=>setLoading(false));
  useEffect(()=>{load();},[]);

  const open=tenders.filter(t=>t.status==="Open");
  const drafts=tenders.filter(t=>t.status==="Draft");
  const awarded=tenders.filter(t=>t.status==="Awarded");
  const needsReview=open.reduce((n,t)=>n+(t.bid_count||0),0);

  return <div className="fade-in mx-auto max-w-7xl space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Procurement Officer</div><h1 className="mt-1 text-2xl font-bold text-slate-900">Officer Command Centre</h1><p className="mt-1 text-sm text-slate-500">Create tenders, manage live procurements, review bidder activity and complete awards.</p></div>
      <button onClick={()=>navigate("/app/tenders/new")} className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"><Plus size={16}/> Create New Tender</button>
    </div>

    {error&&<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {loading?<div className="flex h-32 items-center justify-center text-slate-400"><Loader2 className="animate-spin"/></div>:<>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <ActionStat label="Open tenders" value={open.length} icon={CircleDot} onClick={()=>document.getElementById("published-tenders")?.scrollIntoView({behavior:"smooth"})}/>
        <ActionStat label="Drafts" value={drafts.length} icon={FileText} onClick={()=>document.getElementById("draft-tenders")?.scrollIntoView({behavior:"smooth"})}/>
        <ActionStat label="Bids on open tenders" value={needsReview} icon={Users} onClick={()=>navigate("/app/bid-verification")}/>
        <ActionStat label="Awarded tenders" value={awarded.length} icon={CheckCircle2} onClick={()=>document.getElementById("awarded-tenders")?.scrollIntoView({behavior:"smooth"})}/>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Officer work queue</h2></div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Queue title="Create / publish" text="Upload an RFP and publish a tender." icon={Plus} onClick={()=>navigate("/app/tenders/new")}/>
          <Queue title="Bid verification" text="Review submitted documents, compliance and evidence." icon={ClipboardCheck} onClick={()=>navigate("/app/bid-verification")}/>
          <Queue title="Risk & network" text="Review bidder relationships and risk signals." icon={AlertTriangle} onClick={()=>navigate("/app/bidder-network")}/>
          <Queue title="Reports" text="Open verification and audit reports." icon={FileText} onClick={()=>navigate("/app/reports")}/>
        </div>
      </section>

      <TenderSection id="published-tenders" title="Published / Open Tenders" subtitle="Manage each live tender instead of opening a duplicate dashboard." tenders={open} actionLabel="Manage Tender" onOpen={id=>navigate("/app/tenders/"+encodeURIComponent(id))}/>
      <TenderSection id="draft-tenders" title="Draft Tenders" subtitle="Review, publish or remove drafts." tenders={drafts} actionLabel="Open Draft" onOpen={id=>navigate("/app/tenders/"+encodeURIComponent(id))}/>
      <TenderSection id="awarded-tenders" title="Closed / Awarded History" subtitle="Historical tender outcomes remain available for audit and bidder history." tenders={tenders.filter(t=>["Closed","Awarded","Withdrawn"].includes(t.status))} actionLabel="View History" onOpen={id=>navigate("/app/tenders/"+encodeURIComponent(id))}/>

    </>}
  </div>;
}

function ActionStat({label,value,icon:Icon,onClick}){return <button onClick={onClick} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card hover:border-brand-300"><Icon size={18} className="text-brand-600"/><div className="mt-3 text-2xl font-bold text-slate-900">{value}</div><div className="text-xs text-slate-500">{label}</div></button>}
function Queue({title,text,icon:Icon,onClick}){return <button onClick={onClick} className="rounded-xl border border-slate-200 p-4 text-left hover:bg-slate-50"><Icon size={18} className="text-brand-600"/><h3 className="mt-3 text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{text}</p><span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">Open <ArrowRight size={12}/></span></button>}
function TenderSection({id,title,subtitle,tenders,actionLabel,onOpen}){return <section id={id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div><span className="text-xs font-semibold text-slate-500">{tenders.length} tenders</span></div><div className="mt-4 space-y-2">{tenders.length?tenders.map(t=><div key={t.tender_id} className="flex flex-col justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 p-4 md:flex-row md:items-center"><div><div className="text-xs font-semibold text-brand-600">{t.tender_id}</div><div className="mt-1 font-semibold text-slate-800">{t.title}</div><div className="mt-1 text-xs text-slate-500">{t.department} · {t.bid_count||0} bids · {formatDateTime(t.deadline||t.closing_date)}</div></div><button onClick={()=>onOpen(t.tender_id)} className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white">{actionLabel}</button></div>):<div className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-400">No tenders in this section.</div>}</div></section>}
