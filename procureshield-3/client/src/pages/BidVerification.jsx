import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, Filter, Loader2, ChevronRight, Download } from "lucide-react";
import { api } from "../api.js";
import { RiskBadge, StatusBadge } from "../components/Badges.jsx";
import { downloadBidPdf } from "../utils/bidPdf.js";

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

const CATEGORIES = [
  "IT Hardware", "Office Supplies", "Construction Materials", "Medical Equipment",
  "Furniture", "Electrical Goods", "Vehicles & Transport", "Cleaning Services",
  "Stationery", "Security Services",
];

export default function BidVerification() {
  const [params, setParams] = useSearchParams();
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(params.get("q") || "");
  const [status, setStatus] = useState("");
  const [risk, setRisk] = useState("");
  const [category, setCategory] = useState("");
  const [exporting, setExporting] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => {
    setLoading(true);
    api.bids({ q, status, risk, category }).then((res) => {
      setBids(res.bids);
      setLoading(false);
    });
  }, [q, status, risk, category]);

  async function handleExportCsv() {
    setExporting(true);
    try {
      const blob = await api.bidsExportCsv({ q, status, risk, category });
      downloadBlob(blob, `procureshield-bids-${Date.now()}.csv`);
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const urlQ = params.get("q");
    if (urlQ) setQ(urlQ);
  }, [params]);

  return (
    <div className="fade-in space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Bid Verification</h1>
          <p className="text-sm text-slate-500">Search, filter, and review submitted bids across the sandbox dataset.</p>
        </div>
        <button
          onClick={handleExportCsv}
          disabled={exporting || bids.length === 0}
          className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Export CSV
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setParams(e.target.value ? { q: e.target.value } : {});
              }}
              placeholder="Search by Bid ID, Tender ID, or Bidder name..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterSelect icon={Filter} value={status} onChange={setStatus} placeholder="Status" options={["Verified", "Needs Review", "Rejected"]} />
            <FilterSelect value={risk} onChange={setRisk} placeholder="Risk Level" options={["Low", "Medium", "High", "Critical"]} />
            <FilterSelect value={category} onChange={setCategory} placeholder="Category" options={CATEGORIES} />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Bid ID</th>
                <th className="px-4 py-3">Tender ID</th>
                <th className="px-4 py-3">Bidder</th>
                <th className="px-4 py-3">MSME</th>
                <th className="px-4 py-3">Submission Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Risk Score</th>
                <th className="px-4 py-3">Bid PDF</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <Loader2 className="mx-auto animate-spin" />
                  </td>
                </tr>
              ) : bids.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-slate-400">
                    No bids match your search/filters.
                  </td>
                </tr>
              ) : (
                bids.map((b) => (
                  <tr
                    key={b.bid_id}
                    onClick={() => navigate(`/app/bid-verification/${encodeURIComponent(b.bid_id)}`)}
                    className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium text-brand-700">{b.bid_id}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500">{b.tender_id}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{b.bidder_name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{b.msme_status}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{b.submission_date}</td>
                    <td className="whitespace-nowrap px-4 py-3"><StatusBadge status={b.verification_status} /></td>
                    <td className="whitespace-nowrap px-4 py-3"><RiskBadge score={b.risk_score} category={b.risk_category} /></td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadBidPdf({ bid: b });
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-brand-300 hover:bg-brand-50"
                        title="Download bid submission PDF"
                      >
                        <Download size={13} /> PDF
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
                        View Analysis <ChevronRight size={14} />
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">
          Showing {bids.length} bid{bids.length !== 1 ? "s" : ""} · sandbox demo data
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, placeholder, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
