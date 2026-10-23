import Foundation

/// Chosen at the start of every session.
enum SessionMode: String, CaseIterable, Identifiable {
    case clinic
    case patient

    var id: String { rawValue }

    /// Clinic mode is operated by a signed-in clinician (ADR-010).
    var requiresClinicianSignIn: Bool { self == .clinic }

    var title: String {
        switch self {
        case .clinic: return "Clinic mode"
        case .patient: return "Patient mode"
        }
    }

    var detail: String {
        switch self {
        case .clinic:
            return "A clinician runs the assessment with the device on a tripod and reviews each step."
        case .patient:
            return "Follow guided steps on your own. Your clinician reviews the results before you see them."
        }
    }

    var icon: String {
        switch self {
        case .clinic: return "stethoscope"
        case .patient: return "figure.stand"
        }
    }
}
