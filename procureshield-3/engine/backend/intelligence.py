"""Document and eligibility intelligence for the ProcureShield prototype."""
from __future__ import annotations

import base64
import binascii
import re
from typing import Any, Dict, List, Optional


def extract_pdf(data: bytes, filename: str) -> Dict[str, Any]:
    """Extract text from a PDF using PyMuPDF."""
    if not filename.lower().endswith(".pdf"):
        return {"filename": filename, "pages": 0, "text": "", "extraction_status": "unsupported_type", "ocr_required": False,
                "message": "Only PDF documents are supported by the prototype."}
    try:
        import fitz
    except ImportError:
        return {"filename": filename, "pages": 0, "text": "", "extraction_status": "parser_unavailable", "ocr_required": False,
                "message": "PyMuPDF is not installed."}
    try:
        doc = fitz.open(stream=data, filetype="pdf")
        pages = [(page.get_text("text") or "") for page in doc]
        doc.close()
    except Exception as exc:
        return {"filename": filename, "pages": 0, "text": "", "extraction_status": "error", "ocr_required": False,
                "message": f"Unable to read PDF: {exc}"}
    text = "\n\n".join(pages).strip()
    ocr_required = len(re.sub(r"\s+", "", text)) < 80
    return {
        "filename": filename,
        "pages": len(pages),
        "text": text,
        "extraction_status": "success" if text else "empty",
        "ocr_required": ocr_required,
        "message": "Text extracted successfully." if text and not ocr_required
                   else "Little or no text was extracted; OCR may be required.",
    }


def extract_requirements(text: str) -> Dict[str, Any]:
    """Extract common procurement requirements using a deterministic parser."""
    source = text or ""
    lowered = source.lower()
    requirements: List[Dict[str, Any]] = []

    patterns = [
        (r"(?:minimum|min\.?)[^.\n]{0,80}(\d+)\s*years?[^.\n]{0,80}(?:experience|work)", "experience"),
        (r"(?:turnover|average annual turnover)[^.\n]{0,80}(?:rs\.?|₹)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(crore|lakh|million)?", "turnover"),
        (r"(?:gst|goods and services tax)[^.\n]{0,80}(?:registration|registered)", "tax"),
        (r"(?:udyam|msme)[^.\n]{0,80}(?:registration|certificate)", "msme"),
        (r"(?:pan)[^.\n]{0,80}(?:card|number|details)", "identity"),
    ]
    for pattern, kind in patterns:
        match = re.search(pattern, source, flags=re.I)
        if not match:
            continue
        if kind == "experience":
            description = f"Minimum {match.group(1)} years experience"
        elif kind == "turnover":
            description = f"Minimum turnover {match.group(1)} {match.group(2) or ''}".strip()
        elif kind == "tax":
            description = "Valid GST registration"
        elif kind == "msme":
            description = "Udyam/MSME registration information"
        else:
            description = "PAN information"
        requirements.append({
            "requirement": description,
            "type": kind,
            "mandatory": any(word in lowered for word in ("mandatory", "shall", "must")),
            "source": "deterministic-prototype-parser",
        })

    required_documents: List[str] = []
    for needle, label in [
        ("gst", "GST certificate"), ("pan", "PAN card"), ("udyam", "Udyam/MSME certificate"),
        ("experience certificate", "Experience certificate"), ("work order", "Work order"),
        ("financial statement", "Financial statement"), ("balance sheet", "Balance sheet"),
        ("incorporation", "Certificate of incorporation"),
    ]:
        if needle in lowered and label not in required_documents:
            required_documents.append(label)

    dates = re.findall(
        r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+"
        r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b",
        source, flags=re.I
    )
    title = next(
        (line.strip() for line in source.splitlines()
         if 5 <= len(line.strip()) <= 140 and any(k in line.lower() for k in ("tender", "request for proposal", "rfp"))),
        "Extracted Tender",
    )
    return {
        "tender_title": title,
        "eligibility_requirements": requirements,
        "required_documents": required_documents,
        "technical_requirements": [],
        "financial_requirements": [r for r in requirements if r["type"] == "turnover"],
        "important_dates": dates[:20],
        "parser": "deterministic-prototype",
        "llm_configured": False,
        "disclaimer": "Prototype extraction; human review is required before procurement decisions.",
    }


