// swift-tools-version: 5.10
//
// The Commerce plugin's Apple code: the Aglyn POS register (item grid,
// basket, checkout and receipt), its card readers screen, and the Aglyn
// app's store screens. The apps reach it only through the generated plugin
// manifest (apps/ios/PluginManifest).

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
    // Tap to Pay on iPhone and Bluetooth readers. iPhone and iPad only: the
    // Mac register takes cards on smart readers, which the server drives.
    .package(url: "https://github.com/stripe/stripe-terminal-ios", exact: "6.0.0"),
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
        .product(name: "StripeTerminal", package: "stripe-terminal-ios", condition: .when(platforms: [.iOS])),
      ],
      resources: [.copy("Resources/commerce.screens.json")]
    ),
    .testTarget(name: "AglynCommercePluginTests", dependencies: ["AglynCommercePlugin"]),
  ]
)
