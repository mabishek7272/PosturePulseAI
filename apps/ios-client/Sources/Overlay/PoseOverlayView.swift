import SwiftUI

/// Renders landmarks/quality flags returned from the server. Renders the
/// "unsupported" state distinctly and never fabricates guidance when quality
/// is suppressed - see quality-gate-flag.schema.json and
/// docs/claims-and-scope.md. Positions are normalized (0-1, image-space) per
/// the pose-landmark-frame contract, not metric/calibrated coordinates
/// (docs/coordinate-frames.md).
struct PoseOverlayView: View {
    let frame: PoseLandmarkFrame?
    let qualityGateFlag: QualityGateFlag?

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                if let qualityGateFlag, !qualityGateFlag.isSupported {
                    unsupportedBanner(reasons: qualityGateFlag.reasons)
                } else if let frame {
                    ForEach(observedLandmarks(in: frame), id: \.jointName) { landmark in
                        if let position = landmark.position {
                            Circle()
                                .fill(Color.green)
                                .frame(width: 8, height: 8)
                                .position(
                                    x: position[0] * geometry.size.width,
                                    y: position[1] * geometry.size.height
                                )
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(qualityGateFlag?.isSupported == false ? "Measurement unavailable" : "Pose overlay")
    }

    private func observedLandmarks(in frame: PoseLandmarkFrame) -> [PoseLandmarkFrame.Landmark] {
        frame.landmarks.filter { $0.observationState == .observed }
    }

    private func unsupportedBanner(reasons: [String]) -> some View {
        VStack(spacing: 4) {
            Text("Measurement unavailable")
                .font(.headline)
            if !reasons.isEmpty {
                Text(reasons.joined(separator: ", "))
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
