# apps/ios-client — PosturePulse

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

`AppResources/Assets.xcassets` holds the icon (mark only, opaque 1024 px), the in-app logo and the accent colour; the
source logo is `brand/posturepulse-logo-source.png`. The in-app logo is an opaque image drawn with the `multiply` blend
so its white background disappears into the paper. Regenerate both from a new logo (crop rectangles are
`x,y,width,height` in source pixels: the mark alone for the icon, the full lockup for the logo):

```bash
cd apps/ios-client
swift scripts/make-brand-assets.swift brand/posturepulse-logo-source.png \
  AppResources/Assets.xcassets/AppIcon.appiconset AppResources/Assets.xcassets/BrandLogo.imageset \
  102,198,1650,1650 40,180,1840,2030
```

### Device access and the device check

The only permission the app requests is **Camera** (`NSCameraUsageDescription`). Everything else in the device check
(`Sources/Device/`) is either part of the camera or handled in the app:

* **Flashlight** - part of the camera, no separate permission. A light switch appears while recording (off by default,
  turned off when leaving the screen).
* **Infrared / depth sensor** (TrueDepth, LiDAR) - no separate permission and no API to switch it; this version does
  not use it. The check only reports whether the device has one.
* **Battery** - iOS has no per-app "battery optimisation" setting. The app keeps the screen from auto-locking while a
  clip is recorded (`ScreenAwake`) and warns when Low Power Mode is on (it can lower the camera frame rate) or the
  device is hot, with a button to Settings.
* Not requested because not needed: microphone (clips are video only), motion (device gravity needs no permission),
  photos, location, notifications.

