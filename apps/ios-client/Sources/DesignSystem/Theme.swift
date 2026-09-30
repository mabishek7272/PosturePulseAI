import SwiftUI

/// PosturePulse AI light theme. Brand purple is sampled from the logo
/// (AppResources/Assets.xcassets/BrandLogo); the app is light-only
/// (Info.plist UIUserInterfaceStyle = Light).
enum Theme {
    static let brand = Color(red: 0x5E / 255, green: 0x45 / 255, blue: 0x87 / 255)
    static let brandSoft = Color(red: 0xEF / 255, green: 0xEB / 255, blue: 0xF6 / 255)
    static let background = Color(red: 0xF7 / 255, green: 0xF6 / 255, blue: 0xFA / 255)
    static let surface = Color.white
    static let cornerRadius: CGFloat = 16
}

/// Full logo (mark + wordmark) for screen headers.
struct BrandHeader: View {
    var subtitle: String?

    var body: some View {
        VStack(spacing: 8) {
            Image("BrandLogo")
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(height: 80)
                .accessibilityLabel("PosturePulse AI")
            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }
}

/// White rounded card on the light background.
struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
            .shadow(color: Theme.brand.opacity(0.08), radius: 8, x: 0, y: 2)
    }
}

extension View {
    func card() -> some View { modifier(CardStyle()) }
}
