import SwiftUI

/// One-field height entry feeding subject-specific scale calibration
/// (docs/adr/008-scale-calibration-scope.md - the only TRD-approved method
/// implemented server-side this phase). Not verified in this sandbox.
struct HeightEntryView: View {
    let sessionId: String
    let onHeightSet: () -> Void

    @State private var heightCentimeters: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private let client = SessionsClient()

    var body: some View {
        VStack(spacing: 16) {
            Text("Enter your height")
                .font(.title3)
            Text("Used only to estimate scale for this session - not stored as a health record.")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            TextField("Height in cm", text: $heightCentimeters)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)

            if let errorMessage {
                Text(errorMessage).foregroundColor(.red).font(.caption)
            }

            Button {
                submit()
            } label: {
                if isSubmitting {
                    ProgressView()
                } else {
                    Text("Continue").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isSubmitting || Double(heightCentimeters) == nil)
            .padding(.horizontal)
        }
    }

    private func submit() {
        guard let centimeters = Double(heightCentimeters), centimeters > 0 else {
            errorMessage = "Enter a valid height."
            return
        }
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                try await client.setHeight(sessionId: sessionId, subjectHeightMeters: centimeters / 100.0)
                onHeightSet()
            } catch {
                errorMessage = "Could not save height: \(error.localizedDescription)"
            }
        }
    }
}
