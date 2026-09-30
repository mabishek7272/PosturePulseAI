import AVFoundation
import Foundation

/// AVFoundation camera capture. Delivers frames to a delegate for encoding and
/// upload - no on-device pose/AI processing happens here (that runs server-side
/// per the product's architecture decision).
final class CameraCaptureController: NSObject {
    private let session = AVCaptureSession()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let processingQueue = DispatchQueue(label: "com.beaive.capture.processing")

    weak var delegate: CameraCaptureDelegate?

    /// Front camera by default - most protocol exercises (sit-to-stand, squat,
    /// shoulder flexion) are self-observed. A clinic-station stationary-camera
    /// mode (docs/coordinate-frames.md) may prefer .back; not selectable in
    /// this phase's UI.
    func configure(position: AVCaptureDevice.Position = .front) throws {
        session.beginConfiguration()
        session.sessionPreset = .hd1280x720

        guard
            let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
            let input = try? AVCaptureDeviceInput(device: device),
            session.canAddInput(input)
        else {
            session.commitConfiguration()
            throw CameraCaptureError.deviceUnavailable
        }
        session.addInput(input)

        videoOutput.setSampleBufferDelegate(self, queue: processingQueue)
        guard session.canAddOutput(videoOutput) else {
            session.commitConfiguration()
            throw CameraCaptureError.outputUnavailable
        }
        session.addOutput(videoOutput)

        session.commitConfiguration()
    }

    func start() {
        guard !session.isRunning else { return }
        processingQueue.async { [session] in session.startRunning() }
    }

    func stop() {
        guard session.isRunning else { return }
        processingQueue.async { [session] in session.stopRunning() }
    }
}

protocol CameraCaptureDelegate: AnyObject {
    /// Called on `processingQueue` - hop to the main actor before touching UI.
    func cameraCaptureController(_ controller: CameraCaptureController, didCapture sampleBuffer: CMSampleBuffer, at timestamp: CMTime)
}

extension CameraCaptureController: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        delegate?.cameraCaptureController(self, didCapture: sampleBuffer, at: timestamp)
    }
}

enum CameraCaptureError: Error {
    case deviceUnavailable
    case outputUnavailable
}
