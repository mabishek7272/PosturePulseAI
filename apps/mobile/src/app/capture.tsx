import * as Device from "expo-device";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  useFrameOutput,
  useVideoOutput,
  type CameraSessionConfig,
  type Frame,
  type Recorder,
} from "react-native-vision-camera";
import { useTensorflowModel } from "react-native-fast-tflite";
import { useResizer } from "react-native-vision-camera-resizer";
import { uploadClip } from "../api/clips";
import { startGravitySampling } from "../capture/gravity";
import { formatLevel, useDeviceLevel } from "../capture/level";
import { EMPTY_POSE, MOVENET_INPUT, decodeMoveNet, poseStatusText, visibleCount, type PoseSnapshot } from "../capture/pose-overlay";
import { CLIP_SECONDS, POSES } from "../capture/poses";
import { buildSidecar, clipIdFor } from "../capture/sidecar";
import { CentreGuides, ScanLine, Shutter, SquareGlassButton, ViewProgress, CaptureGlass } from "../components/CaptureChrome";
import { GlassCard } from "../components/GlassCard";
import { ClockIcon, LayoutIcon, RefreshIcon, SparkleIcon } from "../components/icons";
import { PulseDot } from "../components/Motion";
import { PoseOverlay } from "../components/PoseOverlay";
import { MAX_CONTENT_WIDTH } from "../components/Screen";
import { BackButton } from "../components/ScreenHeader";
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

// 1440x1920 - portrait 4:3, because iPad is the primary device and iPad and
// iPhone rear cameras are natively 4:3.
//
// 4:3 uses the whole sensor. Asking for 16:9 crops the sides off it, giving
// the same 1920 height but only 1080 of width - less room for a standing
// subject with feet apart and arms at their sides, and so more out-of-frame
// failures. 4:3 also matches an iPad screen, so the full-bleed preview really
// does show what is being recorded rather than a crop of it.
//
// The sidecar reports this target, not the resolution the pipeline selected.
// That is deliberate and safe: vision-camera prioritises the target's aspect
// ratio over pixel count when it cannot be met exactly, and the server-side
// angles depend on aspect ratio, not absolute scale (ml-service passes
// width/height into analyze_observations). A 1080x1440 recording described as
// 1440x1920 yields identical angles. Do not "fix" this to the selected size.
const TARGET_RESOLUTION = CommonResolutions.FHD_4_3;
const TARGET_FPS = 30;

