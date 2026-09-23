import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FileCheck2, ArrowRight, ShieldCheck, IndianRupee } from "lucide-react";
import { api } from "../api.js";

export default function BidderPortal() {
  const navigate = useNavigate();
  const [bids, setBids] = useState([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    api.bids({})
      .then((res) => setBids(res.bids || []))
      .catch((err) => setError(err?.message || "Unable to load tenders."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const tenders = useMemo(() => {
    const map = new Map();
    for (const bid of bids) {
      if (!bid?.tender_id) continue;
      if (!map.has(bid.tender_id)) {
        map.set(bid.tender_id, {
          tender_id: bid.tender_id,
          category: bid.category || "General",
          bids: 0,
          latest: bid.submission_date,
          amount: Number(bid.bid_amount) || 0,
        });
      }
      const t = map.get(bid.tender_id);
      t.bids += 1;
      t.amount = Math.max(t.amount, Number(bid.bid_amount) || 0);
      if (bid.submission_date > t.latest) t.latest = bid.submission_date;
    }
    return Array.from(map.values()).map((t, i) => ({
      ...t,
      title: ["Supply of Electrical Equipment", "Electrical Infrastructure Works", "Security & Facility Services", "Medical Equipment Supply", "IT Hardware Procurement"][i % 5],
      department: ["Ministry / Department", "State Procurement Division", "Public Works / Services", "Health Department", "IT Procurement Cell"][i % 5],
      deadline: t.latest ? new Date(new Date(t.latest).getTime() + (12 + i) * 86400000).toISOString().slice(0, 10) : "—",
      estimatedValue: Math.round(t.amount * 1.2),
    }));
  }, [bids]);

  const categories = [...new Set(tenders.map((t) => t.category))];
  const filtered = tenders.filter((t) => {
    const haystack = `${t.title} ${t.tender_id} ${t.department}`.toLowerCase();
    return (!q || haystack.includes(q.toLowerCase())) && (!category || t.category === category);
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <div className="text-lg font-bold">ProcureShield</div>
            <div className="text-xs text-slate-500">Bidder Portal</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => navigate("/bidder/documents")} className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white">
              <FileCheck2 size={16} /> Check eligibility
            </button>
            <button onClick={() => navigate("/")} className="rounded-lg px-3 py-2 text-sm text-slate-500">Switch portal</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-7">
        <section className="rounded-2xl bg-navy-950 p-7 text-white">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-widest text-brand-300">For bidders & suppliers</div>
            <h1 className="mt-2 text-3xl font-bold">Find a tender. Check your eligibility. Prepare your bid.</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Browse prototype opportunities and upload your documents to identify missing or review-required requirements before submission.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-xl font-bold">Open opportunities</h2>
              <p className="text-sm text-slate-500">Currently shown from the prototype procurement dataset.</p>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-48 rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm" />
              </div>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">Loading opportunities…</div>
          ) : error ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
              <b>Could not load opportunities.</b>
              <div className="mt-1 text-xs">{error}</div>
              <button onClick={load} className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">No matching opportunities.</div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {filtered.map((t) => <TenderCard key={t.tender_id} tender={t} navigate={navigate} />)}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-brand-600" /> Pre-bid document check</div>
            <p className="mt-1 text-sm text-slate-500">Upload an RFP and your supporting PDFs to see complete, missing and review-required items.</p>
          </div>
          <button onClick={() => navigate("/bidder/documents")} className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
            Open checker <ArrowRight size={14} />
          </button>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-6 py-5 text-center text-xs text-slate-500">
        Prototype / sandbox data — not connected to live GeM systems.
      </footer>
    </div>
  );
}

function TenderCard({ tender: t, navigate }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-brand-600">{t.tender_id}</div>
          <h3 className="mt-1 text-base font-bold">{t.title}</h3>
          <p className="mt-1 text-sm text-slate-500">{t.department} · {t.category}</p>
        </div>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Open</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-y border-slate-100 py-3 text-xs">
        <div><span className="text-slate-400">Deadline</span><div className="mt-1 font-semibold">{t.deadline}</div></div>
        <div><span className="text-slate-400">Est. value</span><div className="mt-1 flex items-center font-semibold"><IndianRupee size={12} />{t.estimatedValue.toLocaleString("en-IN")}</div></div>
        <div><span className="text-slate-400">Bids</span><div className="mt-1 font-semibold">{t.bids}</div></div>
      </div>

      <button onClick={() => navigate("/bidder/documents")} className="mt-4 flex w-full items-center justify-center gap-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white">
        Check eligibility & prepare bid <ArrowRight size={14} />
      </button>
    </article>
  );
}
