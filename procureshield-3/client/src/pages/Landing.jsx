import React from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, Share2, Users, ArrowRight, FlaskConical, Building2, BriefcaseBusiness } from "lucide-react";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-navy-950 text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500">
            <ShieldCheck size={20} />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">ProcureShield AI</div>
            <div className="text-[11px] leading-tight text-slate-400">GeM Bid Verification & Network Risk Analysis</div>
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">
          <FlaskConical size={12} /> DEMO / SANDBOX DATA
        </span>
      </header>

      <section className="mx-auto max-w-4xl px-6 pb-16 pt-16 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
          Smart India Hackathon Prototype
        </div>
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          Making GeM Procurement <span className="text-brand-400">Smarter, Faster</span> &amp; More Transparent
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-300">
          Automated bid verification and bidder relationship analysis for procurement officers.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
            <button onClick={() => navigate("/bidder")} className="rounded-xl border border-white/10 bg-white/10 p-5 text-left hover:bg-white/15">
              <div className="flex items-center gap-2 text-brand-300"><BriefcaseBusiness size={18}/><span className="text-xs font-semibold uppercase tracking-wide">Bidder Portal</span></div>
              <div className="mt-2 text-base font-semibold">Find tenders & check eligibility</div>
              <div className="mt-1 text-xs text-slate-400">Browse opportunities, verify documents and prepare your bid.</div>
            </button>
            <button onClick={() => navigate("/login")} className="rounded-xl bg-brand-500 p-5 text-left shadow-lg shadow-brand-500/20 hover:bg-brand-600">
              <div className="flex items-center gap-2 text-white"><Building2 size={18}/><span className="text-xs font-semibold uppercase tracking-wide">Officer Portal</span></div>
              <div className="mt-2 text-base font-semibold">Manage procurement & review bids</div>
              <div className="mt-1 text-xs text-white/70">Upload RFPs, verify documents, inspect risk and bidder networks.</div>
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Uses realistic synthetic/sandbox data only. Not connected to live GeM government systems.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-5 sm:grid-cols-3">
          <FeatureCard
            icon={ShieldCheck}
            title="Automated Verification"
            desc="Reduce repetitive manual checklist verification with structured, explainable automated checks."
          />
          <FeatureCard
            icon={Share2}
            title="Network Analysis"
            desc="Identify relationships between bidders using multiple data signals — director, address, phone, and bank matches."
          />
          <FeatureCard
            icon={Users}
            title="Human-in-the-Loop"
            desc="Every automated finding is advisory. Final decisions always remain with authorized procurement officers."
          />
        </div>
      </section>

      <footer className="border-t border-white/10 py-6 text-center text-xs text-slate-500">
        ProcureShield AI — Prototype for demonstration purposes only. Synthetic data. No live GeM API connectivity.
      </footer>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-left transition-colors hover:bg-white/[0.06]">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
        <Icon size={20} />
      </div>
      <h3 className="mb-2 text-base font-semibold text-white">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-400">{desc}</p>
    </div>
  );
}
