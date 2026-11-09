// swift-tools-version: 5.10
//
// The Waivers plugin's Apple code: a rider's waiver at check-in, drawn in commerce's `posCheckIn` zone. The app
// reaches it only through the generated plugin manifest.

import Foundation
import PackageDescription

// The manifest package reaches this one through a symlink, so AglynKit's
// path is resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynWaiversPlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynWaiversPlugin", targets: ["AglynWaiversPlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynWaiversPlugin",
      dependencies: [
        .product(name: "AglynCore", package: "apple"),
        .product(name: "AglynPluginHost", package: "apple"),
        .product(name: "AglynUI", package: "apple"),
      ]
    ),
    .testTarget(name: "AglynWaiversPluginTests", dependencies: ["AglynWaiversPlugin"]),
  ]
)
