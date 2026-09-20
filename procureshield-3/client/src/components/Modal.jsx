import React, { useState } from "react";
import { X } from "lucide-react";

export default function Modal({ title, description, requireComment, confirmLabel = "Confirm", tone = "brand", onConfirm, onClose }) {
  const [comment, setComment] = useState("");

  const toneClasses = {
    brand: "bg-brand-600 hover:bg-brand-700",
    danger: "bg-red-600 hover:bg-red-700",
    warn: "bg-amber-600 hover:bg-amber-700",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 fade-in">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-600">{description}</p>
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Comments {requireComment ? "(required)" : "(optional)"}
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            placeholder="Add notes for the audit log..."
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            disabled={requireComment && !comment.trim()}
            onClick={() => onConfirm(comment)}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${toneClasses[tone]}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
