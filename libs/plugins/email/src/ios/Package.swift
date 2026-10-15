// swift-tools-version: 5.10
//
// The Email plugin's Apple code: a site's emails and their reports, designs,
// audiences, topics, sending and suppressions, and the import wizard's steps for
// a list's members (Resources/email-import.screens.json, which src/android/screens
// links to). The apps reach it only through the generated plugin manifest
// (apps/ios/PluginManifest).

import Foundation
import PackageDescription

// The manifest package reaches this one through a symlink
// (apps/ios/PluginManifest/Plugins/AglynEmailPlugin), so AglynKit's path is
// resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynEmailPlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynEmailPlugin", targets: ["AglynEmailPlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynEmailPlugin",
      dependencies: [
        .product(name: "AglynContracts", package: "apple"),
        .product(name: "AglynCore", package: "apple"),
        .product(name: "AglynUI", package: "apple"),
        .product(name: "AglynPluginHost", package: "apple"),
        .product(name: "AglynScreens", package: "apple"),
      ],
      resources: [.copy("Resources/email-import.screens.json")]
    ),
    .testTarget(name: "AglynEmailPluginTests", dependencies: ["AglynEmailPlugin"]),
  ]
)
