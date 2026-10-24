import AVFoundation
import CoreGraphics
import Foundation

/// Records battery clips (ADR-013): back wide camera at 1x, 1080p at 30 fps,
/// video stabilisation off, frames rotated upright to portrait, HEVC through
/// AVAssetWriter, and one sidecar entry {index, t, gravity} per encoded frame
/// from CMDeviceMotion. Every third frame also goes to on-device pose
/// detection for guidance. Needs a real device; the logic it feeds
/// (SidecarBuilder, CameraGravity, GuidanceEngine) is unit-tested.
/// Mutable recording state is confined to captureQueue; callbacks hop to main.
final class ClipRecorder: NSObject, ClipRecording, @unchecked Sendable {
    var onGuidanceSample: ((GuidanceSample) -> Void)?
    var onRecordingProgress: ((Double) -> Void)?
    private(set) var imageSize = CGSize(width: 1080, height: 1920)

    let session = AVCaptureSession()
    private let output = AVCaptureVideoDataOutput()
    private let depthOutput = AVCaptureDepthDataOutput()
    private let sessionQueue = DispatchQueue(label: "com.beaive.clip.session")
    private let captureQueue = DispatchQueue(label: "com.beaive.clip.capture")
    private let visionQueue = DispatchQueue(label: "com.beaive.clip.vision")
    private let depthQueue = DispatchQueue(label: "com.beaive.clip.depth")
    private let motion: MotionSource
    private let poseDetector: PoseDetecting
    private let orientation: ClipOrientation = .portrait
    private let targetFps: Double = 30
    private var configured = false

    // Owned by captureQueue.
    private var frameIndex = 0
    private var visionBusy = false
    private var recording: Recording?
    /// Smoothed by taking the latest sample only. Written on captureQueue (the
    /// depth delegate callback hops from depthQueue to captureQueue to write
    /// it); also read on captureQueue to keep all access confined there per
    /// this class's threading discipline.
    private var latestDistanceMeters: Double?

    private final class Recording {
        let writer: AVAssetWriter
        let input: AVAssetWriterInput
        let url: URL
        let duration: TimeInterval
        let minFps: Double
        let continuation: CheckedContinuation<RecordedClip, Error>
        var sidecar: SidecarBuilder
        var startTime: CMTime?
        var recordedAt = Date()
        var size = CGSize.zero
        var finished = false

        init(writer: AVAssetWriter, input: AVAssetWriterInput, url: URL, duration: TimeInterval, minFps: Double,
             orientation: ClipOrientation, continuation: CheckedContinuation<RecordedClip, Error>) {
            self.writer = writer
            self.input = input
            self.url = url
            self.duration = duration
            self.minFps = minFps
            self.sidecar = SidecarBuilder(orientation: orientation)
            self.continuation = continuation
        }
    }

    init(motion: MotionSource = CoreMotionSource(), poseDetector: PoseDetecting = VisionPoseDetector()) {
        self.motion = motion
        self.poseDetector = poseDetector
        super.init()
    }

    // MARK: - Configuration

