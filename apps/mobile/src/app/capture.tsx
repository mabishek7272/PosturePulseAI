import * as Device from "expo-device";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  usePreviewOutput,
  useVideoOutput,
  type CameraSessionConfig,
  type Recorder,
} from "react-native-vision-camera";
import { uploadClip } from "../api/clips";
import { startGravitySampling } from "../capture/gravity";
import { CLIP_SECONDS, POSES } from "../capture/poses";
import { buildSidecar } from "../capture/sidecar";

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
  const { sessionId, sessionToken } = useLocalSearchParams<{ sessionId: string; sessionToken: string }>();
  const [poseIndex, setPoseIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const device = useCameraDevice("back");
  const previewOutput = usePreviewOutput();
  const videoOutput = useVideoOutput({ targetResolution: TARGET_RESOLUTION, enableAudio: false });

  // The pipeline resolves constraints to a concrete config; the sidecar must
  // report the fps actually recorded, not the one we asked for.
  const actualFps = useRef(TARGET_FPS);
  const onSessionConfigSelected = useCallback((config: CameraSessionConfig) => {
    if (config.selectedFPS) actualFps.current = config.selectedFPS;
  }, []);

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

  const pose = POSES[poseIndex];

  async function record() {
    if (recording || inFlight.current) return;
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
              clipId: `${sessionId}-${pose.stepId}`,
              sessionId,
              stepId: pose.stepId,
              view: pose.view,
              recordedAt,
              fps: actualFps.current,
              width: TARGET_RESOLUTION.width,
              height: TARGET_RESOLUTION.height,
              durationSeconds: lastDuration,
              gravitySamples,
              device: { model: Device.modelId ?? "unknown", lens: "back_wide", appVersion: "1.0.0" },
            });
            await uploadClip({ sessionId, stepId: pose.stepId, videoPath: filePath, sidecar, token: sessionToken });

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
        <Text style={styles.instruction}>This assessment is missing its session. Go back and start the assessment again.</Text>
      </View>
    );
  }

  if (!device) return <View style={styles.screen}><Text style={styles.instruction}>No camera available.</Text></View>;

  return (
    <View style={styles.screen}>
      {/* absoluteFill with no padding: the subject fills the screen. */}
      <Camera
        style={StyleSheet.absoluteFill}
        isActive
        device={device}
        outputs={[previewOutput, videoOutput]}
        constraints={[{ fps: TARGET_FPS }]}
        onSessionConfigSelected={onSessionConfigSelected}
      />

      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.header}>
          <Text style={styles.step}>Pose {poseIndex + 1} of {POSES.length}</Text>
          <Text style={styles.title}>{pose.title}</Text>
        </View>

        <View style={styles.footer}>
          <Text style={styles.instruction}>{pose.instruction}</Text>
          {error && (
            <>
              <Text style={styles.error}>{error}</Text>
              {/* Recovery in P1 is re-recording this pose; earlier poses are
                  already accepted server-side and are not re-uploaded. */}
              <Text style={styles.errorHint}>Press Start to record this pose again.</Text>
            </>
          )}
          <Pressable style={[styles.shutter, recording && styles.shutterActive]} onPress={record} disabled={recording}>
            <Text style={styles.shutterText}>{recording ? "Recording…" : "Start"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "space-between" },
  header: { paddingTop: 60, paddingHorizontal: 20 },
  step: { color: "#39ffc4", fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  title: { color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 4 },
  footer: { padding: 20, paddingBottom: 44, backgroundColor: "rgba(14,10,22,0.55)" },
  instruction: { color: "#efeaf6", fontSize: 15, lineHeight: 22, marginBottom: 14 },
  error: { color: "#ff6b6b", marginBottom: 4 },
  errorHint: { color: "#9d93ae", fontSize: 13, marginBottom: 10 },
  shutter: { backgroundColor: "#b98cff", borderRadius: 14, padding: 18, alignItems: "center" },
  shutterActive: { backgroundColor: "#6e3fc9" },
  shutterText: { color: "#0e0a16", fontWeight: "800", fontSize: 16 },
});
