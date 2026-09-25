import React from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck, Share2, Users, ArrowRight, FlaskConical,
  Building2, BriefcaseBusiness, FileCheck2, SearchCheck, LockKeyhole
} from "lucide-react";

export default function Landing() {
  const navigate = useNavigate();
  const [launcherOpen, setLauncherOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-700 bg-slate-800 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-700 shadow-sm">
              <ShieldCheck size={21} />
            </div>
            <div>
              <div className="text-base font-bold leading-tight">ProcureShield AI</div>
              <div className="text-[11px] leading-tight text-slate-300">GeM Procurement Verification</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-300 sm:block">Digital Procurement Workspace</span>
            <span className="flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200">
              <FlaskConical size={13} /> Sandbox
            </span>
          </div>
        </div>
      </header>

      <div className="fixed bottom-5 right-5 z-50">
        {launcherOpen ? (
          <div className="w-80 overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-slate-800 px-4 py-3 text-white">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-700"><ShieldCheck size={16}/></div>
                <div><div className="text-sm font-bold">ProcureShield AI</div><div className="text-[10px] text-slate-300">GeM Verification System</div></div>
              </div>
              <button onClick={()=>setLauncherOpen(false)} className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10">Minimise</button>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-2 gap-2">
                <MiniAction label="Officer Command Center" onClick={()=>navigate("/app/officer")} icon={Building2}/>
                <MiniAction label="Create Tender" onClick={()=>navigate("/app/tenders/new")} icon={BriefcaseBusiness}/>
                <MiniAction label="Dashboard" onClick={()=>navigate("/app/dashboard")} icon={FileCheck2}/>
                <MiniAction label="Bid Verification" onClick={()=>navigate("/app/bid-verification")} icon={SearchCheck}/>
                <MiniAction label="Bidder Network" onClick={()=>navigate("/app/bidder-network")} icon={Share2}/>
                <MiniAction label="Risk Analysis" onClick={()=>navigate("/app/risk-analysis")} icon={ShieldCheck}/>
                <MiniAction label="Alerts" onClick={()=>navigate("/app/alerts")} icon={LockKeyhole}/>
                <MiniAction label="Reports" onClick={()=>navigate("/app/reports")} icon={FileCheck2}/>
                <MiniAction label="Settings" onClick={()=>navigate("/app/settings")} icon={Users}/>
              </div>
            </div>
          </div>
        ) : (
          <button onClick={()=>setLauncherOpen(true)} title="Open ProcureShield menu" className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-800 text-white shadow-xl ring-4 ring-white hover:bg-slate-700">
            <ShieldCheck size={25}/>
          </button>
        )}
      </div>

      <main>
        <section className="bg-gradient-to-b from-white to-slate-100">
          <div className="mx-auto max-w-7xl px-6 pb-8 pt-9 lg:px-8 lg:pb-10 lg:pt-11">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-blue-800">
                <span className="h-2 w-2 rounded-full bg-emerald-600" />
                Procurement verification
              </div>

              <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
                Verify procurement decisions
                <span className="block text-slate-700">with clarity and traceability.</span>
              </h1>

              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                A unified workspace for bidder eligibility, tender compliance, document verification
                and procurement risk review.
              </p>

              <div className="mt-6 flex flex-wrap gap-3 text-sm">
                <span className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 shadow-sm">
                  <FileCheck2 size={16} className="text-emerald-700" /> Document compliance
                </span>
                <span className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 shadow-sm">
                  <SearchCheck size={16} className="text-blue-700" /> Risk signals
                </span>
                <span className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 shadow-sm">
                  <LockKeyhole size={16} className="text-slate-600" /> Auditable workflow
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-8 lg:px-8 lg:py-9">
          <div className="mb-5">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Choose your workspace</div>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">Procurement access</h2>
            <p className="mt-1 text-sm text-slate-600">Select the portal that matches your role.</p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <PortalCard
              eyebrow="For bidders"
              title="Bidder Portal"
              description="Find active tenders, check eligibility, validate supporting documents and prepare bids before submission."
              icon={BriefcaseBusiness}
              accent="emerald"
              action="Enter Bidder Portal"
              onClick={() => navigate("/bidder/login")}
              points={["Live tender discovery", "Document & eligibility checks", "Bid preparation and submission"]}
            />

            <PortalCard
              eyebrow="For procurement officers"
              title="Officer Portal"
              description="Create and manage tenders, review bidder compliance, inspect risk signals and maintain an auditable decision workflow."
              icon={Building2}
              accent="blue"
              action="Enter Officer Portal"
              onClick={() => navigate("/login")}
              points={["Tender and bid management", "Compliance & risk review", "Bidder relationship analysis"]}
            />
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-6 lg:px-8">
            <div className="grid gap-5 md:grid-cols-3">
              <FeatureCard icon={ShieldCheck} title="Compliance" desc="Map tender requirements to bidder evidence and identify missing or invalid documents." />
              <FeatureCard icon={Share2} title="Network analysis" desc="Surface bidder relationships and procurement risk signals for officer review." />
              <FeatureCard icon={Users} title="Human review" desc="AI supports verification and analysis; procurement officers retain final decision authority." />
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-slate-800 text-slate-300">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-5 text-xs sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div>
            <div className="font-semibold text-white">ProcureShield AI</div>
            <div className="mt-1 text-slate-400">GeM procurement verification workspace</div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-amber-200">
            <FlaskConical size={13} />
            Synthetic and sandbox data only
          </div>
        </div>
      </footer>
    </div>
  );
}

function PortalCard({ eyebrow, title, description, icon: Icon, accent, action, onClick, points }) {
  const blue = accent === "blue";
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className={"absolute left-0 top-0 h-1 w-full " + (blue ? "bg-blue-700" : "bg-emerald-700")} />
      <div className="flex items-start justify-between gap-5">
        <div className={"flex h-12 w-12 items-center justify-center rounded-xl " + (blue ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700")}>
          <Icon size={23} />
        </div>
        <ArrowRight className={"mt-1 transition group-hover:translate-x-1 " + (blue ? "text-blue-700" : "text-emerald-700")} size={20} />
      </div>

      <div className={"mt-5 text-xs font-bold uppercase tracking-wider " + (blue ? "text-blue-700" : "text-emerald-700")}>{eyebrow}</div>
      <h3 className="mt-1 text-2xl font-bold text-slate-900">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>

      <div className="mt-5 space-y-2 border-t border-slate-100 pt-4">
        {points.map((point) => (
          <div key={point} className="flex items-center gap-2 text-sm text-slate-700">
            <ShieldCheck size={15} className={blue ? "text-blue-700" : "text-emerald-700"} />
            {point}
          </div>
        ))}
      </div>

      <div className={"mt-6 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white " + (blue ? "bg-blue-700 group-hover:bg-blue-800" : "bg-emerald-700 group-hover:bg-emerald-800")}>
        {action} <ArrowRight size={16} />
      </div>
    </button>
  );
}

function FeatureCard({ icon: Icon, title, desc }) {
  return (
    <div className="border-l-4 border-slate-300 pl-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
        <Icon size={18} />
      </div>
      <h3 className="mt-3 text-sm font-bold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-600">{desc}</p>
    </div>
  );
}

function MiniAction({label,onClick,icon:Icon}) {
  return <button onClick={onClick} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-2 text-center text-[11px] font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800">
    <Icon size={17} className="text-emerald-700"/><span>{label}</span>
  </button>;
}
