import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ChevronRight } from "lucide-react";
import { api } from "../api.js";
import { SeverityDot } from "../components/Badges.jsx";

const SEVERITY_LABEL = { red: "High", orange: "Medium", yellow: "Low" };

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.alerts().then((res) => {
      setAlerts(res.alerts);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="fade-in space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Alerts</h1>
        <p className="text-sm text-slate-500">System-generated review priorities derived from relationship signals — sandbox data.</p>
      </div>

      <div className="space-y-3">
        {alerts.length === 0 && <p className="text-sm text-slate-400">No alerts at this time.</p>}
        {alerts.map((a) => (
          <div key={a.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
            <div className="mt-1"><SeverityDot severity={a.severity} /></div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">{a.title}</h3>
                <span className="text-xs font-medium text-slate-400">{a.date}</span>
              </div>
              <p className="mt-1 text-sm text-slate-600">{a.description}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                  Severity: {SEVERITY_LABEL[a.severity]}
                </span>
                {a.cluster_id && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    {a.cluster_id}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() =>
                a.bid_id
                  ? navigate(`/app/bid-verification/${encodeURIComponent(a.bid_id)}`)
                  : navigate(`/app/bidder-network`)
              }
              className="flex flex-shrink-0 items-center gap-1 self-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50"
            >
              Review <ChevronRight size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
