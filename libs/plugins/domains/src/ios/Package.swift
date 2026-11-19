// swift-tools-version: 5.10
//
// The Domains plugin's Apple code: its screens, drawn by
// AglynScreens from the spec its Kotlin module reads too
// (Resources/domains.screens.json, which src/android/screens links to). The app
// reaches it only through the generated plugin manifest.

import Foundation
import PackageDescription

// The manifest package reaches this one through a symlink, so AglynKit's
// path is resolved from this package's real directory, not the link's.
let kit = URL(fileURLWithPath: Context.packageDirectory).resolvingSymlinksInPath()
  .appendingPathComponent("../../../../native/apple").standardizedFileURL.path

let package = Package(
  name: "AglynDomainsPlugin",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynDomainsPlugin", targets: ["AglynDomainsPlugin"]),
  ],
  dependencies: [
    .package(path: kit),
  ],
  targets: [
    .target(
      name: "AglynDomainsPlugin",
      dependencies: [
        .product(name: "AglynPluginHost", package: "apple"),
        .product(name: "AglynScreens", package: "apple"),
      ],
      resources: [.copy("Resources/domains.screens.json")]
    ),
    .testTarget(name: "AglynDomainsPluginTests", dependencies: ["AglynDomainsPlugin"]),
  ]
)