    func startPreview() throws {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .denied, .restricted:
            throw ClipRecorderError.cameraUnavailable
        default:
            break
        }
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            throw ClipRecorderError.cameraUnavailable
        }
        if !configured {
            try configure(device)
            configured = true
        }
        motion.start()
        let session = self.session
        AVCaptureDevice.requestAccess(for: .video) { [sessionQueue] granted in
            guard granted else { return }
            sessionQueue.async { if !session.isRunning { session.startRunning() } }
        }
    }

    private func configure(_ device: AVCaptureDevice) throws {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .inputPriority

        guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
            throw ClipRecorderError.cameraUnavailable
        }
        session.addInput(input)

        // A 1920x1080 format that reaches 30 fps; frame duration locked to 1/30 s.
        let format = device.formats.first { format in
            let d = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            return d.width == 1920 && d.height == 1080
                && format.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= targetFps && $0.minFrameRate <= targetFps }
        }
        try device.lockForConfiguration()
        if let format { device.activeFormat = format }
        let frameDuration = CMTime(value: 1, timescale: CMTimeScale(targetFps))
        device.activeVideoMinFrameDuration = frameDuration
        device.activeVideoMaxFrameDuration = frameDuration
        if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
        device.unlockForConfiguration()

        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: captureQueue)
        guard session.canAddOutput(output) else { throw ClipRecorderError.cameraUnavailable }
        session.addOutput(output)

        if let connection = output.connection(with: .video) {
            if connection.isVideoStabilizationSupported { connection.preferredVideoStabilizationMode = .off }
            if #available(iOS 17.0, *) {
                if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
            } else if connection.isVideoOrientationSupported {
                connection.videoOrientation = .portrait
            }
        }

        // LiDAR depth, best-effort: only on Pro-model devices that have it. Every
        // step is guarded so a failure here never affects the video/recording path
        // already configured above.
        if let depthDevice = AVCaptureDevice.default(.builtInLiDARDepthCamera, for: .depthData, position: .back),
           let depthInput = try? AVCaptureDeviceInput(device: depthDevice),
           session.canAddInput(depthInput), session.canAddOutput(depthOutput) {
            session.addInput(depthInput)
            session.addOutput(depthOutput)
            depthOutput.isFilteringEnabled = true
            depthOutput.setDelegate(self, callbackQueue: depthQueue)
        }
    }

    // MARK: - Recording

    func record(duration: TimeInterval, minFps: Double) async throws -> RecordedClip {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("clip-\(UUID().uuidString).mov")
        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        let size = imageSize
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.hevc,
            AVVideoWidthKey: Int(size.width),
            AVVideoHeightKey: Int(size.height),
        ])
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw ClipRecorderError.writerFailed }
        writer.add(input)

        return try await withCheckedThrowingContinuation { continuation in
            captureQueue.async { [self] in
                if let previous = recording {
                    cancel(previous, error: ClipRecorderError.halted)
                }
                recording = Recording(writer: writer, input: input, url: url, duration: duration, minFps: minFps,
                                      orientation: orientation, continuation: continuation)
            }
        }
    }

    /// captureQueue only.
    private func append(_ sampleBuffer: CMSampleBuffer, deviceGravity: [Double]?, to rec: Recording) {
        guard !rec.finished else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        guard let gravity = deviceGravity, CameraGravity.normalised(gravity) != nil else {
            // No motion reading for this frame: stop rather than invent one.
            cancel(rec, error: ClipRecorderError.motionUnavailable)
            return
        }
        if rec.startTime == nil {
            guard rec.writer.startWriting() else {
                cancel(rec, error: ClipRecorderError.writerFailed)
                return
            }
            rec.writer.startSession(atSourceTime: pts)
            rec.startTime = pts
            rec.recordedAt = Date()
            if let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) {
                rec.size = CGSize(width: CVPixelBufferGetWidth(pixels), height: CVPixelBufferGetHeight(pixels))
            }
        }
        // Frames the encoder cannot take are dropped from both the clip and the sidecar.
        guard rec.input.isReadyForMoreMediaData, rec.input.append(sampleBuffer) else { return }
        rec.sidecar.append(presentationTime: pts.seconds, deviceGravity: gravity)

        let elapsed = (pts - (rec.startTime ?? pts)).seconds
        let progress = min(elapsed / max(rec.duration, 0.001), 1)
        DispatchQueue.main.async { [weak self] in self?.onRecordingProgress?(progress) }
        if elapsed >= rec.duration { finish(rec) }
    }

    private func finish(_ rec: Recording) {
        rec.finished = true
        recording = nil
        rec.input.markAsFinished()
        let orientationSize = rec.size == .zero ? imageSize : rec.size
        rec.writer.finishWriting { [rec] in
            guard rec.writer.status == .completed else {
                try? FileManager.default.removeItem(at: rec.url)
                rec.continuation.resume(throwing: ClipRecorderError.writerFailed)
                return
            }
            let frames = rec.sidecar.frames
            let measuredFps = frames.count > 1 ? Double(frames.count - 1) / max(rec.sidecar.duration, 0.001) : 0
            guard measuredFps >= rec.minFps else {
                try? FileManager.default.removeItem(at: rec.url)
                rec.continuation.resume(throwing: ClipRecorderError.insufficientFrameRate)
                return
            }
            rec.continuation.resume(returning: RecordedClip(
                fileURL: rec.url,
                frames: frames,
                width: Int(orientationSize.width),
                height: Int(orientationSize.height),
                nominalFps: self.targetFps,
                recordedAt: rec.recordedAt,
                lens: .backWide
            ))
        }
    }

    private func cancel(_ rec: Recording, error: Error) {
        guard !rec.finished else { return }
        rec.finished = true
        if recording === rec { recording = nil }
        if rec.writer.status == .writing { rec.writer.cancelWriting() }
        try? FileManager.default.removeItem(at: rec.url)
        rec.continuation.resume(throwing: error)
    }

    func halt() {
        motion.stop()
        captureQueue.async { [self] in
            if let rec = recording { cancel(rec, error: ClipRecorderError.halted) }
        }
        let session = self.session
        sessionQueue.async { if session.isRunning { session.stopRunning() } }
    }
}

