// swift-tools-version: 6.2
import PackageDescription

// Workbench3D for Mac: a native SwiftUI + Metal app for Apple silicon.
// Workbench3DKit is the geometry engine (a port of src/core in the web app) with no UI,
// so its tests run without the app.
let package = Package(
    name: "Workbench3D",
    platforms: [.macOS(.v26)],
    targets: [
        .target(name: "Workbench3DKit"),
        .executableTarget(
            name: "Workbench3D",
            dependencies: ["Workbench3DKit"],
            // App code runs on the main thread unless you say otherwise.
            swiftSettings: [.defaultIsolation(MainActor.self)]
        ),
        .testTarget(
            name: "Workbench3DKitTests",
            dependencies: ["Workbench3DKit"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
