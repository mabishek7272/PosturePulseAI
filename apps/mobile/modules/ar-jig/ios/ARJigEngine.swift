import ARKit
import AVFoundation
import RealityKit
import UIKit

/// ARKit + LiDAR capture with a metric floor template (the "AR jig").
///
/// The jig is an active spatial gatekeeper: an anchored 60 x 40 cm mat tells the
/// patient where to stand, and recording stays locked until camera level,
/// height, distance and foreground clearance all hold continuously for
/// `thresholds.stabilityHold`.
///
/// This type renders ONLY the camera feed and the 3D mat. It deliberately draws
/// no text and no HUD: every piece of user-facing copy lives in the React layer,
/// where `npm run lint:claims` can see it. Native strings would bypass that lint.
final class ARJigEngine: NSObject {

    // MARK: Configuration

    var thresholds: ARJigThresholds = .default
    /// Target clip length in seconds. Recording stops itself at this point.
    var clipSeconds: TimeInterval = 30
    /// The step's minimum acceptable frame rate. A clip that comes in under this
    /// is rejected locally rather than uploaded with a rate it never achieved.
    var minFps: Double = 24
    /// Encoded bit rate. Matches the Expo app's `TARGET_BIT_RATE` so AR clips are
    /// the same order of size as AVFoundation ones and stay inside the server's
    /// upload limit (nginx `client_max_body_size 100m`).
    var averageBitRate: Int = 6_000_000

    // MARK: Callbacks (always delivered on the main thread)

    var onGate: ((ARJigGateState) -> Void)?
    var onProgress: ((Double) -> Void)?
    var onRecorded: ((ARJigClip) -> Void)?
    var onError: ((ARJigCaptureError) -> Void)?

    private(set) var isRecording = false

    // MARK: AR

    private let arView = ARView(frame: .zero)
    private var matAnchor: AnchorEntity?
    /// World-space centre of the mat, cached so the per-frame maths never walks
    /// the entity graph.
    private var matWorldPosition: SIMD3<Float>?
    /// Y of the floor plane the mat sits on, for the camera-height gate.
    private var floorY: Float?
    private var isRunning = false

    // MARK: Gate

    private var stabilityAccumulated: TimeInterval = 0
    private var lastFrameTimestamp: TimeInterval?
    private var gateIsOpen = false
    private var lastGateEmit: TimeInterval = 0
    /// ARKit delivers up to 60 frames a second; forwarding every one to JS would
    /// swamp the bridge for no visual gain. The gate is published at ~12 Hz.
    private let gateEmitInterval: TimeInterval = 1.0 / 12.0

    // MARK: Recording

    /// Serialises all AVAssetWriter access. ARKit delivers frames on the main
    /// thread; encoding must not block it.
    private let writerQueue = DispatchQueue(label: "ai.beaive.arjig.writer")
    /// Written alongside the video for the duration of one clip (ADR-020). nil
    /// whenever the device has no LiDAR, or the writer could not be created -
    /// which is never fatal: the clip uploads without depth.
    private var depthWriter: ARJigDepthWriter?
    private var writer: AVAssetWriter?
    private var writerInput: AVAssetWriterInput?
    private var pixelAdaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var outputURL: URL?
    private var recordingStartedAt: TimeInterval?
    private var recordedAtWallClock = Date()
    private var encodedSize: CGSize = .zero
    private var intrinsics: (fx: Double, fy: Double, cx: Double, cy: Double)?
    /// Frames dropped because their gravity could not be certified.
    private var skippedFrames = 0

    /// One entry per SUCCESSFULLY ENCODED frame, in order — the schema requires
    /// the sidecar and the video to agree frame for frame.
    ///
    /// OWNED BY `writerQueue`. The index MUST come from the serial queue that
    /// does the appending: deriving it on the main thread would hand the same
    /// index to two frames dispatched back to back, so one entry would be dropped
    /// and the sidecar would end up shorter than the video — which the server
    /// rejects as a frame-count mismatch.
    private var sidecarFrames: [ARJigClip.Frame] = []
    private var firstEncodedTimestamp: TimeInterval?
    /// Set on `writerQueue` to refuse further frames once a stop is underway.
    private var encodingStopped = false

    // MARK: - Lifecycle

