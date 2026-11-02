import * as Device from "expo-device";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Camera,
  CommonResolutions,
  useCameraDevice,
  usePreviewOutput,
  useVideoOutput,
  type CameraSessionConfig,
} from "react-native-vision-camera";
import { uploadClip } from "../api/clips";
import { startGravitySampling } from "../capture/gravity";
import { CLIP_SECONDS, POSES } from "../capture/poses";
import { buildSidecar } from "../capture/sidecar";

// 1080x1920 - portrait, so the preview fills a tall phone screen and what is
// framed is what is recorded. A subject boxed into a letterboxed preview looks
// like a toy and gets framed wrong.
const TARGET_RESOLUTION = CommonResolutions.FHD_16_9;
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

  const pose = POSES[poseIndex];

  async function record() {
    if (recording) return;
    setRecording(true);
    setError(null);

    const stopSampling = startGravitySampling();
    const recordedAt = new Date().toISOString();
    let lastDuration = 0;
    let durationTicker: ReturnType<typeof setInterval> | undefined;

    function cleanUp() {
      if (durationTicker) clearInterval(durationTicker);
      setRecording(false);
    }

    try {
      // maxDuration ends the recording itself, so there is no setTimeout race
      // between stopping and the file being finalised.
      const recorder = await videoOutput.createRecorder({ maxDuration: CLIP_SECONDS });

      // recordedDuration reads 0 once recording stops, so sample it while live
      // and keep the last value. The real duration drives the sidecar's frame
      // count - assuming CLIP_SECONDS would be a fabricated measurement.
      durationTicker = setInterval(() => {
        if (recorder.recordedDuration > 0) lastDuration = recorder.recordedDuration;
      }, 100);

      await recorder.startRecording(
        async (filePath) => {
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
  overlay: { ...StyleSheet.absoluteFill, justifyContent: "space-between" },
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
