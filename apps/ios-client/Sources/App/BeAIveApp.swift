import SwiftUI

@main
struct BeAIveApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .tint(Theme.brand)
                .preferredColorScheme(.light)
        }
    }
}
