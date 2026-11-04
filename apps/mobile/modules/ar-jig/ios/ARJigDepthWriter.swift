import ARKit
import Compression
import CryptoKit
import Foundation

/// Writes the clip's LiDAR depth track to disk while the video is recording
/// (ADR-020). One instance per clip; not reusable.
///
/// Format — mirrored by `services/ml-service/app/clips/depth_track.py`, which is
/// the only reader. Any change here is a change there.
///
///     header, 16 bytes:
///         magic       8 bytes   "BEAIVEDP"
///         version     uint16    1
///         width       uint16    depth map width
///         height      uint16    depth map height
///         flags       uint8     bit 0: a confidence plane follows each depth plane
///         reserved    uint8     0
///
///     then, per frame:
///         length      uint32    byte length of the payload that follows
///         payload     RAW DEFLATE (RFC 1951) — no zlib header, no Adler-32
///
///     each inflated payload:
///         depth       width*height uint16 LE, millimetres along the optical
///                     axis, row-major; 0 = no return
///         confidence  width*height uint8 (only when flags bit 0 is set)
///
/// Three properties this writer must keep:
///
/// **Never fabricate a frame.** A frame with no depth map, an unexpected pixel
/// format, or a size that differs from the first frame's is *dropped*: nothing is
/// written and no entry is recorded. The gap then shows up as a jump in `t`,
/// which the server reads as a gap, because that is what it is. Repeating the
/// previous frame or interpolating would turn an absent measurement into a
/// confident wrong one (CLAUDE.md rule 3).
///
/// **0 is not 0 metres.** ARKit reports 0 for "no return". It is stored as 0 and
/// the reader turns it into `nan`; it must never be rounded into a short
/// distance.
///
/// **Depth is planar, not radial.** `sceneDepth` gives distance along the
/// optical axis. The reader's back-projection depends on that, so this writer
/// stores the values exactly as ARKit hands them over, with no conversion.
final class ARJigDepthWriter {

    /// What the sidecar needs to describe the file this writer produced.
    struct Descriptor {
        let fileURL: URL
        let width: Int
        let height: Int
        let frameCount: Int
        let sha256: String
        let hasConfidence: Bool
        let nominalFps: Double
        /// Seconds since the clip's first ENCODED video frame, per depth frame
        /// kept, in file order.
        let times: [Double]
    }

    enum Failure: Error {
        case couldNotCreateFile
        case writeFailed
        case compressionFailed
    }

    static let magic = Array("BEAIVEDP".utf8)
    static let formatVersion: UInt16 = 1
    static let flagHasConfidence: UInt8 = 0x01

    /// 15 Hz. The subject is holding still, so the LiDAR's full rate is mostly
    /// duplicate surfaces at ~98 KB a frame uncompressed. ADR-020's error budget
    /// is set by the sensor's spatial sampling, not its temporal rate, so a
    /// higher rate buys no precision — the dominant errors are static across a
    /// hold and averaging more frames does not shrink them.
    static let targetFps: Double = 15

    private let url: URL
    private let handle: FileHandle
    /// Serial, and separate from the video writer's queue: a slow depth write
    /// must never delay a video append, because a late video append is a dropped
    /// video frame and the video is the primary measurement.
    private let queue = DispatchQueue(label: "beaive.arjig.depth", qos: .utility)

    private var headerWritten = false
    private var width = 0
    private var height = 0
    private var hasConfidence = false
    /// ABSOLUTE ARFrame timestamps, rebased in `finish(firstEncodedTimestamp:)`.
    ///
    /// They cannot be rebased on arrival: the sidecar's video `frames[].t` is
    /// measured from the first frame the video writer actually ENCODED, which is
    /// not known until that append succeeds and is up to one video frame later
    /// than the frame `startRecording` saw. Rebasing against the wrong origin
    /// would shift every depth time by tens of milliseconds - small enough to
    /// look like jitter, large enough to pair a depth frame with the wrong pose.
    private var times: [Double] = []
    private var lastKeptTimestamp: Double?
    private var digest = SHA256()
    private var failed: Failure?
    private var closed = false

