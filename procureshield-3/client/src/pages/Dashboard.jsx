import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { FileCheck2, ShieldCheck, AlertTriangle, ShieldAlert, Share2, Clock, Loader2, FileText, Trophy } from "lucide-react";
import { api } from "../api.js";

const STATUS_COLORS={Verified:"#10b981","Needs Review":"#f59e0b",Rejected:"#ef4444"};
const RISK_COLORS={Low:"#10b981",Medium:"#f59e0b",High:"#f97316",Critical:"#ef4444"};

export default function Dashboard(){
 const [data,setData]=useState(null),[tenders,setTenders]=useState([]),[loading,setLoading]=useState(true);
 const navigate=useNavigate();
 useEffect(()=>{Promise.all([api.dashboard(),api.tenders()]).then(([d,t])=>{setData(d);setTenders(t.tenders||[]);}).finally(()=>setLoading(false));},[]);
 if(loading||!data)return <div className="flex h-64 items-center justify-center text-slate-400"><Loader2 className="animate-spin"/></div>;
 const open=tenders.filter(t=>t.status==="Open"), awarded=tenders.filter(t=>t.status==="Awarded"), closed=tenders.filter(t=>t.status==="Closed");
 const cards=[
  {label:"Active tenders",value:open.length,icon:FileText},
  {label:"Total bids",value:data.stats.totalBids,icon:FileCheck2},
  {label:"Verified bids",value:data.stats.verifiedBids,icon:ShieldCheck},
  {label:"Needs review",value:data.stats.bidsNeedingReview,icon:AlertTriangle},
  {label:"High-risk bids",value:data.stats.highRiskBids,icon:ShieldAlert},
  {label:"Bidder networks",value:data.stats.potentialNetworks,icon:Share2},
 ];
 return <div className="fade-in space-y-6">
  <div><h1 className="text-xl font-bold text-slate-900">Procurement Dashboard</h1><p className="text-sm text-slate-500">Portfolio-wide analytics and procurement activity. Use Officer Command Centre for operational actions.</p></div>
  <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">{cards.map(c=><div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><c.icon size={18} className="text-brand-600"/><div className="mt-3 text-2xl font-bold">{c.value}</div><div className="mt-0.5 text-xs text-slate-500">{c.label}</div></div>)}</div>
  <div className="grid gap-5 lg:grid-cols-3">
   <ChartCard title="Bid Verification Status"><ResponsiveContainer width="100%" height={220}><PieChart><Pie data={data.verificationStatus} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={3}>{data.verificationStatus.map(e=><Cell key={e.name} fill={STATUS_COLORS[e.name]}/>)}</Pie><Tooltip/><Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:12}}/></PieChart></ResponsiveContainer></ChartCard>
   <ChartCard title="Risk Distribution"><ResponsiveContainer width="100%" height={220}><BarChart data={data.riskDistribution}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7"/><XAxis dataKey="name" tick={{fontSize:12}} axisLine={false} tickLine={false}/><YAxis tick={{fontSize:12}} axisLine={false} tickLine={false}/><Tooltip/><Bar dataKey="value" radius={[6,6,0,0]}>{data.riskDistribution.map(e=><Cell key={e.name} fill={RISK_COLORS[e.name]}/>)}</Bar></BarChart></ResponsiveContainer></ChartCard>
   <ChartCard title="Signal Rollup"><div className="space-y-3 pt-3">{(data.signalTrend||[]).slice(0,6).map(s=><div key={s.code}><div className="flex justify-between text-xs"><span className="font-medium">{s.label}</span><span className="text-slate-500">{s.count}</span></div><div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500" style={{width:`${Math.min(100,s.count*15)}%`}}/></div></div>)}</div></ChartCard>
  </div>
  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
   <div className="flex items-center justify-between"><div><h2 className="font-semibold">Procurement portfolio</h2><p className="mt-1 text-sm text-slate-500">System-wide tender status, not individual tender management.</p></div><button onClick={()=>navigate("/app/officer")} className="text-sm font-semibold text-brand-700">Open Command Centre →</button></div>
   <div className="mt-4 grid gap-3 md:grid-cols-3"><Portfolio label="Open" value={open.length} icon={Clock}/><Portfolio label="Closed" value={closed.length} icon={FileText}/><Portfolio label="Awarded" value={awarded.length} icon={Trophy}/></div>
  </section>
 </div>;
}
function ChartCard({title,children}){return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card"><h3 className="text-sm font-semibold text-slate-700">{title}</h3>{children}</div>}
function Portfolio({label,value,icon:Icon}){return <div className="rounded-lg bg-slate-50 p-4"><Icon size={17} className="text-brand-600"/><div className="mt-2 text-xl font-bold">{value}</div><div className="text-xs text-slate-500">{label} tenders</div></div>}
