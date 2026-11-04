"""Sampling depth at a landmark and unprojecting it into camera-frame metres.

Two rules govern this module, and both are refusals.

**Never evaluate depth at a single pixel.** At 2.5 m the 256x192 map carries only
about 150 real LiDAR returns per square metre (ADR-020 section 4), so most pixels
are upsampled from a return some centimetres away, and a pixel on a limb
boundary blends the body with the room behind it. Depth is therefore read as a
median over a patch that has been eroded away from the silhouette edge.

**Never infer a missing sample.** Every rejection below returns `None`. There is
no nearest-valid-pixel search, no inpainting, no neighbour extrapolation and no
unbounded window growth: a 21x21 patch at 2.5 m spans about 22 cm, so a patch
"centred on the shoulder" that grew that far would be averaging the neck and the
upper arm and calling the result the shoulder's depth. A landmark with no
trustworthy depth has no depth, and the caller suppresses the metric
(CLAUDE.md rule 3).

Which intrinsics, and why it is not the depth map's
---------------------------------------------------
The depth VALUE is read from the depth map, but the unprojection uses the
**video** intrinsics at the **video** pixel coordinates. The in-plane position of
a landmark is known to video resolution, which is several times finer than the
depth grid, and nothing is gained by degrading it to the coarser grid first. The
depth-map intrinsics are used only to convert a patch radius in metres into a
radius in depth pixels, and to map the landmark's video pixel into the depth grid
for sampling - both with the pixel-centre convention in `intrinsics.py`, so the
two grids cannot drift apart by half a pixel.

Depth is planar along the optical axis, NOT range along the ray (ARKit's
`sceneDepth` convention), so `Z = d` directly with no `cos` correction. A range
map read as planar depth inflates every off-centre point.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.geometry.intrinsics import CameraIntrinsics

# Patch radius in METRES per landmark class, converted to pixels per frame so the
# patch covers a fixed amount of BODY rather than a fixed number of pixels. A
# fixed pixel radius would sample a larger piece of the person the further away
# they stood.
#
# Torso landmarks sit on broad, near-frontal surfaces; a 7 cm radius there holds
# a few real returns. Extremities get half that because the limb itself is
# narrower than the torso patch - a wider patch would reach past the arm into the
# room, and the MAD gate would then (correctly) reject the whole sample.
TORSO_PATCH_RADIUS_M = 0.07
EXTREMITY_PATCH_RADIUS_M = 0.035

# Fewest surviving pixels that may be medianed. Below this the median is a
# statement about one or two returns.
MIN_PATCH_PIXELS = 9

# A patch straddling two surfaces - the arm and the wall behind it - has a wide
# spread, and its median is a number from neither surface. MAD rather than
# standard deviation because a handful of background pixels is exactly the case
# this must catch, and they would barely move a robust statistic's own estimate.
MAX_PATCH_MAD_M = 0.030

# Smallest fraction of surviving pixels that must agree with the median, to
# within MAX_PATCH_MAD_M.
#
# This gate exists because MAD is ROBUST, and that robustness is a blind spot
# here: a patch that is 53% wall and 47% body has its median ON the wall and a
# MAD of exactly ZERO, so the MAD gate passes it and reports the wall's distance
# as the landmark's. Robustness means the majority surface wins silently, which
# is the opposite of what a measurement needs.
#
# Requiring a supermajority catches a two-surface patch whichever surface wins,
# and needs no knowledge of where the body is - so unlike the body-depth gate
# below it still works on the first landmark sampled in a frame.
MIN_PATCH_CONSENSUS = 0.8

# How far a landmark's depth may sit from the body's own median depth. The last
# line of defence: it catches a patch that is uniformly on the background, which
# both gates above accept because a flat wall is a perfectly consistent surface.
MAX_BODY_DEPTH_DEVIATION_M = 0.35

# ARKit confidence levels are 0 (low), 1 (medium), 2 (high). Medium is accepted:
# `.high` alone is sparse at 2.5 m on dark or matte clothing, and demanding it
# would reject most of a real clinic capture. Empirically tunable on hardware -
# raising it trades recall for per-sample precision and never risks a wrong
# number, since a rejected sample becomes `None`.
MIN_CONFIDENCE = 1

# Silhouette erosion, in DEPTH pixels. 2 px is about 2.1 cm at 2.5 m. Stated in
# depth pixels on purpose: a mask eroded by 6 pixels in the VIDEO grid is eroded
# by about 1.07 depth pixels, which removes essentially nothing.
EROSION_DEPTH_PX = 2

# Real LiDAR returns per square metre at the reference distance, for n_eff.
RETURNS_PER_M2_AT_REF = 150.0
REFERENCE_DISTANCE_M = 2.5
# Per-point depth precision, metres (ADR-020 section 4).
POINT_SIGMA_M = 0.020


def _depth_sigma(n_effective: float) -> float:
    """Imported inside the function because `uncertainty3d` imports this module
    for its Jacobian; a module-level import would be circular."""
    from app.geometry.uncertainty3d import depth_sigma_from_returns

    return depth_sigma_from_returns(n_effective)


@dataclass(frozen=True)
class DepthSample:
    """One landmark's depth, with the evidence for believing it."""

    depth_m: float
    #: Pixels that survived every gate and were medianed.
    pixels_used: int
    #: Median absolute deviation within the patch, metres.
    mad_m: float
    #: Independent LiDAR returns the patch is estimated to contain.
    n_effective: float
    #: Random component of this sample's depth uncertainty, metres.
    sigma_m: float


