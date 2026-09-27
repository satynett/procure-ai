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
  PanelLeftClose,
} from "lucide-react";
import { useApp } from "../store.jsx";
import { Building2 } from "lucide-react";

const NAV = [
  { to: "/app/officer", label: "Officer Command Center", icon: Building2 },
  { to: "/app/tenders/new", label: "Create Tender", icon: PlusSquare },
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/bid-verification", label: "Bid Verification", icon: ShieldCheck },
  { to: "/app/bidder-network", label: "Bidder Network", icon: Share2 },
  { to: "/app/risk-analysis", label: "Risk Analysis", icon: AlertTriangle },
  { to: "/app/reports", label: "Reports", icon: FileBarChart },
  { to: "/app/settings", label: "Settings", icon: SettingsIcon },
];

export default function Layout({ children }) {
  const { officer, logout } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem("procureshield-sidebar") !== "collapsed";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("procureshield-sidebar", sidebarOpen ? "open" : "collapsed");
    } catch {
      // Sidebar preference is non-critical.
    }
  }, [sidebarOpen]);

sition group-hover:text-white"
            />
          )}
        </button>

        <nav className={`flex-1 space-y-1 overflow-y-auto py-3 ${
          sidebarOpen ? "px-3" : "px-2"
        }`}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={!sidebarOpen ? item.label : undefined}
              className={({ isActive }) =>
                `group flex items-center rounded-lg text-sm font-medium transition-colors ${
                  sidebarOpen ? "gap-3 px-3 py-2.5" : "justify-center px-2 py-2.5"
                } ${
                  isActive
                    ? "bg-emerald-700 text-white shadow-sm"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`
              }
            >
              <item.icon size={17} className="flex-shrink-0" />
              {sidebarOpen && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className={`border-t border-white/10 ${
          sidebarOpen ? "p-3" : "flex justify-center p-2"
        }`}>
          {sidebarOpen ? (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-300">
              <FlaskConical size={14} />
              DEMO / SANDBOX DATA
            </div>
          ) : (
            <div
              title="Demo / Sandbox Data"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-300"
            >
              <FlaskConical size={14} />
            </div>
          )}
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
              aria-label="Open alerts"
              title="Alerts"
              className="rounded-full p-2 text-slate-300 hover:bg-white/10"
            >
              <Bell size={18} />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                className="flex min-w-0 items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-left text-slate-100 transition-colors hover:border-white/30 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-800">
                  PO
                </div>
                <span className="hidden max-w-[180px] truncate text-sm font-medium text-slate-100 sm:inline">{officer?.name || "Officer"}</span>
                <ChevronDown size={14} className="flex-shrink-0 text-slate-300" />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg fade-in">
                  <div className="px-3 py-2 text-xs text-slate-500">
                    <div className="font-medium text-slate-700">{officer?.name}</div>
                    <div>{officer?.role}</div>
                  </div>
                  <button
                    type="button"
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
