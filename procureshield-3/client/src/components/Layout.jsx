import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ShieldCheck,
  Share2,
  AlertTriangle,
  Bell,
  FileBarChart,
  Settings as SettingsIcon,
  Search,
  ChevronDown,
  LogOut,
  FlaskConical,
  FileSearch,
} from "lucide-react";
import { useApp } from "../store.jsx";
import { Building2 } from "lucide-react";

const NAV = [
  { to: "/app/officer", label: "Officer Command Center", icon: Building2 },
  { to: "/app/bid-intelligence", label: "Bid Intelligence", icon: FileSearch },
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/bid-verification", label: "Bid Verification", icon: ShieldCheck },
  { to: "/app/bidder-network", label: "Bidder Network", icon: Share2 },
  { to: "/app/risk-analysis", label: "Risk Analysis", icon: AlertTriangle },
  { to: "/app/alerts", label: "Alerts", icon: Bell },
  { to: "/app/reports", label: "Reports", icon: FileBarChart },
  { to: "/app/settings", label: "Settings", icon: SettingsIcon },
];

export default function Layout({ children }) {
  const { officer, logout } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);

  function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    navigate(`/app/bid-verification?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="hidden w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-navy-950 text-slate-200 md:flex">
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight text-white">ProcureShield AI</div>
            <div className="text-[11px] leading-tight text-slate-400">GeM Verification System</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-brand-600 text-white shadow-sm"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <item.icon size={17} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-300">
            <FlaskConical size={14} />
            DEMO / SANDBOX DATA
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 md:px-6">
          <form onSubmit={handleSearch} className="relative w-full max-w-md">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bid ID, bidder, director, GST, PAN, address..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
          </form>

          <div className="flex items-center gap-3 pl-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 sm:flex">
              <FlaskConical size={12} /> Demo Environment
            </span>
            <button className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100">
              <Bell size={18} />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
            </button>
            <div className="relative">
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 hover:bg-slate-50"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                  PO
                </div>
                <span className="hidden text-sm font-medium text-slate-700 sm:inline">{officer?.name || "Officer"}</span>
                <ChevronDown size={14} className="text-slate-400" />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg fade-in">
                  <div className="px-3 py-2 text-xs text-slate-500">
                    <div className="font-medium text-slate-700">{officer?.name}</div>
                    <div>{officer?.role}</div>
                  </div>
                  <button
                    onClick={() => {
                      logout();
                      navigate("/");
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
