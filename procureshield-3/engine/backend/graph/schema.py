"""Heterogeneous procurement graph schema."""

from __future__ import annotations

from enum import Enum
from typing import Dict, Tuple


class NodeType(str, Enum):
    COMPANY = "Company"
    PERSON = "Person"
    TENDER = "Tender"
    DEPARTMENT = "Department"
    ADDRESS = "Address"


class EdgeType(str, Enum):
    DIRECTOR_OF = "DIRECTOR_OF"
    OWNS = "OWNS"
    BIDS_IN = "BIDS_IN"
    WINS = "WINS"
    REGISTERED_AT = "REGISTERED_AT"
    ISSUED_BY = "ISSUED_BY"
    CO_BID = "CO_BID"


#: Allowed (source, edge, target) triples. The builder enforces this.
EDGE_SCHEMA: Dict[EdgeType, Tuple[NodeType, NodeType]] = {
    EdgeType.DIRECTOR_OF: (NodeType.PERSON, NodeType.COMPANY),
    EdgeType.OWNS: (NodeType.PERSON, NodeType.COMPANY),
    EdgeType.BIDS_IN: (NodeType.COMPANY, NodeType.TENDER),
    EdgeType.WINS: (NodeType.COMPANY, NodeType.TENDER),
    EdgeType.REGISTERED_AT: (NodeType.COMPANY, NodeType.ADDRESS),
    EdgeType.ISSUED_BY: (NodeType.TENDER, NodeType.DEPARTMENT),
    EdgeType.CO_BID: (NodeType.COMPANY, NodeType.COMPANY),
}

#: Edges that are semantically undirected (stored once, traversed both ways).
SYMMETRIC_EDGES = frozenset({EdgeType.CO_BID})

NODE_TYPE_ORDER = [
    NodeType.COMPANY,
    NodeType.PERSON,
    NodeType.TENDER,
    NodeType.DEPARTMENT,
    NodeType.ADDRESS,
]
