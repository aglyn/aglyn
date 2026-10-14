// swift-tools-version: 5.10
//
// The InventorySync plugin's Apple code: its screens, drawn by
// AglynScreens from the spec its Kotlin module reads too
// (Resources/inventory-sync.screens.json, which src/android/screens links to). The app
// reaches it only through the generated plugin manifest.

import Foundation
import PackageDescription

// The manifest package reaches this one through a symlink, so AglynKit's
// path is resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynInventorySyncPlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynInventorySyncPlugin", targets: ["AglynInventorySyncPlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynInventorySyncPlugin",
      dependencies: [
        .product(name: "AglynPluginHost", package: "apple"),
        .product(name: "AglynScreens", package: "apple"),
      ],
      resources: [.copy("Resources/inventory-sync.screens.json")]
    ),
    .testTarget(name: "AglynInventorySyncPluginTests", dependencies: ["AglynInventorySyncPlugin"]),
  ]
)
