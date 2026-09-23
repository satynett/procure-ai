import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileUp, FileCheck2, Share2, FileText, ArrowRight, AlertTriangle, Loader2 } from "lucide-react";
import { api } from "../api.js";

export default function OfficerPortal() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.dashboard().then(setData).catch((err) => setError(err?.message || "Could not load officer data."));
  }, []);

  const stats = data?.stats || {};

  return (
    <div className="fade-in mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Procurement Officer</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Review Center</h1>
          <p className="mt-1 text-sm text-slate-500">Four steps: analyze the RFP, review bids, inspect risk, generate the report.</p>
        </div>
        <button onClick={() => navigate("/app/bid-intelligence")} className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
          <FileUp size={16} /> Analyze RFP
        </button>
      </div>

      {error && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</div>}

      {!data && !error ? (
        <div className="flex h-32 items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Total bids" value={stats.totalBids ?? "—"} />
            <Stat label="Verified" value={stats.verifiedBids ?? "—"} />
            <Stat label="Needs review" value={stats.bidsNeedingReview ?? "—"} />
            <Stat label="High risk" value={stats.highRiskBids ?? "—"} />
            <Stat label="Networks" value={stats.potentialNetworks ?? "—"} />
          </div>

          <section className="grid gap-4 md:grid-cols-2">
            <Action step="1" title="Analyze RFP" text="Upload a tender PDF and generate its eligibility and document checklist." icon={FileUp} onClick={() => navigate("/app/bid-intelligence")} />
            <Action step="2" title="Review bids" text="See bidder status, verification results, evidence and risk for submitted bids." icon={FileCheck2} onClick={() => navigate("/app/bid-verification")} />
            <Action step="3" title="Inspect bidder network" text="Explore shared bidder attributes and engine-generated relationship signals." icon={Share2} onClick={() => navigate("/app/bidder-network")} />
            <Action step="4" title="Generate report" text="Open the report workspace for verification, network and audit outputs." icon={FileText} onClick={() => navigate("/app/reports")} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <div className="flex items-start gap-3">
              <AlertTriangle size={19} className="mt-0.5 text-amber-600" />
              <div>
                <h2 className="font-semibold text-slate-900">How to use the results</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Compliance results and network risk are decision-support signals. Review the underlying evidence before taking procurement action.
                  The current prototype uses synthetic sandbox data and does not connect to live GeM or government registries.
                </p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </div>
  );
}

function Action({ step, title, text, icon: Icon, onClick }) {
  return (
    <button onClick={onClick} className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-card transition hover:border-brand-300">
      <div className="flex items-center justify-between">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{step}</span>
        <Icon size={19} className="text-brand-600" />
      </div>
      <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm leading-5 text-slate-500">{text}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">Open <ArrowRight size={13} /></span>
    </button>
  );
}
