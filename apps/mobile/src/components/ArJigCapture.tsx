import * as Device from "expo-device";
import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ARJigModule, {
  ARJigView,
  type ARJigGateEvent,
  type ARJigRecordedClip,
  type ARJigViewRef,
} from "../../modules/ar-jig";
import { uploadClip } from "../api/clips";
import { buildArJigSidecar } from "../capture/ar-jig-sidecar";
import { ERROR_TEXT, GATE_READY_TEXT, GATE_SETTLING_TEXT, primaryBlockerText } from "../capture/ar-jig-copy";
import { CLIP_SECONDS, POSES } from "../capture/poses";
import { colors } from "../theme/colors";
import { radii } from "../theme/radii";
import { BackButton } from "./ScreenHeader";

/**
 * Guided (AR) capture: the ARKit path from `modules/ar-jig`, which places a
 * virtual floor mat, holds the iPad inside a spatial gate before it will record,
 * and writes a LiDAR depth track beside the video (ADR-020).
 *
 * This is deliberately a SEPARATE screen body from `capture.tsx`'s
 * vision-camera path rather than a swapped-in preview, because the two differ in
 * what they can promise. The vision-camera path guides with an on-device pose
 * model and samples CoreMotion for gravity; this one refuses to record at all
 * until the geometry is right and gets exact per-frame gravity and true
 * intrinsics from ARKit. Interleaving them in one component would mean one set
 * of HUD states standing for two different sets of guarantees.
 *
 * NOT YET EXERCISED ON HARDWARE. ARKit does not run in the simulator, so
 * everything below is type-checked and lint-checked only. The gate thresholds
 * (`ARJigThresholds`) are engineering defaults to be tuned against a real iPad
 * Pro in a clinic room, and until that happens this screen is reachable only
 * behind an explicit preference that defaults to off - see
 * `useArJigCapturePref`. A gate that is wrong in the strict direction does not
 * mis-measure anything; it just refuses to record, which is why it must not be
 * the default path for a patient before anyone has stood in front of it.
 */
