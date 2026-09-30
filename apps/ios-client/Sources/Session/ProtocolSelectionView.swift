import SwiftUI

/// Lists the clinician-approved (currently: draft) protocols and lets the
/// user pick one to start a session with. Every row shows DraftBadge - a
/// draft protocol must never look identical to a clinically reviewed one
/// (docs/claims-and-scope.md).
struct ProtocolSelectionView: View {
    @State private var protocols: [ProtocolSummary] = []
    @State private var loadError: String?
    let onSelect: (ProtocolSummary) -> Void

    private let client = ProtocolsClient()

    var body: some View {
        List(protocols) { proto in
            Button {
                onSelect(proto)
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(proto.definition.name).font(.headline)
                        if proto.isDraft {
                            DraftBadge()
                        }
                    }
                    Text(proto.definition.targetPopulation)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .overlay {
            if let loadError {
                Text(loadError).foregroundColor(.red).padding()
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            protocols = try await client.list()
        } catch {
            loadError = "Could not load protocols: \(error.localizedDescription)"
        }
    }
}
