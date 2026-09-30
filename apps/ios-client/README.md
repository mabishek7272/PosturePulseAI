# apps/ios-client — PosturePulse AI

Native iOS (Swift/SwiftUI) capture + display front end. Per the product's
architecture decision, this app does **not** run pose/AI inference on-device
in this phase - it captures camera frames and streams them to backend-api,
which forwards them to ml-service (see root `README.md`).

## Build and run

Requires Xcode 26 on macOS and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
cd apps/ios-client
xcodegen generate            # after adding/removing files or packages
open PosturePulse.xcodeproj  # scheme "PosturePulse": the app + its unit tests
```

- `project.yml` defines the app target (`PosturePulse`, bundle id
  `com.amgi.posturepulse`, light appearance only) and `PosturePulseTests`.
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

Launch with `-designPreview report|report-movement|capture|reps|setup` to see
screens with sample data (e.g. Xcode scheme → Run → Arguments, or
`xcrun simctl launch <sim> com.amgi.posturepulse -designPreview report`).

### Brand assets

`AppResources/Assets.xcassets` holds the icon (mark only), the in-app logo and
the accent colour. Regenerate both images from a new logo file:

```bash
cd AppResources/Assets.xcassets
swift ../../scripts/make-brand-assets.swift <logo.png> AppIcon.appiconset BrandLogo.imageset
```

## Structure

- `Sources/App/` - app entry (`BeAIveApp`, forces light appearance) and `RootView`
  (consent -> protocol -> calibrate -> live session).
- `Sources/Consent/`, `Sources/Identity/` - consent screen/client and the
  pseudonymous device id (random UUID in Keychain) - docs/adr/012.
- `Sources/Capture/` - `CameraCaptureController` (AVFoundation), `FrameEncoder`.
- `Sources/Session/` - `SessionViewModel`, `CalibrationFlowView`,
  `ProtocolSelectionView`, `GuidedCaptureView` (guided scan chrome, spec §5).
- `Sources/Networking/` - REST clients, `SessionWebSocketClient`
  (socket.io-client-swift), `SessionCredentials`, and hand-kept DTOs mirroring
  `packages/schemas` (docs/adr/004).
- `Sources/Safety/` - `SymptomStopButton` (local-first stop) and its client.
  The local stop must complete before any network call is awaited.
- `Sources/Overlay/` - `PoseOverlayView`, which renders the quality-gate
  "unsupported" state distinctly and never fabricates guidance when suppressed.
- `Sources/Report/` - report model and readout UI (spec §7); not yet fed by a
  backend endpoint.
- `Sources/DesignSystem/` - `Theme` (paper + ink, brand purple, serif display,
  monospaced measurements), `DraftBadge`.

## Known gaps

- Guided capture and the report screen are UI only until pieces 2–5 of
  docs/superpowers/specs/2026-10-01-posture-report-design.md land.
- Session tokens last 4 h with no refresh (docs/adr/012).
- No ARKit anchoring or on-device pose estimation - both deferred.
