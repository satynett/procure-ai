import React from "react";
import { UploadCloud, X, AlertCircle, CheckCircle2 } from "lucide-react";

const ALLOWED_EXTENSIONS = /\.(pdf|doc|docx)$/i;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const MAX_FILE_SIZE = 15 * 1024 * 1024;

export function addAcceptedFiles(existing, fileList) {
  const accepted = [];
  const rejected = [];
  Array.from(fileList || []).forEach((file) => {
    const validType = ALLOWED_TYPES.has(file.type) || ALLOWED_EXTENSIONS.test(file.name);
    if (!validType) {
      rejected.push({ name: file.name, reason: "Wrong file type. Upload PDF, DOC or DOCX." });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      rejected.push({ name: file.name, reason: "File is too large. Maximum size is 15 MB." });
      return;
    }
    if (!file.size) {
      rejected.push({ name: file.name, reason: "Empty document. Please upload a real document." });
      return;
    }
    accepted.push(file);
  });
  const merged = [...existing, ...accepted].filter((file, index, all) =>
    all.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size) === index
  );
  return { files: merged, rejected };
}

export default function DocumentDropzone({ files, onChange, errors = [], label = "Documents", hint = "Drag and drop multiple PDF, DOC or DOCX files here, or choose files." }) {
  function handleFiles(fileList) {
    const result = addAcceptedFiles(files, fileList);
    onChange(result.files, result.rejected);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
      className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-5 text-center transition hover:border-brand-300"
    >
      <UploadCloud className="mx-auto text-brand-600" size={28} />
      <div className="mt-2 text-sm font-semibold text-slate-800">{label}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500">{hint}</div>
      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:border-brand-300">
        <UploadCloud size={14} /> Choose files
        <input
          type="file"
          multiple
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          className="sr-only"
        />
      </label>

      {(errors.length > 0 || files.length > 0) && (
        <div className="mt-4 space-y-2 text-left">
          {errors.map((item, index) => (
            <div key={item.name + index} className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <div><span className="font-semibold">{item.name}</span> — {item.reason}</div>
            </div>
          ))}
          {files.map((file, index) => (
            <div key={file.name + file.size + index} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                <span className="truncate font-medium text-slate-700">{file.name}</span>
              </div>
              <button type="button" onClick={() => onChange(files.filter((_, i) => i !== index), errors)} className="shrink-0 text-slate-400 hover:text-red-500" aria-label={`Remove ${file.name}`}>
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
