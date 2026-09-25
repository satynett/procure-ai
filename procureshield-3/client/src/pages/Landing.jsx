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
            <div className="text-[11px] leading-tight text-slate-400">GeM procurement verification</div>
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">
          <FlaskConical size={12} /> Sandbox
        </span>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-20 pt-14">
        <section className="text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">Procurement verification</div>
          <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Verify bids with clarity.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-300">
            One workspace for bidder eligibility, tender compliance and procurement risk review.
          </p>

          <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-2">
            <button
              onClick={() => navigate("/bidder")}
              className="group rounded-xl border border-white/10 bg-white/[0.06] p-5 text-left transition hover:border-brand-400/40 hover:bg-white/[0.09]"
            >
              <div className="flex items-center gap-2 text-brand-300">
                <BriefcaseBusiness size={18} />
                <span className="text-xs font-semibold uppercase tracking-wide">Bidder Portal</span>
              </div>
              <div className="mt-3 text-lg font-semibold">Find tenders & check eligibility</div>
              <div className="mt-1 text-sm text-slate-400">Prepare documents and submit bids.</div>
              <ArrowRight className="mt-4 text-brand-400 transition group-hover:translate-x-1" size={17} />
            </button>

            <button
              onClick={() => navigate("/login")}
              className="group rounded-xl bg-brand-500 p-5 text-left transition hover:bg-brand-600"
            >
              <div className="flex items-center gap-2 text-white">
                <Building2 size={18} />
                <span className="text-xs font-semibold uppercase tracking-wide">Officer Portal</span>
              </div>
              <div className="mt-3 text-lg font-semibold">Manage tenders & review bids</div>
              <div className="mt-1 text-sm text-white/75">Verify compliance, risk and bidder relationships.</div>
              <ArrowRight className="mt-4 text-white transition group-hover:translate-x-1" size={17} />
            </button>
          </div>

          <p className="mt-4 text-xs text-slate-500">Synthetic and sandbox data only.</p>
        </section>

        <section className="mt-16 grid gap-3 sm:grid-cols-3">
          <FeatureCard icon={ShieldCheck} title="Compliance" desc="Requirement and document checks." />
          <FeatureCard icon={Share2} title="Network analysis" desc="Bidder relationships and risk signals." />
          <FeatureCard icon={Users} title="Human review" desc="Officer decisions remain final." />
        </section>
      </main>

      <footer className="border-t border-white/10 py-5 text-center text-xs text-slate-500">
        ProcureShield AI · Prototype / sandbox
      </footer>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
        <Icon size={18} />
      </div>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-400">{desc}</p>
    </div>
  );
}
