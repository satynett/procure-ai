"""Conversion of the NetworkX procurement graph into PyTorch Geometric tensors.

The heterogeneous graph is encoded as a single homogeneous tensor graph where
node type is carried by a one-hot block of the feature vector and relation type
is carried on ``edge_type``. This keeps message passing simple while preserving
the type information the attention layer needs, and it lets the same tensors
drive both supervised and unsupervised modes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

from ..exceptions import DependencyMissingError
from ..graph.builder import ProcurementGraph
from ..graph.schema import NODE_TYPE_ORDER, EdgeType, NodeType
from ..logging_utils import get_logger
from .graph_features import COMPANY_FEATURE_COLUMNS, FeatureBundle

LOGGER = get_logger("features.encoders")

EDGE_TYPE_ORDER: List[EdgeType] = list(EdgeType)


def _require_torch():
    try:
        import torch  # noqa: F401
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise DependencyMissingError(
            "PyTorch is required for tensor encoding. Install it with "
            "`pip install torch` or run the pipeline in rules-only mode."
        ) from exc
    import torch

    return torch


@dataclass
class GraphTensors:
    """Tensors describing the whole procurement graph."""

    x: "np.ndarray"          # torch.Tensor at runtime; typed loosely to keep torch optional
    edge_index: "np.ndarray"
    edge_type: "np.ndarray"
    node_ids: List[str]
    company_indices: "np.ndarray"
    company_ids: List[str]
    y: Optional["np.ndarray"] = None
    labelled_mask: Optional["np.ndarray"] = None
    feature_names: List[str] = None  # type: ignore[assignment]

    @property
    def num_nodes(self) -> int:
        return len(self.node_ids)

    @property
    def num_features(self) -> int:
        return int(self.x.shape[1])

    def to_pyg(self):
        """Wrap into a ``torch_geometric.data.Data`` object when PyG is present."""
        try:
            from torch_geometric.data import Data  # type: ignore import-not-found
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise DependencyMissingError(
                "torch_geometric is not installed; use the raw tensors instead."
            ) from exc
        return Data(x=self.x, edge_index=self.edge_index, edge_type=self.edge_type)


def build_graph_tensors(
    pg: ProcurementGraph,
    bundle: FeatureBundle,
    labels: Optional[Dict[str, int]] = None,
) -> GraphTensors:
    """Encode graph + features into tensors.

    Node features = ``[one-hot node type | company feature block]``. Non-company
    nodes carry a small set of structural statistics in the company block slots
    that are meaningful for them (degree-based), and zeros elsewhere.
    """
    torch = _require_torch()

    node_ids: List[str] = list(pg.graph.nodes())
    index_of = {node_id: i for i, node_id in enumerate(node_ids)}
    n_types = len(NODE_TYPE_ORDER)
    n_company_features = len(COMPANY_FEATURE_COLUMNS)

    x = np.zeros((len(node_ids), n_types + n_company_features), dtype=np.float32)
    company_feature_matrix, company_ids = bundle.matrix()
    company_row_index = {cid: i for i, cid in enumerate(company_ids)}

    degrees = dict(pg.graph.degree())
    max_degree = max(degrees.values()) if degrees else 1

    for node_id, data in pg.graph.nodes(data=True):
        row = index_of[node_id]
        node_type = str(data.get("node_type"))
        for i, candidate in enumerate(NODE_TYPE_ORDER):
            if candidate.value == node_type:
                x[row, i] = 1.0
                break
        if node_type == NodeType.COMPANY.value and node_id in company_row_index:
            x[row, n_types:] = company_feature_matrix[company_row_index[node_id]]
        else:
            # Structural context for non-company nodes: normalised degree in the
            # first company-block slot keeps them informative without faking
            # company-specific statistics.
            x[row, n_types] = degrees.get(node_id, 0) / max(max_degree, 1)

    # ------------------------------------------------------------- edges
    sources: List[int] = []
    targets: List[int] = []
    relations: List[int] = []
    relation_index = {edge.value: i for i, edge in enumerate(EDGE_TYPE_ORDER)}
    for source, target, data in pg.graph.edges(data=True):
        relation = relation_index.get(str(data.get("edge_type")), 0)
        s, t = index_of[source], index_of[target]
        # Message passing needs both directions; relation id preserves semantics.
        sources.extend([s, t])
        targets.extend([t, s])
        relations.extend([relation, relation])

    if not sources:  # isolated graph - add self loops so layers still run
        sources = list(range(len(node_ids)))
        targets = list(sources)
        relations = [0] * len(sources)

    edge_index = torch.tensor([sources, targets], dtype=torch.long)
    edge_type = torch.tensor(relations, dtype=torch.long)
    x_tensor = torch.tensor(x, dtype=torch.float32)

    company_indices = torch.tensor(
        [index_of[cid] for cid in company_ids if cid in index_of], dtype=torch.long
    )
    ordered_company_ids = [cid for cid in company_ids if cid in index_of]

    y_tensor = None
    labelled_mask = None
    if labels:
        y_values = np.full(len(ordered_company_ids), -1, dtype=np.int64)
        for i, company_id in enumerate(ordered_company_ids):
            if company_id in labels:
                y_values[i] = int(labels[company_id])
        y_tensor = torch.tensor(y_values, dtype=torch.long)
        labelled_mask = torch.tensor(y_values >= 0, dtype=torch.bool)

    LOGGER.info(
        "encoded tensors: %d nodes, %d directed edges, %d features",
        len(node_ids), edge_index.shape[1], x.shape[1],
    )
    return GraphTensors(
        x=x_tensor,
        edge_index=edge_index,
        edge_type=edge_type,
        node_ids=node_ids,
        company_indices=company_indices,
        company_ids=ordered_company_ids,
        y=y_tensor,
        labelled_mask=labelled_mask,
        feature_names=[f"type_{t.value}" for t in NODE_TYPE_ORDER] + COMPANY_FEATURE_COLUMNS,
    )


def scale_features(
    x, train_row_indices, scaler=None
) -> Tuple["np.ndarray", object]:
    """Standardise features, fitting **only** on training rows (no leakage).

    Returns the scaled tensor and the fitted scaler so inference can reuse it.
    """
    torch = _require_torch()
    from sklearn.preprocessing import StandardScaler

    array = x.detach().cpu().numpy()
    if scaler is None:
        scaler = StandardScaler()
        fit_rows = array[train_row_indices] if len(train_row_indices) else array
        scaler.fit(fit_rows)
    scaled = scaler.transform(array).astype(np.float32)
    return torch.tensor(scaled, dtype=torch.float32), scaler
