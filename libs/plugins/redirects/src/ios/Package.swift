// swift-tools-version: 5.10
//
// The Redirects plugin's Apple code: the sample native registration every
// other plugin's `src/ios` package follows. The app reaches it only through
// the generated plugin manifest (apps/ios/PluginManifest).

import Foundation
import PackageDescription

// The manifest package reaches this one through a symlink
// (apps/ios/PluginManifest/Plugins/AglynRedirectsPlugin), so AglynKit's path is
// resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynRedirectsPlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynRedirectsPlugin", targets: ["AglynRedirectsPlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynRedirectsPlugin",
      dependencies: [
        .product(name: "AglynContracts", package: "apple"),
        .product(name: "AglynCore", package: "apple"),
        .product(name: "AglynUI", package: "apple"),
        .product(name: "AglynPluginHost", package: "apple"),
      ]
    ),
    .testTarget(name: "AglynRedirectsPluginTests", dependencies: ["AglynRedirectsPlugin"]),
  ]
)
