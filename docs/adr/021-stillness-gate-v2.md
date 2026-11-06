# ADR-021: Stillness gate tolerant of model jitter, measuring the still part of a hold

## Status
Proposed (engineering). Changes which frames a static metric is computed from, so it bumps
`METRICS_VERSION` from `metrics/v1` to `metrics/v2`. The threshold value is unchanged and
remains a draft engineering default.

## Context
The first iPad test scan (2026-11-06) reported that small movements, breathing included,
ruined scans. `app/quality/clip_quality.py` failed the clip with `subject_moving` when the
radial SD of the hip midpoint exceeded `MAX_HIP_SD_FRACTION` (2 %) of body height, over the
whole hold. It used raw per-frame MediaPipe landmarks, so a few frames of model jitter could
fail an otherwise still hold. A single movement episode, such as a step at the end, also
failed every metric in the clip.

## Decision
1. **Rolling median of the hip track (5 frames, about 0.17 s at 30 fps) before the spread is
   measured.** This removes single-frame jitter spikes and keeps real movement. A low-pass
   filter was rejected: a cutoff low enough to help (about 1.5 Hz) would also erase fast real
   movement, and the existing test of a 1.6 Hz sway would then pass as still.
2. **The spread stays an SD, not a MAD.** For smooth sway, a MAD-based spread reads about
   1.5× larger than the SD, which would make breathing-sized sway *more* likely to fail.
3. **Stillest contiguous window.** If the whole hold is not still, the gate takes the
   stillest run of at least the minimum usable share (`MIN_USABLE_FRACTION`, at least
   `MIN_USABLE_FRAMES`). It grows that run only while its spread stays within the limit
   *and* each new frame lies within 2 × the limit of the run's median position. Frames
   outside the run are marked `unusable / subject_moving` (CLAUDE.md rule 3), and metrics
   come from the run only. If no such run exists, the clip fails `subject_moving` as before.
4. `MAX_HIP_SD_FRACTION` is unchanged.

## Consequences
- Results from `metrics/v1` and `metrics/v2` must not be pooled (Study A, test-retest).
  Every record carries `metricsVersion`.
- A hold with a late step is now measured from its still part instead of being refused.
- The device-side "Hold still" check now also uses only the hips, with hysteresis
  (`apps/mobile/src/capture/guidance.ts`). The device check does not gate the upload.
- Verified by `services/ml-service/tests/test_clip_quality.py`: jitter spikes pass,
  breathing-sized sway passes, a late step keeps the still part, steady drift still fails,
  and the existing fast-sway test still fails.
