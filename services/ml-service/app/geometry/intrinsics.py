"""Pinhole camera intrinsics for the oriented image, as the device reported them.

`clip-capture.schema.json` has carried an optional `intrinsics` block since v0,
populated with true ARKit intrinsics by the AR jig capture path. Until ADR-020
nothing on the server read it. This module is the one place that interprets it.

Two rules govern everything here.

**A guessed fx is a guessed metric scale.** `from_sidecar` returns `None` when
the device sent no intrinsics. It never synthesises fx from an assumed field of
view: every depth-derived distance is proportional to 1/fx, so an invented fx
produces a plausible-looking number in metres that is wrong by whatever the
guess was wrong by, with nothing in the output to show it. That is exactly the
fabricated measurement CLAUDE.md rule 3 forbids. A caller with no intrinsics
must emit nothing, not an estimate.

**The depth map is smaller than the video frame.** On current iPad Pro hardware
the depth map is 256x192 against a 1920x1440 (or larger) video frame, so
intrinsics reported for the video image must be rescaled before they can be
used with depth pixel coordinates. `rescaled_to` uses the pixel-centre
convention

    cx' = (cx + 0.5) * W'/W - 0.5

because a pixel's coordinate names its *centre*, not its corner: pixel 0 spans
[-0.5, +0.5]. The naive `cx * W'/W` is off by half a destination pixel, which at
2.5 m and 256 px across is about 7 mm of lateral error at every landmark -
small enough to look like noise and large enough to bias a yaw measurement.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class CameraIntrinsics:
    """Pinhole intrinsics in pixels, for an image of `width` x `height` pixels.

    Principal point and focal lengths are in the pixel coordinates of the
    oriented image (x right, y down), the same frame as
    `FrameObservation.points` and `clip-capture`'s `width`/`height`. Lens
    distortion is deliberately absent: ARKit reports an undistorted pinhole
    model for the frames it hands out, and inventing distortion coefficients
    would be the same class of error as inventing fx.
    """

    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int

    def __post_init__(self) -> None:
        if not (self.fx > 0 and self.fy > 0):
            raise ValueError("fx and fy must be positive")
        if self.width < 1 or self.height < 1:
            raise ValueError("width and height must be at least 1 pixel")

    def rescaled_to(self, width: int, height: int) -> "CameraIntrinsics":
        """These intrinsics expressed in the pixel grid of a `width` x `height` image.

        Used to read video-frame intrinsics in depth-map coordinates. Assumes the
        two images cover the *same field of view* - true for ARKit's depth map
        and captured frame, which are the same camera at different resolutions,
        and false for a cropped image. A crop must be undone before calling this.
        """
        if width < 1 or height < 1:
            raise ValueError("width and height must be at least 1 pixel")
        sx = width / self.width
        sy = height / self.height
        return CameraIntrinsics(
            fx=self.fx * sx,
            fy=self.fy * sy,
            # Pixel-centre convention; see the module docstring for why the
            # simpler cx * sx is wrong by half a destination pixel.
            cx=(self.cx + 0.5) * sx - 0.5,
            cy=(self.cy + 0.5) * sy - 0.5,
            width=width,
            height=height,
        )


def from_sidecar(sidecar: Any) -> CameraIntrinsics | None:
    """The clip's intrinsics, or `None` when the device reported none.

    `None` is a first-class answer, not a failure: most clips today come from the
    non-AR capture path, which has no intrinsics to report. The caller's correct
    response is to emit no depth-derived field at all.

    Accepts the generated `ClipCapture` model (whose `intrinsics` is a Pydantic
    object) or a plain mapping, since the sidecar also reaches this code as JSON
    in tests.
    """
    block = _get(sidecar, "intrinsics")
    if block is None:
        return None

    values = {}
    for key in ("fx", "fy", "cx", "cy"):
        value = _get(block, key)
        if value is None:
            # A partial intrinsics block is a producer bug, not a usable camera.
            # Treating it as absent is the safe direction: it suppresses the
            # depth path rather than completing it with a default.
            return None
        values[key] = float(value)

    width = _get(sidecar, "width")
    height = _get(sidecar, "height")
    if width is None or height is None:
        return None

    try:
        return CameraIntrinsics(width=int(width), height=int(height), **values)
    except ValueError:
        # Non-positive focal length or a zero-sized frame: unusable, and not
        # something to repair by substituting a plausible value.
        return None


def _get(obj: Any, name: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)
