import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import ReactFlow, { Background, Controls, MarkerType, Handle, Position } from "reactflow";
import "reactflow/dist/style.css";
import { Building2, Loader2, X, ChevronRight } from "lucide-react";
import { api } from "../api.js";
import { RiskBadge } from "../components/Badges.jsx";
import { labelFor } from "../constants.js";

function CompanyNode({ data }) {
  return (
    <div
      onClick={data.onClick}
      className="w-60 cursor-pointer rounded-xl border-2 border-slate-200 bg-white p-3 shadow-md hover:border-brand-300"
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
          <Building2 size={17} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-bold text-slate-800">{data.label}</div>
          <div className="text-[10px] text-slate-500">Risk {data.riskScore}/100 · {data.riskCategory}</div>
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { company: CompanyNode };

export default function BidderNetwork() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [raw, setRaw] = useState(null);
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.network().then(setRaw).finally(() => setLoading(false));
  }, []);

  const graph = useMemo(() => {
    if (!raw) return { nodes: [], edges: [] };

    const nodes = [];
    const edges = [];
    const nodeIds = new Set();

    raw.clusters.forEach((cluster, clusterIndex) => {
      const members = raw.nodes.filter((n) => cluster.members.includes(n.bidder_id));
      const baseX = clusterIndex * 520;
      members.forEach((member, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        nodeIds.add(member.bidder_id);
        nodes.push({
          id: member.bidder_id,
          type: "company",
          position: { x: baseX + col * 285, y: 80 + row * 150 },
          data: {
            label: member.company_name,
            riskScore: member.risk_score,
            riskCategory: member.risk_category,
            onClick: () => {
              setSelectedCompany(member);
              setSelectedCluster(cluster);
            },
          },
        });
      });
    });

    raw.edges.forEach((edge) => {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
      const labels = (edge.evidence || []).slice(0, 2).map(labelFor).join(" · ");
      edges.push({
        id: `${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        label: labels || "Relationship signal",
        labelStyle: { fontSize: 9, fontWeight: 600, fill: "#475569" },
        labelBgStyle: { fill: "#ffffff", fillOpacity: 0.95 },
        labelBgPadding: [4, 3],
        style: { stroke: "#94a3b8", strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8", width: 16, height: 16 },
      });
    });

    return { nodes, edges };
  }, [raw]);

  useEffect(() => {
    const focus = params.get("focus");
    if (focus && raw) {
      const company = raw.nodes.find((n) => n.bidder_id === focus);
      const cluster = raw.clusters.find((c) => c.members.includes(focus));
      if (company) {
        setSelectedCompany(company);
        setSelectedCluster(cluster || null);
      }
    }
  }, [params, raw]);

  if (loading || !raw) {
    return <div className="flex h-64 items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>;
  }

  const nameOf = (id) => raw.nodes.find((n) => n.bidder_id === id)?.company_name || id;

  return (
    <div className="fade-in flex h-[calc(100vh-7rem)] min-h-[620px] flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Bidder Network Analysis</h1>
        <p className="text-sm text-slate-500">Each box is a company. Lines are labelled with the relationship signal connecting the two companies.</p>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          {graph.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">No relationship groups detected.</div>
          ) : (
            <ReactFlow
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2, minZoom: 0.25, maxZoom: 1.1 }}
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} color="#eef2f7" />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>

        <aside className="w-[360px] flex-shrink-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          {selectedCompany ? (
            <CompanyPanel
              company={selectedCompany}
              cluster={selectedCluster}
              raw={raw}
              onClose={() => setSelectedCompany(null)}
              navigate={navigate}
            />
          ) : (
            <>
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-slate-800">Relationship Groups</h2>
                <p className="mt-1 text-xs text-slate-500">The companies in each group are listed explicitly below.</p>
              </div>
              <div className="space-y-3">
                {raw.clusters.map((cluster) => (
                  <button
                    key={cluster.cluster_id}
                    type="button"
                    onClick={() => setSelectedCluster(cluster)}
                    className="w-full rounded-xl border border-slate-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800">{cluster.cluster_id}</span>
                      <RiskBadge score={cluster.risk_score} category={cluster.risk_category} />
                    </div>
                    <div className="mt-2 space-y-1">
                      {cluster.members.map((id) => (
                        <div key={id} className="text-xs font-semibold text-slate-700">{nameOf(id)}</div>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(cluster.signal_breakdown || []).slice(0, 3).map((signal) => (
                        <span key={signal.code} className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                          {signal.label || labelFor(signal.code)}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function CompanyPanel({ company, cluster, raw, onClose, navigate }) {
  const nameOf = (id) => raw.nodes.find((n) => n.bidder_id === id)?.company_name || id;
  const related = cluster
    ? cluster.members.filter((id) => id !== company.bidder_id).map((id) => ({
        id,
        name: nameOf(id),
        edge: raw.edges.find((e) => (e.source === company.bidder_id && e.target === id) || (e.target === company.bidder_id && e.source === id)),
      }))
    : [];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">Company Relationship Details</h2>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X size={16} /></button>
      </div>

      <div className="rounded-xl bg-slate-50 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Selected company</div>
        <div className="mt-1 text-sm font-bold text-slate-900">{company.company_name}</div>
        <div className="mt-2"><RiskBadge score={company.risk_score} category={company.risk_category} /></div>
      </div>

      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Related companies</h3>
        <div className="mt-2 space-y-2">
          {related.length === 0 && <p className="text-xs text-slate-400">No directly connected companies.</p>}
          {related.map((item) => (
            <div key={item.id} className="rounded-lg border border-slate-100 p-3">
              <div className="font-semibold text-sm text-slate-800">{item.name}</div>
              <div className="mt-1 text-[11px] text-slate-500">
                {item.edge?.evidence?.map(labelFor).join(" · ") || "Relationship signal detected"}
              </div>
              {item.edge && <div className="mt-1 text-[11px] font-semibold text-slate-600">Strength {item.edge.score}/100</div>}
            </div>
          ))}
        </div>
      </div>

      {cluster && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{cluster.cluster_id} companies</h3>
          <div className="mt-2 space-y-1">
            {cluster.members.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => navigate(`/app/bid-verification?q=${encodeURIComponent(nameOf(id))}`)}
                className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {nameOf(id)} <ChevronRight size={13} className="text-slate-400" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
