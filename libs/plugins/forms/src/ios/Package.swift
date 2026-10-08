// swift-tools-version: 5.10
//
// The Forms plugin's Apple code: a site's forms on iPhone, iPad and Mac
// (search, in use or retired, create, duplicate, rename, retire, CRM routing,
// questions, versions). The app reaches it only through the generated plugin
// manifest (apps/ios/PluginManifest).

import Foundation
import PackageDescription

// The manifest package reaches this one through a symlink
// (apps/ios/PluginManifest/Plugins/AglynFormsPlugin), so AglynKit's path is
// resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynFormsPlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynFormsPlugin", targets: ["AglynFormsPlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynFormsPlugin",
      dependencies: [
        .product(name: "AglynContracts", package: "apple"),
        .product(name: "AglynCore", package: "apple"),
        .product(name: "AglynUI", package: "apple"),
        .product(name: "AglynPluginHost", package: "apple"),
      ]
    ),
    .testTarget(name: "AglynFormsPluginTests", dependencies: ["AglynFormsPlugin"]),
  ]
)
