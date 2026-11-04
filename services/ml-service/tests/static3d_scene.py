"""A 3D standing-torso scene rendered consistently as video landmarks AND a depth
track, so the whole `static3d.*` pipeline can be driven end to end with a known
right answer. Shared by the pipeline tests."""
from __future__ import annotations

import numpy as np

from app.geometry.intrinsics import CameraIntrinsics
from depth_helpers import depth_sidecar_block, encode_depth_file
from synthetic_pose import HEIGHT, WIDTH, anterior_pose, make_frames
from test_depth_metrics import torso_points

#: Video intrinsics for the 1080x1920 synthetic frame.
K = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=539.5, cy=959.5, width=WIDTH, height=HEIGHT)
DEPTH_W, DEPTH_H = 256, 192
K_DEPTH = K.rescaled_to(DEPTH_W, DEPTH_H)

LANDMARK_NAMES = {
    "l_sh": "left_shoulder",
    "r_sh": "right_shoulder",
    "l_hip": "left_hip",
    "r_hip": "right_hip",
}


def rx(deg: float) -> np.ndarray:
    p = np.radians(deg)
    return np.array([[1, 0, 0], [0, np.cos(p), -np.sin(p)], [0, np.sin(p), np.cos(p)]])


def project(p: np.ndarray) -> tuple[float, float]:
    return float(p[0] * K.fx / p[2] + K.cx), float(p[1] * K.fy / p[2] + K.cy)


def cam_points(shoulder_yaw: float, pelvis_yaw: float, pitch: float) -> dict[str, np.ndarray]:
    """Torso landmarks as a camera pitched by `pitch` degrees sees them."""
    m = rx(pitch)
    return {k: m @ v for k, v in torso_points(shoulder_yaw, pelvis_yaw).items()}


def gravity_cam(pitch: float) -> tuple[float, float, float]:
    g = rx(pitch) @ np.array([0.0, 1.0, 0.0])
    return (float(g[0]), float(g[1]), float(g[2]))


def depth_map_mm(pts: dict[str, np.ndarray], pitch: float, *, noise_m: np.ndarray | None = None) -> np.ndarray:
    """Planar depth of the torso: one plane through the shoulders over one through
    the hips (the same plane when there is no twist), switching at the row midway
    between them. Zero (no return) where a ray misses, as the sensor reports."""
    down = rx(pitch) @ np.array([0.0, 1.0, 0.0])

    def plane(left: np.ndarray, right: np.ndarray):
        n = np.cross(left - right, down)
        return left, n / np.linalg.norm(n)

    upper, lower = plane(pts["l_sh"], pts["r_sh"]), plane(pts["l_hip"], pts["r_hip"])
    v_sh = project((pts["l_sh"] + pts["r_sh"]) / 2)[1]
    v_hip = project((pts["l_hip"] + pts["r_hip"]) / 2)[1]
    split_row = ((v_sh + v_hip) / 2 + 0.5) * DEPTH_H / HEIGHT - 0.5

    us, vs = np.meshgrid(np.arange(DEPTH_W), np.arange(DEPTH_H))
    dx = (us - K_DEPTH.cx) / K_DEPTH.fx
    dy = (vs - K_DEPTH.cy) / K_DEPTH.fy
    z = np.zeros((DEPTH_H, DEPTH_W))
    for (p0, n), rows in ((upper, vs <= split_row), (lower, vs > split_row)):
        denom = n[0] * dx + n[1] * dy + n[2]
        with np.errstate(divide="ignore", invalid="ignore"):
            zz = (n @ p0) / denom
        z = np.where(rows, zz, z)
    if noise_m is not None:
        z = z + noise_m
    z = np.where(np.isfinite(z) & (z > 0.25) & (z < 6.0), z, 0.0)
    return np.round(z * 1000.0).astype(np.uint16)


def build(
    tmp_path,
    *,
    shoulder_yaw: float = 0.0,
    pelvis_yaw: float | None = None,
    pitch: float = 0.0,
    with_depth: bool = True,
    with_intrinsics: bool = True,
    depth_frames: int = 30,
    noise_seed: int | None = None,
):
    """`(sidecar_dict, depth_path_or_None, observations)` for one scene."""
    from clip_helpers import sidecar as base_sidecar

    pelvis = shoulder_yaw if pelvis_yaw is None else pelvis_yaw
    pts = cam_points(shoulder_yaw, pelvis, pitch)

    pose = anterior_pose()
    for key, name in LANDMARK_NAMES.items():
        pose[name] = project(pts[key])
    observations = make_frames(pose, n=60, gravity=gravity_cam(pitch))

    side = base_sidecar(gravity=gravity_cam(pitch))
    if with_intrinsics:
        side["intrinsics"] = {"fx": K.fx, "fy": K.fy, "cx": K.cx, "cy": K.cy}

    depth_path = None
    if with_depth:
        rng = np.random.default_rng(noise_seed) if noise_seed is not None else None
        frames_mm = []
        for _ in range(depth_frames):
            noise = None
            if rng is not None:
                from depth_noise import correlated_depth_noise_m

                noise = correlated_depth_noise_m((DEPTH_H, DEPTH_W), rng=rng, fx_depth_px=K_DEPTH.fx)
            frames_mm.append(depth_map_mm(pts, pitch, noise_m=noise))
        depth_path = encode_depth_file(tmp_path / "clip-1.depth", frames_mm)
        side["depth"] = depth_sidecar_block(depth_path, frames_mm, fps=15.0)
    return side, depth_path, observations
