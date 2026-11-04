import * as Device from "expo-device";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  useCameraPermission,
  useFrameOutput,
  useVideoOutput,
  type CameraSessionConfig,
  type Frame,
  type Recorder,
} from "react-native-vision-camera";
import { useTensorflowModel } from "react-native-fast-tflite";
import { useResizer } from "react-native-vision-camera-resizer";
import ARJigModule from "../../modules/ar-jig";
import { uploadClip } from "../api/clips";
import { ArJigCapture } from "../components/ArJigCapture";
import { SymptomStop } from "../components/SymptomStop";
import { startGravitySampling } from "../capture/gravity";
import { createFeedback, ISSUE_TEXT, type FeedbackEvent, type Issue } from "../capture/feedback";
import { distanceState, isLateral, PITCH_TOLERANCE_DEG, ROLL_TOLERANCE_DEG } from "../capture/guidance";
import { useDeviceTilt } from "../capture/level";
import { recordingStartHaptic, recoveredHaptic, milestoneHaptic, tickHaptic, warnHaptic } from "../capture/haptics";
import { EMPTY_POSE, MOVENET_INPUT, decodeMoveNet,
  personPresent, meanVisibleScore, keypointScores, poseStatusText, visibleCount, type PoseSnapshot } from "../capture/pose-overlay";
import { CLIP_SECONDS, POSES } from "../capture/poses";
import { meanRollFromSamples, medianPitchFromSamples, recordClipStats, type ClipStats } from "../capture/session-stats";
import { buildSidecar, clipIdFor } from "../capture/sidecar";
import { starsFor } from "../capture/sqi";
import { useCaptureAnalysis } from "../capture/use-capture-analysis";
import { readVideoInfoFromFile } from "../capture/video-info-file";
import { ArTarget, CentreGuides, CloseGlyph, GuidanceChips, InfoButton, ScanLine, Shutter, SquareGlassButton, ViewProgress, CaptureGlass } from "../components/CaptureChrome";
import { EdgeGlow, HoldToast, type ToastMessage } from "../components/HoldToast";
import { PoseResultCard, RecordingHud } from "../components/CaptureHud";
import { ScanRing } from "../components/ScanRing";
import { BubbleLevel2D } from "../components/BubbleLevel2D";
import { DistanceMeter } from "../components/DistanceMeter";
import { bubbleDiameter, computeCaptureLayout } from "../capture/layout";
import { LinearGradient } from "expo-linear-gradient";
import { GlassCard } from "../components/GlassCard";
import { LayoutIcon, RefreshIcon, SparkleIcon } from "../components/icons";
import { PulseDot } from "../components/Motion";
import { PoseOverlay } from "../components/PoseOverlay";
import { MAX_CONTENT_WIDTH } from "../components/Screen";
import { BackButton } from "../components/ScreenHeader";
import { useArJigCapturePref, useCaptureGuidancePref, useHapticFeedbackPref, useSkeletonOverlayPref } from "../settings/prefs";
import { colors } from "../theme/colors";
import { radii } from "../theme/radii";

// Live pose GUIDE (MoveNet Lightning, 192x192 RGB uint8). Alignment aid only -
// the measurement is the server's MediaPipe analysis of the recorded clip.
// A modest 4:3 target keeps the extra frame output cheap and the same aspect as
// the recorded video and the preview, which the overlay's cover-crop maths
// relies on. The model is loaded off the recording path: if it or the resizer
// fails, the pill says so and recording is unaffected.
const POSE_FRAME_RESOLUTION = CommonResolutions.VGA_4_3;
const POSE_MODEL = require("../../assets/models/movenet_lightning.tflite");
const VIEW_LABELS = ["FRONT", "LEFT", "RIGHT", "BACK"];

