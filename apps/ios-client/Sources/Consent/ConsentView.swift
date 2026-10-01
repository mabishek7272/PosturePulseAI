import SwiftUI

/// First-run consent (docs/consent-and-retention.md). `derived_events` is
/// required and locked on; every other scope is off unless chosen.
struct ConsentView: View {
    let subjectPseudoId: String
    let onConsented: (_ consentRecordId: String) -> Void

    @State private var selected: Set<ConsentScope> = [.derivedEvents]
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private let client = ConsentClient()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                BrandHeader()
                    .padding(.top, 4)

                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Your privacy", color: Theme.brand)
                    Text("Choose what we may store")
                        .font(Typo.hero)
                        .foregroundColor(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("You can ask your clinician to withdraw consent at any time. You're identified here only by a random code on this phone.")
                        .font(.callout)
                        .foregroundColor(Theme.inkSoft)
                }

                VStack(spacing: 0) {
                    ForEach(Array(ConsentScope.allCases.enumerated()), id: \.element) { index, scope in
                        ScopeRow(scope: scope, isOn: binding(for: scope))
                        if index < ConsentScope.allCases.count - 1 {
                            Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, 54)
                        }
                    }
                }
                .card()

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundColor(Theme.ink)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.draftTint))
                }

                Button {
                    submit()
                } label: {
                    if isSubmitting {
                        ProgressView().tint(.white)
                    } else {
                        Text("I agree")
                    }
                }
                .buttonStyle(.primary)
                .disabled(isSubmitting)
            }
            .padding(.horizontal, Theme.gutter)
            .readableColumn()
            .padding(.bottom, 28)
        }
        .paperBackground()
    }

    private func binding(for scope: ConsentScope) -> Binding<Bool> {
        Binding(
            get: { selected.contains(scope) },
            set: { isOn in
                if isOn { selected.insert(scope) } else if !scope.isRequired { selected.remove(scope) }
            }
        )
    }

    private func submit() {
        isSubmitting = true
        errorMessage = nil
        Task {
            defer { isSubmitting = false }
            do {
                let record = try await client.create(
                    .init(subjectPseudoId: subjectPseudoId, scopes: selected.map(\.rawValue).sorted())
                )
                onConsented(record.id)
            } catch {
                errorMessage = "Could not save your choices. Check your connection and try again."
            }
        }
    }
}

private struct ScopeRow: View {
    let scope: ConsentScope
    @Binding var isOn: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: scope.icon)
                .font(.title3)
                .foregroundColor(Theme.brand)
                .frame(width: 40, height: 40)
                .background(Circle().fill(Theme.brandTint))
            VStack(alignment: .leading, spacing: 4) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(scope.title).font(.headline).foregroundColor(Theme.ink)
                    if scope.isRequired {
                        Text("REQUIRED")
                            .font(.system(size: 9, weight: .heavy))
                            .tracking(0.8)
                            .foregroundColor(Theme.brand)
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .background(Capsule().fill(Theme.brandTint))
                    }
                }
                Text(scope.detail)
                    .font(.footnote)
                    .foregroundColor(Theme.inkSoft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(Theme.brand)
                .disabled(scope.isRequired)
        }
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
        .accessibilityHint(scope.isRequired ? "Required to run a session" : "")
    }
}
