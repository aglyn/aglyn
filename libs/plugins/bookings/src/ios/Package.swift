// swift-tools-version: 5.10
//
// The Bookings plugin's Apple code: the site's bookings on a calendar with
// each booking's check-in, reschedule, cancel and refund, the services and
// their hours, and payment at the counter in Aglyn POS. The app reaches it
// only through the generated plugin manifest (apps/ios/PluginManifest).

import Foundation
import PackageDescription

// Reached through a symlink in the manifest package, so AglynKit's path is
// resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynBookingsPlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynBookingsPlugin", targets: ["AglynBookingsPlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynBookingsPlugin",
      dependencies: [
        .product(name: "AglynContracts", package: "apple"),
        .product(name: "AglynCore", package: "apple"),
        .product(name: "AglynUI", package: "apple"),
        .product(name: "AglynPluginHost", package: "apple"),
        .product(name: "AglynHardware", package: "apple"),
      ]
    ),
    .testTarget(name: "AglynBookingsPluginTests", dependencies: ["AglynBookingsPlugin"]),
  ]
)
