import React from "react";

export function riskClass(category) {
  switch (category) {
    case "Critical":
      return "risk-critical";
    case "High":
      return "risk-high";
    case "Medium":
      return "risk-medium";
    default:
      return "risk-low";
  }
}

export function statusClass(status) {
  switch (status) {
    case "Verified":
      return "status-verified";
    case "Needs Review":
      return "status-needs-review";
    case "Rejected":
      return "status-rejected";
    default:
      return "status-needs-review";
  }
}

export function RiskBadge({ score, category }) {
  const cat = category || (score >= 81 ? "Critical" : score >= 61 ? "High" : score >= 31 ? "Medium" : "Low");
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${riskClass(cat)}`}>
      {score !== undefined ? `${score}/100` : cat}
      {score !== undefined && <span className="opacity-70">· {cat}</span>}
    </span>
  );
}

export function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusClass(status)}`}>
      {status}
    </span>
  );
}

export function SeverityDot({ severity }) {
  const colors = { red: "bg-red-500", orange: "bg-orange-500", yellow: "bg-amber-400" };
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${colors[severity] || "bg-slate-400"}`} />;
}