export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const { sessionId, sessionToken } = useLocalSearchParams<{ sessionId: string; sessionToken: string }>();
  const [poseIndex, setPoseIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The native session connects its outputs asynchronously after mount;
  // recording before onConfigured fires throws "VideoOutput is not yet
  // connected to the CameraSession!" in vision-camera.
  const [cameraReady, setCameraReady] = useState(false);
  const onConfigured = useCallback(() => setCameraReady(true), []);

  const device = useCameraDevice("back");
  // <Camera> wires its own preview output internally (see Camera.tsx:
  // `outputs: [previewOutput, ...outputs]`) - passing a second one here
  // duplicated the output and left it unconnected to any PreviewView.
  const videoOutput = useVideoOutput({ targetResolution: TARGET_RESOLUTION, enableAudio: false });

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
  const onFrame = useCallback(
    (frame: Frame) => {
      "worklet";
      try {
        if (resizer && tflite) {
          // Raw buffer dims are sensor-oriented; the resizer rotates to upright.
          const sideways = frame.orientation === "left" || frame.orientation === "right";
          const fw = sideways ? frame.height : frame.width;
          const fh = sideways ? frame.width : frame.height;
          const gpu = resizer.resize(frame);
          try {
            const outputs = tflite.runSync([gpu.getPixelBuffer()]);
            pose.value = { pts: decodeMoveNet(new Float32Array(outputs[0]), fw, fh), w: fw, h: fh };
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
    [resizer, tflite, pose],
  );
  const frameOutput = useFrameOutput({
    pixelFormat: "yuv",
    targetResolution: POSE_FRAME_RESOLUTION,
    enablePreviewSizedOutputBuffers: true,
    onFrame,
  });

  // Count of visible keypoints for the pill, polled (the worklet never touches React state).
  const [pointCount, setPointCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPointCount(visibleCount(pose.value.pts)), 250);
    return () => clearInterval(id);
  }, [pose]);
  const levelText = formatLevel(useDeviceLevel());

  // Re-entry guard that, unlike `recording` state, is visible within a tick.
  const inFlight = useRef(false);
  // Held in refs so the unmount cleanup can reach the live sampler and ticker.
  const activeStop = useRef<(() => unknown) | null>(null);
  const activeRecorder = useRef<Recorder | null>(null);
  const isMounted = useRef(true);
  const activeTicker = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Set again on mount so a dev-mode remount does not stay marked unmounted.
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (activeTicker.current) clearInterval(activeTicker.current);
      activeTicker.current = null;
      activeStop.current?.();
      activeStop.current = null;
      // Leaving the screen abandons the clip. Nothing useful can be done with a
      // rejection here - the screen is already gone.
      activeRecorder.current?.cancelRecording().catch(() => {});
      activeRecorder.current = null;
    };
  }, []);

  const currentPose = POSES[poseIndex];

  async function record() {
    if (recording || inFlight.current || !cameraReady) return;
    inFlight.current = true;
    setRecording(true);
    setError(null);

    const stopSampling = startGravitySampling();
    activeStop.current = stopSampling;
    const recordedAt = new Date().toISOString();
    let lastDuration = 0;

    function cleanUp() {
      if (activeTicker.current) clearInterval(activeTicker.current);
      activeTicker.current = null;
      activeStop.current = null;
      activeRecorder.current = null;
      inFlight.current = false;
      setRecording(false);
    }

    try {
      // maxDuration ends the recording itself, so there is no setTimeout race
      // between stopping and the file being finalised.
      const recorder = await videoOutput.createRecorder({ maxDuration: CLIP_SECONDS });
      activeRecorder.current = recorder;

      // recordedDuration reads 0 once recording stops, so sample it while live
      // and keep the last value. The real duration drives the sidecar's frame
      // count - assuming CLIP_SECONDS would be a fabricated measurement.
      activeTicker.current = setInterval(() => {
        if (recorder.recordedDuration > 0) lastDuration = recorder.recordedDuration;
      }, 100);

      await recorder.startRecording(
        async (filePath) => {
          // The screen was left, so the clip is abandoned regardless of which
          // callback the recorder delivers after cancelRecording().
          if (!isMounted.current) return;
          cleanUp();
          const gravitySamples = stopSampling();
          try {
            const sidecar = buildSidecar({
              clipId: clipIdFor(sessionId, currentPose.stepId),
              sessionId,
              stepId: currentPose.stepId,
              view: currentPose.view,
              recordedAt,
              fps: actualFps.current,
              width: TARGET_RESOLUTION.width,
              height: TARGET_RESOLUTION.height,
              durationSeconds: lastDuration,
              gravitySamples,
              device: { model: Device.modelId ?? "unknown", lens: "back_wide", appVersion: "1.0.0" },
            });
            await uploadClip({ sessionId, stepId: currentPose.stepId, videoPath: filePath, sidecar, token: sessionToken });

            if (poseIndex + 1 < POSES.length) setPoseIndex(poseIndex + 1);
            else router.replace({ pathname: "/analysis", params: { sessionId } });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save that clip.");
          }
        },
        (err) => {
          // Screen left: abandoned, nothing to report (see onFinished).
          if (!isMounted.current) return;
          cleanUp();
          stopSampling();
          setError(err.message);
        }
      );
    } catch (err) {
      cleanUp();
      stopSampling();
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

  if (!device) return <View style={styles.screen}><Text style={styles.message}>No camera available.</Text></View>;

  const shutterState = recording ? "recording" : cameraReady ? "ready" : "preparing";
  const detecting = pointCount > 0 && modelState.state === "loaded" && !resizerState.error;
  const statusText = poseStatusText(modelState.state, !!resizerState.error, pointCount);

  return (
    <View style={styles.screen}>
      {/* absoluteFill with no padding: the subject fills the screen. */}
      <Camera
        style={StyleSheet.absoluteFill}
        isActive
        device={device}
        outputs={[videoOutput, frameOutput]}
        constraints={[{ fps: TARGET_FPS }]}
        onSessionConfigSelected={onSessionConfigSelected}
        onConfigured={onConfigured}
      />

      <View style={[StyleSheet.absoluteFill, styles.scrim]} pointerEvents="none" />
      <ScanLine height={winH} />
      <CentreGuides width={winW} height={winH} />
      <View pointerEvents="none" style={styles.frame} />
      <PoseOverlay pose={pose} />

      <View
        style={[styles.overlay, { paddingTop: insets.top + 14, paddingBottom: Math.max(30, insets.bottom + 12) }]}
        pointerEvents="box-none"
      >
        <View style={styles.constrained} pointerEvents="box-none">
          <View style={styles.headerRow}>
            <BackButton variant="glass" />
            <CaptureGlass radius={11} ring={colors.captureRingSoft} style={styles.pill}>
              <View style={styles.pillInner} accessibilityLiveRegion="polite">
                {detecting ? <PulseDot style={styles.dot} /> : <View style={[styles.dot, styles.dotIdle]} />}
                <Text style={styles.pillText}>{statusText}</Text>
              </View>
            </CaptureGlass>
            <CaptureGlass
              radius={11}
              fill={colors.captureAccentPill}
              ring={colors.captureAccentPillRing}
              style={[styles.pill, styles.levelPill]}
            >
              <View style={[styles.pillInner, { gap: 6, paddingHorizontal: 11 }]} accessibilityLabel={`Device tilt ${levelText}`}>
                <ClockIcon size={13} color={colors.accent300} strokeWidth={2.2} />
                <Text style={styles.pillText}>{levelText}</Text>
              </View>
            </CaptureGlass>
          </View>

          <ViewProgress labels={VIEW_LABELS} current={poseIndex} />
        </View>

        <View style={[styles.constrained, styles.bottom]} pointerEvents="box-none">
          <GlassCard tint="dark" fill={colors.captureCard} ring={colors.captureRingSoft} intensity={50} elevated={false} radius={18}>
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <SparkleIcon size={15} color={colors.accent400} strokeWidth={1.9} />
                <Text style={styles.eyebrow}>POSE GUIDE</Text>
              </View>
              <Text style={styles.cardBody}>
                <Text style={styles.cardStrong}>{currentPose.title}</Text>
                {" — "}
                {currentPose.instruction}
              </Text>
              {error && (
                <>
                  <Text style={styles.error}>{error}</Text>
                  {/* Recovery in P1 is re-recording this pose; earlier poses are
                      already accepted server-side and are not re-uploaded. */}
                  <Text style={styles.errorHint}>Press Start to record this pose again.</Text>
                </>
              )}
              <View style={styles.chips}>
                {currentPose.cues.map((c) => (
                  <View key={c} style={styles.chip}>
                    <Text style={styles.chipText}>{c}</Text>
                  </View>
                ))}
              </View>
            </View>
          </GlassCard>

          <View style={styles.controls}>
            <SquareGlassButton label="Grid (not available)" disabled>
              <LayoutIcon size={20} color={colors.accent300} strokeWidth={1.8} />
            </SquareGlassButton>
            <Shutter state={shutterState} onPress={record} />
            <SquareGlassButton label="Reset (not available)" disabled>
              <RefreshIcon size={20} color={colors.accent300} strokeWidth={1.8} />
            </SquareGlassButton>
          </View>
          <Text style={styles.caption}>
            {recording ? "Recording…" : cameraReady ? `View ${poseIndex + 1} of ${POSES.length} · tap to record a ${CLIP_SECONDS}-second clip` : "Preparing camera…"}
          </Text>
        </View>
      </View>
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
  pill: { height: 34 },
  levelPill: { marginLeft: "auto" },
  pillInner: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent400 },
  dotIdle: { opacity: 0.22 },
  pillText: { color: colors.textOnDark, fontSize: 12, fontWeight: "600", letterSpacing: 0.48 },
  bottom: { gap: 16 },
  card: { paddingVertical: 15, paddingHorizontal: 16, gap: 9 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyebrow: { color: colors.accent400, fontSize: 11, fontWeight: "600", letterSpacing: 1.43 },
  cardBody: { color: colors.captureBody, fontSize: 14.5, lineHeight: 21 },
  cardStrong: { color: colors.accent300, fontWeight: "600" },
  chips: { flexDirection: "row", gap: 7, marginTop: 3 },
  chip: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: radii.sm - 1, backgroundColor: colors.captureChip },
  chipText: { color: colors.accent300, fontSize: 11, fontWeight: "600" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 6 },
  caption: { textAlign: "center", fontSize: 11.5, color: colors.captureGuide, letterSpacing: 0.46 },
  message: { color: colors.textOnDark, fontSize: 15, lineHeight: 22, margin: 20, marginTop: 120 },
  error: { color: colors.caution },
  errorHint: { color: colors.accent300, fontSize: 13 },
});
