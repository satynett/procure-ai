import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FileCheck2, ArrowRight, ShieldCheck, FileText, Upload, X, History, ExternalLink } from "lucide-react";
import { api } from "../api.js";

export default function BidderPortal() {
  const navigate = useNavigate();
  const [tenders, setTenders] = useState([]);
  const [myBids, setMyBids] = useState([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [company, setCompany] = useState("");
  const [bidAmount, setBidAmount] = useState("");
  const [documents, setDocuments] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      const [openRes, closedRes, historyRes] = await Promise.all([api.tenders("Open"), api.tenders("Awarded"), api.bidderBids()]);
      setTenders([...(openRes.tenders || []), ...(closedRes.tenders || [])]);
      setMyBids(historyRes.bids || []);
    } catch (e) { setError(e.message || "Unable to load tenders."); }
  };

  useEffect(() => { load(); }, []);

  const openTenders = tenders.filter((t) => t.status === "Open");
  const closedTenders = tenders.filter((t) => t.status === "Awarded");
  const categories = [...new Set(tenders.map((t) => t.category).filter(Boolean))];

  const filteredOpen = useMemo(() => openTenders.filter((t) => {
    const hay = `${t.title} ${t.tender_id} ${t.department} ${t.category}`.toLowerCase();
    return (!q || hay.includes(q.toLowerCase())) && (!category || t.category === category);
  }), [openTenders, q, category]);

  const filteredClosed = useMemo(() => closedTenders.filter((t) => {
    const hay = `${t.title} ${t.tender_id} ${t.department} ${t.category}`.toLowerCase();
    return (!q || hay.includes(q.toLowerCase())) && (!category || t.category === category);
  }), [closedTenders, q, category]);

  async function submitBid() {
    if (!selected || !company.trim()) return;
    setError(""); setMessage("");
    try {
      const result = await api.submitBid({
        tender_id: selected.tender_id,
        company_name: company,
        bid_amount: bidAmount || null,
        documents: documents.map((f) => f.name),
      });
      await load();
      setMessage(`Bid ${result.bid.bid_id} submitted successfully. Status: Under Review.`);
      setShowSubmit(false);
      setDocuments([]);
      setBidAmount("");
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div><div className="text-lg font-bold">ProcureShield</div><div className="text-xs text-slate-500">Bidder Portal</div></div>
          <div className="flex gap-2">
            <button onClick={() => navigate("/bidder/documents")} className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white"><FileCheck2 size={16}/> Check My Documents</button>
            <button onClick={() => setShowHistory(true)} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-brand-300"><History size={16}/> My Bids</button>
            <button onClick={() => navigate("/")} className="rounded-lg px-3 py-2 text-sm text-slate-500">Switch portal</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-7">
        <section className="rounded-2xl bg-navy-950 p-7 text-white">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-widest text-brand-300">For bidders & suppliers</div>
            <h1 className="mt-2 text-3xl font-bold">Submit a bid or check your documents.</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">Tenders are published by procurement officers. You can view the officer-uploaded RFP and submit only your own bid documents.</p>
          </div>
        </section>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

        <section className="grid gap-4 md:grid-cols-2">
          <button onClick={() => document.getElementById("live-tenders")?.scrollIntoView({behavior:"smooth"})} className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-brand-300">
            <FileText className="text-brand-600" size={20}/><h2 className="mt-3 font-bold">Submit a Bid</h2><p className="mt-1 text-sm text-slate-500">Browse officer-published tenders, view the RFP and upload your bid documents.</p><span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">Browse tenders <ArrowRight size={13}/></span>
          </button>
          <button onClick={() => navigate("/bidder/documents")} className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-brand-300">
            <ShieldCheck className="text-brand-600" size={20}/><h2 className="mt-3 font-bold">Check My Documents</h2><p className="mt-1 text-sm text-slate-500">Upload your documents separately to find missing, invalid or review-required items before bidding.</p><span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">Open checker <ArrowRight size={13}/></span>
          </button>
        </section>

        <section id="live-tenders" className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div><h2 className="text-xl font-bold">Live Tenders <span className="text-sm font-normal text-slate-400">({openTenders.length})</span></h2><p className="text-sm text-slate-500">Only currently open tenders are shown here.</p></div>
            <div className="flex gap-2">
              <div className="relative"><Search className="absolute left-3 top-2.5 text-slate-400" size={16}/><input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search" className="w-48 rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm"/></div>
              <select value={category} onChange={(e)=>setCategory(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">{filteredOpen.map(t=><TenderCard key={t.tender_id} tender={t} onOpen={()=>{setSelected(t);setShowSubmit(false)}} onBid={()=>{setSelected(t);setShowSubmit(true)}} />)}</div>
        </section>

        <section className="space-y-4">
          <div><h2 className="text-xl font-bold">Closed / Awarded Tenders <span className="text-sm font-normal text-slate-400">({closedTenders.length})</span></h2><p className="text-sm text-slate-500">Historical tenders with the recorded demo award outcome.</p></div>
          <div className="grid gap-4 lg:grid-cols-2">{filteredClosed.map(t=><TenderCard key={t.tender_id} tender={t} onOpen={()=>{setSelected(t);setShowSubmit(false)}} />)}</div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><div><h2 className="font-semibold">My Bids</h2><p className="text-sm text-slate-500">Your submitted bids and current review status.</p></div><span className="text-xs text-slate-400">{myBids.length} submitted</span></div>
          <div className="mt-3 space-y-2">{myBids.length ? myBids.slice(0,5).map((b,i)=>{const status=b.verification_status||"Under Review"; const statusClass=status==="Verified"?"bg-emerald-50 text-emerald-700":status==="Rejected"?"bg-red-50 text-red-700":"bg-amber-50 text-amber-700"; return <div key={b.bid_id||i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm"><span className="font-medium">{b.tender_id}</span><span>{b.bid_id}</span><span className={"rounded-full px-2 py-1 text-xs font-semibold "+statusClass}>{status}</span></div>}) : <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No bids submitted from this bidder account yet.</div>}</div>
        </section>
      </main>

      {selected && <TenderModal tender={selected} submitting={showSubmit} company={company} setCompany={setCompany} bidAmount={bidAmount} setBidAmount={setBidAmount} documents={documents} setDocuments={setDocuments} onClose={()=>{setSelected(null);setShowSubmit(false)}} onStartSubmit={()=>setShowSubmit(true)} onSubmit={submitBid}/>}
      {showHistory && <BidHistoryModal bids={myBids} onClose={()=>setShowHistory(false)}/>}
      <footer className="border-t border-slate-200 bg-white px-6 py-5 text-center text-xs text-slate-500">Prototype / sandbox data. The officer and bidder portals read the same tender and bid data.</footer>
    </div>
  );
}

function TenderCard({ tender:t, onOpen, onBid }) {
  const isOpen = t.status === "Open";
  const statusClass = isOpen
    ? "bg-emerald-50 text-emerald-700"
    : "bg-slate-100 text-slate-600";
  const dateLabel = isOpen ? "Deadline" : "Closed";
  const valueLabel = isOpen ? "Est. value" : "Winner";
  const valueText = isOpen
    ? "₹" + Number(t.estimated_value || 0).toLocaleString("en-IN")
    : (t.winner_name || "—");

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-brand-600">{t.tender_id}</div>
          <h3 className="mt-1 text-base font-bold">{t.title}</h3>
          <p className="mt-1 text-sm text-slate-500">{t.department} · {t.category}</p>
        </div>
        <span className={"rounded-full px-2.5 py-1 text-xs font-semibold " + statusClass}>
          {isOpen ? "Open" : "Awarded"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-y border-slate-100 py-3 text-xs">
        <div>
          <span className="text-slate-400">{dateLabel}</span>
          <div className="mt-1 font-semibold">{t.deadline || t.closing_date}</div>
        </div>
        <div>
          <span className="text-slate-400">Bids</span>
          <div className="mt-1 font-semibold">{t.bid_count}</div>
        </div>
        <div>
          <span className="text-slate-400">{valueLabel}</span>
          <div className="mt-1 truncate font-semibold">{valueText}</div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onOpen}
          className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold"
        >
          View Details
        </button>
        {isOpen && (
          <button
            onClick={onBid}
            className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Bid Now
          </button>
        )}
      </div>
    </article>
  );
}

function TenderModal({ tender:t, submitting, company, setCompany, bidAmount, setBidAmount, documents, setDocuments, onClose, onStartSubmit, onSubmit }) {
  const isAwarded = t.status === "Awarded";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-brand-600">{t.tender_id}</div>
            <h2 className="mt-1 text-xl font-bold">{t.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{t.department} · {t.category}</p>
          </div>
          <button onClick={onClose}><X size={20}/></button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Info label="Status" value={t.status}/>
          <Info label={isAwarded ? "Closing date" : "Deadline"} value={t.deadline || t.closing_date}/>
          <Info label="Bids" value={String(t.bid_count || 0)}/>
          <Info label="RFP uploaded by" value="Procurement Officer"/>
        </div>

        <RfpViewer tender={t} />

        {isAwarded && (
          <div className="mt-4 rounded-lg border border-slate-200 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Award outcome</div>
            <div className="mt-1 text-lg font-bold">{t.winner_name || "Demo award record"}</div>
            <div className="text-sm text-slate-500">
              Award date: {t.award_date || "—"}
              {t.award_amount && (
                <span> · Award amount: ₹{Number(t.award_amount).toLocaleString("en-IN")}</span>
              )}
            </div>
          </div>
        )}

        {!isAwarded && (
          <div className="mt-4 rounded-lg border border-slate-200 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Required documents</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(t.required_documents || []).map((d) => (
                <span key={d} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{d}</span>
              ))}
            </div>
          </div>
        )}

        {submitting && !isAwarded && (
          <div className="mt-5 border-t border-slate-200 pt-5">
            <h3 className="font-semibold">Submit your bid documents</h3>
            <p className="mt-1 text-sm text-slate-500">
              The RFP stays with the officer. You upload only your company bid documents here.
            </p>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Company name"
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value)}
              placeholder="Quoted amount (optional)"
              type="number"
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx"
              onChange={(e) => setDocuments(Array.from(e.target.files || []))}
              className="mt-3 w-full text-sm"
            />
            <button
              onClick={onSubmit}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              <Upload size={15}/> Submit Bid
            </button>
          </div>
        )}

        {t.status === "Open" && !submitting && (
          <button
            onClick={onStartSubmit}
            className="mt-5 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Click “Bid Now” to submit your documents
          </button>
        )}
      </div>
    </div>
  );
}

function Info({label,value}){return <div className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-400">{label}</div><div className="mt-1 text-sm font-semibold">{value}</div></div>}

function RfpViewer({ tender: t }) {
  const [open, setOpen] = useState(false);
  const base64 = tender.rfp_content_base64 || "";
  const isPdf = base64.startsWith("JVBERi0");
  const pdfUrl = isPdf ? "data:application/pdf;base64," + base64 : null;
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
      <button type="button" onClick={() => setOpen((value) => !value)} className="w-full bg-slate-50 p-4 text-left hover:bg-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Officer RFP</div>
            <div className="mt-1 font-medium">{t.rfp_filename || "Officer-uploaded tender document"}</div>
            <p className="mt-1 text-sm text-slate-500">{open ? "Click to hide the officer-uploaded RFP." : "Click to view the officer-uploaded RFP."}</p>
          </div>
          <ExternalLink size={18} className="mt-1 shrink-0 text-brand-600" />
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-200 bg-white p-3">
          {pdfUrl ? <iframe title={t.rfp_filename || "Officer RFP"} src={pdfUrl} className="h-[520px] w-full rounded-lg border border-slate-200" /> : <div className="rounded-lg bg-slate-50 p-4"><div className="text-sm font-semibold text-slate-700">RFP preview</div><pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-600">{t.rfp_text || t.eligibility_summary || "No RFP preview is available."}</pre></div>}
        </div>
      )}
    </div>
  );
}

