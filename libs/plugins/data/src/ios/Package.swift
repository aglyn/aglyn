// swift-tools-version: 5.10
//
// The Data plugin's Apple code: the workspace's datasets on iPhone, iPad and Mac
// (records with search and filters, record create, edit and delete, the schema
// editor, sharing, export). The app reaches it only through the generated plugin
// manifest (apps/ios/PluginManifest).

import Foundation
import PackageDescription

// The manifest package reaches this one through a symlink
// (apps/ios/PluginManifest/Plugins/AglynDataPlugin), so AglynKit's path is
// resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynDataPlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynDataPlugin", targets: ["AglynDataPlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynDataPlugin",
      dependencies: [
        .product(name: "AglynContracts", package: "apple"),
        .product(name: "AglynCore", package: "apple"),
        .product(name: "AglynUI", package: "apple"),
        .product(name: "AglynPluginHost", package: "apple"),
      ]
    ),
    .testTarget(name: "AglynDataPluginTests", dependencies: ["AglynDataPlugin"]),
  ]
)
