# apps/ios-client — PosturePulse AI

Native iOS (Swift/SwiftUI) capture + display front end for the assessment
battery (M1 spec: `docs/superpowers/specs/2026-10-23-m1-static-battery.md`,
slice C). Each battery step is recorded on the phone as a short HEVC clip with
a per-frame sidecar (frame timing + gravity) and uploaded to backend-api; the
measurements are computed server-side by ml-service from the clip (ADR-013).
On-device Vision runs only to guide framing - it is never uploaded and never
shown as a number.

## Build and run

Requires Xcode 26 on macOS and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
cd apps/ios-client
xcodegen generate            # after adding/removing files or packages
open PosturePulse.xcodeproj  # scheme "PosturePulse": the app + its unit tests
```

- `project.yml` defines the app target (`PosturePulse`, bundle id
  `com.beaive.posturepulse`, light appearance only) and `PosturePulseTests`.
  The generated `PosturePulse.xcodeproj` is committed; regenerate rather than
  hand-edit it.
- `Package.swift` is kept for the same `Sources/` as a library. With the
  project present, command-line `xcodebuild` picks the project, so run tests
  through the app scheme:
  `xcodebuild -project PosturePulse.xcodeproj -scheme PosturePulse -destination 'platform=iOS Simulator,name=iPhone 17' test`
- The app talks to `https://posture.beaive.com` (`Sources/Networking/BackendConfig.swift`).
- Status: builds and its unit tests pass on the iOS Simulator; not yet run on
  a physical device.

### Design previews (DEBUG only)

Launch with `-designPreview report|report-movement|capture|reps|setup|patients|results` to see
screens with sample data (e.g. Xcode scheme → Run → Arguments, or
`xcrun simctl launch <sim> com.beaive.posturepulse -designPreview report`).

### Release to TestFlight (one command)

```bash
apps/ios-client/scripts/testflight.sh              # archive, upload, wait until processed
apps/ios-client/scripts/testflight.sh --no-upload  # archive and check signing only
```

Uses the App Store Connect API key in `~/.appstoreconnect/private_keys/` (never commit it) and a
timestamp build number, so there is nothing to edit between releases. Needs `xcodegen` and `uv`.
Internal testers receive the build in the TestFlight app once Apple finishes processing it.

### Brand assets

`AppResources/Assets.xcassets` holds the icon (mark only), the in-app logo and
the accent colour. Regenerate both images from a new logo file:

```bash
cd AppResources/Assets.xcassets
swift ../../scripts/make-brand-assets.swift <logo.png> AppIcon.appiconset BrandLogo.imageset
```

## Structure

- `Sources/App/` - app entry (`BeAIveApp`, forces light appearance) and `RootView`:
  mode -> (Clinic: clinician sign-in -> `PatientPickerView`) -> consent ->
  battery + session -> setup -> `BatteryView` -> `BatteryDoneView`
  (Patient: report-access token; Clinic: link the visit to the patient).
- `Sources/Assessment/` - `AssessmentBattery` (GET /assessment-battery),
  `ClipCapture` + `SidecarBuilder` (clip-capture sidecar), `GuidanceEngine`
  (level, framing, view and stillness rules, 1.5 s ready hold), `BatteryRunner`
  (guide -> record -> upload -> poll step status -> Looks good / Redo).
- `Sources/Capture/` - `ClipRecorder` (back wide 1x, 1080p30, stabilisation
  off, HEVC via AVAssetWriter, CMDeviceMotion gravity per frame, Vision every
  third frame), `CameraGravity` (device -> camera-frame gravity), small
  protocols (`ClipRecording`, `MotionSource`, `PoseDetecting`) so the logic is
  unit-tested without a camera.
- `Sources/Consent/`, `Sources/Identity/` - consent screen/client and the
  pseudonymous device id (random UUID in Keychain) - docs/adr/012.
- `Sources/Session/` - `BatteryView`, `GuidedCaptureView` (data-driven steps,
  no measured numbers), `CalibrationFlowView` (setup checklist),
  `PatientPickerView`, `BatteryDoneView`, `ModeChooserView`.
- `Sources/Networking/` - REST clients (`BatteryClient`, `ClipUploadClient`
  multipart PUT, `ClipUploadQueue` persisted retry queue in Application
  Support with complete file protection, `StepStatusClient`,
  `ReportAccessClient` + `ReportAccessStore` (Keychain), `PatientsClient`),
  `SessionWebSocketClient`, `SessionCredentials`, and hand-kept DTOs mirroring
  `packages/schemas` (docs/adr/004).
- `Sources/Safety/` - `SymptomStopButton` (local-first stop) and its client.
  The local stop must complete before any network call is awaited; it is on
  screen in every battery phase.
- `Sources/Overlay/` - `SkeletonOverlay`: the guidance pose as plain lines, no numbers.
- `Sources/Report/` - `AssessmentReportBody` (assessment-report DTO), the
  readout model and `AssessmentReportView` (tier chip, positions incl.
  indeterminate / no reference, Not measured with reasons, not-measurable
  list, clinician's assessment), `ResultsView` (Patient mode released reports).
- `Sources/DesignSystem/` - `Theme` (paper + ink, brand purple, serif display,
  monospaced measurements), `DraftBadge`.

## Known gaps

- Clip recording, motion and Vision need a physical device; on the Simulator
  the battery stops at "Camera not available". Their logic is covered by unit
  tests through the protocols above.
- M1 records timed holds only (the static battery); reps/passes steps arrive with M2.
- Session tokens last 4 h with no refresh (docs/adr/012); a queued clip whose
  token has expired is dropped, not kept.
