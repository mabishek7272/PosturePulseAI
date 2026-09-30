import SwiftUI

/// First-class UI mode for TRD 2.3's "2D fallback" - shown whenever AR world
/// tracking is unsupported on this device, or has degraded, rather than
/// silently continuing to stream camera poses under a stale worldAnchorId.
/// This is a distinct named mode the user sees, not an implicit default the
/// app falls into quietly.
struct TwoDFallbackBanner: View {
    enum Reason {
        case unsupportedDevice
        case trackingDegraded

        var title: String {
            switch self {
            case .unsupportedDevice: return "2D mode"
            case .trackingDegraded: return "Re-anchoring"
            }
        }

        var detail: String {
            switch self {
            case .unsupportedDevice:
                return "This device doesn't support AR world tracking. Spatial measurements are unavailable this session."
            case .trackingDegraded:
                return "AR tracking lost its anchor. Hold steady - spatial measurements are paused until tracking recovers."
            }
        }
    }

    let reason: Reason

    var body: some View {
        VStack(spacing: 4) {
            Text(reason.title)
                .font(.headline)
            Text(reason.detail)
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(reason.title): \(reason.detail)")
    }
}
