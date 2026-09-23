import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import ReactFlow, { Background, Controls, MarkerType, Handle, Position } from "reactflow";
import "reactflow/dist/style.css";
import {
  Building2, User, MapPin, Phone, Landmark, Hash, CreditCard,
  Loader2, Search as SearchIcon, X, ChevronRight,
} from "lucide-react";
import { api } from "../api.js";
import { RiskBadge } from "../components/Badges.jsx";
import { labelFor } from "../constants.js";

const ADDRESS_STOPWORDS = new Set(["delhi", "new", "road", "street", "nagar", "pune", "sector"]);

function addressCoreTokens(address = "") {
  const words = address
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !ADDRESS_STOPWORDS.has(w));
  return new Set(words);
}

function groupBy(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return map;
}

const ATTR_ICON = {
  director: User,
  address: MapPin,
  phone: Phone,
  bank: Landmark,
  gst: Hash,
  pan: CreditCard,
};
const ATTR_COLOR = {
  director: "bg-purple-500",
  address: "bg-orange-500",
  phone: "bg-cyan-500",
  bank: "bg-red-500",
  gst: "bg-teal-500",
  pan: "bg-indigo-500",
};

function BidderNode({ data }) {
  return (
    <div
      onClick={data.onClick}
      className={`flex w-56 cursor-pointer items-center gap-2 rounded-xl border-2 bg-white px-3 py-2 shadow-md transition-transform hover:scale-105 ${
        data.riskCategory === "High" || data.riskCategory === "Critical"
          ? "border-red-400"
          : data.riskCategory === "Medium"
          ? "border-amber-400"
          : "border-slate-200"
      }`}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
        <Building2 size={16} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-slate-800">{data.label}</div>
        <div className="text-[10px] text-slate-400">{data.riskCategory} · {data.riskScore}</div>
      </div>
    </div>
  );
}

function AttrNode({ data }) {
  const Icon = ATTR_ICON[data.attrType] || Hash;
  return (
    <div
      onClick={data.onClick}
      className="flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm hover:scale-105"
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className={`flex h-5 w-5 items-center justify-center rounded-full text-white ${ATTR_COLOR[data.attrType]}`}>
        <Icon size={11} />
      </div>
      <span className="text-[10px] font-medium text-slate-600">{data.label}</span>
    </div>
  );
}

const nodeTypes = { bidder: BidderNode, attr: AttrNode };