export function ArJigCapture({
  sessionId,
  sessionToken,
}: {
  sessionId: string;
  sessionToken: string;
}) {
  const insets = useSafeAreaInsets();
  const view = useRef<ARJigViewRef>(null);
  const [poseIndex, setPoseIndex] = useState(0);
  const [gate, setGate] = useState<ARJigGateEvent | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Guards against a second clip being handled while one is uploading. */
  const inFlight = useRef(false);

  const pose = POSES[poseIndex];

  const onGate = useCallback((event: { nativeEvent: ARJigGateEvent }) => {
    setGate(event.nativeEvent);
  }, []);

  const onRecordingProgress = useCallback((event: { nativeEvent: { progress: number } }) => {
    setProgress(event.nativeEvent.progress);
  }, []);

  const onCaptureError = useCallback((event: { nativeEvent: { code: keyof typeof ERROR_TEXT } }) => {
    inFlight.current = false;
    setUploading(false);
    setProgress(0);
    setError(ERROR_TEXT[event.nativeEvent.code] ?? ERROR_TEXT.writer_failed);
  }, []);

  const onRecorded = useCallback(
    async (event: { nativeEvent: ARJigRecordedClip }) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const clip = event.nativeEvent;
      setUploading(true);
      setError(null);
      try {
        // Throws rather than uploading a sidecar it cannot vouch for: a wrong
        // gravity vector is silent, and the server would trust it and
        // mis-measure every angle.
        const sidecar = buildArJigSidecar({
          sessionId,
          stepId: pose.stepId,
          view: pose.view,
          clip,
        });
        // The module reports the real device model; `device` is passed through
        // from native so the sidecar's provenance names the hardware that
        // actually recorded (CLAUDE.md rule 4).
        sidecar.device = {
          model: clip.device.model || Device.modelId || "unknown",
          lens: clip.device.lens,
          appVersion: clip.device.appVersion,
        };

        await uploadClip({
          sessionId,
          stepId: pose.stepId,
          videoPath: clip.videoPath,
          // Sent only when the sidecar describes it; `uploadClip` enforces that
          // pairing again, because the server rejects one without the other.
          depthPath: clip.depth?.depthPath,
          sidecar,
          token: sessionToken,
        });

        const last = poseIndex + 1 >= POSES.length;
        if (last) router.replace({ pathname: "/analysis", params: { sessionId } });
        else setPoseIndex(poseIndex + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save that clip.");
      } finally {
        inFlight.current = false;
        setUploading(false);
        setProgress(0);
      }
    },
    [poseIndex, pose.stepId, pose.view, sessionId, sessionToken],
  );

  const isRecording = gate?.isRecording ?? false;
  const canRecord = (gate?.isOpen ?? false) && !isRecording && !uploading;
  const blocker = gate ? primaryBlockerText(gate.blockers, gate.primaryBlocker) : null;
  const status = blocker ?? (gate?.isOpen ? GATE_READY_TEXT : GATE_SETTLING_TEXT);

  return (
    <View style={styles.root}>
      <ARJigView
        ref={view}
        style={StyleSheet.absoluteFill}
        active
        clipSeconds={CLIP_SECONDS}
        onGate={onGate}
        onRecordingProgress={onRecordingProgress}
        onRecorded={onRecorded}
        onCaptureError={onCaptureError}
      />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton variant="glass" />
        <Text style={styles.step}>
          {`Pose ${poseIndex + 1} of ${POSES.length}`}
        </Text>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <Text style={styles.title}>{pose.title}</Text>
        <Text style={styles.instruction}>{pose.instruction}</Text>

        {/* The status line is the whole point of this screen: it says what to
            adjust, one thing at a time, and it is never blank. */}
        <Text style={[styles.status, blocker ? styles.statusBlocked : styles.statusReady]}>{status}</Text>

        {/* Measurements are OMITTED when the device could not produce them -
            rendered as a dash, never coalesced to 0, or the HUD would show a
            reading that was never taken. */}
        <Text style={styles.readings}>
          {`distance ${fmt(gate?.distance, 2, " m")}   tilt ${fmt(gate?.pitchDegrees, 1, "°")}   height ${fmt(gate?.cameraHeight, 2, " m")}`}
        </Text>

        {isRecording ? (
          <Text style={styles.recording}>{`Recording ${Math.round(progress * CLIP_SECONDS)}s / ${CLIP_SECONDS}s`}</Text>
        ) : null}
        {uploading ? <Text style={styles.recording}>Saving that clip...</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRecording ? "Stop recording" : "Start recording"}
          accessibilityState={{ disabled: !canRecord && !isRecording }}
          disabled={!canRecord && !isRecording}
          onPress={() => {
            if (isRecording) void view.current?.stopRecording();
            else void view.current?.startRecording();
          }}
          style={[styles.shutter, !canRecord && !isRecording ? styles.shutterDisabled : null]}
        >
          <Text style={styles.shutterText}>{isRecording ? "Stop" : "Record"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A dash for an absent reading. Never a 0 - see ARJigGateEvent's contract. */
function fmt(value: number | undefined, digits: number, unit: string): string {
  return value === undefined ? "-" : `${value.toFixed(digits)}${unit}`;
}

/** True when this device can run the guided path at all. */
export function arJigSupported(): boolean {
  return ARJigModule.isSupported;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgDark },
  header: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
  },
  step: { color: colors.textOnDark, fontSize: 15, fontWeight: "600" },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 8,
    backgroundColor: colors.captureCard,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
  },
  title: { color: colors.textOnDark, fontSize: 19, fontWeight: "700" },
  instruction: { color: colors.accentSoft, fontSize: 14, lineHeight: 20 },
  status: { fontSize: 15, fontWeight: "600", marginTop: 4 },
  statusBlocked: { color: colors.textOnDark },
  statusReady: { color: colors.accent300 },
  readings: { color: colors.accentSoft, fontSize: 12, fontVariant: ["tabular-nums"] },
  recording: { color: colors.accent300, fontSize: 14, fontWeight: "600" },
  error: { color: colors.textOnDark, fontSize: 14 },
  shutter: {
    marginTop: 8,
    alignSelf: "center",
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.accent600,
  },
  shutterDisabled: { backgroundColor: colors.captureSegOff },
  shutterText: { color: colors.white, fontSize: 16, fontWeight: "700" },
});
