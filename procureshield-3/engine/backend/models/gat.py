"""Graph Attention Network for company risk classification.

Uses ``torch_geometric.nn.GATConv`` when PyTorch Geometric is installed. When it
is not, an equivalent sparse multi-head attention layer implemented directly in
PyTorch is used, so the engine trains end to end with torch alone.
"""

from __future__ import annotations

from typing import Optional

from ..exceptions import DependencyMissingError
from ..logging_utils import get_logger

LOGGER = get_logger("models.gat")

try:  # pragma: no cover - import guard
    import torch
    import torch.nn as nn
    import torch.nn.functional as F

    TORCH_AVAILABLE = True
except ImportError:  # pragma: no cover
    TORCH_AVAILABLE = False
    nn = object  # type: ignore[assignment]

try:  # pragma: no cover - optional dependency
    from torch_geometric.nn import GATConv as _PyGGATConv

    PYG_AVAILABLE = True
except ImportError:  # pragma: no cover
    PYG_AVAILABLE = False
    _PyGGATConv = None  # type: ignore[assignment]


def _require_torch() -> None:
    if not TORCH_AVAILABLE:
        raise DependencyMissingError(
            "PyTorch is required to train or run the GAT. Install it with "
            "`pip install torch`, or use unsupervised/rules-only mode."
        )


if TORCH_AVAILABLE:

    class FallbackGATConv(nn.Module):
        """Multi-head graph attention (Velickovic et al.) without PyG.

        Mathematically equivalent to ``GATConv`` with ``add_self_loops=True``:
        attention logits are computed per edge, softmaxed over each node's
        incoming edges via a segment-wise max/sum, then used to aggregate
        neighbour messages.
        """

        def __init__(
            self,
            in_channels: int,
            out_channels: int,
            heads: int = 1,
            concat: bool = True,
            dropout: float = 0.0,
            negative_slope: float = 0.2,
        ) -> None:
            super().__init__()
            self.in_channels = in_channels
            self.out_channels = out_channels
            self.heads = heads
            self.concat = concat
            self.dropout = dropout
            self.negative_slope = negative_slope

            self.lin = nn.Linear(in_channels, heads * out_channels, bias=False)
            self.att_src = nn.Parameter(torch.empty(1, heads, out_channels))
            self.att_dst = nn.Parameter(torch.empty(1, heads, out_channels))
            self.bias = nn.Parameter(
                torch.zeros(heads * out_channels if concat else out_channels)
            )
            self.reset_parameters()

        def reset_parameters(self) -> None:
            nn.init.xavier_uniform_(self.lin.weight)
            nn.init.xavier_uniform_(self.att_src)
            nn.init.xavier_uniform_(self.att_dst)
            nn.init.zeros_(self.bias)

        @staticmethod
        def _add_self_loops(edge_index: "torch.Tensor", num_nodes: int) -> "torch.Tensor":
            loop = torch.arange(num_nodes, device=edge_index.device)
            loops = torch.stack([loop, loop], dim=0)
            return torch.cat([edge_index, loops], dim=1)

        def _segment_softmax(
            self, logits: "torch.Tensor", index: "torch.Tensor", num_nodes: int
        ) -> "torch.Tensor":
            # Numerically stable softmax grouped by destination node.
            max_per_node = logits.new_full((num_nodes, self.heads), float("-inf"))
            max_per_node = max_per_node.index_reduce(
                0, index, logits, "amax", include_self=True
            )
            max_per_node = torch.nan_to_num(max_per_node, neginf=0.0)
            exp_logits = torch.exp(logits - max_per_node[index])
            denominator = torch.zeros((num_nodes, self.heads), device=logits.device)
            denominator.index_add_(0, index, exp_logits)
            return exp_logits / (denominator[index] + 1e-16)

        def forward(self, x: "torch.Tensor", edge_index: "torch.Tensor") -> "torch.Tensor":
            num_nodes = x.size(0)
            edge_index = self._add_self_loops(edge_index, num_nodes)
            source, destination = edge_index[0], edge_index[1]

            h = self.lin(x).view(num_nodes, self.heads, self.out_channels)
            alpha_src = (h * self.att_src).sum(dim=-1)
            alpha_dst = (h * self.att_dst).sum(dim=-1)
            logits = F.leaky_relu(
                alpha_src[source] + alpha_dst[destination], self.negative_slope
            )
            attention = self._segment_softmax(logits, destination, num_nodes)
            attention = F.dropout(attention, p=self.dropout, training=self.training)

            messages = h[source] * attention.unsqueeze(-1)
            out = torch.zeros_like(h)
            out.index_add_(0, destination, messages)

            out = out.reshape(num_nodes, self.heads * self.out_channels) if self.concat \
                else out.mean(dim=1)
            return out + self.bias

    GATConv = _PyGGATConv if PYG_AVAILABLE else FallbackGATConv

    class GATRiskClassifier(nn.Module):
        """Two-layer GAT producing a binary risk logit per node.

        The output is a *risk propensity*, not a determination of misconduct.
        """

        def __init__(
            self,
            in_channels: int,
            hidden_channels: int = 64,
            heads: int = 4,
            num_classes: int = 2,
            dropout: float = 0.3,
        ) -> None:
            _require_torch()
            super().__init__()
            self.dropout = dropout
            self.conv1 = GATConv(
                in_channels, hidden_channels, heads=heads, dropout=dropout
            )
            self.conv2 = GATConv(
                hidden_channels * heads, hidden_channels, heads=1, concat=True,
                dropout=dropout,
            )
            self.norm = nn.LayerNorm(hidden_channels)
            self.head = nn.Linear(hidden_channels, num_classes)
            self.backend = "torch_geometric" if PYG_AVAILABLE else "pytorch_fallback"

        def forward(self, x: "torch.Tensor", edge_index: "torch.Tensor") -> "torch.Tensor":
            x = F.dropout(x, p=self.dropout, training=self.training)
            x = F.elu(self.conv1(x, edge_index))
            x = F.dropout(x, p=self.dropout, training=self.training)
            x = F.elu(self.conv2(x, edge_index))
            x = self.norm(x)
            return self.head(x)

        @torch.no_grad()
        def predict_proba(
            self, x: "torch.Tensor", edge_index: "torch.Tensor"
        ) -> "torch.Tensor":
            self.eval()
            logits = self.forward(x, edge_index)
            return F.softmax(logits, dim=-1)[:, 1]

else:  # pragma: no cover - torch missing

    class GATRiskClassifier:  # type: ignore[no-redef]
        def __init__(self, *args, **kwargs) -> None:
            _require_torch()

    FallbackGATConv = None  # type: ignore[assignment]
    GATConv = None  # type: ignore[assignment]


def backend_name() -> str:
    if not TORCH_AVAILABLE:
        return "unavailable"
    return "torch_geometric" if PYG_AVAILABLE else "pytorch_fallback"


def describe_backend() -> dict:
    return {
        "torch_available": TORCH_AVAILABLE,
        "pyg_available": PYG_AVAILABLE,
        "gat_backend": backend_name(),
    }


__all__ = [
    "GATRiskClassifier",
    "FallbackGATConv",
    "backend_name",
    "describe_backend",
    "TORCH_AVAILABLE",
    "PYG_AVAILABLE",
]


def _unused(value: Optional[object] = None) -> None:  # pragma: no cover
    return None