    init() throws {
        self.url = FileManager.default.temporaryDirectory
            .appendingPathComponent("arjig-\(UUID().uuidString).depth")
        try? FileManager.default.removeItem(at: url)
        guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
            throw Failure.couldNotCreateFile
        }
        guard let handle = try? FileHandle(forWritingTo: url) else {
            try? FileManager.default.removeItem(at: url)
            throw Failure.couldNotCreateFile
        }
        self.handle = handle
    }

    /// Offers one ARFrame. Cheap and non-blocking on the caller's thread beyond
    /// copying the depth planes out of ARKit's buffers, which must happen before
    /// the frame is released.
    ///
    /// Returns without doing anything when the frame is not due at the target
    /// rate, when it carries no depth, or when the writer has already failed.
    func append(_ frame: ARFrame) {
        guard failed == nil, !closed else { return }

        let t = frame.timestamp

        // Rate limit on the frame clock, not a frame counter: ARKit's delivery
        // rate varies, so counting frames would give an uneven real cadence.
        let minimumGap = 1.0 / Self.targetFps
        if let last = lastKeptTimestamp, t - last < minimumGap * 0.95 { return }

        guard let depth = frame.smoothedSceneDepth ?? frame.sceneDepth else { return }
        guard let planes = Self.copyPlanes(from: depth) else { return }

        // The first kept frame fixes the geometry for the whole file. A later
        // frame of a different size cannot be stored in the same file, and
        // rescaling it would move every sample; it is dropped instead.
        if headerWritten, planes.width != width || planes.height != height { return }
        if headerWritten, (planes.confidence != nil) != hasConfidence { return }

        lastKeptTimestamp = t
        queue.async { [weak self] in
            self?.write(planes: planes, at: t)
        }
    }

    /// Finishes the file and rebases every depth time onto the video's clock.
    ///
    /// `firstEncodedTimestamp` is the absolute ARFrame timestamp of the first
    /// frame the VIDEO writer encoded — the origin of the sidecar's
    /// `frames[].t`. Depth frames captured before it are dropped rather than
    /// given a negative time (the schema requires `t >= 0`, and a clamped time
    /// would claim the frame arrived at the start of the clip when it did not).
    ///
    /// Returns nil when no frame was written, a write failed, or nothing
    /// survives the rebase. In every one of those cases the clip uploads with no
    /// depth block at all — a supported state end to end — rather than with a
    /// description of a file that is not what it says.
    func finish(firstEncodedTimestamp: Double) -> Descriptor? {
        var descriptor: Descriptor?
        queue.sync {
            guard !closed else { return }
            closed = true
            try? handle.close()

            guard failed == nil, headerWritten, !times.isEmpty else {
                try? FileManager.default.removeItem(at: url)
                return
            }

            // A depth frame older than the video's first encoded frame cannot be
            // described: the schema requires `t >= 0`, and a clamped time would
            // claim the frame arrived at the start of the clip when it did not.
            //
            // The whole track is abandoned rather than trimmed. The frames are
            // already in the file, and `frameCount` must equal the number of
            // frames the file holds, so describing fewer would hand the reader a
            // count it will (correctly) refuse. Trimming would mean rewriting
            // the file. The engine only offers frames it is also encoding, so
            // this is the narrow case where a video append failed after a depth
            // frame was already written - rare, and losing an additive
            // depth track is the right cost for never shipping a
            // mis-timestamped one.
            guard times.allSatisfy({ $0 >= firstEncodedTimestamp }) else {
                try? FileManager.default.removeItem(at: url)
                return
            }

            let rebased = times.map { $0 - firstEncodedTimestamp }

            // Honest rate, derived from the frames actually kept, exactly as the
            // video writer derives its own: a track that dropped most of its
            // frames must not claim 15 Hz.
            let span = (rebased.last ?? 0) - (rebased.first ?? 0)
            let fps = (rebased.count > 1 && span > 0) ? Double(rebased.count - 1) / span : 0

            descriptor = Descriptor(
                fileURL: url,
                width: width,
                height: height,
                frameCount: rebased.count,
                sha256: digest.finalize().map { String(format: "%02x", $0) }.joined(),
                hasConfidence: hasConfidence,
                nominalFps: fps,
                times: rebased
            )
        }
        return descriptor
    }

    /// Abandons the file. Safe to call after `finish()`.
    func cancel() {
        queue.sync {
            guard !closed else { return }
            closed = true
            try? handle.close()
            try? FileManager.default.removeItem(at: url)
        }
    }

    // MARK: - Writing (queue only)

    private struct Planes {
        let width: Int
        let height: Int
        let millimetres: Data
        let confidence: Data?
    }

    private func write(planes: Planes, at t: Double) {
        guard failed == nil, !closed else { return }

        if !headerWritten {
            width = planes.width
            height = planes.height
            hasConfidence = planes.confidence != nil
            guard emit(Self.header(width: width, height: height, hasConfidence: hasConfidence)) else { return }
            headerWritten = true
        }

        var payload = planes.millimetres
        if let confidence = planes.confidence { payload.append(confidence) }

        guard let blob = Self.deflate(payload), !blob.isEmpty else {
            // A frame that will not compress is dropped, not stored raw: a
            // mixed-encoding file would decode as garbage from that point on.
            return
        }

        var length = UInt32(blob.count).littleEndian
        var record = Data(bytes: &length, count: 4)
        record.append(blob)
        guard emit(record) else { return }
        times.append(t)
    }

    /// Writes and hashes in one place, so the recorded sha256 is always of
    /// exactly the bytes that reached the file.
    private func emit(_ data: Data) -> Bool {
        do {
            try handle.write(contentsOf: data)
            digest.update(data: data)
            return true
        } catch {
            failed = .writeFailed
            return false
        }
    }

    // MARK: - Encoding

    private static func header(width: Int, height: Int, hasConfidence: Bool) -> Data {
        var data = Data(magic)
        var version = formatVersion.littleEndian
        var w = UInt16(clamping: width).littleEndian
        var h = UInt16(clamping: height).littleEndian
        data.append(Data(bytes: &version, count: 2))
        data.append(Data(bytes: &w, count: 2))
        data.append(Data(bytes: &h, count: 2))
        data.append(hasConfidence ? flagHasConfidence : 0)
        data.append(0) // reserved
        return data
    }

    /// Copies the depth (and confidence) planes out of ARKit's pixel buffers,
    /// converting metres to millimetres. Reuses `ARJigEngine.sampleForeground`'s
    /// access pattern: lock, read inside a `defer`-unlock, never retain the
    /// buffer, because ARKit's pool is small and holding frames stalls the
    /// session.
    private static func copyPlanes(from depth: ARDepthData) -> Planes? {
        let map = depth.depthMap
        guard CVPixelBufferGetPixelFormatType(map) == kCVPixelFormatType_DepthFloat32 else { return nil }

        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(map) else { return nil }

        let width = CVPixelBufferGetWidth(map)
        let height = CVPixelBufferGetHeight(map)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(map)
        guard width > 0, height > 0, width <= Int(UInt16.max), height <= Int(UInt16.max) else { return nil }

        var millimetres = [UInt16](repeating: 0, count: width * height)
        for y in 0..<height {
            let row = base.advanced(by: y * bytesPerRow).assumingMemoryBound(to: Float32.self)
            for x in 0..<width {
                let metres = row[x]
                // Anything non-finite, non-positive, or past the sensor's usable
                // range is stored as 0 — "no return". It is NOT clamped to the
                // range: a clamped value is a measurement the sensor never made.
                guard metres.isFinite, metres > 0, metres < 65.0 else { continue }
                millimetres[y * width + x] = UInt16(clamping: Int((metres * 1000).rounded()))
            }
        }

        var confidence: Data?
        if let confidenceMap = depth.confidenceMap {
            confidence = copyConfidence(confidenceMap, width: width, height: height)
        }

        return Planes(
            width: width,
            height: height,
            millimetres: millimetres.withUnsafeBufferPointer { Data(buffer: $0) },
            confidence: confidence
        )
    }

    /// ARKit's confidence levels (0 low, 1 medium, 2 high). Apple documents depth
    /// accuracy as highly dependent on this, so it is transported rather than
    /// thrown away: it rejects a pixel upsampled far from any real return better
    /// than any statistical gate on the server can.
    private static func copyConfidence(_ map: CVPixelBuffer, width: Int, height: Int) -> Data? {
        guard CVPixelBufferGetPixelFormatType(map) == kCVPixelFormatType_OneComponent8,
              CVPixelBufferGetWidth(map) == width,
              CVPixelBufferGetHeight(map) == height else { return nil }

        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(map) else { return nil }
        let bytesPerRow = CVPixelBufferGetBytesPerRow(map)

        var out = [UInt8](repeating: 0, count: width * height)
        for y in 0..<height {
            let row = base.advanced(by: y * bytesPerRow).assumingMemoryBound(to: UInt8.self)
            for x in 0..<width { out[y * width + x] = row[x] }
        }
        return out.withUnsafeBufferPointer { Data(buffer: $0) }
    }

    /// RAW DEFLATE via Apple's Compression framework. `COMPRESSION_ZLIB` here
    /// produces raw DEFLATE with no zlib header and no Adler-32 trailer, which is
    /// why the format is named `uint16_millimetres_deflate` and why the Python
    /// reader inflates with `wbits=-15`.
    static func deflate(_ input: Data) -> Data? {
        guard !input.isEmpty else { return nil }
        // Depth planes of identical surfaces compress well, but the bound must
        // still allow for incompressible input plus the framework's overhead.
        let capacity = input.count + (input.count / 16) + 64
        var output = Data(count: capacity)

        let written: Int = output.withUnsafeMutableBytes { outBytes in
            input.withUnsafeBytes { inBytes in
                guard let dst = outBytes.bindMemory(to: UInt8.self).baseAddress,
                      let src = inBytes.bindMemory(to: UInt8.self).baseAddress else { return 0 }
                return compression_encode_buffer(dst, capacity, src, input.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard written > 0 else { return nil }
        output.removeSubrange(written..<output.count)
        return output
    }
}
