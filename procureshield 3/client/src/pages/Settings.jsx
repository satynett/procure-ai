import React from "react";
import { ArrowDown, ShieldCheck, FlaskConical, Info } from "lucide-react";

export default function Settings() {
  return (
    <div className="fade-in space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">System configuration and prototype information.</p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <div className="flex items-center gap-2 font-semibold">
          <FlaskConical size={16} /> Demo / Sandbox Mode
        </div>
        <p className="mt-1 text-xs">
          This prototype uses realistic synthetic data only. It is not connected to any live GeM government
          APIs or production databases.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <ShieldCheck size={16} /> Prototype Architecture
        </h2>
        <ArchFlow steps={["Frontend", "Backend API", "Verification Engine", "Relationship Detection Engine", "Database"]} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
        <h2 className="mb-4 text-sm font-semibold text-slate-800">Future Production Deployment</h2>
        <ArchFlow
          steps={[
            "GeM Authorized APIs",
            "Data Processing Layer",
            "ML/AI Models",
            "Graph Database",
            "Risk Engine",
            "Procurement Officer Dashboard",
          ]}
        />
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          <Info size={14} className="mt-0.5 flex-shrink-0" />
          Production deployment would require authorized government API access, security controls, data
          governance, authentication, scalability infrastructure and validation with official procurement
          workflows. These integrations do not currently exist in this prototype.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">AI Disclosure</h2>
        <p className="text-xs leading-relaxed text-slate-600">
          AI-generated analysis is advisory. It is produced from structured, pre-verified relationship signals
          only — it never invents bidder information, documents, or financial details. Final procurement
          decisions must be made by an authorized officer.
        </p>
      </div>
    </div>
  );
}

function ArchFlow({ steps }) {
  return (
    <div className="flex flex-col items-center">
      {steps.map((s, i) => (
        <React.Fragment key={s}>
          <div className="w-full max-w-xs rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-center text-sm font-medium text-slate-700">
            {s}
          </div>
          {i < steps.length - 1 && <ArrowDown size={16} className="my-1 text-slate-300" />}
        </React.Fragment>
      ))}
    </div>
  );
}
