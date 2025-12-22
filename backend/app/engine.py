from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from typing import Any

import numpy as np

from .types import Direction, IndicatorRecord, StandardizationParams, WeightMethod, now_iso


class ComputeError(ValueError):
    pass


def _apply_direction(values: np.ndarray, directions: list[Direction]) -> np.ndarray:
    x = values.copy()
    for j, d in enumerate(directions):
        if d == "negative":
            x[:, j] = -x[:, j]
    return x


def _minmax_fit(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    min_v = np.nanmin(x, axis=0)
    max_v = np.nanmax(x, axis=0)
    return min_v, max_v


def _minmax_transform(x: np.ndarray, min_v: np.ndarray, max_v: np.ndarray) -> np.ndarray:
    denom = (max_v - min_v)
    if np.any(denom == 0):
        raise ComputeError("存在 max==min 的指标列，无法 min-max 标准化")
    return (x - min_v) / denom


def _zscore_fit(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mean = np.nanmean(x, axis=0)
    std = np.nanstd(x, axis=0, ddof=1)
    return mean, std


def _zscore_transform(x: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    if np.any(std == 0):
        raise ComputeError("存在 std==0 的指标列，无法 z-score 标准化")
    return (x - mean) / std


def _entropy_weights(z: np.ndarray) -> np.ndarray:
    # z is non-negative (after min-max), shape (n,p)
    n, p = z.shape
    col_sum = np.sum(z, axis=0)
    if np.any(col_sum == 0):
        # all zeros columns -> weight 0 (handled by d_j)
        col_sum = np.where(col_sum == 0, 1.0, col_sum)
    pij = z / col_sum
    # avoid log(0); define 0*log0=0
    with np.errstate(divide="ignore", invalid="ignore"):
        logp = np.where(pij > 0, np.log(pij), 0.0)
    k = 1.0 / math.log(n) if n > 1 else 0.0
    e = -k * np.sum(pij * logp, axis=0)
    d = 1.0 - e
    d = np.where(np.isfinite(d), d, 0.0)
    total = np.sum(d)
    if total <= 0:
        raise ComputeError("熵权法无法得到有效权重（差异系数全为 0）")
    w = d / total
    return w


@dataclass
class PcaResult:
    weights: np.ndarray
    k: int
    cumulative: float


def _pca_weights(z: np.ndarray, *, cum_var_threshold: float = 0.85) -> PcaResult:
    # z: standardized (z-score), shape (n,p)
    if z.shape[0] < 2:
        raise ComputeError("PCA 训练样本量不足（至少 2 行）")
    c = np.cov(z, rowvar=False, ddof=1)
    eigvals, eigvecs = np.linalg.eigh(c)  # ascending
    order = np.argsort(eigvals)[::-1]
    eigvals = eigvals[order]
    eigvecs = eigvecs[:, order]

    eigvals = np.where(eigvals < 0, 0.0, eigvals)
    total = float(np.sum(eigvals))
    if total <= 0:
        raise ComputeError("PCA 协方差矩阵方差为 0")

    cum = np.cumsum(eigvals) / total
    k = int(np.searchsorted(cum, cum_var_threshold) + 1)
    k = max(1, min(k, z.shape[1]))
    cumulative = float(cum[k - 1])

    # weight_j ∝ Σ_{l<=k} v_{jl}^2 * λ_l^2
    w_raw = np.zeros(z.shape[1], dtype=float)
    for l in range(k):
        lam = float(eigvals[l])
        v = eigvecs[:, l]
        w_raw += (v**2) * (lam**2)
    s = float(np.sum(w_raw))
    if s <= 0:
        raise ComputeError("PCA 无法得到有效权重")
    w = w_raw / s
    return PcaResult(weights=w, k=k, cumulative=cumulative)


def _ahp_weights(matrix: np.ndarray) -> tuple[np.ndarray, float, float, float]:
    # returns weights, lambda_max, CI, CR
    if matrix.shape[0] != matrix.shape[1]:
        raise ComputeError("AHP 判断矩阵必须为方阵")
    n = matrix.shape[0]
    if n < 1:
        raise ComputeError("AHP 指标数必须 >= 1")

    eigvals, eigvecs = np.linalg.eig(matrix)
    idx = int(np.argmax(eigvals.real))
    lambda_max = float(eigvals.real[idx])
    vec = eigvecs[:, idx].real
    vec = np.where(vec < 0, -vec, vec)
    if float(np.sum(vec)) == 0:
        raise ComputeError("AHP 权重向量为 0")
    w = vec / float(np.sum(vec))

    ci = 0.0
    if n > 1:
        ci = (lambda_max - n) / (n - 1)

    ri_table = {
        1: 0.0,
        2: 0.0,
        3: 0.58,
        4: 0.9,
        5: 1.12,
        6: 1.24,
        7: 1.32,
        8: 1.41,
        9: 1.45,
        10: 1.49,
        11: 1.51,
        12: 1.48,
        13: 1.56,
        14: 1.57,
        15: 1.59,
    }
    ri = ri_table.get(n, 1.59)
    cr = 0.0 if ri == 0 else ci / ri
    return w.astype(float), lambda_max, float(ci), float(cr)


def build_dimension2_weights(indicators: list[IndicatorRecord], weights: dict[str, float]) -> dict[str, float]:
    dim: dict[str, float] = {}
    for ind in indicators:
        k = ind["key"]
        g = ind["dimension2Key"] or "default"
        dim[g] = dim.get(g, 0.0) + float(weights.get(k, 0.0))
    return dim


def compute_scores(
    *,
    z: np.ndarray,
    indicator_keys: list[str],
    indicators: list[IndicatorRecord],
    weights: dict[str, float],
) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    w = np.array([float(weights[k]) for k in indicator_keys], dtype=float)
    score_raw = z @ w

    # sub-scores per dimension2 (group-normalized weights)
    key_to_dim: dict[str, str] = {i["key"]: (i["dimension2Key"] or "default") for i in indicators}
    dims: dict[str, list[int]] = {}
    for idx, k in enumerate(indicator_keys):
        g = key_to_dim.get(k, "default")
        dims.setdefault(g, []).append(idx)

    sub_scores: dict[str, np.ndarray] = {}
    for g, idxs in dims.items():
        wg = float(np.sum(w[idxs]))
        if wg <= 0:
            continue
        w_cond = w[idxs] / wg
        sub_scores[g] = z[:, idxs] @ w_cond

    return score_raw, sub_scores


def scale_0_100(values: np.ndarray, vmin: float, vmax: float) -> np.ndarray:
    denom = vmax - vmin
    if denom == 0:
        return np.full_like(values, 50.0, dtype=float)
    return (values - vmin) / denom * 100.0


def train_weight_model(
    *,
    method: WeightMethod,
    name: str,
    indicator_keys: list[str],
    indicators: list[IndicatorRecord],
    x_train: np.ndarray,
    directions: list[Direction],
    trained_on_dataset_ids: list[str],
    ahp_matrix: list[list[float]] | None = None,
    pca_cum_var_threshold: float = 0.85,
) -> dict[str, Any]:
    x = _apply_direction(x_train, directions)

    if method == "entropy":
        min_v, max_v = _minmax_fit(x)
        z = _minmax_transform(x, min_v, max_v)
        w_vec = _entropy_weights(z)
        standardization: StandardizationParams = {
            "kind": "minmax",
            "min": {k: float(min_v[i]) for i, k in enumerate(indicator_keys)},
            "max": {k: float(max_v[i]) for i, k in enumerate(indicator_keys)},
        }
        pca_info = None
        ahp_info = None
    elif method == "pca":
        mean, std = _zscore_fit(x)
        z = _zscore_transform(x, mean, std)
        pca_res = _pca_weights(z, cum_var_threshold=pca_cum_var_threshold)
        w_vec = pca_res.weights
        standardization = {
            "kind": "zscore",
            "mean": {k: float(mean[i]) for i, k in enumerate(indicator_keys)},
            "std": {k: float(std[i]) for i, k in enumerate(indicator_keys)},
        }
        pca_info = {"k": int(pca_res.k), "cumulative": float(pca_res.cumulative), "threshold": float(pca_cum_var_threshold)}
        ahp_info = None
    elif method == "ahp":
        if ahp_matrix is None:
            raise ComputeError("AHP 需要判断矩阵")
        mean, std = _zscore_fit(x)
        z = _zscore_transform(x, mean, std)
        m = np.array(ahp_matrix, dtype=float)
        w_vec, lambda_max, ci, cr = _ahp_weights(m)
        standardization = {
            "kind": "zscore",
            "mean": {k: float(mean[i]) for i, k in enumerate(indicator_keys)},
            "std": {k: float(std[i]) for i, k in enumerate(indicator_keys)},
        }
        pca_info = None
        ahp_info = {"matrix": ahp_matrix, "lambdaMax": lambda_max, "CI": ci, "CR": cr}
    else:
        raise ComputeError(f"未知 method: {method}")

    weights = {k: float(w_vec[i]) for i, k in enumerate(indicator_keys)}
    dim_weights = build_dimension2_weights(indicators, weights)

    score_raw, sub_scores = compute_scores(
        z=z, indicator_keys=indicator_keys, indicators=indicators, weights=weights
    )
    score_min = float(np.min(score_raw))
    score_max = float(np.max(score_raw))
    sub_min = {g: float(np.min(v)) for g, v in sub_scores.items()}
    sub_max = {g: float(np.max(v)) for g, v in sub_scores.items()}

    model_id = uuid.uuid4().hex
    return {
        "id": model_id,
        "name": name,
        "createdAt": now_iso(),
        "method": method,
        "indicatorKeys": indicator_keys,
        "weights": weights,
        "dimension2Weights": dim_weights,
        "standardization": standardization,
        "scaling": {"scoreMin": score_min, "scoreMax": score_max, "subScoreMin": sub_min, "subScoreMax": sub_max},
        "trainedOnDatasetIds": trained_on_dataset_ids,
        "pca": pca_info,
        "ahp": ahp_info,
    }


def apply_weight_model(
    *,
    model: dict[str, Any],
    indicators: list[IndicatorRecord],
    x: np.ndarray,
    directions: list[Direction],
) -> tuple[np.ndarray, np.ndarray, dict[str, np.ndarray], dict[str, np.ndarray]]:
    indicator_keys: list[str] = list(model["indicatorKeys"])
    weights: dict[str, float] = dict(model["weights"])
    x2 = _apply_direction(x, directions)

    std: StandardizationParams = model["standardization"]
    if std["kind"] == "minmax":
        min_v = np.array([float(std["min"][k]) for k in indicator_keys], dtype=float)
        max_v = np.array([float(std["max"][k]) for k in indicator_keys], dtype=float)
        z = _minmax_transform(x2, min_v, max_v)
    elif std["kind"] == "zscore":
        mean = np.array([float(std["mean"][k]) for k in indicator_keys], dtype=float)
        s = np.array([float(std["std"][k]) for k in indicator_keys], dtype=float)
        z = _zscore_transform(x2, mean, s)
    else:
        raise ComputeError("未知 standardization kind")

    score_raw, sub_scores = compute_scores(
        z=z, indicator_keys=indicator_keys, indicators=indicators, weights=weights
    )
    scaling = model.get("scaling") or {}
    score_min = float(scaling.get("scoreMin", float(np.min(score_raw))))
    score_max = float(scaling.get("scoreMax", float(np.max(score_raw))))
    index_0_100 = scale_0_100(score_raw, score_min, score_max)

    sub_index_0_100: dict[str, np.ndarray] = {}
    sub_min: dict[str, float] = dict(scaling.get("subScoreMin") or {})
    sub_max: dict[str, float] = dict(scaling.get("subScoreMax") or {})
    for g, v in sub_scores.items():
        vmin = float(sub_min.get(g, float(np.min(v))))
        vmax = float(sub_max.get(g, float(np.max(v))))
        sub_index_0_100[g] = scale_0_100(v, vmin, vmax)

    return z, score_raw, sub_scores, sub_index_0_100

