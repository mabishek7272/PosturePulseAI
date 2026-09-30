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
            VStack(alignment: .leading, spacing: 18) {
                BrandHeader()
                    .padding(.top, 4)

                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("Today's assessment", color: Theme.brand)
                    Text("Choose what your clinician assigned")
                        .font(Typo.hero)
                        .foregroundColor(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("About 10 minutes. You'll need a chair and room to stand 2–3 metres from your phone.")
                        .font(.callout)
                        .foregroundColor(Theme.inkSoft)
                }

                if isLoading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 24)
                } else if let loadError {
                    VStack(alignment: .leading, spacing: 14) {
                        Label("Can't reach your clinic's server", systemImage: "wifi.exclamationmark")
                            .font(.headline)
                            .foregroundColor(Theme.ink)
                        Text(loadError)
                            .font(.callout)
                            .foregroundColor(Theme.inkSoft)
                        Button("Try again") { Task { await load() } }
                            .buttonStyle(.primary)
                    }
                    .card()
                } else {
                    ForEach(Array(protocols.enumerated()), id: \.element.id) { index, proto in
                        Button {
                            onSelect(proto)
                        } label: {
                            ProtocolCard(index: index + 1, proto: proto)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, Theme.gutter)
            .padding(.bottom, 28)
        }
        .paperBackground()
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        loadError = nil
        defer { isLoading = false }
        do {
            protocols = try await client.list()
        } catch {
            loadError = "Check your connection and try again."
        }
    }
}

private struct ProtocolCard: View {
    let index: Int
    let proto: ProtocolSummary

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Text(String(format: "%02d", index))
                .font(Typo.readout(.title3))
                .foregroundColor(Theme.brand)
                .frame(width: 34, alignment: .leading)
            VStack(alignment: .leading, spacing: 8) {
                Text(proto.definition.name)
                    .font(Typo.heading)
                    .foregroundColor(Theme.ink)
                if proto.isDraft {
                    DraftBadge()
                }
                Text(proto.definition.targetPopulation)
                    .font(.footnote)
                    .foregroundColor(Theme.inkSoft)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            Image(systemName: "arrow.right")
                .font(.body.weight(.semibold))
                .foregroundColor(Theme.brand)
                .padding(.top, 4)
        }
        .card()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Starts this assessment")
    }
}
