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
      <header className="h-[64px] border-b border-slate-700 bg-slate-800 text-white">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-5 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700">
              <ShieldCheck size={20} />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight">ProcureShield AI</div>
              <div className="text-[10px] leading-tight text-slate-300">GeM Procurement Verification</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-[11px] text-slate-300 md:block">Digital Procurement Workspace</span>
            <span className="flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
              <FlaskConical size={12} /> Sandbox
            </span>
          </div>
        </div>
      </header>

      <div className="fixed right-5 top-[78px] z-50">
        {launcherOpen ? (
          <div className="w-[330px] overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-slate-800 px-3.5 py-2.5 text-white">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-700"><ShieldCheck size={16} /></div>
                <div>
                  <div className="text-xs font-bold">ProcureShield AI</div>
                  <div className="text-[9px] text-slate-300">GeM Verification System</div>
                </div>
              </div>
              <button onClick={() => setLauncherOpen(false)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-white/10">
                <X size={13} /> Minimise
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
            className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-white shadow-xl ring-4 ring-white transition hover:bg-slate-700"
          >
            <Menu size={22} />
          </button>
        )}
      </div>

      <main className="mx-auto flex h-[calc(100vh-108px)] max-w-7xl flex-col px-5 py-5 lg:px-8">
        <section className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[1.02fr_0.98fr]">
          <div className="flex min-h-0 flex-col justify-center rounded-2xl border border-slate-200 bg-white px-6 py-6 shadow-sm lg:px-8">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-blue-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
              Procurement verification
            </div>

            <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-4xl lg:text-[42px]">
              Verify procurement decisions
              <span className="block text-slate-700">with clarity and traceability.</span>
            </h1>

            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
              A unified workspace for bidder eligibility, tender compliance, document verification and procurement risk review.
            </p>

            <div className="mt-5 grid max-w-xl grid-cols-3 gap-2.5">
              <InfoPill icon={FileCheck2} text="Document compliance" />
              <InfoPill icon={SearchCheck} text="Risk signals" />
              <InfoPill icon={LockKeyhole} text="Auditable workflow" />
            </div>

            <div className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4 text-[11px] text-slate-500">
              <ShieldCheck size={15} className="text-emerald-700" />
              AI-assisted verification with human review
            </div>
          </div>

          <section className="flex min-h-0 flex-col">
            <div className="mb-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Choose your workspace</div>
              <h2 className="mt-0.5 text-xl font-bold text-slate-900">Procurement access</h2>
            </div>

            <div className="grid min-h-0 flex-1 gap-4">
              <PortalCard
                eyebrow="For bidders"
                title="Bidder Portal"
                description="Find active tenders, check eligibility, validate documents and prepare bids before submission."
                icon={BriefcaseBusiness}
                accent="emerald"
                action="Enter Bidder Portal"
                onClick={() => navigate("/bidder/login")}
                points={["Live tender discovery", "Document & eligibility checks", "Bid preparation and submission"]}
              />

              <PortalCard
                eyebrow="For procurement officers"
                title="Officer Portal"
                description="Create tenders, review bidder compliance, inspect risk signals and maintain an auditable workflow."
                icon={Building2}
                accent="blue"
                action="Enter Officer Portal"
                onClick={() => navigate("/login")}
                points={["Tender and bid management", "Compliance & risk review", "Bidder relationship analysis"]}
              />
            </div>
          </section>
        </section>

        <section className="mt-4 shrink-0 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-3">
            <FeatureCard icon={ShieldCheck} title="Compliance" desc="Map requirements to bidder evidence and identify missing or invalid documents." />
            <FeatureCard icon={Share2} title="Network analysis" desc="Surface bidder relationships and procurement risk signals for officer review." />
            <FeatureCard icon={Users} title="Human review" desc="AI supports verification; officers retain final decision authority." />
          </div>
        </section>
      </main>

      <footer className="h-[44px] bg-slate-800 text-slate-300">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-5 text-[10px] lg:px-8">
          <div className="font-semibold text-white">ProcureShield AI <span className="font-normal text-slate-400">· GeM procurement verification workspace</span></div>
          <div className="flex items-center gap-1.5 text-amber-200">
            <FlaskConical size={12} /> Synthetic and sandbox data only
          </div>
        </div>
      </footer>
    </div>
  );
}

function InfoPill({ icon: Icon, text }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[10px] font-semibold text-slate-700">
      <Icon size={14} className="shrink-0 text-emerald-700" />
      <span className="truncate">{text}</span>
    </div>
  );
}

function PortalCard({ eyebrow, title, description, icon: Icon, accent, action, onClick, points }) {
  const blue = accent === "blue";
  return (
    <button
      onClick={onClick}
      className="group relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className={"absolute left-0 top-0 h-1 w-full " + (blue ? "bg-blue-700" : "bg-emerald-700")} />
      <div className="flex items-start justify-between gap-4">
        <div className={"flex h-10 w-10 items-center justify-center rounded-xl " + (blue ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700")}>
          <Icon size={21} />
        </div>
        <ArrowRight className={"mt-1 transition group-hover:translate-x-1 " + (blue ? "text-blue-700" : "text-emerald-700")} size={18} />
      </div>

      <div className={"mt-3 text-[10px] font-bold uppercase tracking-wider " + (blue ? "text-blue-700" : "text-emerald-700")}>{eyebrow}</div>
      <h3 className="mt-0.5 text-xl font-bold text-slate-900">{title}</h3>
      <p className="mt-2 text-xs leading-5 text-slate-600">{description}</p>

      <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
        {points.map((point) => (
          <div key={point} className="flex items-center gap-2 text-xs text-slate-700">
            <ShieldCheck size={13} className={blue ? "text-blue-700" : "text-emerald-700"} />
            {point}
          </div>
        ))}
      </div>

      <div className={"mt-auto inline-flex w-fit items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold text-white " + (blue ? "bg-blue-700 group-hover:bg-blue-800" : "bg-emerald-700 group-hover:bg-emerald-800")}>
        {action} <ArrowRight size={14} />
      </div>
    </button>
  );
}

function FeatureCard({ icon: Icon, title, desc }) {
  return (
    <div className="border-l-4 border-slate-300 pl-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-700">
          <Icon size={15} />
        </div>
        <h3 className="text-xs font-bold text-slate-900">{title}</h3>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-slate-600">{desc}</p>
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
