// swift-tools-version: 5.10
//
// The Workflows plugin's Apple code: Automation natively — the site's
// workflows, actions and webhooks with their run history, and the
// organization's automations. The app reaches it only through the generated
// plugin manifest (apps/ios/PluginManifest).

import Foundation
import PackageDescription

// Reached through a symlink in the manifest package, so AglynKit's path is
// resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynWorkflowsPlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynWorkflowsPlugin", targets: ["AglynWorkflowsPlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynWorkflowsPlugin",
      dependencies: [
        .product(name: "AglynContracts", package: "apple"),
        .product(name: "AglynCore", package: "apple"),
        .product(name: "AglynUI", package: "apple"),
        .product(name: "AglynPluginHost", package: "apple"),
      ]
    ),
    .testTarget(name: "AglynWorkflowsPluginTests", dependencies: ["AglynWorkflowsPlugin"]),
  ]
)
