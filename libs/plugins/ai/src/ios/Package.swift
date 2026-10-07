// swift-tools-version: 5.10
//
// The AI plugin's Apple code: its jobs, credits and staff screens, drawn by
// AglynScreens from the spec its Kotlin module reads too
// (src/android/screens/ai.screens.json, linked into Resources). The app
// reaches it only through the generated plugin manifest.

import Foundation
import PackageDescription

// The manifest package reaches this one through a symlink, so AglynKit's
// path is resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynAiPlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynAiPlugin", targets: ["AglynAiPlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynAiPlugin",
      dependencies: [
        .product(name: "AglynPluginHost", package: "apple"),
        .product(name: "AglynScreens", package: "apple"),
      ],
      resources: [.copy("Resources/ai.screens.json")]
    ),
    .testTarget(name: "AglynAiPluginTests", dependencies: ["AglynAiPlugin"]),
  ]
)
