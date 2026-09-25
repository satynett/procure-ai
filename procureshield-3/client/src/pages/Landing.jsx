import React from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck, Share2, Users, ArrowRight, FlaskConical,
  Building2, BriefcaseBusiness, FileCheck2, SearchCheck, LockKeyhole,
  Menu, X
} from "lucide-react";

export default function Landing() {
  const navigate = useNavigate();
  const [launcherOpen, setLauncherOpen] = React.useState(false);

  return (
    <div className="h-screen overflow-hidden bg-slate-100 text-slate-900">
      <header className="mx-auto flex h-[68px] max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white">
            <ShieldCheck size={20} />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight text-slate-900">ProcureShield AI</div>
            <div className="text-[11px] leading-tight text-slate-500">GeM Bid Verification & Network Risk Analysis</div>
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
          <FlaskConical size={12} /> DEMO / SANDBOX DATA
        </span>
      </header>

      <div className="fixed right-5 top-5 z-50">
        {launcherOpen ? (
          <div className="w-[320px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-slate-800 px-3.5 py-2.5 text-white">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-700"><ShieldCheck size={16} /></div>
                <div>
                  <div className="text-xs font-bold">ProcureShield AI</div>
                  <div className="text-[9px] text-slate-300">GeM Verification System</div>
                </div>
              </div>
              <button
                onClick={() => setLauncherOpen(false)}
                className="flex items-center gap-1 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[10px] font-bold text-white hover:bg-white/20"
              >
                <X size={12} /> Minimise
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3">
              <MiniAction label="Officer Command Center" onClick={() => navigate("/app/officer")} icon={Building2} />
              <MiniAction label="Create Tender" onClick={() => navigate("/app/tenders/new")} icon={BriefcaseBusiness} />
              <MiniAction label="Dashboard" onClick={() => navigate("/app/dashboard")} icon={FileCheck2} />
              <MiniAction label="Bid Verification" onClick={() => navigate("/app/bid-verification")} icon={SearchCheck} />
              <MiniAction label="Bidder Network" onClick={() => navigate("/app/bidder-network")} icon={Share2} />
              <MiniAction label="Risk Analysis" onClick={() => navigate("/app/risk-analysis")} icon={ShieldCheck} />
              <MiniAction label="Alerts" onClick={() => navigate("/app/alerts")} icon={LockKeyhole} />
              <MiniAction label="Reports" onClick={() => navigate("/app/reports")} icon={FileCheck2} />
              <MiniAction label="Settings" onClick={() => navigate("/app/settings")} icon={Users} />
            </div>
          </div>
        ) : (
          <button
            onClick={() => setLauncherOpen(true)}
            title="Open ProcureShield menu"
            aria-label="Open ProcureShield menu"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-white shadow-xl ring-4 ring-white hover:bg-slate-700"
          >
            <Menu size={22} />
          </button>
        )}
      </div>

      <section className="mx-auto flex h-[calc(100vh-68px-128px)] max-w-4xl flex-col justify-center px-6 text-center">
        <div className="mb-3 inline-flex self-center items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
          Smart India Hackathon Prototype
        </div>

        <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl">
          Making GeM Procurement <span className="text-emerald-700">Smarter, Faster</span> &amp; More Transparent
        </h1>

        <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600">
          Automated bid verification and bidder relationship analysis for procurement officers.
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
            <button
              onClick={() => navigate("/bidder")}
              className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
            >
              <div className="flex items-center gap-2 text-emerald-700">
                <BriefcaseBusiness size={18} />
                <span className="text-xs font-bold uppercase tracking-wide">Bidder Portal</span>
              </div>
              <div className="mt-2 text-base font-semibold text-slate-900">Find tenders & check eligibility</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">Browse opportunities, verify documents and prepare your bid.</div>
            </button>

            <button
              onClick={() => navigate("/login")}
              className="rounded-xl bg-blue-700 p-4 text-left text-white shadow-md transition hover:-translate-y-0.5 hover:bg-blue-800"
            >
              <div className="flex items-center gap-2 text-white">
                <Building2 size={18} />
                <span className="text-xs font-bold uppercase tracking-wide">Officer Portal</span>
              </div>
              <div className="mt-2 text-base font-semibold">Manage procurement & review bids</div>
              <div className="mt-1 text-xs leading-5 text-blue-100">Upload RFPs, verify documents, inspect risk and bidder networks.</div>
            </button>
          </div>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Uses realistic synthetic/sandbox data only. Not connected to live GeM government systems.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <FeatureCard icon={ShieldCheck} title="Automated Verification" desc="Reduce repetitive manual checklist verification with structured, explainable automated checks." />
          <FeatureCard icon={Share2} title="Network Analysis" desc="Identify relationships between bidders using multiple data signals — director, address, phone, and bank matches." />
          <FeatureCard icon={Users} title="Human-in-the-Loop" desc="Every automated finding is advisory. Final decisions always remain with authorized procurement officers." />
        </div>
      </section>

      <footer className="h-[44px] border-t border-slate-200 bg-slate-800 text-center text-[10px] text-slate-400">
        <div className="flex h-full items-center justify-center px-6">
          ProcureShield AI — Prototype for demonstration purposes only. Synthetic data. No live GeM API connectivity.
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
        <Icon size={19} />
      </div>
      <h3 className="mb-1.5 text-sm font-bold text-slate-900">{title}</h3>
      <p className="text-xs leading-5 text-slate-500">{desc}</p>
    </div>
  );
}

function MiniAction({ label, onClick, icon: Icon }) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-2 text-center text-[10px] font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
    >
      <Icon size={16} className="text-emerald-700" />
      <span>{label}</span>
    </button>
  );
}
