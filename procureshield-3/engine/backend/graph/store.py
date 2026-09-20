"""Pluggable graph persistence.

Development runs entirely in memory on NetworkX. The same interface writes to a
Neo4j-compatible database when ``PROCURESHIELD_GRAPH_BACKEND=neo4j`` and the
``neo4j`` driver is installed. There are no stubbed or faked remote calls: if
the driver or server is unavailable the store raises immediately.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from ..config import Settings
from ..exceptions import DependencyMissingError
from ..logging_utils import get_logger
from .builder import ProcurementGraph, export_edges, export_nodes
from .schema import EdgeType

LOGGER = get_logger("graph.store")


@runtime_checkable
class GraphStore(Protocol):
    """Minimal persistence contract used by the pipeline."""

    backend: str

    def persist(self, graph: ProcurementGraph) -> Dict[str, int]: ...

    def fetch_neighbors(self, node_id: str, depth: int = 1) -> Dict[str, Any]: ...

    def close(self) -> None: ...


class InMemoryGraphStore:
    """Default development store - keeps the NetworkX graph in process memory."""

    backend = "memory"

    def __init__(self) -> None:
        self._graph: Optional[ProcurementGraph] = None

    @property
    def graph(self) -> Optional[ProcurementGraph]:
        return self._graph

    def persist(self, graph: ProcurementGraph) -> Dict[str, int]:
        self._graph = graph
        stats = graph.stats()
        LOGGER.info("persisted graph in memory (%s nodes)", stats["nodes"])
        return stats

    def fetch_neighbors(self, node_id: str, depth: int = 1) -> Dict[str, Any]:
        if self._graph is None:
            return {"nodes": [], "edges": []}
        from .builder import ego_network

        nodes, edges = ego_network(self._graph, node_id, depth=depth)
        return {"nodes": nodes, "edges": edges}

    def close(self) -> None:  # nothing to release
        self._graph = None


class Neo4jGraphStore:
    """Writes the procurement graph into Neo4j using parameterised Cypher."""

    backend = "neo4j"

    NODE_MERGE = (
        "UNWIND $rows AS row "
        "MERGE (n:Entity {id: row.id}) "
        "SET n.label = row.label, n.node_type = row.type, n.degree = row.degree"
    )
    EDGE_MERGE = (
        "UNWIND $rows AS row "
        "MATCH (a:Entity {id: row.source}) "
        "MATCH (b:Entity {id: row.target}) "
        "MERGE (a)-[r:RELATED {type: row.type}]->(b) "
        "SET r.weight = row.weight"
    )
    NEIGHBOUR_QUERY = (
        "MATCH path = (n:Entity {id: $node_id})-[*1..$depth]-(m:Entity) "
        "RETURN path LIMIT $limit"
    )

    def __init__(self, settings: Settings) -> None:
        try:
            from neo4j import GraphDatabase  # type: ignore import-not-found
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise DependencyMissingError(
                "neo4j driver is not installed. Run `pip install neo4j` or set "
                "PROCURESHIELD_GRAPH_BACKEND=memory."
            ) from exc

        self._settings = settings
        self._driver = GraphDatabase.driver(
            settings.neo4j_uri, auth=(settings.neo4j_user, settings.neo4j_password)
        )

    def persist(self, graph: ProcurementGraph) -> Dict[str, int]:
        nodes = export_nodes(graph)
        edges = export_edges(graph)
        with self._driver.session(database=self._settings.neo4j_database) as session:
            session.run("CREATE INDEX entity_id IF NOT EXISTS FOR (n:Entity) ON (n.id)")
            for chunk in _chunked(nodes, 1000):
                session.run(self.NODE_MERGE, rows=chunk)
            for chunk in _chunked(edges, 1000):
                session.run(self.EDGE_MERGE, rows=chunk)
        LOGGER.info("persisted %d nodes / %d edges to Neo4j", len(nodes), len(edges))
        return graph.stats()

    def fetch_neighbors(self, node_id: str, depth: int = 1) -> Dict[str, Any]:
        query = (
            f"MATCH (n:Entity {{id: $node_id}})-[r:RELATED*1..{int(depth)}]-(m:Entity) "
            "RETURN DISTINCT m.id AS id, m.label AS label, m.node_type AS type LIMIT 500"
        )
        with self._driver.session(database=self._settings.neo4j_database) as session:
            result = session.run(query, node_id=node_id)
            nodes = [dict(record) for record in result]
        return {"nodes": nodes, "edges": []}

    def close(self) -> None:
        self._driver.close()


def _chunked(items: List[Dict[str, Any]], size: int) -> List[List[Dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def build_store(settings: Settings) -> GraphStore:
    """Factory honouring ``settings.graph_backend`` with a safe fallback."""
    if settings.graph_backend == "neo4j":
        try:
            return Neo4jGraphStore(settings)
        except DependencyMissingError as exc:
            LOGGER.warning("%s Falling back to in-memory graph store.", exc)
    return InMemoryGraphStore()


__all__ = [
    "GraphStore",
    "InMemoryGraphStore",
    "Neo4jGraphStore",
    "build_store",
    "EdgeType",
]
