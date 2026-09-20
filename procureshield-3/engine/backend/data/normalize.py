"""Identity normalisation / entity resolution.

Bid-rigging networks hide behind spelling variants: ``ABC Infra Pvt. Ltd.`` and
``A.B.C. INFRA PRIVATE LIMITED`` are the same bidder, and ``12/A, MG Road``
matches ``12 A M.G. Road``. This module produces deterministic canonical keys so
the graph links those entities instead of duplicating them.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple

from .schema import BidRecord

LEGAL_SUFFIXES = {
    "pvt", "private", "ltd", "limited", "llp", "llc", "inc", "incorporated",
    "corp", "corporation", "co", "company", "plc", "gmbh", "sa", "sarl", "bv",
    "and", "the",
}

ADDRESS_ABBREVIATIONS = {
    "st": "street", "str": "street", "rd": "road", "ave": "avenue",
    "av": "avenue", "blvd": "boulevard", "ln": "lane", "dr": "drive",
    "sq": "square", "apt": "apartment", "flr": "floor", "fl": "floor",
    "bldg": "building", "blk": "block", "no": "number", "opp": "opposite",
    "nr": "near", "ind": "industrial", "estt": "estate", "sec": "sector",
    "ph": "phase", "plt": "plot",
}

PERSON_TITLES = {"mr", "mrs", "ms", "dr", "shri", "smt", "sri", "prof", "er"}

_NON_ALNUM = re.compile(r"[^a-z0-9\s]+")
_MULTI_SPACE = re.compile(r"\s+")
# Dots and apostrophes are *removed* rather than replaced by a space, so
# "A.B.C." collapses to "abc" instead of splitting into three tokens.
_JOINING_PUNCT = re.compile(r"[.\u2019']+")


def _ascii_fold(text: str) -> str:
    normalised = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in normalised if not unicodedata.combining(ch))


def _base_clean(text: str) -> str:
    cleaned = _ascii_fold(str(text)).lower()
    cleaned = _JOINING_PUNCT.sub("", cleaned)
    cleaned = _NON_ALNUM.sub(" ", cleaned)
    return _MULTI_SPACE.sub(" ", cleaned).strip()


def normalize_company_name(name: Optional[str]) -> str:
    """Canonical company key: lowercase, de-punctuated, legal suffixes dropped."""
    if not name:
        return ""
    tokens = [t for t in _base_clean(name).split() if t not in LEGAL_SUFFIXES]
    return " ".join(tokens) if tokens else _base_clean(name)


def normalize_person_name(name: Optional[str]) -> str:
    """Canonical person key: titles stripped, tokens sorted to survive name order."""
    if not name:
        return ""
    tokens = [t for t in _base_clean(name).split() if t not in PERSON_TITLES]
    if not tokens:
        return _base_clean(name)
    return " ".join(sorted(tokens))


def normalize_address(address: Optional[str]) -> str:
    """Canonical address key: abbreviations expanded, tokens sorted.

    Token sorting deliberately makes the key order-insensitive so that
    ``12 MG Road, Sector 5`` and ``Sector 5, 12 M.G. Road`` collapse together.
    """
    if not address:
        return ""
    tokens = [ADDRESS_ABBREVIATIONS.get(t, t) for t in _base_clean(address).split()]
    tokens = [t for t in tokens if t]
    if not tokens:
        return ""
    return " ".join(sorted(tokens))


def stable_id(prefix: str, key: str) -> str:
    """Deterministic surrogate id derived from a canonical key."""
    import hashlib

    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{digest}"


@dataclass
class IdentityIndex:
    """Bidirectional map between canonical ids and the raw values observed."""

    canonical_to_display: Dict[str, str] = field(default_factory=dict)
    raw_to_canonical: Dict[str, str] = field(default_factory=dict)
    canonical_to_raw: Dict[str, List[str]] = field(default_factory=dict)

    def register(self, raw_id: str, canonical_id: str, display: str) -> None:
        self.raw_to_canonical[raw_id] = canonical_id
        self.canonical_to_display.setdefault(canonical_id, display)
        bucket = self.canonical_to_raw.setdefault(canonical_id, [])
        if raw_id not in bucket:
            bucket.append(raw_id)

    def resolve(self, raw_id: str) -> str:
        return self.raw_to_canonical.get(raw_id, raw_id)

    def display(self, canonical_id: str) -> str:
        return self.canonical_to_display.get(canonical_id, canonical_id)

    def aliases(self, canonical_id: str) -> List[str]:
        return list(self.canonical_to_raw.get(canonical_id, []))

    @property
    def merged_groups(self) -> Dict[str, List[str]]:
        """Canonical ids that absorbed more than one raw identifier."""
        return {k: v for k, v in self.canonical_to_raw.items() if len(v) > 1}


@dataclass
class NormalizedDataset:
    """Records plus the identity indexes used to link them."""

    records: List[BidRecord]
    companies: IdentityIndex
    persons: IdentityIndex
    addresses: IdentityIndex
    departments: IdentityIndex

    def summary(self) -> Dict[str, int]:
        return {
            "records": len(self.records),
            "companies": len(self.companies.canonical_to_display),
            "persons": len(self.persons.canonical_to_display),
            "addresses": len(self.addresses.canonical_to_display),
            "departments": len(self.departments.canonical_to_display),
            "merged_company_identities": len(self.companies.merged_groups),
            "shared_address_clusters": sum(
                1 for v in self.addresses.canonical_to_raw.values() if len(v) > 1
            ),
        }


def _canonical_pair(
    raw_id: Optional[str],
    raw_name: Optional[str],
    prefix: str,
    normalizer,
) -> Optional[Tuple[str, str]]:
    """Return ``(canonical_id, display)`` or ``None`` when nothing identifiable."""
    key = normalizer(raw_name) if raw_name else ""
    if key:
        return stable_id(prefix, key), (raw_name or key).strip()
    if raw_id:
        return f"{prefix}_{str(raw_id).strip()}", str(raw_id).strip()
    return None


def normalize_records(records: Iterable[BidRecord]) -> NormalizedDataset:
    """Resolve raw identifiers into canonical entity ids.

    Resolution rules, in order:

    1. If a name is present, the normalised name drives the canonical id, so two
       ids spelling the same company merge into one node.
    2. Otherwise the raw id is used verbatim.
    """
    companies = IdentityIndex()
    persons = IdentityIndex()
    addresses = IdentityIndex()
    departments = IdentityIndex()

    materialised = list(records)

    for record in materialised:
        company = _canonical_pair(
            record.company_id, record.company_name, "C", normalize_company_name
        )
        if company is None:  # company_id is mandatory, so this is unreachable
            continue
        companies.register(record.company_id, company[0], company[1])

        if record.person_id or record.person_name:
            person = _canonical_pair(
                record.person_id, record.person_name, "P", normalize_person_name
            )
            if person:
                persons.register(record.person_id or person[0], person[0], person[1])

        if record.address:
            key = normalize_address(record.address)
            if key:
                addresses.register(record.address, stable_id("A", key), record.address)

        if record.department_id or record.department_name:
            dept = _canonical_pair(
                record.department_id, record.department_name, "D", normalize_company_name
            )
            if dept:
                departments.register(
                    record.department_id or dept[0], dept[0], dept[1]
                )

    return NormalizedDataset(
        records=materialised,
        companies=companies,
        persons=persons,
        addresses=addresses,
        departments=departments,
    )
