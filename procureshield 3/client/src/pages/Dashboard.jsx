import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from "recharts";
import { FileCheck2, ShieldCheck, AlertTriangle, ShieldAlert, Share2, Clock, PlayCircle, Loader2 } from "lucide-react";
import { api } from "../api.js";

const STATUS_COLORS = { Verified: "#10b981", "Needs Review": "#f59e0b", Rejected: "#ef4444" };
const RISK_COLORS = { Low: "#10b981", Medium: "#f59e0b", High: "#f97316", Critical: "#ef4444" };

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.dashboard().then((d) => {
      setData(d);
      setLoading(false);
    });
  }, []);

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const cards = [
    { label: "Total Bids", value: data.stats.totalBids, icon: FileCheck2, color: "text-brand-600 bg-brand-50" },
    { label: "Verified Bids", value: data.stats.verifiedBids, icon: ShieldCheck, color: "text-emerald-600 bg-emerald-50" },
    { label: "Bids Requiring Review", value: data.stats.bidsNeedingReview, icon: AlertTriangle, color: "text-amber-600 bg-amber-50" },
    { label: "High-Risk Bids", value: data.stats.highRiskBids, icon: ShieldAlert, color: "text-red-600 bg-red-50" },
    { label: "Potential Bidder Networks", value: data.stats.potentialNetworks, icon: Share2, color: "text-purple-600 bg-purple-50" },
    { label: "Avg. Verification Time", value: `${data.stats.avgVerificationTimeMin} min`, icon: Clock, color: "text-slate-600 bg-slate-100" },
  ];

  return (
    <div className="fade-in space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500">Overview of procurement verification &amp; risk activity (sandbox data).</p>
        </div>
        <button
          onClick={() => navigate("/app/bidder-network?demo=1")}
          className="flex items-center gap-2 self-start rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800"
        >
          <PlayCircle size={16} /> Load Demo Scenario
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
            <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg ${c.color}`}>
              <c.icon size={18} />
            </div>
            <div className="text-2xl font-bold text-slate-900">{c.value}</div>
            <div className="mt-0.5 text-xs font-medium text-slate-500">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <ChartCard title="Bid Verification Status">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={data.verificationStatus} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={3}>
                {data.verificationStatus.map((entry) => (
                  <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Risk Distribution">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.riskDistribution}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {data.riskDistribution.map((entry) => (
                  <Cell key={entry.name} fill={RISK_COLORS[entry.name]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Suspicious Pattern Trend (30 days)">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.suspiciousTrend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
              <XAxis dataKey="day" reversed tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#356af0" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      {children}
    </div>
  );
}
