import React, { useState, useEffect } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { FileText, Download, Loader2, Share2, AlertTriangle, ClipboardList, History, Table2 } from "lucide-react";
import { api } from "../api.js";

const REPORT_TYPES = [
  { type: "bid-verification", title: "Bid Verification Report", icon: FileText, desc: "Verification status and risk score for every bid in the sandbox dataset.", csv: true },
  { type: "bidder-network", title: "Bidder Network Report", icon: Share2, desc: "Detected bidder clusters, members, and shared evidence signals.", csv: false },
  { type: "risk-analysis", title: "Risk Analysis Report", icon: AlertTriangle, desc: "Risk score distribution and the highest-priority bids for review.", csv: true },
  { type: "investigation-summary", title: "Investigation Summary", icon: ClipboardList, desc: "Cluster evidence combined with the most recent officer audit actions.", csv: false },
];

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Turn each report's JSON payload into { head, body } table rows so the PDF
// renders as an actual readable table instead of a dump of raw JSON text.
function reportToTable(data) {
  switch (data.type) {
    case "bid-verification":
      return {
        head: [["Bid ID", "Bidder", "Status", "Risk Score"]],
        body: data.rows.map((r) => [r.bid_id, r.bidder, r.status, String(r.risk_score)]),
      };
    case "risk-analysis":
      return {
        head: [["Bid ID", "Bidder", "Risk Score"]],
        body: data.topRiskBids.map((r) => [r.bid_id, r.bidder, String(r.risk_score)]),
      };
    case "bidder-network":
      return {
        head: [["Cluster", "Members", "Risk Score", "Risk Category", "Evidence"]],
        body: data.clusters.map((c) => [
          c.cluster_id,
          (c.members || []).join(", "),
          String(c.risk_score),
          c.risk_category,
          (c.evidence || []).join(", "),
        ]),
      };
    case "investigation-summary":
      return {
        head: [["Cluster", "Members", "Risk Score", "Evidence"]],
        body: data.clusters.map((c) => [c.cluster_id, (c.members || []).join(", "), String(c.risk_score), (c.evidence || []).join(", ")]),
      };
    default:
      return { head: [["Field", "Value"]], body: Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]) };
  }
}

