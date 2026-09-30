import Foundation

/// Mirrors consent-record.schema.json's scope enum.
enum ConsentScope: String, CaseIterable, Identifiable {
    case derivedEvents = "derived_events"
    case rawVideo = "raw_video"
    case researchDataExport = "research_data_export"
    case wearableIntegration = "wearable_integration"

    var id: String { rawValue }

    /// Sessions cannot run without derived-event retention (backend enforces this).
    var isRequired: Bool { self == .derivedEvents }

    var icon: String {
        switch self {
        case .derivedEvents: return "waveform.path.ecg"
        case .rawVideo: return "video"
        case .researchDataExport: return "chart.bar.doc.horizontal"
        case .wearableIntegration: return "applewatch"
        }
    }

    var title: String {
        switch self {
        case .derivedEvents: return "Session measurements"
        case .rawVideo: return "Keep session video"
        case .researchDataExport: return "Research use"
        case .wearableIntegration: return "Connected sensors"
        }
    }

    var detail: String {
        switch self {
        case .derivedEvents:
            return "Store estimated joint angles, movement and data-quality results from your sessions - never video - so your clinician can review them. Required to run a session."
        case .rawVideo:
            return "Store the camera video of your sessions for a limited time. Off unless you choose it."
        case .researchDataExport:
            return "Include de-identified session measurements in research studies."
        case .wearableIntegration:
            return "Combine readings from a connected wearable, such as heart rate, with your sessions."
        }
    }
}