extension ClipRecorder: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let deviceGravity = motion.latestGravity
        if let rec = recording { append(sampleBuffer, deviceGravity: deviceGravity, to: rec) }

        defer { frameIndex += 1 }
        guard GuidanceEngine.shouldDetectPose(frameIndex: frameIndex), !visionBusy,
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        visionBusy = true
        let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
        let cameraGravity = deviceGravity.flatMap(CameraGravity.normalised).map {
            CameraGravity.cameraFrame(deviceGravity: $0, orientation: orientation)
        }
        let size = CGSize(width: CVPixelBufferGetWidth(pixels), height: CVPixelBufferGetHeight(pixels))
        visionQueue.async { [weak self] in
            guard let self else { return }
            let pose = self.poseDetector.detect(in: pixels)
            self.captureQueue.async { [weak self] in
                guard let self else { return }
                self.visionBusy = false
                // Read latestDistanceMeters here, on captureQueue, to keep all
                // access to it confined to this queue (it's written from the
                // depth delegate's captureQueue hop below) rather than reading
                // it unsynchronized from visionQueue.
                let distance = self.latestDistanceMeters
                // Dispatching to main from inside this closure (rather than
                // directly from visionQueue, as before this read was added)
                // lets us capture `distance` synchronously without a second
                // hop. This ties guidance-sample delivery to captureQueue's
                // queue depth, which is negligible next to the ~33ms frame
                // interval.
                DispatchQueue.main.async {
                    self.imageSize = size
                    self.onGuidanceSample?(GuidanceSample(time: time, pose: pose, cameraGravity: cameraGravity, distanceMeters: distance))
                }
            }
        }
    }
}

extension ClipRecorder: AVCaptureDepthDataOutputDelegate {
    func depthDataOutput(_ output: AVCaptureDepthDataOutput, didOutput depthData: AVDepthData, timestamp: CMTime, connection: AVCaptureConnection) {
        let converted = depthData.depthDataType == kCVPixelFormatType_DepthFloat32
            ? depthData
            : depthData.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
        let pixelBuffer = converted.depthDataMap
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return }
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        guard width > 0, height > 0 else { return }
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        // bytesPerRow already accounts for any row-stride padding, so
        // advancing by whole rows in bytes before rebinding to Float32 and
        // indexing by width/2 lands exactly on the center pixel.
        let centerRow = base.advanced(by: (height / 2) * bytesPerRow).assumingMemoryBound(to: Float32.self)
        let centerDistance = centerRow[width / 2]
        guard centerDistance.isFinite, centerDistance > 0 else { return }
        captureQueue.async { [weak self] in self?.latestDistanceMeters = Double(centerDistance) }
    }
}
