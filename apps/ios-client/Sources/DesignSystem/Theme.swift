import SwiftUI

/// PosturePulse AI design system: "clinical instrument on paper".
/// Light ivory paper + ink everywhere; results render in a dark aubergine
/// readout panel. Brand purple (sampled from the logo) is the only accent.
/// No red/amber/green anywhere in results - position on a scale carries the
/// information, never a good/bad colour (docs/claims-and-scope.md).
enum Theme {
    // Paper (light app surfaces)
    static let paper = Color(hex: 0xF7F4EE)
    static let card = Color.white
    static let ink = Color(hex: 0x1F1A27)
    static let inkSoft = Color(hex: 0x6D6679)
    static let hairline = Color(hex: 0xE5E0E9)

    // Brand
    static let brand = Color(hex: 0x5E4587)
    static let brandTint = Color(hex: 0xEEE8F6)

    // Readout (dark results panel)
    static let readout = Color(hex: 0x17121F)
    static let readoutRaised = Color(hex: 0x221B2D)
    static let readoutText = Color(hex: 0xEFEAF6)
    static let readoutDim = Color(hex: 0x9D93AE)
    static let readoutRule = Color(hex: 0x342A42)
    static let readoutAccent = Color(hex: 0xB9A4E0)

    // Draft / caution (non-result metadata only)
    static let draft = Color(hex: 0xA15C12)
    static let draftTint = Color(hex: 0xFBEEDC)

    static let radius: CGFloat = 18
    static let gutter: CGFloat = 20
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

/// Serif display (New York) for headings, SF for reading, SF Mono for every
/// measured number so values read like an instrument.
enum Typo {
    static let hero = Font.system(.largeTitle, design: .serif).weight(.semibold)
    static let title = Font.system(.title2, design: .serif).weight(.semibold)
    static let heading = Font.system(.title3, design: .serif).weight(.semibold)
    static let body = Font.body
    static let caption = Font.footnote
    static let eyebrow = Font.caption2.weight(.bold)
    static func readout(_ style: Font.TextStyle = .title3) -> Font {
        Font.system(style, design: .monospaced).weight(.medium)
    }
}

/// Small uppercase tracked label ("POSTURE · FRONT VIEW").
struct Eyebrow: View {
    let text: String
    var color: Color = Theme.inkSoft

    init(_ text: String, color: Color = Theme.inkSoft) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text.uppercased())
            .font(Typo.eyebrow)
            .tracking(1.4)
            .foregroundColor(color)
    }
}

/// Full logo (mark + wordmark).
struct BrandHeader: View {
    var subtitle: String?

    var body: some View {
        VStack(spacing: 10) {
            Image("BrandLogo")
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(height: 96)
                .accessibilityLabel("PosturePulse AI")
            if let subtitle {
                Text(subtitle)
                    .font(Typo.caption)
                    .foregroundColor(Theme.inkSoft)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }
}

/// White card with a hairline edge on paper.
struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .strokeBorder(Theme.hairline, lineWidth: 1)
            )
    }
}

extension View {
    func card() -> some View { modifier(CardStyle()) }

    /// Caps content at a comfortable reading width on iPad; no effect on iPhone.
    func readableColumn() -> some View {
        frame(maxWidth: 640).frame(maxWidth: .infinity)
    }

    /// Paper background for every light screen.
    func paperBackground() -> some View {
        background(Theme.paper.ignoresSafeArea())
    }
}

/// Full-width brand button used for the one primary action on a screen.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundColor(.white)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(isEnabled ? Theme.brand : Theme.inkSoft.opacity(0.4))
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var primary: PrimaryButtonStyle { PrimaryButtonStyle() }
}

/// Numbered step marker for multi-step flows: ① ② ③ with a connecting rule.
struct StepTrack: View {
    let steps: [String]
    let current: Int

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, title in
                VStack(spacing: 6) {
                    ZStack {
                        Circle()
                            .fill(index <= current ? Theme.brand : Theme.card)
                            .overlay(Circle().strokeBorder(index <= current ? Theme.brand : Theme.hairline, lineWidth: 1.5))
                            .frame(width: 26, height: 26)
                        Text("\(index + 1)")
                            .font(.caption.weight(.bold).monospacedDigit())
                            .foregroundColor(index <= current ? .white : Theme.inkSoft)
                    }
                    Text(title)
                        .font(.caption2.weight(index == current ? .semibold : .regular))
                        .foregroundColor(index == current ? Theme.ink : Theme.inkSoft)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Step \(index + 1) of \(steps.count): \(title)\(index == current ? ", current" : "")")
            }
        }
        .background(alignment: .top) {
            Rectangle()
                .fill(Theme.hairline)
                .frame(height: 1.5)
                .padding(.horizontal, 40)
                .offset(y: 12.5)
        }
    }
}
