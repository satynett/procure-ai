import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FileCheck2, Clock3, ArrowRight, ShieldCheck, Upload, IndianRupee } from "lucide-react";
import { api } from "../api.js";

export default function BidderPortal() {
  const navigate = useNavigate();
  const [bids, setBids] = useState([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.bids({}).then((res) => { setBids(res.bids || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const tenders = useMemo(() => {
    const map = new Map();
    for (const bid of bids) {
      if (!map.has(bid.tender_id)) map.set(bid.tender_id, { tender_id: bid.tender_id, category: bid.category, bids: 0, latest: bid.submission_date, amount: bid.bid_amount });
      const t = map.get(bid.tender_id);
      t.bids += 1;
      t.amount = Math.max(t.amount || 0, bid.bid_amount || 0);
      if (bid.submission_date > t.latest) t.latest = bid.submission_date;
    }
    return Array.from(map.values()).map((t, i) => ({
      ...t,
      title: ["Supply of Electrical Equipment", "Electrical Infrastructure Works", "Security & Facility Services", "Medical Equipment Supply", "IT Hardware Procurement"][i % 5],
      department: ["Ministry / Department", "State Procurement Division", "Public Works / Services", "Health Department", "IT Procurement Cell"][i % 5],
      deadline: new Date(new Date(t.latest).getTime() + (12 + i) * 86400000).toISOString().slice(0,10),
      estimatedValue: Math.round((t.amount || 0) * 1.2),
    }));
  }, [bids]);

  const filtered = tenders.filter(t => (!q || (t.title + t.tender_id + t.department).toLowerCase().includes(q.toLowerCase())) && (!category || t.category === category));
  const categories = [...new Set(tenders.map(t => t.category))];

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div><div className="text-lg font-bold">ProcureShield</div><div className="text-xs text-slate-500">Bidder Portal</div></div>
        <div className="flex gap-2">
          <button onClick={() => navigate("/bidder/documents")} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold"><FileCheck2 size={16}/> My Eligibility</button>
          <button onClick={() => navigate("/")} className="rounded-lg px-3 py-2 text-sm text-slate-500">Switch Portal</button>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-7">
      <section className="rounded-2xl bg-navy-950 p-7 text-white">
        <div className="max-w-2xl"><div className="text-xs font-semibold uppercase tracking-widest text-brand-300">For bidders & suppliers</div><h1 className="mt-2 text-3xl font-bold">Find a tender. Check eligibility. Bid with confidence.</h1><p className="mt-3 text-sm leading-6 text-slate-300">See active procurement opportunities and verify your documents before you submit a bid.</p></div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Quick title="Browse tenders" icon={Search} text="Find procurement opportunities" onClick={() => document.getElementById("tenders")?.scrollIntoView({behavior:"smooth"})}/>
          <Quick title="Check documents" icon={Upload} text="Find missing requirements" onClick={() => navigate("/bidder/documents")}/>
          <Quick title="My bids" icon={ShieldCheck} text="Review your submission status" onClick={() => document.getElementById("tenders")?.scrollIntoView({behavior:"smooth"})}/>
        </div>
      </section>

      <section id="tenders" className="space-y-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-xl font-bold">Open procurement opportunities</h2><p className="text-sm text-slate-500">Prototype opportunities derived from the sandbox procurement dataset.</p></div><div className="flex gap-2"><div className="relative"><Search className="absolute left-3 top-2.5 text-slate-400" size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search tenders" className="rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm"/></div><select value={category} onChange={e=>setCategory(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div></div>
        {loading ? <div className="rounded-xl bg-white p-10 text-center text-sm text-slate-400">Loading opportunities...</div> :
        <div className="grid gap-4 lg:grid-cols-2">{filtered.map(t=><TenderCard key={t.tender_id} tender={t} navigate={navigate}/>)}</div>}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Info icon={ShieldCheck} title="Pre-bid document check" text="Upload your PDFs and see which requirements are complete, missing or need review." onClick={()=>navigate("/bidder/documents")}/>
        <Info icon={Clock3} title="Deadline awareness" text="Keep closing dates and tender requirements visible before you submit."/>
        <Info icon={FileCheck2} title="Evidence-based checks" text="Each checklist result shows the document evidence behind it."/>
      </section>
    </main>
    <footer className="border-t border-slate-200 bg-white px-6 py-5 text-center text-xs text-slate-500">Prototype / sandbox data — not connected to live GeM systems.</footer>
  </div>;
}

function Quick({title,text,icon:Icon,onClick}) { return <button onClick={onClick} className="rounded-xl border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10"><Icon size={18} className="text-brand-300"/><div className="mt-3 text-sm font-semibold">{title}</div><div className="mt-1 text-xs text-slate-400">{text}</div></button>; }
function Info({title,text,icon:Icon,onClick}) { return <button onClick={onClick} className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-brand-200"><Icon className="text-brand-600" size={20}/><div className="mt-3 font-semibold">{title}</div><p className="mt-1 text-sm text-slate-500">{text}</p></button>; }
function TenderCard({t,navigate}) { return <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-semibold text-brand-600">{t.tender_id}</div><h3 className="mt-1 text-base font-bold">{t.title}</h3><p className="mt-1 text-sm text-slate-500">{t.department} · {t.category}</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Open</span></div><div className="mt-4 grid grid-cols-3 gap-3 border-y border-slate-100 py-3 text-xs"><div><span className="text-slate-400">Deadline</span><div className="mt-1 font-semibold">{t.deadline}</div></div><div><span className="text-slate-400">Estimated value</span><div className="mt-1 flex items-center font-semibold"><IndianRupee size={12}/>{t.estimatedValue.toLocaleString("en-IN")}</div></div><div><span className="text-slate-400">Bids in dataset</span><div className="mt-1 font-semibold">{t.bids}</div></div></div><div className="mt-4 flex gap-2"><button onClick={()=>navigate("/bidder/documents")} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold">Check eligibility</button><button onClick={()=>navigate("/app/bid-intelligence")} className="flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">Bid now <ArrowRight size={14}/></button></div></article>; }
