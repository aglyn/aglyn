// swift-tools-version: 5.10
//
// The Events Calendar plugin's Apple code: the site's events, added, edited,
// published and deleted natively. The app reaches it only through
// the generated plugin manifest (apps/ios/PluginManifest).

import Foundation
import PackageDescription

// The manifest package reaches this one through a symlink
// (apps/ios/PluginManifest/Plugins/AglynEventsCalendarPlugin), so AglynKit's path is
// resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynEventsCalendarPlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynEventsCalendarPlugin", targets: ["AglynEventsCalendarPlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynEventsCalendarPlugin",
      dependencies: [
        .product(name: "AglynContracts", package: "apple"),
        .product(name: "AglynCore", package: "apple"),
        .product(name: "AglynUI", package: "apple"),
        .product(name: "AglynPluginHost", package: "apple"),
      ]
    ),
    .testTarget(name: "AglynEventsCalendarPluginTests", dependencies: ["AglynEventsCalendarPlugin"]),
  ]
)
