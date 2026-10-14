// swift-tools-version: 5.10
//
// The Delivery apps plugin's Apple code: the register's delivery-order queue
// (the `posOrders` zone of the Aglyn POS register). The apps reach it only
// through the generated plugin manifest (apps/ios/PluginManifest).

import Foundation
import PackageDescription

// The manifest package reaches this one through a symlink
// (apps/ios/PluginManifest/Plugins/AglynDeliveryAppsPlugin), so AglynKit's path is
// resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynDeliveryAppsPlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynDeliveryAppsPlugin", targets: ["AglynDeliveryAppsPlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynDeliveryAppsPlugin",
      dependencies: [
        .product(name: "AglynCore", package: "apple"),
        .product(name: "AglynUI", package: "apple"),
        .product(name: "AglynPluginHost", package: "apple"),
      ]
    ),
    .testTarget(name: "AglynDeliveryAppsPluginTests", dependencies: ["AglynDeliveryAppsPlugin"]),
  ]
)
