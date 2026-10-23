import SwiftUI

/// First screen of every session: Clinic mode or Patient mode.
struct ModeChooserView: View {
    let onChoose: (SessionMode) -> Void
    /// Set when this phone holds access to at least one assessment's results.
    var onViewResults: (() -> Void)?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                BrandHeader()
                    .padding(.top, 4)

                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow("New session", color: Theme.brand)
                    Text("Who is running this assessment?")
                        .font(Typo.hero)
                        .foregroundColor(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ForEach(SessionMode.allCases) { mode in
                    Button {
                        onChoose(mode)
                    } label: {
                        HStack(alignment: .top, spacing: 14) {
                            Image(systemName: mode.icon)
                                .font(.title2)
                                .foregroundColor(Theme.brand)
                                .frame(width: 48, height: 48)
                                .background(Circle().fill(Theme.brandTint))
                            VStack(alignment: .leading, spacing: 6) {
                                Text(mode.title)
                                    .font(Typo.heading)
                                    .foregroundColor(Theme.ink)
                                Text(mode.detail)
                                    .font(.footnote)
                                    .foregroundColor(Theme.inkSoft)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.right")
                                .font(.body.weight(.semibold))
                                .foregroundColor(Theme.brand)
                                .padding(.top, 4)
                        }
                        .card()
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                    .accessibilityHint("Starts a session in \(mode.title)")
                }

                if let onViewResults {
                    Button(action: onViewResults) {
                        Label("Your results", systemImage: "doc.text.magnifyingglass")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .accessibilityHint("Shows assessments your clinician has released")
                }

                Text("Results are camera-based estimates that a clinician reviews.")
                    .font(.footnote)
                    .foregroundColor(Theme.inkSoft)
            }
            .padding(.horizontal, Theme.gutter)
            .readableColumn()
            .padding(.bottom, 28)
        }
        .paperBackground()
    }
}
