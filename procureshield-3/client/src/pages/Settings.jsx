import React, { useEffect, useState } from "react";
import { ArrowDown, ShieldCheck, FlaskConical, Info, Cpu, RefreshCw } from "lucide-react";
import { api } from "../api.js";

export default function Settings() {
  const [engine, setEngine] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const loadStatus = () => api.engineStatus().then(setEngine).catch(() => setEngine({ reachable: false }));
  useEffect(() => { loadStatus(); }, []);

  async function refresh(train) {
    setBusy(true);
    setNote("");
    try {
      const res = train ? await api.engineTrain({}) : await api.engineRefresh(false);
      setNote(
        train
          ? `Training finished in ${res.mode} mode (seed ${res.seed}).`
          : `Re-analysed: ${res.clusters} cluster(s), ${res.flagged} bidder(s) above threshold.`
      );
      await loadStatus();
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }

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
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Cpu size={16} /> Analytics Engine
        </h2>
        {engine === null ? (
          <p className="text-xs text-slate-400">Checking engine status...</p>
        ) : engine.reachable ? (
          <div className="space-y-1 text-xs text-slate-600">
            <Row k="Status" v="Reachable" />
            <Row k="URL" v={engine.url} />
            <Row k="Version" v={engine.version} />
            <Row k="Graph backend" v={engine.graph_backend} />
            <Row k="GAT backend" v={engine.model?.gat_backend} />
            <Row k="Model trained" v={String(engine.model?.trained)} />
            <Row k="Alert threshold" v={engine.thresholds?.alert_threshold} />
            <Row
              k="Rule / model weight"
              v={`${engine.thresholds?.rule_weight} / ${engine.thresholds?.model_weight}`}
            />
            <Row k="Last analysis" v={engine.last_analysis || "none yet"} />
          </div>
        ) : (
          <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700">
            {engine.message || "The ProcureShield engine is not reachable."}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={() => refresh(false)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50"
          >
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> Re-run analysis
          </button>
          <button
            disabled={busy}
            onClick={() => refresh(true)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Train model
          </button>
        </div>
        {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          Training requires labelled examples of known collusive bidders in the dataset. Without labels the
          engine scores in unsupervised anomaly mode and reports that instead.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <ShieldCheck size={16} /> Prototype Architecture
        </h2>
        <ArchFlow
          steps={[
            "React client (Vite)",
            "Node BFF - auth, workflow, audit log",
            "ProcureShield Engine (FastAPI)",
            "Graph build + features (NetworkX)",
            "GAT / anomaly scoring (PyTorch Geometric)",
            "JSON dataset (prototype store)",
          ]}
        />
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
          Every score, signal and explanation shown in this application is computed by the ProcureShield
          analytics engine from structured bid and registry data. No language model writes any finding, and
          no text is generated that cannot be traced to a computed signal. Scores indicate relationship risk
          and review priority only: no entity has been determined to have done anything wrong, and final
          procurement decisions must be made by an authorised officer.
        </p>
      </div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-50 py-1 last:border-0">
      <span className="text-slate-400">{k}</span>
      <span className="font-medium text-slate-700">{String(v ?? "-")}</span>
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
