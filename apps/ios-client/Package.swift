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
    targets: [
        .target(name: "PostureAnalysisClient", path: "Sources"),
        .testTarget(name: "PostureAnalysisClientTests", dependencies: ["PostureAnalysisClient"], path: "Tests"),
    ]
)