export default function Reports() {
  const [generating, setGenerating] = useState(null);
  const [lastReport, setLastReport] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [tab, setTab] = useState("reports");

  useEffect(() => {
    if (tab === "audit") {
      api.auditLog().then((res) => setAuditLog(res.log));
    }
  }, [tab]);

  const [exportingCsv, setExportingCsv] = useState(null);

  async function generate(type) {
    setGenerating(type);
    try {
      const data = await api.report(type);
      setLastReport(data);
    } finally {
      setGenerating(null);
    }
  }

  async function downloadCsv(type) {
    setExportingCsv(type);
    try {
      const blob = await api.reportCsv(type);
      downloadBlob(blob, `procureshield-${type}-${Date.now()}.csv`);
    } finally {
      setExportingCsv(null);
    }
  }

  function downloadPdf(data) {
    const doc = new jsPDF();
    let y = 18;
    doc.setFontSize(16);
    doc.text("ProcureShield AI", 14, y);
    y += 6;
    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.text("SANDBOX / DEMO DATA — Not connected to live GeM systems", 14, y);
    doc.setTextColor(0);
    y += 10;
    doc.setFontSize(13);
    doc.text(data.title, 14, y);
    y += 6;
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Generated: ${new Date(data.generatedAt).toLocaleString()}`, 14, y);
    doc.setTextColor(0);
    y += 4;

    if (data.summary) {
      y += 6;
      doc.setFontSize(9);
      const summaryLine = Object.entries(data.summary)
        .map(([k, v]) => `${k}: ${v}`)
        .join("   ·   ");
      doc.text(summaryLine, 14, y);
    }
    if (data.distribution) {
      y += 6;
      doc.setFontSize(9);
      const distLine = Object.entries(data.distribution)
        .map(([k, v]) => `${k}: ${v}`)
        .join("   ·   ");
      doc.text(distLine, 14, y);
    }

    const { head, body } = reportToTable(data);
    autoTable(doc, {
      startY: y + 6,
      head,
      body,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [35, 76, 224] },
      margin: { left: 14, right: 14 },
    });

    if (data.recentAuditActions && data.recentAuditActions.length > 0) {
      const afterTableY = doc.lastAutoTable.finalY + 10;
      doc.setFontSize(11);
      doc.text("Recent Audit Actions", 14, afterTableY);
      autoTable(doc, {
        startY: afterTableY + 4,
        head: [["Officer", "Action", "Bid ID", "Previous → New"]],
        body: data.recentAuditActions.map((a) => [a.officer, a.action, a.bid_id || "—", `${a.previous_status} → ${a.new_status}`]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [35, 76, 224] },
        margin: { left: 14, right: 14 },
      });
    }

    doc.save(`${data.type}-${Date.now()}.pdf`);
  }

  return (
    <div className="fade-in space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500">Generate reports from the current sandbox dataset. PDF export uses generated report data.</p>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        <TabButton active={tab === "reports"} onClick={() => setTab("reports")}>Reports</TabButton>
        <TabButton active={tab === "audit"} onClick={() => setTab("audit")}>
          <History size={14} className="mr-1 inline" /> Audit Log
        </TabButton>
      </div>

      {tab === "reports" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {REPORT_TYPES.map((r) => (
              <div key={r.type} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <r.icon size={18} />
                </div>
                <h3 className="text-sm font-semibold text-slate-800">{r.title}</h3>
                <p className="mt-1 text-xs text-slate-500">{r.desc}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => generate(r.type)}
                    disabled={generating === r.type}
                    className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    {generating === r.type ? <Loader2 size={14} className="animate-spin" /> : null}
                    Generate Report
                  </button>
                  {r.csv && (
                    <button
                      onClick={() => downloadCsv(r.type)}
                      disabled={exportingCsv === r.type}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      title="Download this report as CSV"
                    >
                      {exportingCsv === r.type ? <Loader2 size={14} className="animate-spin" /> : <Table2 size={14} />}
                      CSV
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {lastReport && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">{lastReport.title} — Preview</h3>
                <button
                  onClick={() => downloadPdf(lastReport)}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Download size={14} /> Download PDF
                </button>
              </div>
              <p className="mb-3 text-[11px] text-slate-400">
                Generated {new Date(lastReport.generatedAt).toLocaleString()} · sandbox demo data
              </p>
              <ReportPreviewTable data={lastReport} />
            </div>
          )}
        </>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Officer</th>
                  <th className="px-4 py-2.5">Action</th>
                  <th className="px-4 py-2.5">Bid ID</th>
                  <th className="px-4 py-2.5">Timestamp</th>
                  <th className="px-4 py-2.5">Previous → New</th>
                  <th className="px-4 py-2.5">Comment</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-slate-400">
                      No audit actions recorded yet. Actions taken from a Bid Detail page will appear here.
                    </td>
                  </tr>
                ) : (
                  auditLog.map((entry) => (
                    <tr key={entry.id} className="border-b border-slate-50 last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{entry.officer}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-700">{entry.action}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-brand-700">{entry.bid_id}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">
                        {new Date(entry.timestamp).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">
                        {entry.previous_status} → {entry.new_status}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{entry.comment || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportPreviewTable({ data }) {
  const { head, body } = reportToTable(data);
  return (
    <div className="max-h-96 overflow-auto rounded-lg border border-slate-100">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left font-semibold uppercase tracking-wide text-slate-500">
            {head[0].map((h) => (
              <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.length === 0 ? (
            <tr>
              <td colSpan={head[0].length} className="py-6 text-center text-slate-400">No rows in this report.</td>
            </tr>
          ) : (
            body.map((row, i) => (
              <tr key={i} className="border-b border-slate-50 last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 text-slate-600">{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
        active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
