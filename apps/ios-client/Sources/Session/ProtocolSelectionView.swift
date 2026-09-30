import SwiftUI

/// Lists the clinician-approved (currently: draft) protocols and lets the
/// user pick one to start a session with. Every row shows DraftBadge - a
/// draft protocol must never look identical to a clinically reviewed one
/// (docs/claims-and-scope.md).
struct ProtocolSelectionView: View {
    @State private var protocols: [ProtocolSummary] = []
    @State private var loadError: String?
    @State private var isLoading = true
    let onSelect: (ProtocolSummary) -> Void

    private let client = ProtocolsClient()

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                BrandHeader(subtitle: "Choose the assessment your clinician assigned")

                if isLoading {
                    ProgressView().padding(.top, 24)
                } else if let loadError {
                    VStack(spacing: 12) {
                        Text(loadError)
                            .font(.callout)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                        Button("Try again") { Task { await load() } }
                            .buttonStyle(.borderedProminent)
                    }
                    .card()
                } else {
                    ForEach(protocols) { proto in
                        Button {
                            onSelect(proto)
                        } label: {
                            ProtocolCard(proto: proto)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .background(Theme.background.ignoresSafeArea())
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            protocols = try await client.list()
        } catch {
            loadError = "Could not load assessments. Check that you're connected to your clinic's server."
        }
    }
}

private struct ProtocolCard: View {
    let proto: ProtocolSummary

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Text(proto.definition.name)
                    .font(.headline)
                    .foregroundColor(.primary)
                if proto.isDraft {
                    DraftBadge()
                }
                Text(proto.definition.targetPopulation)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(3)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundColor(Theme.brand)
                .padding(.top, 4)
        }
        .card()
    }
}
