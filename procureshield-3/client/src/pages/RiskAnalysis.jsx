import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Users, Network, ChevronRight, ShieldAlert } from "lucide-react";
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
    Promise.all([api.network(), api.bids()])
      .then(([net, bidsRes]) => {
        setNetwork(net);
        setBids(bidsRes.bids.slice().sort((a, b) => b.risk_score - a.risk_score));
        setSelectedCluster(net.clusters[0] || null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading || !network) {
    return <div className="flex h-64 items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>;
  }

  const nameOf = (id) => network.nodes.find((n) => n.bidder_id === id)?.company_name || id;
  const selectedMembers = selectedCluster?.members.map((id) => ({
    id,
    name: nameOf(id),
    bidder: network.nodes.find((n) => n.bidder_id === id),
  })) || [];

  return (
    <div className="fade-in space-y-5 pb-8">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Risk Analysis</h1>
        <p className="text-sm text-slate-500">Relationship groups are shown as named companies first, with the signals that connect them underneath.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={Network} label="Relationship Groups" value={network.clusters.length} />
        <Stat icon={Users} label="Flagged Bidders" value={network.nodes.filter((n) => n.risk_score > 50).length} />
        <Stat icon={ShieldAlert} label="High/Critical Bids" value={bids.filter((b) => b.risk_score > 50).length} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-800">Relationship Groups</h2>
          <p className="mt-1 text-xs text-slate-500">Select a group to see exactly which companies are connected and why.</p>
        </div>

        {network.clusters.length === 0 ? (
          <div className="p-6 text-sm text-slate-400">No relationship groups detected in the current dataset.</div>
        ) : (
          <div className="grid gap-3 p-4 lg:grid-cols-2">
            {network.clusters.map((cluster) => {
              const active = selectedCluster?.cluster_id === cluster.cluster_id;
              return (
                <button
                  key={cluster.cluster_id}
                  type="button"
                  onClick={() => setSelectedCluster(cluster)}
                  className={`rounded-xl border p-4 text-left transition ${
                    active ? "border-brand-300 bg-brand-50/50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{cluster.cluster_id}</div>
                      <div className="mt-1 text-sm font-bold text-slate-900">{cluster.members.length} connected companies</div>
                    </div>
                    <RiskBadge score={cluster.risk_score} category={cluster.risk_category} />
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {cluster.members.map((id) => (
                      <div key={id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-2 text-xs font-semibold text-slate-700">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-brand-600 shadow-sm"><Users size={12} /></div>
                        <span className="truncate">{nameOf(id)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(cluster.signal_breakdown || []).slice(0, 4).map((signal) => (
                      <span key={signal.code} className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                        {signal.label || labelFor(signal.code)}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selectedCluster && (
        <section className="grid gap-4 lg:grid-cols-[1.3fr_.7fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Selected relationship group</div>
                <h2 className="mt-1 text-lg font-bold text-slate-900">{selectedCluster.cluster_id}</h2>
                <p className="mt-1 text-xs text-slate-500">These are the companies the engine placed in the same connected group.</p>
              </div>
              <RiskBadge score={selectedCluster.risk_score} category={selectedCluster.risk_category} />
            </div>

            <div className="mt-4 space-y-2">
              {selectedMembers.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => navigate(`/app/bid-verification?q=${encodeURIComponent(member.name)}`)}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-left hover:border-brand-200 hover:bg-brand-50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-brand-600"><Users size={15} /></div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-800">{member.name}</div>
                      <div className="text-[11px] text-slate-500">{member.bidder?.risk_category || "Low"} risk · score {member.bidder?.risk_score ?? 0}</div>
                    </div>
                  </div>
                  <ChevronRight size={15} className="text-slate-400" />
                </button>
              ))}
            </div>

            <div className="mt-5 border-t border-slate-100 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Why are these companies connected?</h3>
              <div className="mt-2 space-y-2">
                {(selectedCluster.signal_breakdown || []).map((signal) => (
                  <div key={signal.code} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5">
                    <div>
                      <div className="text-xs font-semibold text-slate-700">{signal.label || labelFor(signal.code)}</div>
                      <div className="text-[11px] text-slate-500">Relationship signal detected by the analytics engine</div>
                    </div>
                    <span className="text-xs font-semibold text-slate-600">{(signal.severity * 100).toFixed(0)}% strength</span>
                  </div>
                ))}
                {(selectedCluster.signal_breakdown || []).length === 0 && (
                  <div className="text-xs text-slate-400">No scored signals available for this group.</div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <h3 className="text-sm font-semibold text-slate-800">Review guidance</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              A relationship group is a review aid, not a conclusion. The named companies and signals above are the evidence trail an officer should verify independently.
            </p>
            <button
              type="button"
              onClick={() => navigate("/app/bidder-network")}
              className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Open Visual Network <ChevronRight size={14} />
            </button>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">Highest Risk Bids</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5">Bid ID</th><th className="px-4 py-2.5">Bidder</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Risk</th><th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {bids.slice(0, 10).map((b) => (
                <tr key={b.bid_id} onClick={() => navigate(`/app/bid-verification/${encodeURIComponent(b.bid_id)}`)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-brand-700">{b.bid_id}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-slate-700">{b.bidder_name}</td>
                  <td className="whitespace-nowrap px-4 py-2.5"><StatusBadge status={b.verification_status} /></td>
                  <td className="whitespace-nowrap px-4 py-2.5"><RiskBadge score={b.risk_score} category={b.risk_category} /></td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right"><ChevronRight size={14} className="inline text-slate-400" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><Icon size={15} className="text-brand-600" />{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}
