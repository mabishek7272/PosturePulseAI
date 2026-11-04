"""app/geometry/intrinsics.py - reading the sidecar's intrinsics, and rescaling
them from the video frame to the depth map's pixel grid."""
from __future__ import annotations

import pytest

from app.geometry.intrinsics import CameraIntrinsics, from_sidecar
from clip_helpers import sidecar

K = {"fx": 1000.0, "fy": 1000.0, "cx": 539.5, "cy": 959.5}


def test_absent_intrinsics_are_none_not_a_default():
    """The ordinary case: a clip from the non-AR capture path. The caller's
    correct response is to emit no depth-derived field, so None must come back
    rather than a plausible stand-in camera."""
    assert from_sidecar(sidecar()) is None
    assert from_sidecar(sidecar(**{})) is None


def test_intrinsics_are_read_with_the_frame_size():
    side = sidecar()
    side["intrinsics"] = dict(K)
    k = from_sidecar(side)
    assert k == CameraIntrinsics(fx=1000.0, fy=1000.0, cx=539.5, cy=959.5, width=side["width"], height=side["height"])


@pytest.mark.parametrize("missing", ["fx", "fy", "cx", "cy"])
def test_a_partial_intrinsics_block_is_treated_as_absent(missing):
    """A half-filled block is a producer bug. Suppressing the depth path is the
    safe direction; completing it with a default would invent a camera."""
    side = sidecar()
    side["intrinsics"] = {k: v for k, v in K.items() if k != missing}
    assert from_sidecar(side) is None


@pytest.mark.parametrize("bad", [{"fx": 0.0}, {"fx": -1000.0}, {"fy": 0.0}])
def test_a_non_positive_focal_length_is_not_repaired(bad):
    side = sidecar()
    side["intrinsics"] = {**K, **bad}
    assert from_sidecar(side) is None


def test_rescaling_uses_the_pixel_centre_convention():
    """cx' = (cx + 0.5) * W'/W - 0.5, because a pixel coordinate names the
    pixel's centre. The naive cx * W'/W is off by half a destination pixel; at
    2.5 m across a 256-px depth map that is about 7 mm at every landmark, which
    looks like noise and biases a yaw measurement."""
    k = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=539.5, cy=959.5, width=1080, height=1920)
    d = k.rescaled_to(256, 192)

    assert d.fx == pytest.approx(1000.0 * 256 / 1080)
    assert d.fy == pytest.approx(1000.0 * 192 / 1920)
    # An exactly-centred principal point must stay exactly centred.
    assert d.cx == pytest.approx(127.5)
    assert d.cy == pytest.approx(95.5)
    # And it must differ from the naive scaling, or this test proves nothing.
    assert d.cx != pytest.approx(539.5 * 256 / 1080)


def test_rescaling_is_invertible():
    """Scaling down to the depth grid and back must return the original camera.
    Only the pixel-centre convention has this property; the naive form drifts."""
    k = CameraIntrinsics(fx=1234.5, fy=1200.0, cx=600.25, cy=880.75, width=1440, height=1920)
    back = k.rescaled_to(256, 192).rescaled_to(1440, 1920)
    for field in ("fx", "fy", "cx", "cy"):
        assert getattr(back, field) == pytest.approx(getattr(k, field))


def test_rescaling_an_offset_principal_point_tracks_the_image_centre():
    """A principal point one video pixel right of centre must land one depth
    pixel's worth right of centre - the scale factor, not a whole pixel."""
    k = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=540.5, cy=959.5, width=1080, height=1920)
    d = k.rescaled_to(256, 192)
    assert d.cx == pytest.approx(127.5 + 256 / 1080)


def test_a_zero_sized_target_is_rejected():
    k = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=0.0, cy=0.0, width=1080, height=1920)
    with pytest.raises(ValueError):
        k.rescaled_to(0, 192)
