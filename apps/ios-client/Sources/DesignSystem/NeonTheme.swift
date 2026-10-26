import SwiftUI

/// "Neon Clinical" tokens for the app shell only - splash, mode chooser, and
/// the live capture screen's skeleton overlay
/// (docs/superpowers/specs/2026-10-23-neon-shell-redesign-design.md §3-4).
/// Dark aubergine base, glowing violet accent (same brand-purple family as
/// Theme.brand), mint as the skeleton's second gradient stop. The report
/// screens under Sources/Report/ do not import this - they keep Theme/Typo
/// unchanged (see the spec's §2 scope).
enum NeonTheme {
    static let bgDeep = Color(hex: 0x0e0a16)
    static let bgGlow = Color(hex: 0x2a1744)
    static let violet = Color(hex: 0xb98cff)
    static let violetDim = Color(hex: 0x6e3fc9)
    static let mint = Color(hex: 0x39ffc4)
    static let textPrimary = Color(hex: 0xefeaf6)
    static let textDim = Color(hex: 0x9d93ae)
    /// Error/caution banners - deliberately outside the violet brand family
    /// so a problem reads as visually distinct from ordinary chrome.
    static let caution = Color(hex: 0xff6b6b)
}

/// Bold rounded sans for shell headings - distinct from Typo's serif/mono
/// pairing used by the report screen.
enum NeonTypo {
    static let hero = Font.system(.largeTitle, design: .rounded).weight(.heavy)
    static let heading = Font.system(.title2, design: .rounded).weight(.bold)
    static let body = Font.system(.body, design: .rounded)
    static let caption = Font.system(.caption, design: .rounded).weight(.semibold)
}
