import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileUp, FileCheck2, ShieldAlert, Share2, FileText, ArrowRight, Loader2 } from "lucide-react";
import { api } from "../api.js";

export default function OfficerPortal() {
  const navigate = useNavigate();
  const [data,setData]=useState(null);
  useEffect(()=>{api.dashboard().then(setData).catch(()=>{});},[]);
  const stats=data?.stats || {};
  return <div className="fade-in space-y-6">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div><div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Government procurement workspace</div><h1 className="mt-1 text-2xl font-bold text-slate-900">Officer Command Center</h1><p className="mt-1 text-sm text-slate-500">One place to publish tenders, review bids, verify documents and investigate network risk.</p></div>
      <button onClick={()=>navigate("/app/bid-intelligence")} className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"><FileUp size={16}/> Upload / Analyze RFP</button>
    </div>
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      <Stat label="Total bids" value={stats.totalBids ?? "—"} icon={FileCheck2}/>
      <Stat label="Verified" value={stats.verifiedBids ?? "—"} icon={FileCheck2}/>
      <Stat label="Needs review" value={stats.bidsNeedingReview ?? "—"} icon={ShieldAlert}/>
      <Stat label="High risk" value={stats.highRiskBids ?? "—"} icon={ShieldAlert}/>
      <Stat label="Networks" value={stats.potentialNetworks ?? "—"} icon={Share2}/>
    </div>
    <div className="grid gap-5 lg:grid-cols-3">
      <Action title="Create / analyze tender" text="Upload an RFP and automatically extract eligibility, document and technical requirements." icon={FileUp} onClick={()=>navigate("/app/bid-intelligence")}/>
      <Action title="Review submitted bids" text="Compare bidders, document status, eligibility and risk from one table." icon={FileCheck2} onClick={()=>navigate("/app/bid-verification")}/>
      <Action title="Investigate bidder network" text="Explore shared directors, addresses, phones, bank links and graph-derived clusters." icon={Share2} onClick={()=>navigate("/app/bidder-network")}/>
    </div>
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex items-center justify-between"><div><h2 className="font-semibold">Procurement review workflow</h2><p className="mt-1 text-sm text-slate-500">Keep the automated engine, but present its output in officer-friendly language.</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Human review required</span></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">{["RFP uploaded","Requirements extracted","Bids verified","Risk investigated"].map((x,i)=><div key={x} className="rounded-lg border border-slate-100 bg-slate-50 p-4"><div className="text-xs font-semibold text-brand-600">0{i+1}</div><div className="mt-2 text-sm font-semibold">{x}</div><p className="mt-1 text-xs text-slate-500">{["Create the tender checklist.","See mandatory evidence.","Compare complete / missing documents.","Review graph connections and explanations."][i]}</p></div>)}</div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
        <h2 className="font-semibold">Reports</h2><p className="mt-1 text-sm text-slate-500">Generate readable PDF reports for tender review and audit.</p>
        <button onClick={()=>navigate("/app/reports")} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white"><FileText size={15}/> Open reports</button>
      </div>
    </div>
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card"><h2 className="font-semibold">Officer-friendly output</h2><div className="mt-3 grid gap-3 md:grid-cols-3"><div><b className="text-sm">What is complete?</b><p className="mt-1 text-xs text-slate-500">Requirement-by-requirement evidence and document status.</p></div><div><b className="text-sm">Why is risk raised?</b><p className="mt-1 text-xs text-slate-500">Plain-language explanation of the signals and bidder connections.</p></div><div><b className="text-sm">What should I review?</b><p className="mt-1 text-xs text-slate-500">Clear review priorities without treating an automated score as a final finding.</p></div></div></div>
  </div>;
}
function Stat({label,value,icon:Icon}){return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><Icon size={17} className="text-brand-600"/><div className="mt-2 text-2xl font-bold">{value}</div><div className="text-xs text-slate-500">{label}</div></div>}
function Action({title,text,icon:Icon,onClick}){return <button onClick={onClick} className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-card hover:border-brand-200"><Icon size={20} className="text-brand-600"/><h3 className="mt-3 font-semibold">{title}</h3><p className="mt-1 text-sm leading-5 text-slate-500">{text}</p><span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">Open <ArrowRight size={13}/></span></button>}
