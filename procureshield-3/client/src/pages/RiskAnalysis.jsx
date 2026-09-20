import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ChevronRight } from "lucide-react";
import { api } from "../api.js";
import { RiskBadge, StatusBadge } from "../components/Badges.jsx";
import { labelFor } from "../constants.js";

export default function RiskAnalysis() {
  const [network, setNetwork] = useState(null);
  const [bids, setBids] = useState([]);
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([api.network(), api.bids()]).then(([net, bidsRes]) => {
      setNetwork(net);
      setBids(bidsRes.bids.slice().sort((a, b) => b.risk_score - a.risk_score));
      setSelectedCluster(net.clusters[0] || null);
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

  const nameOf = (id) => network.nodes.find((n) => n.bidder_id === id)?.company_name || id;
  // The engine returns a per-signal breakdown (severity x configured weight)
  // for every cluster. Evidence codes with no engine contribution - e.g. the
  // registry-only shared phone / bank checks - are shown with a zero bar so
  // they are visible as evidence without implying they moved the score.
  const breakdown = selectedCluster
    ? [
        ...selectedCluster.signal_breakdown.map((s) => ({
          label: s.label,
          severity: s.severity,
          contribution: s.contribution,
        })),
        ...selectedCluster.evidence
          .filter((e) => !selectedCluster.signal_breakdown.some((s) => s.code === e))
          .map((e) => ({ label: labelFor(e), severity: 0, contribution: 0 })),
      ]
    : [];
  const maxContribution = Math.max(0.0001, ...breakdown.map((b) => b.contribution));

  return (
    <div className="fade-in space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Risk Analysis</h1>
        <p className="text-sm text-slate-500">Every relationship-risk score is fully explainable — signals, weights, and totals.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-card">
          {selectedCluster ? (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">{selectedCluster.cluster_id} Risk Breakdown</h2>
                  <p className="text-xs text-slate-500">{selectedCluster.members.map(nameOf).join(", ")}</p>
                </div>
                <RiskBadge score={selectedCluster.risk_score} category={selectedCluster.risk_category} />
              </div>

              <div className="space-y-3">
                {breakdown.map((b) => (
                  <div key={b.label}>
                    <div className="mb-1 flex justify-between text-xs font-medium text-slate-600">
                      <span>{b.label}</span>
                      <span>
                        {b.contribution > 0
                          ? `strength ${(b.severity * 100).toFixed(0)}%`
                          : "evidence only"}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${(b.contribution / maxContribution) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-bold text-slate-900">
                  <span>Highest member score (0-100)</span>
                  <span>{selectedCluster.risk_score}</span>
                </div>
              </div>

              <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                Scores and signal strengths come from the ProcureShield analytics engine, which combines
                graph rules with a graph neural network. Bar length shows each signal's contribution
                (strength x configured weight). This is relationship risk / review priority — not proof
                of wrongdoing, and every flagged entity requires independent human investigation.
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-400">No suspicious clusters detected in the current dataset.</p>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <h3 className="mb-3 text-sm font-semibold text-slate-800">All Clusters</h3>
          <div className="space-y-2">
            {network.clusters.map((c) => (
              <button
                key={c.cluster_id}
                onClick={() => setSelectedCluster(c)}
                className={`flex w-full items-center justify-between rounded-lg border p-2.5 text-left text-xs ${
                  selectedCluster?.cluster_id === c.cluster_id ? "border-brand-300 bg-brand-50" : "border-slate-100 hover:bg-slate-50"
                }`}
              >
                <span className="font-medium text-slate-700">{c.cluster_id}</span>
                <RiskBadge score={c.risk_score} category={c.risk_category} />
              </button>
            ))}
            {network.clusters.length === 0 && <p className="text-xs text-slate-400">None detected.</p>}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">Highest Risk Bids</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">Bid ID</th>
                <th className="px-4 py-2.5">Bidder</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Risk Score</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {bids.slice(0, 10).map((b) => (
                <tr
                  key={b.bid_id}
                  onClick={() => navigate(`/app/bid-verification/${encodeURIComponent(b.bid_id)}`)}
                  className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50"
                >
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-brand-700">{b.bid_id}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{b.bidder_name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5"><StatusBadge status={b.verification_status} /></td>
                  <td className="whitespace-nowrap px-4 py-2.5"><RiskBadge score={b.risk_score} category={b.risk_category} /></td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-brand-600">
                    <span className="inline-flex items-center gap-1">Details <ChevronRight size={13} /></span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
