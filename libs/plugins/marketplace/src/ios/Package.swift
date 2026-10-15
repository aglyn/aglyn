// swift-tools-version: 5.10
//
// The Marketplace plugin's Apple code: the workspace's Marketplace on iPhone, iPad and Mac
// (browse, a listing's page, install, update and remove a plugin, reviews, the
// installed plugins and the licenses). The app reaches it only through the generated plugin
// manifest (apps/ios/PluginManifest).

import Foundation
import PackageDescription

// The manifest package reaches this one through a symlink
// (apps/ios/PluginManifest/Plugins/AglynMarketplacePlugin), so AglynKit's path is
// resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynMarketplacePlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynMarketplacePlugin", targets: ["AglynMarketplacePlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynMarketplacePlugin",
      dependencies: [
        .product(name: "AglynContracts", package: "apple"),
        .product(name: "AglynCore", package: "apple"),
        .product(name: "AglynUI", package: "apple"),
        .product(name: "AglynPluginHost", package: "apple"),
        .product(name: "AglynScreens", package: "apple"),
      ],
      // Publishing the site as a template: the spec screens its Kotlin module reads too (src/android/screens links the file).
      resources: [.copy("Resources/marketplace.screens.json")]
    ),
    .testTarget(name: "AglynMarketplacePluginTests", dependencies: ["AglynMarketplacePlugin"]),
  ]
)
