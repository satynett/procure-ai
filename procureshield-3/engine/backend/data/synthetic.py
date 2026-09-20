"""Deterministic synthetic procurement data with planted collusion patterns.

The generator produces a realistic mix of competitive procurement plus three
classic textbook patterns that investigators look for:

* **bid rotation** - the same small group bids on every tender and takes turns
  winning;
* **cover / complementary bidding** - losers file bids a few percent above the
  designated winner so the tender looks competitive;
* **structural links** - shared directors and shared registered addresses
  between nominally independent bidders.

Labels (``1``) mark companies belonging to a planted ring. In production these
would be historic investigation outcomes, never model output.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

CITY_STREETS = [
    "MG Road", "Industrial Estate", "Civil Lines", "Nehru Nagar", "Sector 7",
    "Ring Road", "Station Road", "Link Road", "Gandhi Chowk", "Steel Plant Road",
]
CITIES = ["Bhilai", "Raipur", "Durg", "Nagpur", "Bhopal", "Indore"]
SUFFIXES = ["Pvt Ltd", "Private Limited", "Infra Pvt. Ltd.", "Constructions", "Enterprises"]
WORD_A = ["Shakti", "Orion", "Vindhya", "Sunrise", "Apex", "Meridian", "Kalinga",
          "Trident", "Vertex", "Sapphire", "Bluestone", "Nova", "Ironwood", "Crest"]
WORD_B = ["Infra", "Buildcon", "Engineers", "Projects", "Works", "Systems",
          "Constructions", "Technologies", "Traders", "Associates"]
DEPARTMENTS = [
    ("DEPT_PWD", "Public Works Department"),
    ("DEPT_HEALTH", "Directorate of Health Services"),
    ("DEPT_EDU", "Department of Education"),
    ("DEPT_WATER", "Water Resources Board"),
    ("DEPT_MUNI", "Municipal Corporation"),
]


@dataclass(frozen=True)
class SyntheticConfig:
    """Knobs for the demo dataset."""

    n_clean_companies: int = 40
    n_cartels: int = 4
    cartel_size: int = 4
    n_competitive_tenders: int = 90
    n_cartel_tenders_each: int = 9
    bidders_per_competitive_tender: Tuple[int, int] = (3, 6)
    seed: int = 7
    start_date: date = date(2024, 1, 8)
    include_labels: bool = True
    # Share of cartel companies whose label is withheld (unknown to the model).
    label_dropout: float = 0.15
    # Share of companies that appear under a second spelling of their name.
    alias_rate: float = 0.12


class SyntheticGenerator:
    """Builds a reproducible procurement dataset."""

    def __init__(self, config: Optional[SyntheticConfig] = None) -> None:
        self.config = config or SyntheticConfig()
        self.rng = random.Random(self.config.seed)
        self._used_names: set[str] = set()

    # ------------------------------------------------------------------ names
    def _company_name(self) -> str:
        """Unique on the *normalised* key so no two firms accidentally merge."""
        from .normalize import normalize_company_name

        for _ in range(500):
            name = f"{self.rng.choice(WORD_A)} {self.rng.choice(WORD_B)} {self.rng.choice(SUFFIXES)}"
            key = normalize_company_name(name)
            if key not in self._used_names:
                self._used_names.add(key)
                return name
        suffix = self.rng.randint(1000, 9999)
        return f"Generic Works {suffix} Pvt Ltd"

    def _person_name(self) -> str:
        first = ["Rahul", "Anita", "Suresh", "Priya", "Vikram", "Neha", "Arjun",
                 "Kavita", "Manoj", "Deepa", "Rajesh", "Sunita", "Amit", "Pooja"]
        last = ["Sharma", "Verma", "Patel", "Nair", "Reddy", "Singh", "Joshi",
                "Mehta", "Rao", "Gupta", "Chauhan", "Das"]
        return f"{self.rng.choice(first)} {self.rng.choice(last)}"

    def _address(self) -> str:
        return (
            f"{self.rng.randint(1, 240)}, {self.rng.choice(CITY_STREETS)}, "
            f"{self.rng.choice(CITIES)}"
        )

    @staticmethod
    def _alias(name: str) -> str:
        """A messy second spelling of the same company, to exercise normalisation."""
        return (
            name.upper()
            .replace("PVT LTD", "PRIVATE LIMITED")
            .replace("PVT. LTD.", "PRIVATE LIMITED")
            .replace(" ", "  ")
        )

    @staticmethod
    def _address_variant(address: str) -> str:
        """Same postal address, sloppier data entry."""
        return (
            address.replace("Road", "Rd.")
            .replace("MG", "M.G.")
            .replace(", ", " , ")
            .upper()
        )

    # ----------------------------------------------------------------- build
    def generate(self) -> pd.DataFrame:
        cfg = self.config
        rows: List[Dict[str, Any]] = []

        companies: List[Dict[str, Any]] = []
        for i in range(cfg.n_clean_companies):
            name = self._company_name()
            companies.append(
                {
                    "id": f"C{i:04d}",
                    "name": name,
                    "address": self._address(),
                    "directors": [
                        {"id": f"P{i:04d}_{k}", "name": self._person_name()}
                        for k in range(self.rng.randint(1, 2))
                    ],
                    "label": 0,
                    "ring": None,
                }
            )

        # ---------------------------------------------------------- cartels
        cartels: List[List[Dict[str, Any]]] = []
        next_index = cfg.n_clean_companies
        for ring_id in range(cfg.n_cartels):
            shared_address = self._address()
            shared_director = {
                "id": f"PX{ring_id:03d}",
                "name": self._person_name(),
            }
            members: List[Dict[str, Any]] = []
            for member_index in range(cfg.cartel_size):
                directors = [
                    {"id": f"P{next_index:04d}_0", "name": self._person_name()}
                ]
                # Structural overlap: most members share a director, half share an address.
                if member_index < max(2, cfg.cartel_size - 1):
                    directors.append(shared_director)
                address = shared_address if member_index % 2 == 0 else self._address()
                members.append(
                    {
                        "id": f"C{next_index:04d}",
                        "name": self._company_name(),
                        "address": address,
                        "directors": directors,
                        "label": 1,
                        "ring": ring_id,
                    }
                )
                next_index += 1
            cartels.append(members)
            companies.extend(members)

        # Withhold some labels so the demo has unlabelled nodes too.
        if cfg.include_labels and cfg.label_dropout > 0:
            for company in companies:
                if company["label"] == 1 and self.rng.random() < cfg.label_dropout:
                    company["label"] = None

        by_id = {c["id"]: c for c in companies}
        clean_pool = [c for c in companies if c["ring"] is None]
        departments = list(DEPARTMENTS)
        tender_counter = 0
        current_date = cfg.start_date

        # Some firms appear in the feed under a second registration id and a
        # sloppier spelling - identity normalisation must collapse them.
        for company in companies:
            company["alias"] = self.rng.random() < cfg.alias_rate

        def emit(
            tender_id: str,
            dept: Tuple[str, str],
            company: Dict[str, Any],
            bid_amount: float,
            tender_value: float,
            bid_date: date,
            is_winner: bool,
        ) -> None:
            director = self.rng.choice(company["directors"])
            name = company["name"]
            company_id = company["id"]
            address = company["address"]
            if company["alias"] and self.rng.random() < 0.5:
                name = self._alias(name)
                company_id = f"{company_id}-B"
                address = self._address_variant(address)
            rows.append(
                {
                    "company_id": company_id,
                    "company_name": name,
                    "person_id": director["id"],
                    "person_name": director["name"],
                    "tender_id": tender_id,
                    "department_id": dept[0],
                    "department_name": dept[1],
                    "address": address,
                    "bid_amount": round(bid_amount, 2),
                    "tender_value": round(tender_value, 2),
                    "bid_date": bid_date.isoformat(),
                    "result": "WIN" if is_winner else "LOSE",
                    "label": company["label"],
                }
            )

        # ------------------------------------------- competitive (clean) tenders
        for _ in range(cfg.n_competitive_tenders):
            tender_id = f"T{tender_counter:04d}"
            tender_counter += 1
            dept = self.rng.choice(departments)
            value = self.rng.uniform(4e5, 9e6)
            current_date += timedelta(days=self.rng.randint(1, 6))
            k = self.rng.randint(*cfg.bidders_per_competitive_tender)
            bidders = self.rng.sample(clean_pool, min(k, len(clean_pool)))
            # Genuine competition: wide, unstructured spread around the estimate.
            bids = [value * self.rng.uniform(0.74, 1.10) for _ in bidders]
            winner_index = min(range(len(bids)), key=lambda i: bids[i])
            for i, company in enumerate(bidders):
                emit(tender_id, dept, company, bids[i], value, current_date, i == winner_index)

        # ------------------------------------------------ cartel-captured tenders
        for ring_id, members in enumerate(cartels):
            dept = departments[ring_id % len(departments)]
            for round_index in range(cfg.n_cartel_tenders_each):
                tender_id = f"T{tender_counter:04d}"
                tender_counter += 1
                value = self.rng.uniform(1.2e6, 8e6)
                current_date += timedelta(days=self.rng.randint(2, 9))

                # Rotation: designated winner walks around the ring in order.
                winner = members[round_index % len(members)]
                # Winner bids close to the estimate (no price pressure).
                winning_bid = value * self.rng.uniform(0.965, 1.02)

                participants = [winner]
                others = [m for m in members if m["id"] != winner["id"]]
                # Cover bidders: 2-3 ring members file higher "complementary" bids.
                cover_count = min(len(others), self.rng.randint(2, 3))
                participants.extend(self.rng.sample(others, cover_count))

                emit(tender_id, dept, winner, winning_bid, value, current_date, True)
                for member in participants[1:]:
                    # Tight, patterned mark-up above the winner - the tell-tale sign.
                    markup = self.rng.uniform(1.025, 1.075)
                    emit(tender_id, dept, member, winning_bid * markup, value,
                         current_date, False)

                # Occasionally an outsider bids too, and always loses.
                if self.rng.random() < 0.25:
                    outsider = self.rng.choice(clean_pool)
                    emit(tender_id, dept, outsider,
                         winning_bid * self.rng.uniform(1.10, 1.35), value,
                         current_date, False)

        frame = pd.DataFrame(rows)
        if not cfg.include_labels:
            frame = frame.drop(columns=["label"])
        # Shuffle so downstream code cannot depend on row order.
        frame = frame.sample(frac=1.0, random_state=cfg.seed).reset_index(drop=True)
        _ = by_id  # kept for readability/debugging of generated rings
        return frame


def generate_synthetic_dataset(
    config: Optional[SyntheticConfig] = None,
) -> pd.DataFrame:
    """Convenience wrapper returning a ready-to-analyse DataFrame."""
    return SyntheticGenerator(config).generate()


def write_synthetic_dataset(
    path: str, config: Optional[SyntheticConfig] = None
) -> str:
    frame = generate_synthetic_dataset(config)
    frame.to_csv(path, index=False)
    return path
