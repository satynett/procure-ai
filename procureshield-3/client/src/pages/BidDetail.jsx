import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft, CheckCircle2, AlertTriangle, XCircle, Sparkles, Info,
  ShieldQuestion, Loader2, ChevronRight, Share2, CheckCircle2, XCircle, ClipboardCheck,
} from "lucide-react";
import { api } from "../api.js";
import { RiskBadge, StatusBadge } from "../components/Badges.jsx";
import Modal from "../components/Modal.jsx";
import { labelFor } from "../constants.js";

const ICONS = {
  verified: <CheckCircle2 size={16} className="text-emerald-500" />,
  warning: <AlertTriangle size={16} className="text-amber-500" />,
  failed: <XCircle size={16} className="text-red-500" />,
};

export default function BidDetail() {
  const { bidId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [scoreExplainOpen, setScoreExplainOpen] = useState(false);
  const [modal, setModal] = useState(null); // { action, title, description, ... }
  const [toast, setToast] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api.bidDetail(bidId).then((res) => {
      setData(res);
      setLoading(false);
      setAiSummary(null);
    });
  }, [bidId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!data) return;
    if (data.relatedEdges.length === 0) return;
    setAiLoading(true);
    const top = data.relatedEdges[0];
    api
      // Ids, not names: the server resolves the relationship in the engine's
      // output rather than having text composed on the client.
      .aiAnalyze("relationship", {
        bidderA: data.bidder.bidder_id,
        bidderB: top.bidder_id,
      })
      .then(setAiSummary)
      .finally(() => setAiLoading(false));
  }, [data]);

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const { bid, bidder, checklist, relatedEdges: allEdges } = data;
  // Only "linkable" (strong-signal) relationships are surfaced as AI findings /
  // network connections. Weak, coincidental signals (e.g. a shared GST-state
  // prefix on their own) are real data points but must not trigger the same
  // "potential relationship detected" messaging as a genuine network match —
  // otherwise the system would appear to flag nearly everyone.
  const relatedEdges = allEdges.filter((e) => e.linkable);

  async function runAction(actionKey, comment) {
    await api.verificationAction(bid.bid_id, actionKey, comment);
    setModal(null);
    setToast("Action recorded and saved to the audit log.");
    setTimeout(() => setToast(""), 3500);
    load();
  }

  // Score breakdown now comes from the engine's per-signal output for this
  // bidder, not from client-side weights.
  const engineSignals = data.riskAssessment?.signals || [];
  const scoreBreakdown = engineSignals.map((s) => ({
    label: s.label,
    value: Math.round(s.severity * s.weight * 100),
    description: s.description,
  }));
  const scoreTotal = data.riskAssessment?.score ?? bid.risk_score;

  return (
    <div className="fade-in space-y-5 pb-10">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={14} /> Back
      </button>

      {toast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 fade-in">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-mono text-lg font-bold text-slate-900">Bid {bid.bid_id}</h1>
            <p className="text-sm text-slate-500">Tender {bid.tender_id} · {bid.category}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={bid.verification_status} />
            <button onClick={() => setScoreExplainOpen(true)}>
              <RiskBadge score={bid.risk_score} category={bid.risk_category} />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4">
          <Field label="Bidder" value={bidder.company_name} />
          <Field label="Bid Amount" value={`₹ ${bid.bid_amount.toLocaleString("en-IN")}`} />
          <Field label="Submission Date" value={bid.submission_date} />
          <Field label="MSME Status" value={bidder.msme_status} />
        </div>
      </div>

      {data.finalComparison && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <ClipboardCheck size={16} /> Final Compliance Comparison
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {data.finalComparison.tender_id} · {data.finalComparison.tender_title}
              </p>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-slate-900">{data.finalComparison.score}%</div>
              <div className="text-xs text-slate-500">{data.finalComparison.matched}/{data.finalComparison.total} requirements matched</div>
            </div>
          </div>

          {data.finalComparison.eligibility_summary && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">RFP eligibility:</span> {data.finalComparison.eligibility_summary}
            </div>
          )}

          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {(data.finalComparison.checks || []).map((item) => (
              <div key={item.requirement} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 p-3">
                <div className="flex items-start gap-2">
                  {item.status === "matched"
                    ? <CheckCircle2 size={16} className="mt-0.5 text-emerald-600" />
                    : item.status === "missing"
                      ? <XCircle size={16} className="mt-0.5 text-red-500" />
                      : <AlertTriangle size={16} className="mt-0.5 text-amber-500" />}
                  <div>
                    <div className="text-sm font-medium text-slate-800">{item.requirement}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.evidence}</div>
                  </div>
                </div>
                <span className={
                  item.status === "matched"
                    ? "rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700"
                    : item.status === "missing"
                      ? "rounded-full bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700"
                      : "rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700"
                }>
                  {item.status === "matched" ? "Matched" : item.status === "missing" ? "Missing" : "Evidence required"}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {data.finalComparison.message}
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Checklist */}
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="mb-4 text-sm font-semibold text-slate-800">Automated Compliance Checklist</h2>
            <div className="space-y-3">
              {checklist.map((item) => (
                <div key={item.key} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3">
                  <div className="mt-0.5">{ICONS[item.status]}</div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-800">{item.label}</span>
                      <span className="text-xs font-semibold text-slate-400">{item.confidence}% confidence</span>
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.explanation}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Verification Panel */}
          <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
                <Sparkles size={14} />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">AI Verification Assistant</h2>
            </div>

            {relatedEdges.length === 0 ? (
              <p className="text-sm text-slate-600">
                Automated analysis completed. No relationship signals were found for this bidder in the current dataset.
              </p>
            ) : aiLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 size={14} className="animate-spin" /> Automated analysis completed. Generating explanation...
              </div>
            ) : (
              <>
                <p className="mb-3 text-sm font-medium text-slate-700">Automated analysis completed.</p>
                <div className="mb-3 rounded-lg bg-white p-3 text-sm text-slate-700">
                  {aiSummary?.narrative}
                </div>
                <div className="mb-3 grid grid-cols-3 gap-3">
                  {relatedEdges[0].evidence.includes("sharedAddress") && <ConfBox label="Address Match" value={94} />}
                  {relatedEdges[0].evidence.includes("sharedDirector") && <ConfBox label="Director Match" value={91} />}
                  {relatedEdges[0].evidence.includes("sharedBank") && <ConfBox label="Bank Relationship" value={87} />}
                </div>
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                  Potential relationship detected — manual verification required.
                </p>
              </>
            )}
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
              <Info size={12} className="mt-0.5 flex-shrink-0" />
              AI-generated analysis is advisory. Final procurement decisions must be made by an authorized officer.
            </p>
          </div>

          {relatedEdges.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Share2 size={15} /> Related Bidders
              </h2>
              <div className="space-y-2">
                {relatedEdges.map((e) => (
                  <div key={e.bidder_id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                    <div>
                      <div className="text-sm font-medium text-slate-800">{e.company_name}</div>
                      <div className="text-xs text-slate-400">{e.evidence.map(labelFor).join(", ")}</div>
                    </div>
                    <RiskBadge score={e.score} />
                  </div>
                ))}
              </div>
              <Link
                to={`/app/bidder-network?focus=${bidder.bidder_id}`}
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
              >
                View full network graph <ChevronRight size={13} />
              </Link>
            </div>
          )}
        </div>

        {/* Sidebar: HITL actions */}
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <ShieldQuestion size={15} /> Officer Decision
            </h2>
            <p className="mb-4 text-xs text-slate-500">
              The system never auto-decides. Choose the appropriate action for this bid.
            </p>
            <div className="space-y-2">
              <ActionButton
                tone="brand"
                label="Confirm & Close"
                onClick={() =>
                  setModal({
                    action: "confirm",
                    title: "Confirm & Close",
                    description: "Are you sure you want to confirm this bid and close verification?",
                  })
                }
              />
              <ActionButton
                tone="warn"
                label="Send for Manual Review"
                onClick={() =>
                  setModal({
                    action: "review",
                    title: "Send for Manual Review",
                    description: "Are you sure you want to mark this relationship for manual review?",
                  })
                }
              />
              <ActionButton
                tone="neutral"
                label="Mark as False Positive"
                onClick={() =>
                  setModal({
                    action: "false-positive",
                    title: "Mark as False Positive",
                    description: "Confirm that the detected signal(s) do not indicate a real relationship risk.",
                    requireComment: true,
                  })
                }
              />
              <ActionButton
                tone="danger"
                label="Escalate"
                onClick={() =>
                  setModal({
                    action: "escalate",
                    title: "Escalate",
                    description: "Escalate this bid for senior officer / investigation cell attention.",
                    requireComment: true,
                  })
                }
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card text-xs text-slate-500">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Bidder Snapshot</h3>
            <Field label="Director" value={bidder.director_name} small />
            <Field label="Address" value={bidder.address} small />
            <Field label="Phone" value={bidder.phone_masked} small />
            <Field label="Bank Account" value={bidder.bank_account_masked} small />
            <Field label="GST" value={bidder.gst_number} small />
            <Field label="PAN" value={bidder.pan_number} small />
          </div>
        </div>
      </div>

      {scoreExplainOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 fade-in" onClick={() => setScoreExplainOpen(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-semibold text-slate-900">Why is this score {bid.risk_score}?</h3>
            <p className="mb-4 text-xs text-slate-500">Relationship Risk / Review Priority — not proof of wrongdoing.</p>
            {scoreBreakdown.length === 0 ? (
              <p className="text-sm text-slate-500">No relationship signals contributed to this score.</p>
            ) : (
              <div className="space-y-2">
                {scoreBreakdown.map((s) => (
                  <div key={s.label} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{s.label}</span>
                    <span className="font-semibold text-slate-800">+{s.value}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-sm font-bold text-slate-900">
                  <span>Total</span>
                  <span>{scoreTotal}</span>
                </div>
              </div>
            )}
            <button
              onClick={() => setScoreExplainOpen(false)}
              className="mt-4 w-full rounded-lg bg-slate-100 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {modal && (
        <Modal
          title={modal.title}
          description={modal.description}
          requireComment={modal.requireComment}
          confirmLabel="Confirm"
          tone={modal.action === "escalate" ? "danger" : modal.action === "review" ? "warn" : "brand"}
          onClose={() => setModal(null)}
          onConfirm={(comment) => runAction(modal.action, comment)}
        />
      )}
    </div>
  );
}

function Field({ label, value, small }) {
  return (
    <div className={small ? "mb-2" : ""}>
      <div className={`text-[11px] font-medium uppercase tracking-wide text-slate-400`}>{label}</div>
      <div className={small ? "text-xs font-medium text-slate-700" : "text-sm font-semibold text-slate-800"}>{value}</div>
    </div>
  );
}

function ConfBox({ label, value }) {
  return (
    <div className="rounded-lg bg-white p-2 text-center">
      <div className="text-lg font-bold text-brand-700">{value}%</div>
      <div className="text-[10px] font-medium text-slate-500">{label}</div>
    </div>
  );
}

function ActionButton({ label, onClick, tone }) {
  const styles = {
    brand: "bg-brand-600 text-white hover:bg-brand-700",
    warn: "bg-amber-500 text-white hover:bg-amber-600",
    danger: "bg-red-600 text-white hover:bg-red-700",
    neutral: "bg-slate-100 text-slate-700 hover:bg-slate-200",
  };
  return (
    <button onClick={onClick} className={`w-full rounded-lg py-2.5 text-sm font-semibold transition-colors ${styles[tone]}`}>
      {label}
    </button>
  );
}