    override init() {
        super.init()
        arView.cameraMode = .ar
        // Critical: ARView would otherwise replace our configuration with its own
        // default (no scene reconstruction, no depth semantics) on every
        // `session.run`, silently dropping LiDAR.
        arView.automaticallyConfigureSession = false
        arView.renderOptions.insert(.disableMotionBlur)
        arView.session.delegate = self

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        arView.addGestureRecognizer(tap)
    }

    deinit {
        // If we are torn down mid-recording the file on disk is incomplete and
        // unusable, so it must not survive. The depth track goes with it: a
        // partial depth recording of the person must never outlive the video.
        if let url = outputURL { try? FileManager.default.removeItem(at: url) }
        depthWriter?.cancel()
    }

    /// Adds the AR view to the Expo view and keeps it filling it.
    func attach(to container: UIView) {
        arView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(arView)
        NSLayoutConstraint.activate([
            arView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            arView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            arView.topAnchor.constraint(equalTo: container.topAnchor),
            arView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
    }

    static var isSupported: Bool { ARWorldTrackingConfiguration.isSupported }
    static var hasLiDAR: Bool { ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) }

    // MARK: - Session

    func start() {
        guard ARWorldTrackingConfiguration.isSupported else {
            onError?(.unsupportedDevice)
            return
        }
        guard !isRunning else { return }
        isRunning = true

        let config = ARWorldTrackingConfiguration()
        // World +Y is true up. This is what makes gravity derivable from the
        // camera transform (see ARJigGravity).
        config.worldAlignment = .gravity
        config.planeDetection = [.horizontal]
        config.environmentTexturing = .none
        config.isLightEstimationEnabled = false

        // LiDAR mesh: finds the floor in a second or two even on the glossy,
        // textureless vinyl a clinic floor usually is, where plain feature-point
        // plane detection can stall indefinitely. Guarded because the property
        // traps on a device without the sensor.
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            config.sceneReconstruction = .mesh
        }

        // Prefer temporally smoothed depth; fall back to raw; otherwise run
        // without depth and report the foreground reading as unavailable rather
        // than invent a clearance figure.
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.smoothedSceneDepth) {
            config.frameSemantics.insert(.smoothedSceneDepth)
        } else if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            config.frameSemantics.insert(.sceneDepth)
        }

        // Highest-resolution format available, so the clip carries as much pixel
        // detail to the server-side pose model as the device can give.
        if let best = ARWorldTrackingConfiguration.supportedVideoFormats
            .max(by: { $0.imageResolution.width * $0.imageResolution.height
                     < $1.imageResolution.width * $1.imageResolution.height }) {
            config.videoFormat = best
        }

        arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    }

    func pause() {
        guard isRunning else { return }
        isRunning = false
        halt()
        arView.session.pause()
    }

    // MARK: - Mat placement

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        // Lets the operator put the mat on the exact spot the patient should
        // stand. Locked out while recording.
        guard !isRecording else { return }
        let point = gesture.location(in: arView)
        guard let result = arView.raycast(from: point,
                                          allowing: .estimatedPlane,
                                          alignment: .horizontal).first else { return }
        placeMat(atWorldTransform: result.worldTransform)
    }

    /// Places the mat straight ahead at the ideal distance. Exposed to JS so the
    /// React layer can offer a "place the mat" button instead of relying on a tap.
    func placeMatAhead() {
        guard let frame = arView.session.currentFrame else { return }
        placeMatAutomatically(using: frame, force: true)
    }

    func clearMat() {
        matAnchor?.removeFromParent()
        matAnchor = nil
        matWorldPosition = nil
        floorY = nil
        stabilityAccumulated = 0
    }

    /// Auto-places the mat on the first plausible floor plane, so the operator
    /// usually does not have to tap at all.
    private func placeMatAutomatically(using frame: ARFrame, force: Bool = false) {
        guard force || matAnchor == nil else { return }
        let cameraY = frame.camera.transform.columns.3.y

        let candidates = frame.anchors
            .compactMap { $0 as? ARPlaneAnchor }
            .filter { $0.alignment == .horizontal }
            // A floor is below the camera by roughly a standing hold height. This
            // rejects tables, beds and the ceiling.
            .filter { plane in
                let drop = Double(cameraY - plane.transform.columns.3.y)
                return drop > 0.5 && drop < 2.2
            }

        guard let floor = candidates.max(by: {
            $0.planeExtent.width * $0.planeExtent.height < $1.planeExtent.width * $1.planeExtent.height
        }) else { return }

        // Put the mat at the ideal distance straight ahead, dropped onto the floor
        // plane, rather than at the plane's centre (which may be metres off to one
        // side).
        let forward = -simd_make_float3(frame.camera.transform.columns.2)
        let flat = SIMD3<Float>(forward.x, 0, forward.z)
        guard simd_length(flat) > 1e-4 else { return }
        let camPos = simd_make_float3(frame.camera.transform.columns.3)
        let target = camPos + simd_normalize(flat) * Float(thresholds.idealDistance)

        var placement = matrix_identity_float4x4
        placement.columns.3 = SIMD4<Float>(target.x, floor.transform.columns.3.y, target.z, 1)
        placeMat(atWorldTransform: placement)
    }

    private func placeMat(atWorldTransform transform: simd_float4x4) {
        matAnchor?.removeFromParent()

        let position = simd_make_float3(transform.columns.3)
        let anchor = AnchorEntity(world: transform)
        anchor.addChild(makeJigEntity(facing: position))
        arView.scene.addAnchor(anchor)

        matAnchor = anchor
        matWorldPosition = position
        floorY = position.y
        // Repositioning invalidates any accumulated stability.
        stabilityAccumulated = 0
    }

    /// The metric floor template: a translucent 60 x 40 cm mat, two heel pads
    /// 10 cm apart, and a sagittal midline. No text — copy belongs in React.
    private func makeJigEntity(facing matPosition: SIMD3<Float>) -> Entity {
        let root = Entity()

        // Yaw the jig so its front edge faces the camera.
        if let camera = arView.session.currentFrame?.camera {
            let camPos = simd_make_float3(camera.transform.columns.3)
            let toCamera = camPos - matPosition
            if simd_length(SIMD3<Float>(toCamera.x, 0, toCamera.z)) > 1e-4 {
                root.orientation = simd_quatf(angle: atan2(toCamera.x, toCamera.z), axis: [0, 1, 0])
            }
        }

        let matWidth: Float = 0.60   // local X
        let matDepth: Float = 0.40   // local Z

        // Lifted 5 mm so it does not z-fight with the LiDAR floor mesh.
        let mat = ModelEntity(
            mesh: .generatePlane(width: matWidth, depth: matDepth, cornerRadius: 0.02),
            materials: [UnlitMaterial(color: UIColor.cyan.withAlphaComponent(0.4))]
        )
        mat.position.y = 0.005
        root.addChild(mat)

        // Heel pads, centres 10 cm apart, set toward the back half of the mat so
        // the patient's feet land inside the template rather than straddling it.
        for x in [Float(-0.05), Float(0.05)] {
            let pad = ModelEntity(
                mesh: .generateBox(size: [0.09, 0.004, 0.06], cornerRadius: 0.004),
                materials: [UnlitMaterial(color: UIColor.cyan.withAlphaComponent(0.85))]
            )
            pad.position = [x, 0.008, -0.06]
            root.addChild(pad)
        }

        // Sagittal midline, so a lateral-view step has a reference to stand on.
        let line = ModelEntity(
            mesh: .generateBox(size: [0.004, 0.003, matDepth], cornerRadius: 0.001),
            materials: [UnlitMaterial(color: UIColor.white.withAlphaComponent(0.7))]
        )
        line.position.y = 0.007
        root.addChild(line)

        // A single marker at the front edge gives the mat an unambiguous facing
        // without rendering any words.
        let frontMarker = ModelEntity(
            mesh: .generateBox(size: [0.12, 0.004, 0.02], cornerRadius: 0.002),
            materials: [UnlitMaterial(color: UIColor.white.withAlphaComponent(0.9))]
        )
        frontMarker.position = [0, 0.008, matDepth / 2 - 0.02]
        root.addChild(frontMarker)

        return root
    }

    // MARK: - Per-frame gate

    /// Nearest surface and foreground-clutter fraction in the central band of the
    /// depth map, or nil when the device gives no depth this frame.
    private func sampleForeground(_ frame: ARFrame) -> (nearest: Double, closeFraction: Double)? {
        guard let depth = frame.smoothedSceneDepth ?? frame.sceneDepth else { return nil }
        let map = depth.depthMap
        guard CVPixelBufferGetPixelFormatType(map) == kCVPixelFormatType_DepthFloat32 else { return nil }

        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(map) else { return nil }

        let width = CVPixelBufferGetWidth(map)
        let height = CVPixelBufferGetHeight(map)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(map)
        guard width > 0, height > 0 else { return nil }

        // Central vertical band: where a standing subject is, excluding the floor
        // immediately under the lens and the ceiling.
        let xStart = Int(Double(width) * 0.35)
        let xEnd = Int(Double(width) * 0.65)
        let yStart = Int(Double(height) * 0.20)
        let yEnd = Int(Double(height) * 0.90)
        let step = 4   // every 4th pixel: ~1/16 the work, same answer

        var nearest = Double.greatestFiniteMagnitude
        var total = 0
        var close = 0

        for y in stride(from: yStart, to: yEnd, by: step) {
            let row = base.advanced(by: y * bytesPerRow).assumingMemoryBound(to: Float32.self)
            for x in stride(from: xStart, to: xEnd, by: step) {
                let d = Double(row[x])
                // LiDAR returns 0 for "no return" and is unreliable past ~5 m.
                guard d.isFinite, d > 0.3, d < 6.0 else { continue }
                total += 1
                nearest = min(nearest, d)
                if d < thresholds.minSubjectClearance { close += 1 }
            }
        }

        guard total > 0 else { return nil }
        return (nearest, Double(close) / Double(total))
    }

    /// Evaluates every gate condition. Blockers come back in priority order.
    private func evaluate(_ frame: ARFrame) -> ARJigGateState {
        var state = ARJigGateState()
        state.blockers = []
        state.matPlaced = matWorldPosition != nil

        switch frame.camera.trackingState {
        case .notAvailable:
            state.blockers.append(.trackingUnavailable)
        case .limited(let reason):
            let why: String
            switch reason {
            case .initializing: why = "initializing"
            case .excessiveMotion: why = "excessive_motion"
            case .insufficientFeatures: why = "insufficient_features"
            case .relocalizing: why = "relocalizing"
            @unknown default: why = "unstable"
            }
            state.blockers.append(.trackingLimited(why))
        case .normal:
            break
        }

        guard let gravity = ARJigGravity.cameraFrame(cameraTransform: frame.camera.transform) else {
            state.blockers.append(.trackingUnavailable)
            return state
        }
        let pitch = ARJigMath.pitchDegrees(gravity)   // 0 = optical axis level
        let roll = ARJigMath.rollDegrees(gravity)
        state.pitchDegrees = pitch
        state.rollDegrees = roll

        if pitch > thresholds.maxPitchDegrees || abs(roll) > thresholds.maxRollDegrees {
            state.blockers.append(.cameraNotLevel(pitch: pitch, roll: roll))
        }

        guard let matPosition = matWorldPosition, let floorY else {
            state.blockers.append(.noFloorPlane)
            return state
        }

        let camPos = simd_make_float3(frame.camera.transform.columns.3)
        let height = Double(camPos.y - floorY)
        state.cameraHeight = height
        if height < thresholds.minCameraHeight { state.blockers.append(.cameraTooLow(height)) }
        if height > thresholds.maxCameraHeight { state.blockers.append(.cameraTooHigh(height)) }

        let distance = Double(simd_distance(camPos, matPosition))
        state.distance = distance
        if distance < thresholds.minDistance { state.blockers.append(.tooClose(distance)) }
        if distance > thresholds.maxDistance { state.blockers.append(.tooFar(distance)) }

        if let foreground = sampleForeground(frame) {
            state.nearestSurface = foreground.nearest
            if foreground.closeFraction > thresholds.maxForegroundFraction {
                state.blockers.append(.foregroundObstruction(nearest: foreground.nearest))
            }
        }
        // No depth this frame leaves `nearestSurface` nil: reported honestly
        // rather than pretending the foreground is clear.

        return state
    }

    private func updateGate(with frame: ARFrame) {
        var state = evaluate(frame)

        let dt = lastFrameTimestamp.map { max(0, frame.timestamp - $0) } ?? 0
        lastFrameTimestamp = frame.timestamp

        if state.blockers.isEmpty {
            stabilityAccumulated = min(thresholds.stabilityHold, stabilityAccumulated + dt)
        } else {
            stabilityAccumulated = 0
        }
        state.stabilityProgress = thresholds.stabilityHold > 0
            ? stabilityAccumulated / thresholds.stabilityHold
            : 1
        state.isOpen = state.blockers.isEmpty && stabilityAccumulated >= thresholds.stabilityHold
        state.isRecording = isRecording
        state.skippedFrames = skippedFrames

        // Capture the previous value BEFORE updating it, or the transition test
        // below compares the new value against itself and never fires.
        let wasOpen = gateIsOpen
        gateIsOpen = state.isOpen

        // Throttle to spare the bridge, but never swallow the open/closed
        // transition — that one drives the record button.
        let opened = state.isOpen != wasOpen
        if opened || frame.timestamp - lastGateEmit >= gateEmitInterval {
            lastGateEmit = frame.timestamp
            onGate?(state)
        }
    }

    // MARK: - Recording

    func startRecording() {
        guard !isRecording else { return }
        guard gateIsOpen else {
            onError?(.gateClosed)
            return
        }
        guard let currentFrame = arView.session.currentFrame else {
            onError?(.sessionNotReady)
            return
        }

        let pixelBuffer = currentFrame.capturedImage
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        guard width > 0, height > 0 else {
            onError?(.sessionNotReady)
            return
        }
        encodedSize = CGSize(width: width, height: height)

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("arjig-\(UUID().uuidString).mov")
        try? FileManager.default.removeItem(at: url)

        do {
            // `.mov` + HEVC matches the Expo app's existing recorder, so the server
            // decodes AR clips through exactly the same path.
            let assetWriter = try AVAssetWriter(outputURL: url, fileType: .mov)
            let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.hevc,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: averageBitRate,
                ],
            ])
            input.expectsMediaDataInRealTime = true
            // No transform: we encode `capturedImage` exactly as ARKit hands it
            // over, so the frames carry no rotation metadata and the sidecar's
            // camera frame is the native sensor frame.
            input.transform = .identity

            let adaptor = AVAssetWriterInputPixelBufferAdaptor(
                assetWriterInput: input,
                sourcePixelBufferAttributes: [
                    kCVPixelBufferPixelFormatTypeKey as String: CVPixelBufferGetPixelFormatType(pixelBuffer),
                    kCVPixelBufferWidthKey as String: width,
                    kCVPixelBufferHeightKey as String: height,
                ]
            )

            guard assetWriter.canAdd(input) else { throw ARJigCaptureError.writerFailed }
            assetWriter.add(input)
            guard assetWriter.startWriting() else { throw ARJigCaptureError.writerFailed }
            assetWriter.startSession(
                atSourceTime: CMTime(seconds: currentFrame.timestamp, preferredTimescale: 1_000_000))

            writer = assetWriter
            writerInput = input
            pixelAdaptor = adaptor
        } catch {
            try? FileManager.default.removeItem(at: url)
            onError?(.writerFailed)
            return
        }

        // True pinhole intrinsics for the encoded buffer, which the AVFoundation
        // path cannot supply (it sends `intrinsics: null`). Rescaled if the buffer
        // differs from the resolution ARKit reports for the format.
        let k = currentFrame.camera.intrinsics
        let reported = currentFrame.camera.imageResolution
        if reported.width > 0, reported.height > 0 {
            let sx = Double(width) / Double(reported.width)
            let sy = Double(height) / Double(reported.height)
            intrinsics = (
                fx: Double(k.columns.0.x) * sx,
                fy: Double(k.columns.1.y) * sy,
                cx: Double(k.columns.2.x) * sx,
                cy: Double(k.columns.2.y) * sy
            )
        } else {
            intrinsics = nil
        }

        // Created only after the video writer is known good, and sharing the
        // video's start timestamp so depth times are on the video's clock.
        // A failure here is deliberately swallowed: depth is additive, and
        // losing a clinical capture because an optional depth track could
        // not be opened would be the wrong trade.
        if ARJigEngine.hasLiDAR {
            depthWriter = try? ARJigDepthWriter()
        } else {
            depthWriter = nil
        }

        outputURL = url
        recordingStartedAt = currentFrame.timestamp
        recordedAtWallClock = Date()
        skippedFrames = 0
        // Safe from the main thread: `writerQueue` never blocks on main.
        writerQueue.sync {
            sidecarFrames = []
            firstEncodedTimestamp = nil
            encodingStopped = false
        }
        isRecording = true
    }

    /// Operator-initiated stop: keeps whatever is in the can.
    func stopRecording() {
        guard isRecording else { return }
        finish(reason: .operatorStopped)
    }

    /// Local, synchronous abandon — the ADR-005 safety stop (symptom report or
    /// contraindication) and teardown both use this. No network I/O; the partial
    /// file is deleted. Safety outranks capture progress, always.
    func halt() {
        guard isRecording else {
            if let url = outputURL { try? FileManager.default.removeItem(at: url) }
            depthWriter?.cancel()
            depthWriter = nil
            outputURL = nil
            return
        }
        finish(reason: .failed(.halted))
    }

    private enum StopReason { case completed, operatorStopped, failed(ARJigCaptureError) }

    private func append(_ frame: ARFrame) {
        guard isRecording,
              let adaptor = pixelAdaptor,
              let input = writerInput,
              let startedAt = recordingStartedAt else { return }

        // Gravity must exist for every encoded frame — the schema requires it and
        // CLAUDE.md rule 3 forbids substituting a placeholder.
        //
        // Without world tracking the transform is meaningless, so the gravity it
        // yields would be confidently WRONG rather than obviously missing: the
        // server would trust it and silently mis-measure. Such a frame is SKIPPED
        // — not encoded, no sidecar entry — so video and sidecar stay in step and
        // the clip simply ends up with fewer frames. The honest frame rate
        // computed at finish then fails `minFps` if too many were lost, which is
        // exactly the server-side gate decision we want.
        guard frame.camera.trackingState != .notAvailable,
              let gravity = ARJigGravity.cameraFrame(cameraTransform: frame.camera.transform) else {
            skippedFrames += 1
            return
        }

        // Offered only AFTER the gravity guard, so the depth writer never sees a
        // frame the video writer is not also encoding. That keeps the depth
        // track's clock inside the video's: its first frame cannot predate the
        // video's first encoded frame except when a video append itself fails,
        // which `finish(firstEncodedTimestamp:)` handles.
        //
        // Called on the delegate thread because the depth planes must be copied
        // out of ARKit's pixel buffers before this frame is released; the writer
        // does its compression and file I/O on its own queue.
        depthWriter?.append(frame)

        let timestamp = frame.timestamp
        let buffer = frame.capturedImage
        let duration = clipSeconds

        // Hold the buffer only as long as the append takes. ARKit's buffer pool is
        // small; retaining frames would stall the session.
        writerQueue.async { [weak self] in
            guard let self, !self.encodingStopped, input.isReadyForMoreMediaData else { return }
            let time = CMTime(seconds: timestamp, preferredTimescale: 1_000_000)
            guard adaptor.append(buffer, withPresentationTime: time) else { return }

            // Only now does a sidecar entry exist, and its index comes from this
            // serial queue, so sidecar order always matches encoded frame order.
            let base = self.firstEncodedTimestamp ?? timestamp
            if self.firstEncodedTimestamp == nil { self.firstEncodedTimestamp = base }
            self.sidecarFrames.append(ARJigClip.Frame(
                index: self.sidecarFrames.count,
                t: max(0, timestamp - base),
                gravity: gravity
            ))

            let elapsed = timestamp - startedAt
            let progress = duration > 0 ? min(1, max(0, elapsed / duration)) : 1
            let reachedEnd = elapsed >= duration
            DispatchQueue.main.async {
                guard self.isRecording else { return }
                self.onProgress?(progress)
                if reachedEnd { self.finish(reason: .completed) }
            }
        }
    }

    private func finish(reason: StopReason) {
        guard isRecording else { return }
        isRecording = false

        guard let assetWriter = writer, let input = writerInput else {
            if let url = outputURL { try? FileManager.default.removeItem(at: url) }
            depthWriter?.cancel()
            depthWriter = nil
            outputURL = nil
            return
        }

        let url = outputURL
        let size = encodedSize
        let recordedAt = recordedAtWallClock
        let requiredFps = minFps
        let capturedIntrinsics = intrinsics
        let skipped = skippedFrames
        let depth = depthWriter
        depthWriter = nil

        writer = nil
        writerInput = nil
        pixelAdaptor = nil
        recordingStartedAt = nil

        // Tear down ON the writer queue so it is ordered behind every append
        // already in flight. Calling `markAsFinished()` from the main thread while
        // an append is mid-flight is a hard crash in AVAssetWriter.
        writerQueue.async { [weak self] in
            guard let self else { return }
            self.encodingStopped = true
            let frames = self.sidecarFrames
            // Read on the writer queue, where it is written, and rebased onto
            // the origin the sidecar's own frame times use.
            let encodedOrigin = self.firstEncodedTimestamp
            input.markAsFinished()

            switch reason {
            case .completed, .operatorStopped:
                assetWriter.finishWriting {
                    DispatchQueue.main.async {
                        guard assetWriter.status == .completed, let url else {
                            if let url { try? FileManager.default.removeItem(at: url) }
                            depth?.cancel()
                            self.outputURL = nil
                            self.onError?(.writerFailed)
                            return
                        }
                        // Honest frame rate: derived from the frames actually
                        // encoded, never from the format we asked the camera for, so
                        // a dropped-frame clip fails here instead of being uploaded
                        // with a rate it never achieved.
                        let span = frames.last?.t ?? 0
                        let fps = (frames.count > 1 && span > 0)
                            ? Double(frames.count - 1) / span
                            : 0
                        guard frames.count > 1, fps >= requiredFps else {
                            try? FileManager.default.removeItem(at: url)
                            depth?.cancel()
                            self.outputURL = nil
                            self.onError?(.insufficientFrameRate)
                            return
                        }

                        // nil whenever there is no LiDAR, the writer failed, or
                        // nothing survives the rebase. The clip then uploads
                        // without a depth block, which is supported end to end.
                        let depthDescriptor = encodedOrigin.flatMap { origin in
                            depth?.finish(firstEncodedTimestamp: origin)
                        }
                        if encodedOrigin == nil { depth?.cancel() }

                        let clip = ARJigClip(
                            fileURL: url,
                            frames: frames,
                            width: Int(size.width),
                            height: Int(size.height),
                            nominalFps: fps,
                            recordedAt: recordedAt,
                            intrinsics: capturedIntrinsics,
                            skippedFrames: skipped,
                            depth: depthDescriptor.map {
                                ARJigClip.Depth(
                                    fileURL: $0.fileURL,
                                    width: $0.width,
                                    height: $0.height,
                                    frameCount: $0.frameCount,
                                    sha256: $0.sha256,
                                    hasConfidence: $0.hasConfidence,
                                    nominalFps: $0.nominalFps,
                                    times: $0.times
                                )
                            }
                        )
                        // Ownership of the file passes to JS here. Clearing
                        // `outputURL` stops a later `halt()` or `deinit` deleting a
                        // clip that has already been handed over for upload.
                        self.outputURL = nil
                        self.onRecorded?(clip)
                    }
                }

            case .failed(let error):
                assetWriter.cancelWriting()
                // The safety stop (ADR-005) and every hard failure abandon the
                // depth track with the video: a depth recording of the person
                // must never survive a take whose video was discarded.
                depth?.cancel()
                DispatchQueue.main.async {
                    if let url { try? FileManager.default.removeItem(at: url) }
                    self.outputURL = nil
                    self.onError?(error)
                }
            }
        }
    }
}

// MARK: - ARSessionDelegate

extension ARJigEngine: ARSessionDelegate {

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        placeMatAutomatically(using: frame)
        updateGate(with: frame)

        guard isRecording else { return }

        // RECORDING POLICY: a gate break mid-take does NOT abort the clip. A
        // micro-sway at second 25 of 30 would otherwise destroy a good take, and
        // the server's quality gate already returns precise reason codes
        // (`camera_not_level`, `insufficient_frames`, `subject_moving`, ...) for
        // the cases that matter. The gate keeps publishing to JS so the operator
        // can correct mid-take.
        //
        // The one thing we will NOT do is write a frame we cannot certify, so
        // `append` skips any frame whose gravity is untrustworthy rather than
        // guessing. The ADR-005 safety stop is `halt()`, not geometry.
        append(frame)
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        if isRecording { finish(reason: .failed(.halted)) }
        onError?(.unsupportedDevice)
    }

    func sessionWasInterrupted(_ session: ARSession) {
        // A phone call or backgrounding mid-clip: the capture is void.
        if isRecording { finish(reason: .failed(.halted)) }
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        // World tracking restarted, so the old mat anchor is no longer trustworthy.
        clearMat()
        isRunning = false
        start()
    }
}