// Portrait 4:3, because iPad is the primary device and iPad and iPhone rear
// cameras are natively 4:3. 4:3 uses the whole sensor (16:9 would crop the sides
// off, leaving less room for a standing subject with arms out) and matches the
// iPad screen, so the full-bleed preview shows what is recorded.
//
// 1080x1440 at a 6 Mbps target: a CLIP_SECONDS (30 s) clip is then about
// 22 MB (6 Mb/s * 30 s / 8) - under the ~40 MB budget - while the long edge
// stays 1440 px, comfortably above what landmark detection needs. This is only
// a TARGET: vision-camera prioritises the aspect ratio over pixel count when
// the exact size is unavailable, and the encoder treats the bit rate as a
// reference ("may or may not encode with exactly this bit-rate"). That is why
// NOTHING below trusts these numbers.
//
// The sidecar is built from the recorded FILE (readVideoInfoFromFile): its
// oriented width/height and one entry per encoded frame at its real time. The
// server decodes the clip, applies the container's rotation, and rejects the
// whole clip ("insufficient_frames" for every metric) if the decoded size
// differs from the sidecar's width x height, so a mismatch is NOT harmless.
const TARGET_RESOLUTION = { width: 1080, height: 1440 };
const TARGET_BIT_RATE = 6_000_000;
const TARGET_FPS = 30;
// How long the per-pose capture-quality card stays before moving on (tap to skip).
const RESULT_CARD_MS = 4500;

/**
 * Picks the capture path. The branch lives in its own component because the two
 * paths own two different native camera sessions, and React's hook rules mean a
 * conditional inside one body would still have mounted both.
 *
 * BOTH conditions are required. `isSupported` alone is not enough: the guided
 * path's spatial gate thresholds have never been exercised on real hardware, and
 * a too-strict gate refuses to record with a patient already standing in front
 * of the camera. So it is reachable only when a clinician has explicitly turned
 * it on in Settings, which defaults to off (see `useArJigCapturePref`).
 */
export default function CaptureScreen() {
  const { sessionId, sessionToken } = useLocalSearchParams<{ sessionId: string; sessionToken: string }>();
  const [arJigEnabled] = useArJigCapturePref();

  if (arJigEnabled && ARJigModule.isSupported) {
    return <ArJigCapture sessionId={sessionId} sessionToken={sessionToken} />;
  }
  return <VisionCameraCapture />;
}

