// swift-tools-version:5.10
// HomeFinKit: everything the Home Fin app does that isn't UI — talking to Jellyfin and the
// Home Fin accounts service, building the home screen, and choosing how to play a title.
// Pure Foundation, so it builds and tests on Linux too.
import PackageDescription

let package = Package(
    name: "HomeFinKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "HomeFinKit", targets: ["HomeFinKit"])
    ],
    targets: [
        .target(name: "HomeFinKit"),
        .testTarget(name: "HomeFinKitTests", dependencies: ["HomeFinKit"])
    ]
)
