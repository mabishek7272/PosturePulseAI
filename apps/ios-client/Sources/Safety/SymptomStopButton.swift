import SwiftUI

/// Local-first symptom/stop control (PRD 1.3 feedback hierarchy: stop/seek
/// help is priority 1, above any corrective cue). The local stop action fires
/// synchronously, in-process, before the network call - it must never wait on
/// a round trip. This is the client-side half of the safety state machine's
/// precedence rule (services/backend-api/src/safety/safety-state-machine.ts).
struct SymptomStopButton: View {
    let sessionId: String
    /// Called synchronously, before the network request - halt local capture/
    /// display/audio cues here. Must not perform network I/O itself.
    let onLocalStop: () -> Void

    @State private var isReporting = false
    @State private var selectedSymptoms: Set<String> = []
    @State private var severity = "moderate"

    private let client = SymptomReportingClient()

    var body: some View {
        Button(role: .destructive) {
            // Local stop is synchronous and unconditional - happens before
            // anything below runs, regardless of what the network does next.
            onLocalStop()
            reportAsync()
        } label: {
            Label("Stop - I feel unwell", systemImage: "hand.raised.fill")
                .font(.title2.bold())
                .frame(maxWidth: .infinity, minHeight: 56) // large touch target (PRD 1.6 accessibility)
        }
        .buttonStyle(.borderedProminent)
        .tint(.red)
        .disabled(isReporting)
    }

    private func reportAsync() {
        isReporting = true
        let symptoms = selectedSymptoms.isEmpty ? ["other"] : Array(selectedSymptoms)
        Task {
            defer { isReporting = false }
            do {
                _ = try await client.report(
                    .init(sessionId: sessionId, symptoms: symptoms, severity: severity, freeText: nil)
                )
            } catch {
                // The local stop already happened - a failed network report
                // is a delivery problem to surface/retry, not a safety gap.
                // Left as a TODO for a persistent retry queue in a later phase.
            }
        }
    }
}
