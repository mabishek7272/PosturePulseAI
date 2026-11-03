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
import { readVideoInfoFromFile } from "../capture/video-info-file";
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

// Portrait 4:3, because iPad is the primary device and iPad and iPhone rear
// cameras are natively 4:3. 4:3 uses the whole sensor (16:9 would crop the sides
// off, leaving less room for a standing subject with arms out) and matches the
// iPad screen, so the full-bleed preview shows what is recorded.
//
// 1080x1440 at a 6 Mbps target: a CLIP_SECONDS (45 s) clip is then about
// 34 MB (6 Mb/s * 45 s / 8) - under the ~40 MB budget - while the long edge
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
  // Held in refs so the unmount cleanup can reach the live sampler and recorder.
  const activeStop = useRef<(() => unknown) | null>(null);
  const activeRecorder = useRef<Recorder | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    // Set again on mount so a dev-mode remount does not stay marked unmounted.
    isMounted.current = true;
    return () => {
      isMounted.current = false;
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

    function cleanUp() {
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

      await recorder.startRecording(
        async (filePath) => {
          // The screen was left, so the clip is abandoned regardless of which
          // callback the recorder delivers after cancelRecording().
          if (!isMounted.current) return;
          cleanUp();
          const gravitySamples = stopSampling();
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
                <Text style={styles.pillText} numberOfLines={1}>{statusText}</Text>
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
  pill: { height: 34, flexShrink: 1 },
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
