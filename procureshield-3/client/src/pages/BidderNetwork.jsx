import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import ReactFlow, { Background, Controls, MarkerType, Handle, Position } from "reactflow";
import "reactflow/dist/style.css";
import { Building2, Loader2, X, ChevronRight, Search } from "lucide-react";
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
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.network().then(setRaw).finally(() => setLoading(false));
  }, []);

  const graph = useMemo(() => {
    if (!raw) return { nodes: [], edges: [] };

    const nodes = [];
    const edges = [];
    const nodeIds = new Set();

    (selectedCluster ? [selectedCluster] : raw.clusters).forEach((cluster, clusterIndex) => {
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
  }, [raw, selectedCluster]);

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
  const searchResults = raw.nodes.filter((node) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return false;
    return String(node.company_name || "").toLowerCase().includes(q) ||
      String(node.bidder_id || "").toLowerCase().includes(q);
  }).slice(0, 8);

  const selectSearchCompany = (company) => {
    setSelectedCompany(company);
    const cluster = raw.clusters.find((c) => c.members.includes(company.bidder_id));
    setSelectedCluster(cluster || null);
    setSearchTerm(company.company_name);
  };

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

        <aside className="w-[430px] flex-shrink-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <div className="mb-4">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Search bidder / company</label>
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchResults[0]) selectSearchCompany(searchResults[0]);
                }}
                placeholder="Company name or bidder ID..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-xs text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
            </div>
            {searchTerm.trim() && searchResults.length > 0 && (
              <div className="mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                {searchResults.map((company) => (
                  <button key={company.bidder_id} type="button" onClick={() => selectSearchCompany(company)} className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50">
                    <span className="min-w-0 truncate text-xs font-semibold text-slate-700">{company.company_name}</span>
                    <span className="ml-2 flex-shrink-0 text-[10px] text-slate-400">{company.bidder_id}</span>
                  </button>
                ))}
              </div>
            )}
            {searchTerm.trim() && searchResults.length === 0 && (
              <div className="mt-1 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">No bidder found.</div>
            )}
          </div>
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
                <p className="mt-1 text-xs text-slate-500">Each group is built from calculated relationship signals; unrelated bidders remain outside clusters.</p>
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

              <div className="mt-5 border-t border-slate-100 pt-4">
                <div className="mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Other Bidders</h3>
                  <p className="mt-1 text-[11px] text-slate-500">Companies with no linkable relationship signal in the current analysis.</p>
                </div>
                <div className="space-y-1.5">
                  {raw.nodes
                    .filter((node) => !node.cluster_id)
                    .map((node) => (
                      <button
                        key={node.bidder_id}
                        type="button"
                        onClick={() => setSelectedCompany(node)}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left hover:border-brand-200 hover:bg-slate-50"
                      >
                        <span className="min-w-0 truncate text-xs font-semibold text-slate-700">{node.company_name}</span>
                        <span className="ml-2 text-[10px] font-medium text-slate-400">Standalone</span>
                      </button>
                    ))}
                </div>
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
  const relationships = raw.nodes
    .filter((node) => node.bidder_id !== company.bidder_id)
    .map((node) => {
      const edge = raw.edges.find((e) =>
        (e.source === company.bidder_id && e.target === node.bidder_id) ||
        (e.target === company.bidder_id && e.source === node.bidder_id)
      );
      return { ...node, edge };
    })
    .sort((a, b) => Number(Boolean(b.edge)) - Number(Boolean(a.edge)) || String(a.company_name).localeCompare(String(b.company_name)));
  const relatedCount = relationships.filter((item) => item.edge).length;

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
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">All other companies</h3>
          <span className="text-[10px] font-medium text-slate-400">{relatedCount} relationship{relatedCount === 1 ? "" : "s"} detected</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Companies without a computed link are shown explicitly as having no detected relationship.</p>
        <div className="mt-2 overflow-hidden rounded-lg border border-slate-100">
          {relationships.map((item) => (
            <div key={item.bidder_id} className="border-b border-slate-100 p-3 last:border-b-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-800">{item.company_name}</div>
                  <div className="mt-0.5 text-[10px] text-slate-400">{item.bidder_id}</div>
                </div>
                {item.edge ? (
                  <span className="flex-shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">Relationship detected</span>
                ) : (
                  <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">No detected relationship</span>
                )}
              </div>
              {item.edge ? (
                <div className="mt-2 text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-600">Evidence:</span> {item.edge.evidence?.map(labelFor).join(" · ") || "Relationship signal detected"}
                  <span className="ml-2 font-semibold text-slate-600">Strength {item.edge.score}/100</span>
                </div>
              ) : (
                <div className="mt-1 text-[11px] text-slate-400">No shared relationship signal was computed in the current dataset.</div>
              )}
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
