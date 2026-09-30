// swift-tools-version:5.9
import PackageDescription

// This package organizes the app's source for Xcode ("Open Package.swift" or
// add as a local package dependency to an App project target) - it cannot be
// built standalone via `swift build` because it depends on iOS-only
// frameworks (SwiftUI, AVFoundation, UIKit). See README.md.
let package = Package(
    name: "PostureAnalysisClient",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "PostureAnalysisClient", targets: ["PostureAnalysisClient"])
    ],
    dependencies: [
        .package(url: "https://github.com/socketio/socket.io-client-swift", from: "16.1.1"),
    ],
    targets: [
        .target(
            name: "PostureAnalysisClient",
            dependencies: [.product(name: "SocketIO", package: "socket.io-client-swift")],
            path: "Sources"
        ),
        .testTarget(name: "PostureAnalysisClientTests", dependencies: ["PostureAnalysisClient"], path: "Tests"),
    ]
)
