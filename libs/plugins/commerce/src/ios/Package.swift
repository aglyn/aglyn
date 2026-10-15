// swift-tools-version: 5.10
//
// The Commerce plugin's Apple code: the Aglyn POS register (item grid,
// basket, checkout and receipt), its card readers screen, and the Aglyn
// app's store screens. The apps reach it only through the generated plugin
// manifest (apps/ios/PluginManifest), which both apps link, so this package
// names no card SDK: the register reaches this device's reader through
// AglynHardware's `CardCollector` seam, which Aglyn POS fills at launch.

import Foundation
import PackageDescription

// The manifest package reaches this one through a symlink
// (apps/ios/PluginManifest/Plugins/AglynCommercePlugin), so AglynKit's path is
// resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynCommercePlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynCommercePlugin", targets: ["AglynCommercePlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynCommercePlugin",
      dependencies: [
        .product(name: "AglynContracts", package: "apple"),
        .product(name: "AglynCore", package: "apple"),
        .product(name: "AglynUI", package: "apple"),
        .product(name: "AglynHardware", package: "apple"),
        .product(name: "AglynPluginHost", package: "apple"),
        .product(name: "AglynScreens", package: "apple"),
        .product(name: "AglynSite", package: "apple"),
      ],
      resources: [.copy("Resources/commerce-catalog.screens.json"), .copy("Resources/commerce-import.screens.json"), .copy("Resources/commerce-promotions.screens.json"), .copy("Resources/commerce-queues.screens.json"), .copy("Resources/commerce-returns.screens.json"), .copy("Resources/commerce-stock.screens.json"), .copy("Resources/commerce-store.screens.json"), .copy("Resources/commerce-store2.screens.json"), .copy("Resources/commerce.screens.json")]
    ),
    .testTarget(name: "AglynCommercePluginTests", dependencies: ["AglynCommercePlugin"]),
  ]
)