def backproject(u: float, v: float, depth_m: float, k: CameraIntrinsics) -> np.ndarray:
    """Video pixel `(u, v)` at planar depth `depth_m`, as camera-frame metres.

        X = (u - cx) * Z / fx,   Y = (v - cy) * Z / fy,   Z = depth

    The result is in frame C: x image right, y image **down**, z along the
    optical axis away from the camera - the same frame the sidecar's gravity is
    expressed in, so `gravity_alignment` can be applied directly to it.
    """
    return np.array(
        [
            (u - k.cx) * depth_m / k.fx,
            (v - k.cy) * depth_m / k.fy,
            depth_m,
        ]
    )


def backproject_jacobian(u: float, v: float, depth_m: float, k: CameraIntrinsics) -> np.ndarray:
    """`d(X,Y,Z) / d(u,v,Z)`, for propagating pixel and depth error into metres.

    The third column is `(X/Z, Y/Z, 1)`, i.e. the viewing ray: depth error
    displaces a point ALONG the ray, not along z. That is why the full 3x3
    covariance has to be carried through the pipeline and must never be
    collapsed into a single scalar sigma - the error ellipsoid is anisotropic,
    and at 2.5 m it is an oblate pancake (in-plane sigma 0.0358 m against depth
    random 0.0117 m), not a needle pointing at the camera.
    """
    return np.array(
        [
            [depth_m / k.fx, 0.0, (u - k.cx) / k.fx],
            [0.0, depth_m / k.fy, (v - k.cy) / k.fy],
            [0.0, 0.0, 1.0],
        ]
    )


def erode_mask(mask: np.ndarray, radius_px: int = EROSION_DEPTH_PX) -> np.ndarray:
    """Binary erosion by a square structuring element of the given radius.

    Pulls the silhouette inward so no sampled pixel sits on the boundary, where
    the depth map blends the body with whatever is behind it. Implemented as
    `radius_px` passes of a 3x3 erosion built from array shifts: scipy is not a
    dependency of this service, and adding one for a 3x3 min-filter is not worth
    the supply chain.
    """
    out = np.asarray(mask, dtype=bool)
    if radius_px <= 0:
        return out.copy()
    for _ in range(int(radius_px)):
        shifted = out.copy()
        # A pixel survives only if all four neighbours (and the diagonals, via
        # successive axes) are set.
        shifted[1:, :] &= out[:-1, :]
        shifted[:-1, :] &= out[1:, :]
        shifted[:, 1:] &= out[:, :-1]
        shifted[:, :-1] &= out[:, 1:]
        # Edges erode inward: a pixel on the frame border has no neighbour
        # outside it, and treating the outside as body would keep boundary
        # pixels that this exists to remove.
        shifted[0, :] = False
        shifted[-1, :] = False
        shifted[:, 0] = False
        shifted[:, -1] = False
        out = shifted
    return out


def patch_radius_px(radius_m: float, depth_m: float, k_depth: CameraIntrinsics) -> int:
    """A metric patch radius as a radius in depth pixels at this distance.

    At least 1, so a landmark far from the camera still samples a 3x3 patch
    rather than degenerating to a single pixel - which the `MIN_PATCH_PIXELS`
    gate would then reject outright.
    """
    if depth_m <= 0:
        raise ValueError("depth must be positive")
    return max(1, int(round(radius_m * k_depth.fx / depth_m)))


def effective_returns(radius_px: int, depth_m: float, k_depth: CameraIntrinsics) -> float:
    """Independent LiDAR returns a patch of this radius is estimated to hold.

    Return density falls as `1 / Z^2`, so this is the patch's area in square
    metres times the reference density scaled to the actual distance. It is the
    number that must drive any averaging claim: the patch's PIXEL count is far
    larger and using it would shrink the reported sigma by roughly the ratio of
    the two, which is the error the correlated-noise fixture exists to expose.
    """
    side_m = (2 * radius_px + 1) * depth_m / k_depth.fx
    density = RETURNS_PER_M2_AT_REF * (REFERENCE_DISTANCE_M / depth_m) ** 2
    return max(1.0, side_m * side_m * density)


