import SwiftUI

/// Reusable "DRAFT / not clinically validated" marker (docs/claims-and-scope.md).
/// Any view rendering a ProtocolSummary or similar draft content must show this
/// - never let a draft protocol's UI look identical to a clinically reviewed one.
struct DraftBadge: View {
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 9, weight: .bold))
            // Never truncated: a clipped "NOT CLINICALLY VALID…" would lose the claim's meaning.
            Text("DRAFT · NOT CLINICALLY VALIDATED")
                .font(.system(size: 10, weight: .bold))
                .tracking(0.6)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(Capsule().fill(Theme.draftTint))
        .foregroundColor(Theme.draft)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Draft, not clinically validated")
    }
}
