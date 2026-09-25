import React, { useEffect, useState } from "react";
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
  PlusSquare,
  Menu,
  X,
} from "lucide-react";
import { useApp } from "../store.jsx";
import { Building2 } from "lucide-react";
import { api } from "../api.js";

const NAV = [
  { to: "/app/officer", label: "Officer Command Center", icon: Building2 },
  { to: "/app/tenders/new", label: "Create Tender", icon: PlusSquare },
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
  const [alertCount, setAlertCount] = useState(0);
  const [launcherOpen, setLauncherOpen] = useState(false);

  useEffect(() => {
    let active = true;
    api.alerts()
      .then((res) => { if (active) setAlertCount(Array.isArray(res.alerts) ? res.alerts.length : 0); })
      .catch(() => { if (active) setAlertCount(0); });
    return () => { active = false; };
  }, []);

  function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    navigate(`/app/bid-verification?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <div className="flex h-screen bg-slate-100">
      {/* Sidebar */}
      <aside className="hidden w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-800 text-slate-200 md:flex">
        <button
          type="button"
          onClick={() => setLauncherOpen((v) => !v)}
          aria-label="Open ProcureShield AI menu"
          title="ProcureShield AI"
          className="flex w-full items-center gap-2 border-b border-white/10 px-5 py-5 text-left transition hover:bg-white/5"
        >
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-700">
            {launcherOpen ? <X size={20} className="text-white" /> : <ShieldCheck size={20} className="text-white" />}
          </div>
          <div>
            <div className="text-sm font-bold leading-tight text-white">ProcureShield AI</div>
            <div className="text-[11px] leading-tight text-slate-400">GeM Verification System</div>
          </div>
        </button>

        {launcherOpen && (
          <div className="mx-3 mt-2 rounded-xl border border-white/10 bg-slate-900/80 p-2 shadow-lg">
            <div className="px-2 py-1.5">
              <div className="text-[10px] font-bold text-slate-300">Procurement tools</div>
              <div className="text-[9px] text-slate-500">Quick access to officer workflows</div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {NAV.map((item) => (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => {
                    setLauncherOpen(false);
                    navigate(item.to);
                  }}
                  className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1.5 text-center text-[9px] font-semibold text-slate-300 transition hover:border-emerald-500/50 hover:bg-emerald-700/20 hover:text-white"
                >
                  <item.icon size={14} className="text-emerald-400" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-emerald-700 text-white shadow-sm"
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
        <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-slate-700 bg-slate-800 px-4 md:px-6">
          <form onSubmit={handleSearch} className="relative w-full max-w-md">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search bid ID, bidder, director, GST, PAN, address..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
          </form>

          <div className="flex items-center gap-3 pl-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 sm:flex">
              <FlaskConical size={12} /> Demo Environment
            </span>
            <button
              type="button"
              onClick={() => navigate("/app/alerts")}
              aria-label={alertCount ? `Open alerts, ${alertCount} available` : "Open alerts"}
              title="Alerts"
              className="relative rounded-full p-2 text-slate-300 hover:bg-white/10"
            >
              <Bell size={18} />
              {alertCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-red-500 px-1 text-center text-[9px] font-bold leading-4 text-white">
                  {alertCount > 9 ? "9+" : alertCount}
                </span>
              )}
            </button>
            <div className="relative">
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 hover:bg-slate-50"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-800">
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