export default function BidderNetwork() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // {kind: 'bidder'|'attr'|'cluster', ...}
  const [investigation, setInvestigation] = useState(null);
  const [investigating, setInvestigating] = useState(false);

  useEffect(() => {
    api.network().then((res) => {
      setRaw(res);
      setLoading(false);
    });
  }, []);

  const { nodes, edges, clusters, unclusteredCount } = useMemo(() => {
    if (!raw) return { nodes: [], edges: [], clusters: [], unclusteredCount: 0 };

    const clusterMap = new Map();
    raw.clusters.forEach((c) => clusterMap.set(c.cluster_id, c));

    const nodesOut = [];
    const edgesOut = [];
    const clusterSpacingX = 700;
    let clusterIdx = 0;

    raw.clusters.forEach((cluster) => {
      const members = raw.nodes.filter((n) => cluster.members.includes(n.bidder_id));
      const cx = clusterIdx * clusterSpacingX;
      const cy = 0;
      const R = 230;
      const n = members.length;

      members.forEach((m, i) => {
        const angle = (2 * Math.PI * i) / n - Math.PI / 2;
        const x = cx + R * Math.cos(angle);
        const y = cy + R * Math.sin(angle) + 300;
        nodesOut.push({
          id: m.bidder_id,
          type: "bidder",
          position: { x, y },
          data: {
            label: m.company_name,
            riskCategory: m.risk_category,
            riskScore: m.risk_score,
            onClick: () => setSelected({ kind: "bidder", bidder: m, cluster }),
          },
        });
      });

      // sub-group by strong attributes within this cluster
      const attrGroups = [
        { type: "director", key: (m) => m.director_name, label: (v) => `Director: ${v}` },
        { type: "phone", key: (m) => m.phone, label: (v) => `Phone: ${m0(members, "phone", v).phone_masked}` },
        { type: "bank", key: (m) => m.bank_account, label: () => `Shared Bank Account` },
        {
          type: "address",
          key: (m) => Array.from(addressCoreTokens(m.address)).sort().join("|") || null,
          label: () => `Shared Address`,
        },
      ];

      let attrOffset = 0;
      attrGroups.forEach((ag) => {
        const groups = groupBy(members, ag.key);
        groups.forEach((groupMembers) => {
          if (groupMembers.length < 2) return;
          const angle = (2 * Math.PI * attrOffset) / 6 + Math.PI / 6;
          attrOffset++;
          const rx = cx + 90 * Math.cos(angle);
          const ry = cy + 90 * Math.sin(angle) + 300;
          const attrId = `attr-${cluster.cluster_id}-${ag.type}-${attrOffset}`;
          nodesOut.push({
            id: attrId,
            type: "attr",
            position: { x: rx, y: ry },
            data: {
              attrType: ag.type,
              label: ag.label(ag.key(groupMembers[0])),
              onClick: () =>
                setSelected({
                  kind: "attr",
                  attrType: ag.type,
                  members: groupMembers,
                  cluster,
                }),
            },
          });
          groupMembers.forEach((gm) => {
            edgesOut.push({
              id: `${attrId}-${gm.bidder_id}`,
              source: attrId,
              target: gm.bidder_id,
              type: "straight",
              style: { stroke: "#cbd5e1", strokeWidth: 1.5 },
              markerEnd: { type: MarkerType.ArrowClosed, color: "#cbd5e1", width: 14, height: 14 },
            });
          });
        });
      });

      clusterIdx++;
    });

    const clusteredIds = new Set(raw.clusters.flatMap((c) => c.members));
    const unclusteredCount = raw.nodes.filter((n) => !clusteredIds.has(n.bidder_id)).length;

    return { nodes: nodesOut, edges: edgesOut, clusters: raw.clusters, unclusteredCount };
  }, [raw]);

  useEffect(() => {
    const focus = params.get("focus");
    if (focus && raw) {
      const bidder = raw.nodes.find((n) => n.bidder_id === focus);
      const cluster = raw.clusters.find((c) => c.members.includes(focus));
      if (bidder) setSelected({ kind: "bidder", bidder, cluster });
    }
    if (params.get("demo") === "1" && raw && raw.clusters.length > 0) {
      const top = raw.clusters[0];
      setSelected({ kind: "cluster", cluster: top });
    }
  }, [params, raw]);

  const investigate = useCallback(async (cluster) => {
    setSelected({ kind: "cluster", cluster });
    setInvestigating(true);
    setInvestigation(null);
    const memberNames = cluster.members.map((id) => raw.nodes.find((n) => n.bidder_id === id)?.company_name);
    // The engine owns the narrative; the server looks it up by cluster id.
    const res = await api.aiAnalyze("investigation_summary", {
      clusterId: cluster.cluster_id,
    });
    setInvestigation(res);
    setInvestigating(false);
  }, [raw]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="fade-in flex h-[calc(100vh-7rem)] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Bidder Network Analysis</h1>
          <p className="text-sm text-slate-500">
            {clusters.length} potential network{clusters.length !== 1 ? "s" : ""} detected · {unclusteredCount} independent bidders show no significant relationship signals
          </p>
        </div>
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden">
        <div className="flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          {nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              No suspicious relationships detected in the current dataset.
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.28, minZoom: 0.2, maxZoom: 1.2 }}
              minZoom={0.2}
              defaultEdgeOptions={{ animated: false }}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} color="#eef2f7" />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>

        {/* Side panel */}
        <div className="w-96 flex-shrink-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          {!selected ? (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-800">Suspicious Clusters</h3>
              <div className="space-y-2">
                {clusters.map((c) => (
                  <ClusterCard key={c.cluster_id} cluster={c} raw={raw} onInvestigate={() => investigate(c)} />
                ))}
                {clusters.length === 0 && <p className="text-sm text-slate-400">No clusters detected.</p>}
              </div>
              <p className="mt-4 text-xs text-slate-400">Click any node in the graph to inspect its details.</p>
            </div>
          ) : selected.kind === "bidder" ? (
            <BidderPanel data={selected} onClose={() => setSelected(null)} onInvestigate={investigate} navigate={navigate} />
          ) : selected.kind === "attr" ? (
            <AttrPanel data={selected} onClose={() => setSelected(null)} />
          ) : (
            <ClusterPanel
              data={selected}
              raw={raw}
              onClose={() => setSelected(null)}
              investigation={investigation}
              investigating={investigating}
              navigate={navigate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function m0(members, field, value) {
  return members.find((m) => m[field] === value) || {};
}

function ClusterCard({ cluster, raw, onInvestigate }) {
  const names = cluster.members.map((id) => raw.nodes.find((n) => n.bidder_id === id)?.company_name).join(", ");
  return (
    <div className="rounded-lg border border-slate-100 p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">{cluster.cluster_id}</span>
        <RiskBadge score={cluster.risk_score} category={cluster.risk_category} />
      </div>
      <p className="mb-2 text-xs text-slate-500">{names}</p>
      <button onClick={onInvestigate} className="w-full rounded-md bg-navy-900 py-1.5 text-xs font-semibold text-white hover:bg-navy-800">
        Investigate Cluster
      </button>
    </div>
  );
}

function PanelHeader({ title, onClose }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100">
        <X size={16} />
      </button>
    </div>
  );
}

function BidderPanel({ data, onClose, onInvestigate, navigate }) {
  const { bidder, cluster } = data;
  return (
    <div>
      <PanelHeader title="Bidder Details" onClose={onClose} />
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
        <Building2 size={18} />
      </div>
      <h4 className="text-sm font-bold text-slate-900">{bidder.company_name}</h4>
      <div className="mt-3 space-y-2 text-xs">
        <Row label="Director" value={bidder.director_name} />
        <Row label="Address" value={bidder.address} />
        <Row label="Phone" value={bidder.phone_masked} />
        <Row label="Bank Account" value={bidder.bank_account_masked} />
        <Row label="GST" value={bidder.gst_number} />
        <Row label="PAN" value={bidder.pan_number} />
        <Row label="MSME Status" value={bidder.msme_status} />
      </div>
      <div className="mt-3">
        <RiskBadge score={bidder.risk_score} category={bidder.risk_category} />
      </div>
      {cluster && (
        <button
          onClick={() => onInvestigate(cluster)}
          className="mt-3 w-full rounded-md bg-navy-900 py-2 text-xs font-semibold text-white hover:bg-navy-800"
        >
          Investigate Cluster {cluster.cluster_id}
        </button>
      )}
      <button
        onClick={() => navigate(`/app/bid-verification?q=${encodeURIComponent(bidder.company_name)}`)}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
      >
        View Bids <ChevronRight size={13} />
      </button>
    </div>
  );
}

function AttrPanel({ data, onClose }) {
  const { attrType, members } = data;
  return (
    <div>
      <PanelHeader title={`Shared ${attrType}`} onClose={onClose} />
      <p className="mb-3 text-xs text-slate-500">
        {members.length} bidders are linked through this shared attribute.
      </p>
      <div className="space-y-2">
        {members.map((m) => (
          <div key={m.bidder_id} className="rounded-lg border border-slate-100 p-2 text-xs">
            <div className="font-semibold text-slate-800">{m.company_name}</div>
            {attrType === "director" && <div className="text-slate-500">{m.director_name}</div>}
            {attrType === "address" && <div className="text-slate-500">{m.address}</div>}
            {attrType === "phone" && <div className="text-slate-500">{m.phone_masked}</div>}
            {attrType === "bank" && <div className="text-slate-500">{m.bank_account_masked}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ClusterPanel({ data, raw, onClose, investigation, investigating, navigate }) {
  const { cluster } = data;
  const members = cluster.members.map((id) => raw.nodes.find((n) => n.bidder_id === id));
  return (
    <div>
      <PanelHeader title={`${cluster.cluster_id} — Investigation`} onClose={onClose} />
      <div className="mb-3 flex items-center justify-between">
        <RiskBadge score={cluster.risk_score} category={cluster.risk_category} />
        <span className="text-xs font-medium text-slate-500">Requires Manual Review</span>
      </div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Connected Bidders</h4>
      <ul className="mb-3 space-y-1 text-sm text-slate-700">
        {members.map((m) => (
          <li key={m.bidder_id}>{m.company_name}</li>
        ))}
      </ul>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Common Attributes</h4>
      <ul className="mb-3 space-y-1 text-xs text-slate-600">
        {cluster.evidence.map((e) => {
          const s = (cluster.signal_breakdown || []).find((x) => x.code === e);
          return (
            <li key={e}>
              • {labelFor(e)}
              {s ? ` (strength ${(s.severity * 100).toFixed(0)}%)` : " (evidence only)"}
            </li>
          );
        })}
      </ul>

      <div className="mb-3 rounded-lg bg-slate-50 p-3">
        <h4 className="mb-1 text-xs font-semibold text-slate-700">Engine Investigation Summary</h4>
        {investigating ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 size={13} className="animate-spin" /> Retrieving engine analysis...
          </div>
        ) : investigation ? (
          <p className="text-xs leading-relaxed text-slate-600">{investigation.narrative}</p>
        ) : (
          <p className="text-xs text-slate-400">No summary generated yet.</p>
        )}
      </div>

      <button
        onClick={() => navigate(`/app/bid-verification?q=${encodeURIComponent(members[0]?.company_name || "")}`)}
        className="w-full rounded-md bg-brand-600 py-2 text-xs font-semibold text-white hover:bg-brand-700"
      >
        Open Related Bids
      </button>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="text-right font-medium text-slate-700">{value}</span>
    </div>
  );
}
