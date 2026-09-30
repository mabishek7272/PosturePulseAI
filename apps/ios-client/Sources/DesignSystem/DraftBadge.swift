import SwiftUI

/// Reusable "DRAFT / not clinically validated" marker (docs/claims-and-scope.md).
/// Any view rendering a ProtocolSummary or similar draft content must show this
/// - never let a draft protocol's UI look identical to a clinically reviewed one.
struct DraftBadge: View {
    var body: some View {
        Text("DRAFT · NOT CLINICALLY VALIDATED")
            .font(.caption.bold())
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.orange.opacity(0.2))
            .foregroundColor(.orange)
            .clipShape(Capsule())
            .accessibilityLabel("Draft, not clinically validated")
    }
}