def validate_document(filename: str, content_type: Optional[str], data: bytes) -> Dict[str, Any]:
    checks = [
        {"name": "File present", "passed": bool(data)},
        {"name": "PDF extension", "passed": filename.lower().endswith(".pdf")},
        {"name": "Readable PDF", "passed": False},
    ]
    if data and filename.lower().endswith(".pdf"):
        try:
            import fitz
            doc = fitz.open(stream=data, filetype="pdf")
            checks[2]["passed"] = len(doc) > 0
            doc.close()
        except Exception:
            pass
    return {
        "document": filename,
        "content_type": content_type,
        "status": "valid" if all(c["passed"] for c in checks) else "needs_review",
        "checks": checks,
    }


def decode_upload(payload: Dict[str, Any]) -> bytes:
    encoded = payload.get("content_base64")
    if not encoded:
        raise ValueError("content_base64 is required")
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 document payload") from exc


def check_eligibility(tender: Dict[str, Any], bidder: Dict[str, Any]) -> Dict[str, Any]:
    """Evaluate self-declared bidder information against extracted requirements."""
    requirements = tender.get("eligibility_requirements", [])
    checks: List[Dict[str, Any]] = []
    docs = {str(x).strip().lower() for x in bidder.get("documents", [])}

    for req in requirements:
        kind = req.get("type")
        text = str(req.get("requirement", ""))
        if kind == "experience":
            match = re.search(r"(\d+)", text)
            minimum = int(match.group(1)) if match else None
            actual = bidder.get("years_experience")
            passed = minimum is not None and isinstance(actual, (int, float)) and actual >= minimum
            checks.append({"requirement": text, "status": "pass" if passed else ("missing" if actual is None else "needs_review"),
                           "evidence": f"Self-declared experience: {actual}" if actual is not None else "Experience not provided"})
        elif kind == "turnover":
            actual = bidder.get("turnover")
            checks.append({"requirement": text, "status": "pass" if isinstance(actual, (int, float)) and actual > 0 else "needs_review",
                           "evidence": f"Self-declared turnover: {actual}" if actual is not None else "Turnover not provided"})
        elif kind == "tax":
            checks.append({"requirement": text, "status": "pass" if bidder.get("gstin") else "missing",
                           "evidence": "GSTIN supplied by bidder" if bidder.get("gstin") else "GSTIN not provided"})
        elif kind == "identity":
            checks.append({"requirement": text, "status": "pass" if bidder.get("pan") else "missing",
                           "evidence": "PAN supplied by bidder" if bidder.get("pan") else "PAN not provided"})
        elif kind == "msme":
            checks.append({"requirement": text, "status": "pass" if bidder.get("udyam") else "needs_review",
                           "evidence": "Udyam number supplied by bidder" if bidder.get("udyam") else "Udyam information not provided"})

    for document in tender.get("required_documents", []):
        supplied = document.lower() in docs
        checks.append({"requirement": f"Document: {document}", "status": "pass" if supplied else "missing",
                       "evidence": "Document listed by bidder" if supplied else "Required document not supplied"})

    if any(c["status"] == "missing" for c in checks):
        status = "Needs Documents"
    elif any(c["status"] == "needs_review" for c in checks):
        status = "Needs Review"
    else:
        status = "Pre-check Passed" if checks else "Needs Review"
    passed_count = sum(c["status"] == "pass" for c in checks)
    score = round(100 * passed_count / len(checks), 1) if checks else 0
    return {
        "status": status,
        "eligibility_score": score,
        "checks": checks,
        "verification": "self_declared",
        "message": "Self-check only. External verification is required for official eligibility.",
    }