function VisionCameraCapture() {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const { sessionId, sessionToken } = useLocalSearchParams<{ sessionId: string; sessionToken: string }>();
  const [poseIndex, setPoseIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  // The native session connects its outputs asynchronously after mount;
  // recording before onConfigured fires throws "VideoOutput is not yet
  // connected to the CameraSession!" in vision-camera.
  const [cameraReady, setCameraReady] = useState(false);
  const onConfigured = useCallback(() => setCameraReady(true), []);

  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice("back");
  // <Camera> wires its own preview output internally (see Camera.tsx:
  // `outputs: [previewOutput, ...outputs]`) - passing a second one here
  // duplicated the output and left it unconnected to any PreviewView.
  const videoOutput = useVideoOutput({
    targetResolution: TARGET_RESOLUTION,
    targetBitRate: TARGET_BIT_RATE,
    enableAudio: false,
  });

  // The pipeline resolves constraints to a concrete config; the sidecar must
  // report the fps actually recorded, not the one we asked for.
  const actualFps = useRef(TARGET_FPS);
  const onSessionConfigSelected = useCallback((config: CameraSessionConfig) => {
    if (config.selectedFPS) actualFps.current = config.selectedFPS;
  }, []);

  // Pose guide: resizer + model load asynchronously and independently of the
  // camera session. Frames are only processed once both are ready.
  const resizerState = useResizer({
    width: MOVENET_INPUT,
    height: MOVENET_INPUT,
    channelOrder: "rgb",
    dataType: "uint8",
    scaleMode: "contain",
    pixelLayout: "interleaved",
  });
  const resizer = resizerState.resizer;
  const modelState = useTensorflowModel(POSE_MODEL, []);
  const tflite = modelState.state === "loaded" ? modelState.model : undefined;
  const pose = useSharedValue<PoseSnapshot>(EMPTY_POSE);
  // The far side of the body is hidden in a lateral pose, so the presence test
  // is relaxed for those views (see personPresent).
  const lateralView = isLateral(POSES[poseIndex].view);
  const onFrame = useCallback(
    (frame: Frame) => {
      "worklet";
      try {
        if (resizer && tflite) {
          // With enablePhysicalBufferRotation frames are already upright ('up'); the
          // sideways branch only matters if the pipeline ever stops rotating them.
          const sideways = frame.orientation === "left" || frame.orientation === "right";
          const fw = sideways ? frame.height : frame.width;
          const fh = sideways ? frame.width : frame.height;
          const gpu = resizer.resize(frame);
          try {
            const outputs = tflite.runSync([gpu.getPixelBuffer()]);
            const raw = new Float32Array(outputs[0]);
            pose.value = { pts: personPresent(raw, lateralView) ? decodeMoveNet(raw, fw, fh) : EMPTY_POSE.pts, w: fw, h: fh, n: (pose.value.n ?? 0) + 1, conf: meanVisibleScore(raw), scores: keypointScores(raw) };
          } finally {
            gpu.dispose();
          }
        }
      } catch {
        // Pose detection is best-effort; never let it affect the camera pipeline.
      } finally {
        frame.dispose();
      }
    },
    [resizer, tflite, pose, lateralView],
  );
  const frameOutput = useFrameOutput({
    pixelFormat: "yuv",
    targetResolution: POSE_FRAME_RESOLUTION,
    enablePreviewSizedOutputBuffers: true,
    // Frames arrive in sensor orientation ("left" on iPad). The resizer's own
    // rotation left the model looking at an upside-down image (nose reported
    // at the bottom of the frame), so have the camera pipeline deliver upright
    // buffers and let the resizer do no rotation.
    enablePhysicalBufferRotation: true,
    onFrame,
  });

  // Count of visible keypoints for the pill, polled (the worklet never touches React state).
  const [pointCount, setPointCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPointCount(visibleCount(pose.value.pts)), 250);
    return () => clearInterval(id);
  }, [pose]);
  // Smoothed 2-axis tilt: state at ~15 Hz for the bubble, refs updated on every motion sample for guidance/feedback.
  const { x: tiltX, y: tiltY, level: tiltLevel, refs: tiltRefs } = useDeviceTilt();
  const rollRef = tiltRefs.roll;
  const pitchRef = tiltRefs.pitch;
  const [skeletonOn] = useSkeletonOverlayPref();
  const [guidanceOn] = useCaptureGuidancePref();
  const [hapticOn] = useHapticFeedbackPref();
  const hapticRef = useRef(hapticOn);
  hapticRef.current = hapticOn;
  const poseGuideRunning = modelState.state === "loaded" && !resizerState.error && !!resizer;

  const { guidance, beginRecording, endRecording, getLive } = useCaptureAnalysis({
    pose,
    view: POSES[poseIndex].view,
    available: poseGuideRunning,
    rollRef,
    pitchRef,
  });

  // performance.now() when the recorder actually started (monotonic); drives the ring and timer.
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [result, setResult] = useState<{ stats: ClipStats; title: string; last: boolean; advance: () => void } | null>(null);
  // Bumped when a clip is abandoned so late recorder callbacks are ignored.
  const runId = useRef(0);

  // Re-entry guard that, unlike `recording` state, is visible within a tick.
  const inFlight = useRef(false);
  // Held in refs so the unmount cleanup can reach the live sampler and recorder.
  const activeStop = useRef<(() => unknown) | null>(null);
  const activeRecorder = useRef<Recorder | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    // Set again on mount so a dev-mode remount does not stay marked unmounted.
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      if (resultTimer.current) clearTimeout(resultTimer.current);
      activeStop.current?.();
      activeStop.current = null;
      // Leaving the screen abandons the clip. Nothing useful can be done with a
      // rejection here - the screen is already gone.
      activeRecorder.current?.cancelRecording().catch(() => {});
      activeRecorder.current = null;
    };
  }, []);

  const currentPose = POSES[poseIndex];
  // Top edge (screen y) of the bottom card + controls, so the framing hint stays above them.
  const [infoOpen, setInfoOpen] = useState(false);
  useEffect(() => setInfoOpen(false), [poseIndex]);

  // Hold feedback: while recording, turn the live checks into at most a few
  // gentle nudges (haptic on iPhone, amber ring/edge glow and a small toast
  // everywhere). Filming conditions only. Stops and clears on cancel, finish
  // and unmount because the interval is tied to `recording`.
  const guidanceRef = useRef(guidance);
  guidanceRef.current = guidance;
  const [warnIssue, setWarnIssue] = useState<Issue | null>(null);
  const [greenFlash, setGreenFlash] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  useEffect(() => {
    if (!recording || recordingStartedAt === null) return;
    const fb = createFeedback(CLIP_SECONDS);
    let toastId = 0;
    let flashTimer: ReturnType<typeof setTimeout> | null = null;
    const dispatch = (e: FeedbackEvent) => {
      const haptic = hapticRef.current;
      if (e.kind === "warn") {
        if (haptic) warnHaptic();
        setToast({ id: ++toastId, text: ISSUE_TEXT[e.issue], tone: "warn" });
      } else if (e.kind === "recovered") {
        if (haptic) recoveredHaptic();
        setToast({ id: ++toastId, text: "Good", tone: "good" });
        setGreenFlash(true);
        if (flashTimer) clearTimeout(flashTimer);
        flashTimer = setTimeout(() => setGreenFlash(false), 1200);
      } else if (e.kind === "start") {
        if (haptic) recordingStartHaptic();
      } else if (haptic) {
        milestoneHaptic();
      }
    };
    const id = setInterval(() => {
      try {
        const g = guidanceRef.current;
        const issues = new Set<Issue>();
        const roll = rollRef.current;
        const pitch = pitchRef.current;
        if (pitch !== null && pitch > PITCH_TOLERANCE_DEG) issues.add("tilt");
        else if (roll !== null && Math.abs(roll) > ROLL_TOLERANCE_DEG) issues.add("level");
        if (g.available) {
          const ok = (i: number) => g.checks[i].ok;
          if (!g.personOk) issues.add("personLost");
          else {
            if (!g.inFrame) issues.add("inFrame");
            else {
              if (!ok(2)) issues.add("distance");
              if (!ok(3)) issues.add("centred");
            }
            if (!ok(5)) issues.add("steady");
          }
        }
        for (const e of fb.step({ phase: "recording", issues, now: performance.now() })) dispatch(e);
        setWarnIssue(fb.activeIssue());
      } catch {
        // Feedback is best-effort; never affects recording.
      }
    }, 100);
    return () => {
      clearInterval(id);
      if (flashTimer) clearTimeout(flashTimer);
      setWarnIssue(null);
      setGreenFlash(false);
      setToast(null);
    };
  }, [recording, recordingStartedAt, rollRef, pitchRef]);

  function resetRecordingState() {
    activeStop.current = null;
    activeRecorder.current = null;
    inFlight.current = false;
    setRecording(false);
    setRecordingStartedAt(null);
  }

  function clearCountdown() {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = null;
    setCountdown(null);
  }

  /** Shutter: 3-2-1 with haptic ticks, then the real recording. Cancellable. */
  function begin() {
    if (stopped) return; // latched off by the safety stop
    if (recording || inFlight.current || !cameraReady || countdownTimer.current || result) return;
    setError(null);
    let n = 3;
    setCountdown(n);
    tickHaptic();
    countdownTimer.current = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCountdown(n);
        tickHaptic();
        return;
      }
      clearCountdown();
      void record();
    }, 1000);
  }

  /** Abandon the clip (countdown or recording): recorder cancelled, nothing uploaded. */
  /**
   * The ADR-005 safety stop. `abandon()` is local-only - it clears the
   * countdown, bumps the run id so any in-flight callback is ignored, and
   * cancels the recorder - and it performs no network I/O, so the stop cannot
   * be delayed or prevented by the clinic server being unreachable.
   *
   * `stopped` then latches the shutter off, so a patient who has just said they
   * feel unwell is not offered the record button again. Only leaving and
   * re-entering the screen resumes, which puts a clinician in the loop.
   */
  function safetyStop() {
    setStopped(true);
    try {
      abandon();
    } catch {
      // Nothing to report: the stop must not depend on this succeeding.
    }
  }

  function abandon() {
    if (countdownTimer.current) {
      clearCountdown();
      return;
    }
    if (!inFlight.current) return;
    runId.current += 1;
    const recorder = activeRecorder.current;
    activeStop.current?.();
    endRecording();
    resetRecordingState();
    recorder?.cancelRecording().catch(() => {});
  }

  async function record() {
    if (recording || inFlight.current || !cameraReady) return;
    inFlight.current = true;
    setRecording(true);
    setError(null);
    const myRun = ++runId.current;

    const stopSampling = startGravitySampling();
    activeStop.current = stopSampling;
    const recordedAt = new Date().toISOString();

    const cleanUp = resetRecordingState;

    try {
      // maxDuration ends the recording itself, so there is no setTimeout race
      // between stopping and the file being finalised.
      const recorder = await videoOutput.createRecorder({ maxDuration: CLIP_SECONDS });
      activeRecorder.current = recorder;

      await recorder.startRecording(
        async (filePath) => {
          // The screen was left, so the clip is abandoned regardless of which
          // callback the recorder delivers after cancelRecording().
          if (!isMounted.current || myRun !== runId.current) return;
          cleanUp();
          const gravitySamples = stopSampling();
          const summary = endRecording();
          try {
            // Size and frame timing come from what was actually written. If the
            // file cannot be read the clip is NOT uploaded and the requested
            // resolution is never substituted (CLAUDE.md rule 3).
            let info;
            try {
              info = await readVideoInfoFromFile(filePath);
            } catch {
              setError("Could not read the recorded video's size, so it was not uploaded.");
              return;
            }
            const sidecar = buildSidecar({
              clipId: clipIdFor(sessionId, currentPose.stepId),
              sessionId,
              stepId: currentPose.stepId,
              view: currentPose.view,
              recordedAt,
              fps: actualFps.current,
              width: info.width,
              height: info.height,
              frameTimes: info.frameTimes,
              gravitySamples,
              device: { model: Device.modelId ?? "unknown", lens: "back_wide", appVersion: "1.0.0" },
            });
            await uploadClip({ sessionId, stepId: currentPose.stepId, videoPath: filePath, sidecar, token: sessionToken });

            // The clip is saved; everything below is display-only and cannot affect it.
            const stats: ClipStats = { ...summary, stars: starsFor(summary.sqi), meanRollDegrees: meanRollFromSamples(gravitySamples), meanPitchDegrees: medianPitchFromSamples(gravitySamples) };
            recordClipStats(sessionId, currentPose.stepId, stats);
            const last = poseIndex + 1 >= POSES.length;
            const advance = () => {
              if (resultTimer.current) clearTimeout(resultTimer.current);
              resultTimer.current = null;
              setResult(null);
              if (!last) setPoseIndex(poseIndex + 1);
              else router.replace({ pathname: "/analysis", params: { sessionId } });
            };
            setResult({ stats, title: currentPose.title, last, advance });
            resultTimer.current = setTimeout(advance, RESULT_CARD_MS);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save that clip.");
          }
        },
        (err) => {
          // Screen left: abandoned, nothing to report (see onFinished).
          if (!isMounted.current || myRun !== runId.current) return;
          cleanUp();
          stopSampling();
          endRecording();
          setError(err.message);
        }
      );
      // Recording has started: from here the ring/timer and the quality tally run on real time.
      if (isMounted.current && myRun === runId.current && inFlight.current) {
        beginRecording();
        setRecordingStartedAt(performance.now());
      }
    } catch (err) {
      cleanUp();
      stopSampling();
      endRecording();
      setError(err instanceof Error ? err.message : "Could not start recording.");
    }
  }

  if (!sessionId || !sessionToken) {
    return (
      <View style={styles.screen}>
        <Text style={styles.message}>This assessment is missing its session. Go back and start the assessment again.</Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.screen}>
        <Text style={styles.message}>
          {canRequestPermission
            ? "Camera access is needed to record the assessment poses."
            : "Camera access was turned off. Enable it in Settings to record the assessment poses."}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.permissionButton}
          onPress={() => (canRequestPermission ? void requestPermission() : void Linking.openSettings())}
        >
          <Text style={styles.permissionButtonText}>{canRequestPermission ? "Allow camera" : "Open Settings"}</Text>
        </Pressable>
      </View>
    );
  }

  if (!device) return <View style={styles.screen}><Text style={styles.message}>No camera available.</Text></View>;

  const busy = recording || countdown !== null;
  const lay = computeCaptureLayout(winW, winH, { top: insets.top, bottom: insets.bottom });
  const shutterState = busy ? "recording" : cameraReady && !result ? "ready" : "preparing";
  const detecting = pointCount > 0 && modelState.state === "loaded" && !resizerState.error;
  const statusText = poseStatusText(modelState.state, !!resizerState.error, pointCount);

  return (
    <View style={styles.screen}>
      {/* Always mounted while this screen is open, including mid-clip and while
          a clip is uploading. */}
      <SymptomStop sessionId={sessionId} sessionToken={sessionToken} onStop={safetyStop} />
      {/* absoluteFill with no padding: the subject fills the screen. */}
      <Camera
        style={StyleSheet.absoluteFill}
        isActive
        device={device}
        // The UI is locked to portrait. Orient every output (preview, recorded
        // video, pose frames) by the interface, not the physical device: with the
        // default 'device' source a tilted iPad gave the pose model sideways
        // frames while the preview looked fine, so the skeleton missed the body.
        orientationSource="interface"
        outputs={[videoOutput, frameOutput]}
        constraints={[{ fps: TARGET_FPS }]}
        onSessionConfigSelected={onSessionConfigSelected}
        onConfigured={onConfigured}
      />

      <View style={[StyleSheet.absoluteFill, styles.scrim]} pointerEvents="none" />
      <ScanLine height={winH} />
      <CentreGuides width={winW} height={winH} />
      {guidanceOn ? (
        <ArTarget width={winW} height={winH} aligned={guidance.available && guidance.aligned} view={currentPose.view} />
      ) : (
        <View pointerEvents="none" style={styles.frame} />
      )}
      {skeletonOn ? <PoseOverlay pose={pose} /> : null}
      <EdgeGlow mode={recording && warnIssue ? "amber" : recording && greenFlash ? "green" : "none"} />

      <LinearGradient
        pointerEvents="none"
        colors={["rgba(10,8,24,0)", "rgba(10,8,24,0.55)"]}
        style={[styles.bottomScrim, { height: lay.bottomControls.h + 16 }]}
      />

      {busy && !result ? (
        <View pointerEvents="none" style={{ position: "absolute", left: lay.ring.x, top: lay.ring.y, width: lay.ring.w, height: lay.ring.h }}>
          <ScanRing size={lay.ring.w} startedAt={recording ? recordingStartedAt : null} totalSeconds={CLIP_SECONDS} countdown={recording ? null : countdown}
            tone={recording && warnIssue ? "amber" : recording && greenFlash ? "green" : "violet"}
            caption={recording && warnIssue ? ISSUE_TEXT[warnIssue] : null} />
        </View>
      ) : null}

      {!result ? (
        <>
          <View pointerEvents="none" style={{ position: "absolute", left: lay.bubble.x, top: lay.bubble.y, width: lay.bubble.w, height: lay.bubble.h }}>
            <BubbleLevel2D x={tiltX} y={tiltY} level={tiltLevel} size={recording ? Math.round(bubbleDiameter(winW) * 0.85) : bubbleDiameter(winW)} width={lay.bubble.w} compact={recording} />
          </View>
          <View pointerEvents="none" style={{ position: "absolute", left: lay.distance.x, top: lay.distance.y, width: lay.distance.w, height: lay.distance.h }}>
            <DistanceMeter span={guidance.span} state={distanceState(guidance.span)} width={lay.distance.w} height={lay.distance.h} />
          </View>
        </>
      ) : null}

      <View
        style={[styles.overlay, { paddingTop: insets.top + 14, paddingBottom: Math.max(8, insets.bottom) }]}
        pointerEvents="box-none"
      >
        <View style={styles.constrained} pointerEvents="box-none">
          <View style={styles.headerRow}>
            <BackButton variant="glass" />
            <CaptureGlass radius={11} ring={colors.captureRingSoft} style={styles.pill}>
              <View style={styles.pillInner} accessibilityLiveRegion="polite">
                {detecting ? <PulseDot style={styles.dot} /> : <View style={[styles.dot, styles.dotIdle]} />}
                <Text style={styles.pillText} numberOfLines={1}>{statusText}</Text>
              </View>
            </CaptureGlass>
          </View>

          <ViewProgress labels={VIEW_LABELS} current={poseIndex} />

          {result ? null : recording && recordingStartedAt !== null ? (
            <GlassCard tint="dark" fill={colors.captureCard} ring={colors.captureRingSoft} intensity={40} elevated={false} radius={14} style={styles.strip}>
              <RecordingHud getLive={getLive} poseGuideRunning={poseGuideRunning} />
            </GlassCard>
          ) : busy ? null : (
            <>
              <GlassCard tint="dark" fill={colors.captureCard} ring={colors.captureRingSoft} intensity={40} elevated={false} radius={14} style={styles.strip}>
                <View style={styles.stripBody}>
                  <View style={styles.stripHead}>
                    <Text style={styles.stripTitle} numberOfLines={1}>{currentPose.title}</Text>
                    <InfoButton open={infoOpen} onPress={() => setInfoOpen((v) => !v)} />
                  </View>
                  {guidanceOn ? (
                    <View accessibilityLiveRegion="polite">
                      <Text style={[styles.guidance, guidance.aligned && styles.guidanceOk]} numberOfLines={2}>{guidance.message}</Text>
                    </View>
                  ) : null}
                  {error ? <Text style={styles.error} numberOfLines={2}>{error} Press Start to record this pose again.</Text> : null}
                  {guidanceOn && guidance.available ? (
                    <GuidanceChips checks={guidance.checks} />
                  ) : (
                    <View style={styles.chips}>
                      {currentPose.cues.map((c) => (
                        <View key={c} style={styles.chip}>
                          <Text style={styles.chipText}>{c}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </GlassCard>
              {infoOpen ? (
                <GlassCard tint="dark" fill={colors.captureCard} ring={colors.captureRingSoft} intensity={50} elevated={false} radius={14} style={styles.popover}>
                  <View style={styles.stripBody}>
                    <Text style={styles.cardBody}>{currentPose.instruction}</Text>
                    {guidanceOn && guidance.available ? null : <Text style={styles.mountHint}>For a usable measurement, mount the iPad upright and keep it still (a stand works best).</Text>}
                  </View>
                </GlassCard>
              ) : guidanceOn && !guidance.aligned ? (
                <Text pointerEvents="none" style={styles.hint} numberOfLines={1}>Fit the whole body inside the outline, feet included</Text>
              ) : null}
            </>
          )}
          <HoldToast toast={toast} />
        </View>

        {result ? null : (
          <View style={[styles.constrained, styles.bottom]} pointerEvents="box-none">
            <View style={styles.controls}>
              <SquareGlassButton label="Grid (not available)" disabled>
                <LayoutIcon size={20} color={colors.accent300} strokeWidth={1.8} />
              </SquareGlassButton>
              <Shutter state={shutterState} onPress={begin} recordingStartedAt={recordingStartedAt} totalSeconds={CLIP_SECONDS} />
              {busy ? (
                <SquareGlassButton label="Stop and discard this clip" onPress={abandon}>
                  <CloseGlyph />
                </SquareGlassButton>
              ) : (
                <SquareGlassButton label="Reset (not available)" disabled>
                  <RefreshIcon size={20} color={colors.accent300} strokeWidth={1.8} />
                </SquareGlassButton>
              )}
            </View>
            <Text style={styles.caption} numberOfLines={1}>
              {countdown !== null
                ? "Get ready. Tap ✕ to cancel"
                : recording
                  ? "Recording · tap ✕ to stop and discard"
                  : cameraReady
                    ? `View ${poseIndex + 1} of ${POSES.length} · tap to start, hold still ${CLIP_SECONDS} s`
                    : "Preparing camera…"}
            </Text>
          </View>
        )}
      </View>

      {result ? (
        <View style={styles.resultWrap} pointerEvents="box-none">
          <GlassCard tint="dark" fill={colors.captureCard} ring={colors.captureRingSoft} intensity={50} elevated={false} radius={18} style={styles.resultCard}>
            <PoseResultCard title={result.title} stats={result.stats} last={result.last} onContinue={result.advance} />
          </GlassCard>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgDark },
  scrim: { backgroundColor: colors.captureScrim },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "space-between", paddingHorizontal: 20 },
  constrained: { width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" },
  frame: {
    position: "absolute", left: 26, right: 26, top: 150, bottom: 230,
    borderRadius: 26, borderWidth: 1, borderColor: colors.captureFrame,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  pill: { height: 34, flexShrink: 1 },
  pillInner: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent400 },
  dotIdle: { opacity: 0.22 },
  pillText: { color: colors.textOnDark, fontSize: 12, fontWeight: "600", letterSpacing: 0.48 },
  bottom: { gap: 6 },
  bottomScrim: { position: "absolute", left: 0, right: 0, bottom: 0 },
  strip: { marginTop: 8 },
  stripBody: { paddingVertical: 8, paddingHorizontal: 12, gap: 5 },
  stripHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  stripTitle: { color: colors.accent300, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, flexShrink: 1 },
  popover: { marginTop: 6 },
  hint: { marginTop: 6, textAlign: "center", color: colors.accent100, fontSize: 12.5, fontWeight: "600", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  resultWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  resultCard: { width: "100%", maxWidth: 340 },
  card: { paddingVertical: 15, paddingHorizontal: 16, gap: 9 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyebrow: { color: colors.accent400, fontSize: 11, fontWeight: "600", letterSpacing: 1.43 },
  guidance: { color: colors.accent100, fontSize: 14, fontWeight: "700" },
  guidanceOk: { color: colors.captureAligned },
  cardBody: { color: colors.captureBody, fontSize: 14.5, lineHeight: 21 },
  cardStrong: { color: colors.accent300, fontWeight: "600" },
  chips: { flexDirection: "row", gap: 5 },
  chip: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: radii.sm - 1, backgroundColor: colors.captureChip },
  chipText: { color: colors.accent300, fontSize: 10, fontWeight: "600" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 6 },
  mountHint: { fontSize: 11.5, color: colors.captureGuide, letterSpacing: 0.3 },
  caption: { textAlign: "center", fontSize: 11, color: colors.captureGuide, letterSpacing: 0.46 },
  permissionButton: { marginHorizontal: 20, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent700 },
  permissionButtonText: { color: colors.textOnDark, fontWeight: "600", fontSize: 15 },
  message: { color: colors.textOnDark, fontSize: 15, lineHeight: 22, margin: 20, marginTop: 120 },
  error: { color: colors.caution, fontSize: 12 },
  errorHint: { color: colors.accent300, fontSize: 13 },
});
