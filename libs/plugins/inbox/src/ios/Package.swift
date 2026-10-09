// swift-tools-version: 5.10
//
// The Inbox plugin's Apple code: a site's form submissions on iPhone, iPad
// and Mac (read filter, form pick, search, read or unread, reply, delete,
// export, add to a marketing list), its members and leads, and a Home card
// of unread messages. The apps reach it only through the generated plugin
// manifest (apps/ios/PluginManifest).

import Foundation
import PackageDescription

// The manifest package reaches this one through a symlink
// (apps/ios/PluginManifest/Plugins/AglynInboxPlugin), so AglynKit's path is
// resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynInboxPlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynInboxPlugin", targets: ["AglynInboxPlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynInboxPlugin",
      dependencies: [
        .product(name: "AglynContracts", package: "apple"),
        .product(name: "AglynCore", package: "apple"),
        .product(name: "AglynUI", package: "apple"),
        .product(name: "AglynPluginHost", package: "apple"),
      ]
    ),
    .testTarget(name: "AglynInboxPluginTests", dependencies: ["AglynInboxPlugin"]),
  ]
)