function BidHistoryModal({ bids, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div><div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Bidder history</div><h2 className="mt-1 text-2xl font-bold">My Bids</h2><p className="mt-1 text-sm text-slate-500">Past submissions and their current verification status.</p></div>
          <button onClick={onClose} aria-label="Close bid history"><X size={20}/></button>
        </div>
        <div className="mt-5 space-y-3">
          {bids.length ? bids.map((bid) => {
            const status = bid.verification_status || "Under Review";
            const statusClass = status === "Verified" ? "bg-emerald-50 text-emerald-700" : status === "Rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
            return <div key={bid.bid_id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="text-xs font-semibold text-brand-600">{bid.tender_id}</div><h3 className="mt-1 font-semibold">{bid.tender_title}</h3><div className="mt-1 text-xs text-slate-500">Bid ID: {bid.bid_id} · Submitted: {bid.submission_date || "—"}</div></div>
                <span className={"rounded-full px-2.5 py-1 text-xs font-semibold " + statusClass}>{status}</span>
              </div>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-400">Tender status</div><div className="mt-1 font-medium">{bid.tender_status || "—"}</div></div>
                <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-400">Bid amount</div><div className="mt-1 font-medium">{bid.bid_amount ? "₹" + Number(bid.bid_amount).toLocaleString("en-IN") : "Not provided"}</div></div>
                <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-400">Deadline</div><div className="mt-1 font-medium">{bid.tender_deadline || "—"}</div></div>
              </div>
              {bid.tender_status === "Awarded" && bid.winner_name && <div className="mt-3 text-xs text-slate-500">Recorded winner: {bid.winner_name}</div>}
            </div>;
          }) : <div className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">No bids have been submitted from this bidder account yet.</div>}
        </div>
      </div>
    </div>
  );
}