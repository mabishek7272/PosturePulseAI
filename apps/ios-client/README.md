# apps/ios-client

Native iOS (Swift/SwiftUI) capture + display front end. Per the product's
architecture decision, this app does **not** run pose/AI inference on-device
in this phase - it captures camera frames and streams them to backend-api,
which forwards them to ml-service (see root `README.md`).

## Build/run requirements

This code targets iOS/SwiftUI/AVFoundation and **requires Xcode on macOS** to
build, run, or test. It was authored in a Linux sandbox with no Swift
toolchain available (`swift`/`swiftc` not installed, and no path to install
one - `apt` has no `swift-lang` package on this distro, and swift.org's
download host is not reachable through this sandbox's network policy). This
means:

- The code has been carefully written and reviewed against the documented
  Foundation/UIKit/AVFoundation/SwiftUI APIs, but **has not been compiled or
  run** anywhere in this repository's history so far.
- `Tests/PoseLandmarkFrameDecodingTests.swift` exists to document the intended
  DTO-decoding contract but has not been executed. Run it via Xcode
  (`swift test` or the Test navigator) once this package is opened on macOS,
  and treat the first build as the real verification step for this app -
  don't assume it's bug-free just because it's checked in.

## Structure

- `Sources/App/` - app entry point (`BeAIveApp`) and root navigation (`RootView`).
- `Sources/Capture/` - `CameraCaptureController` (AVFoundation), `FrameEncoder`
  (JPEG encode/downsample for upload).
- `Sources/Session/` - `SessionViewModel` (orchestrates capture -> upload ->
  render), `CalibrationFlowView`, `ProtocolSelectionView`.
- `Sources/Networking/` - HTTP/WebSocket clients (`SessionsClient`,
  `ProtocolsClient`, `FrameStreamingClient`, `SessionWebSocketClient`) and
  hand-kept DTOs (`Networking/DTOs/`) mirroring `packages/schemas` - see
  `docs/adr/004-ios-dtos-hand-kept.md` for why these aren't codegenned yet.
- `Sources/Safety/` - `SymptomStopButton` (local-first stop action) and its
  networking client. The local stop must complete before any network call is
  awaited - see the doc comment on `SymptomStopButton`.
- `Sources/Overlay/` - `PoseOverlayView`, which renders the quality-gate
  "unsupported" state distinctly and never fabricates guidance when
  suppressed.
- `Sources/DesignSystem/` - `DraftBadge`, shown on every draft (unvalidated)
  protocol.

## Known gaps in this phase

- `SessionWebSocketClient` uses a raw `URLSessionWebSocketTask` against a
  plain WebSocket URL. The real backend gateway
  (`services/backend-api/src/ws/session.gateway.ts`) is Socket.IO
  (`@nestjs/platform-socket.io`), which uses its own handshake/framing on top
  of WebSocket - this client will **not** actually interoperate with it as
  written. A Socket.IO-compatible Swift client library is needed; this class
  documents the intended message shapes so that swap-in is mechanical.
- No ARKit anchoring, no on-device pose estimation - both deferred per the
  implementation plan.
- `subjectPseudoId`/`consentRecordId` in `RootView` are hardcoded placeholders;
  there is no real login or consent-collection flow yet
  (docs/consent-and-retention.md).
