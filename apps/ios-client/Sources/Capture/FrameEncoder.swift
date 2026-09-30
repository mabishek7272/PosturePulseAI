import AVFoundation
import CoreImage
import Foundation
import UIKit

/// Downsamples/encodes a captured CMSampleBuffer for upload
/// (FrameStreamingClient). Keeps this separate from CameraCaptureController so
/// the capture pipeline and the encode-for-network step can evolve/benchmark
/// independently (PRD 4.1 P1 device-benchmarking backlog item).
struct FrameEncoder {
    /// Target long-edge resolution for uploaded frames. Full 720p is not needed
    /// for pose estimation and unnecessarily inflates upload size; this value
    /// is a starting point, not a benchmarked choice.
    var maxDimension: CGFloat = 640
    var jpegQuality: CGFloat = 0.7

    private let ciContext = CIContext()

    func encodeJPEG(from sampleBuffer: CMSampleBuffer) -> Data? {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return nil }
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let resized = resize(ciImage, maxDimension: maxDimension)

        guard let cgImage = ciContext.createCGImage(resized, from: resized.extent) else { return nil }
        let uiImage = UIImage(cgImage: cgImage)
        return uiImage.jpegData(compressionQuality: jpegQuality)
    }

    private func resize(_ image: CIImage, maxDimension: CGFloat) -> CIImage {
        let extent = image.extent
        let longEdge = max(extent.width, extent.height)
        guard longEdge > maxDimension else { return image }
        let scale = maxDimension / longEdge
        return image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    }
}