def sample_landmark_depth(
    depth_m: np.ndarray,
    *,
    u: float,
    v: float,
    k_video: CameraIntrinsics,
    k_depth: CameraIntrinsics,
    radius_m: float = TORSO_PATCH_RADIUS_M,
    mask: np.ndarray | None = None,
    confidence: np.ndarray | None = None,
    body_depth_m: float | None = None,
    expected_depth_m: float | None = None,
) -> DepthSample | None:
    """Median depth in a patch at the landmark, or `None` if it cannot be trusted.

    `depth_m` is `(H, W)` metres with `nan` where the sensor returned nothing.
    `mask`, when given, is the silhouette in the DEPTH grid and is eroded here.
    `confidence`, when given, is ARKit's per-pixel level in the depth grid; when
    absent - `hasConfidence` is optional in the sidecar, so this is a real case -
    the confidence gate simply does not run and the MAD and body-depth gates
    carry the load alone. They are pure rejection filters, biased toward
    discarding good readings rather than keeping bad ones, which is the correct
    direction for a missing input.

    The patch radius needs a distance to convert from metres, and the distance is
    what is being measured. `expected_depth_m` (the body's median, or a previous
    frame's value for this landmark) breaks the circularity; failing that the
    patch is sized at `REFERENCE_DISTANCE_M` and resized once from the first
    median. No iteration beyond that: it converges immediately at these scales
    and a loop would be a search, which is how an inference creeps in.
    """
    d = np.asarray(depth_m, dtype=float)
    if d.ndim != 2:
        raise ValueError("depth_m must be a 2-D array")
    height, width = d.shape

    eroded = erode_mask(mask, EROSION_DEPTH_PX) if mask is not None else None
    if eroded is not None and eroded.shape != d.shape:
        raise ValueError("mask must have the same shape as depth_m")
    if confidence is not None and np.asarray(confidence).shape != d.shape:
        raise ValueError("confidence must have the same shape as depth_m")

    # Landmark's video pixel -> depth pixel, pixel-centre convention, matching
    # `CameraIntrinsics.rescaled_to` so the two grids stay in step.
    ud = (u + 0.5) * width / k_video.width - 0.5
    vd = (v + 0.5) * height / k_video.height - 0.5

    seed = expected_depth_m if expected_depth_m and expected_depth_m > 0 else REFERENCE_DISTANCE_M
    first = _median_in_patch(
        d, ud, vd, patch_radius_px(radius_m, seed, k_depth), eroded, confidence, body_depth_m
    )
    if first is None:
        return None

    # One resize at the measured distance, then done.
    radius_px = patch_radius_px(radius_m, first[0], k_depth)
    final = _median_in_patch(d, ud, vd, radius_px, eroded, confidence, body_depth_m)
    if final is None:
        return None

    median, used, mad = final
    n_eff = effective_returns(radius_px, median, k_depth)
    return DepthSample(
        depth_m=median,
        pixels_used=used,
        mad_m=mad,
        n_effective=n_eff,
        # Only the RANDOM component shrinks with independent returns. The
        # systematic component (~0.035 m) is correlated across the whole frame
        # and cancels in DIFFERENCES between landmarks, which is all the
        # downstream geometry uses - so it is deliberately not added here.
        #
        # Delegated to `uncertainty3d` so there is ONE definition of this
        # sigma. It carries the median-efficiency factor: this value describes
        # the spread of a patch MEDIAN, and a median is about 25% less efficient
        # than a mean, which is 25% of under-reported uncertainty if forgotten.
        sigma_m=_depth_sigma(n_eff),
    )


def _median_in_patch(
    d: np.ndarray,
    ud: float,
    vd: float,
    radius_px: int,
    eroded: np.ndarray | None,
    confidence: np.ndarray | None,
    body_depth_m: float | None,
) -> tuple[float, int, float] | None:
    """The ordered rejection pipeline. Every exit is `None`."""
    height, width = d.shape
    cu, cv = int(round(ud)), int(round(vd))
    u0, u1 = max(0, cu - radius_px), min(width, cu + radius_px + 1)
    v0, v1 = max(0, cv - radius_px), min(height, cv + radius_px + 1)
    if u1 <= u0 or v1 <= v0:
        return None  # landmark is outside the depth map entirely

    patch = d[v0:v1, u0:u1]
    keep = np.isfinite(patch)

    if eroded is not None:
        keep &= eroded[v0:v1, u0:u1]
    if confidence is not None:
        keep &= np.asarray(confidence)[v0:v1, u0:u1] >= MIN_CONFIDENCE

    values = patch[keep]
    if values.size < MIN_PATCH_PIXELS:
        return None

    median = float(np.median(values))
    deviation = np.abs(values - median)
    mad = float(np.median(deviation))
    if mad > MAX_PATCH_MAD_M:
        return None  # a widely scattered patch; its median is from no surface

    # The supermajority gate. A 53/47 split of wall and body has mad == 0, so
    # this is what rejects it; see MIN_PATCH_CONSENSUS.
    consensus = float(np.count_nonzero(deviation <= MAX_PATCH_MAD_M) / values.size)
    if consensus < MIN_PATCH_CONSENSUS:
        return None

    if body_depth_m is not None and abs(median - body_depth_m) > MAX_BODY_DEPTH_DEVIATION_M:
        return None  # uniformly on the background, which the gates above accept
    return median, int(values.size), mad
