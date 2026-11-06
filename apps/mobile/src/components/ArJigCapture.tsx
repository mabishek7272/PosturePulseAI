import * as Device from "expo-device";
import { router } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { newTakeId } from "../capture/sidecar";
import { ERROR_TEXT, GATE_READY_TEXT, GATE_SETTLING_TEXT, primaryBlockerText } from "../capture/ar-jig-copy";
import { useBatterySequence } from "../capture/use-battery-sequence";
import { cadenceAt, windowsFor } from "../capture/sub-blocks";
import { colors } from "../theme/colors";
import { radii } from "../theme/radii";
import { BackButton } from "./ScreenHeader";
import { SymptomStop } from "./SymptomStop";

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
  // Set after a clip uploads: the clinician chooses to rescan this view or move on.
  const [saved, setSaved] = useState<{ last: boolean } | null>(null);
  const [gate, setGate] = useState<ARJigGateEvent | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);

  // The clinician's authored protocol, not a hardcoded 30 s. Null until it
  // loads, so nothing records at the wrong duration first.
  const sequence = useBatterySequence("clinic");
  /** Guards against a second clip being handled while one is uploading. */
  const inFlight = useRef(false);

  const steps = sequence?.steps ?? [];
  const pose: typeof steps[number] | undefined = steps[poseIndex];
  const windows = useMemo(
    () => (pose?.subBlocks ? windowsFor(pose.subBlocks) : []),
    [pose?.subBlocks]
  );
  // Derived from the SAME progress value the native module reports, so the
  // prompt, the countdown and the per-frame tag cannot disagree.
  const cadence =
    windows.length > 0 && pose
      ? cadenceAt(windows, progress * pose.durationSeconds)
      : null;

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
      // Cannot happen once the view is mounted - the early return below keeps
      // it unmounted until the protocol is known - but a clip arriving with no
      // step to attribute it to must be dropped rather than uploaded against a
      // guessed stepId.
      if (!pose) {
        inFlight.current = false;
        return;
      }
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
          take: newTakeId(),
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

        setSaved({ last: poseIndex + 1 >= steps.length });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save that clip.");
      } finally {
        inFlight.current = false;
        setUploading(false);
        setProgress(0);
      }
    },
    // Optional chaining is load-bearing, not defensive noise: `pose` is
    // undefined until the battery loads, and a dependency array is evaluated on
    // EVERY render including that first one. `pose.stepId` here threw
    // "Cannot read properties of undefined" before the screen had anything to
    // show. `tsc` does not catch it - `steps[poseIndex]` types as
    // ResolvedStep rather than `| undefined` without noUncheckedIndexedAccess.
    [poseIndex, pose?.stepId, pose?.view, sessionId, sessionToken],
  );

  /**
   * The ADR-005 safety stop. `halt()` abandons the take and deletes the partial
   * file locally - no network, and it cannot throw out of here. Recording is
   * also latched off, so the gate re-opening cannot offer the record button
   * again to a patient who has just said they feel unwell: only leaving and
   * re-entering the screen resumes, which puts a clinician in the loop.
   */
  const safetyStop = useCallback(() => {
    setStopped(true);
    try {
      void view.current?.halt();
    } catch {
      // Nothing to do and nothing to report: the stop must not depend on this.
    }
  }, []);

  // Nothing renders until the protocol is known: a capture screen that opened
  // at a default duration and corrected itself a moment later is exactly the
  // drift this replaced.
  if (!sequence || !pose) {
    return (
      <View style={styles.root}>
        <Text style={[styles.instruction, styles.loading]}>Loading the assessment protocol...</Text>
      </View>
    );
  }

  const isRecording = gate?.isRecording ?? false;
  const canRecord = (gate?.isOpen ?? false) && !isRecording && !uploading && !stopped && !saved;

  const nextView = () => {
    const last = saved?.last ?? false;
    setSaved(null);
    if (last) router.replace({ pathname: "/analysis", params: { sessionId } });
    else setPoseIndex(poseIndex + 1);
  };
  // Same step again; the new clip replaces this one in the report (newest per step).
  const rescanView = () => setSaved(null);
  const blocker = gate ? primaryBlockerText(gate.blockers, gate.primaryBlocker) : null;
  const status = blocker ?? (gate?.isOpen ? GATE_READY_TEXT : GATE_SETTLING_TEXT);

  return (
    <View style={styles.root}>
      <ARJigView
        ref={view}
        style={StyleSheet.absoluteFill}
        active
        clipSeconds={pose.durationSeconds}
        minFps={pose.minFps}
        onGate={onGate}
        onRecordingProgress={onRecordingProgress}
        onRecorded={onRecorded}
        onCaptureError={onCaptureError}
      />

      {/* Always mounted while the capture screen is open, including mid-clip
          and while a clip is uploading. */}
      <SymptomStop sessionId={sessionId} sessionToken={sessionToken} onStop={safetyStop} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton variant="glass" />
        <Text style={styles.step}>
          {`Pose ${poseIndex + 1} of ${steps.length}`}
        </Text>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <Text style={styles.title}>{pose.title}</Text>
        {/* The sub-phase's own instruction takes over mid-hold when the step
            declares sub-blocks; only the wording and the cue change, the
            recording runs straight through. */}
        <Text style={styles.instruction}>
          {cadence?.current?.instruction ?? pose.instruction}
        </Text>
        {cadence?.current?.preparation ? (
          <Text style={styles.instruction}>{cadence.current.preparation}</Text>
        ) : null}
        {cadence?.current ? (
          <Text style={styles.readings}>
            {`${cadence.current.phase} · ${cadence.remainingInPhase.toFixed(0)}s left in this part`}
          </Text>
        ) : null}
        {sequence.source === "fallback" ? (
          <Text style={styles.error}>
            {`${sequence.reason ?? ""} Using the app's default ${pose.durationSeconds}s holds, not this clinic's protocol.`}
          </Text>
        ) : null}

        {/* The status line is the whole point of this screen: it says what to
            adjust, one thing at a time, and it is never blank. */}
        <Text style={[styles.status, blocker ? styles.statusBlocked : styles.statusReady]}>{status}</Text>

        {/* Measurements are OMITTED when the device could not produce them -
            rendered as a dash, never coalesced to 0, or the HUD would show a
            reading that was never taken. */}
        <Text style={styles.readings}>
          {`distance ${fmt(gate?.distance, 2, " m")} (2.3–3.0)   tilt ${fmt(gate?.pitchDegrees, 1, "°")}   side ${fmt(gate?.rollDegrees, 1, "°")}   height ${fmt(gate?.cameraHeight, 2, " m")}`}
        </Text>
        <Text style={styles.readings}>
          {`hold steady ${gate ? Math.round(gate.stabilityProgress * 100) : 0}%   depth ${ARJigModule.hasLiDAR ? (gate?.nearestSurface === undefined ? "no reading" : `nearest ${gate.nearestSurface.toFixed(2)} m`) : "no LiDAR"}`}
        </Text>

        {ARJigModule.hasLiDAR ? null : (
          <Text style={styles.readings}>
            No LiDAR on this iPad: the floor is found by the camera alone, and no depth track is recorded.
          </Text>
        )}

        {isRecording ? (
          <Text style={styles.recording}>
            {`Recording ${Math.round(progress * pose.durationSeconds)}s / ${pose.durationSeconds}s`}
          </Text>
        ) : null}
        {uploading ? <Text style={styles.recording}>Saving that clip...</Text> : null}
        {stopped ? (
          <Text style={styles.recording}>Stopped. A member of staff will come to you.</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {saved ? (
          <View style={styles.savedRow}>
            <Text style={styles.recording}>{`${pose.title} saved.`}</Text>
            <View style={styles.savedButtons}>
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Records this view again; the views already saved are kept"
                onPress={rescanView}
                style={[styles.savedButton, styles.savedButtonSecondary]}
              >
                <Text style={styles.savedButtonTextSecondary}>Rescan this view</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={nextView} style={styles.savedButton}>
                <Text style={styles.savedButtonText}>{saved.last ? "Continue to analysis" : "Next view"}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

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
  savedRow: { gap: 8, alignItems: "center" },
  savedButtons: { flexDirection: "row", gap: 10, flexWrap: "wrap", justifyContent: "center" },
  savedButton: { paddingVertical: 11, paddingHorizontal: 20, borderRadius: 14, backgroundColor: colors.accent600 },
  savedButtonSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.accent400 },
  savedButtonText: { color: colors.white, fontSize: 14, fontWeight: "600" },
  savedButtonTextSecondary: { color: colors.accent300, fontSize: 14, fontWeight: "600" },
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
  loading: { textAlign: "center", marginTop: 120 },
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
