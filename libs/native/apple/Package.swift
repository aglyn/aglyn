// swift-tools-version: 5.10
//
// AglynKit: the Apple foundation every Aglyn app and plugin builds on
// (docs/mobile/native-architecture.md §2–§3). iOS, iPadOS and native macOS
// from one source; nothing here imports web or server code.

import Foundation
import PackageDescription

/// The core screen specs, each a link in Sources/AglynScreens/Resources/screens
/// to libs/native/screens, copied as single files (a copied folder of links
/// would carry the links, not the specs).
let screenSpecs = ((try? FileManager.default.contentsOfDirectory(
  atPath: Context.packageDirectory + "/Sources/AglynScreens/Resources/screens")) ?? [])
  .filter { $0.hasSuffix(".screens.json") }.sorted()

let package = Package(
  name: "AglynKit",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "AglynCore", targets: ["AglynCore"]),
    .library(name: "AglynUI", targets: ["AglynUI"]),
    .library(name: "AglynWebView", targets: ["AglynWebView"]),
    .library(name: "AglynPluginHost", targets: ["AglynPluginHost"]),
    .library(name: "AglynContracts", targets: ["AglynContracts"]),
    .library(name: "AglynHardware", targets: ["AglynHardware"]),
    .library(name: "AglynScreens", targets: ["AglynScreens"]),
    // The platform's own content screens (sites, pages, media): core, not a
    // plugin, loaded by the shells beside the generated plugin manifest.
    .library(name: "AglynSite", targets: ["AglynSite"]),
  ],
  dependencies: [
    .package(url: "https://github.com/firebase/firebase-ios-sdk.git", from: "12.0.0"),
  ],
  targets: [
    .target(
      name: "AglynCore",
      dependencies: [
        "AglynContracts",
        .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),
        .product(name: "FirebaseFirestore", package: "firebase-ios-sdk"),
      ],
      // The notification catalog, linked in from libs/native/contracts.
      resources: [.copy("Resources/notification-catalog.generated.json")]
    ),
    .target(name: "AglynUI", resources: [.process("Resources")]),
    // contracts.generated.json is a link to libs/native/contracts, so the
    // bundled values are always the generated ones.
    .target(name: "AglynContracts", resources: [.copy("Resources/contracts.generated.json")]),
    .target(name: "AglynHardware"),
    .target(name: "AglynWebView", dependencies: ["AglynCore"]),
    .target(name: "AglynPluginHost", dependencies: ["AglynContracts", "AglynCore", "AglynUI", "AglynWebView"]),
    // Console screens drawn from specs (§13); Resources/screens links each
    // core spec file in libs/native/screens.
    .target(
      name: "AglynScreens",
      dependencies: ["AglynCore", "AglynContracts", "AglynUI", "AglynPluginHost"],
      resources: screenSpecs.map { .copy("Resources/screens/\($0)") }
    ),
    .target(name: "AglynSite", dependencies: ["AglynContracts", "AglynCore", "AglynUI", "AglynPluginHost"]),
    .testTarget(name: "AglynContractsTests", dependencies: ["AglynContracts"]),
    .testTarget(name: "AglynCoreTests", dependencies: ["AglynCore", "AglynContracts"]),
    .testTarget(name: "AglynPluginHostTests", dependencies: ["AglynPluginHost", "AglynWebView"]),
    .testTarget(name: "AglynHardwareTests", dependencies: ["AglynHardware"]),
    .testTarget(name: "AglynScreensTests", dependencies: ["AglynScreens", "AglynPluginHost", "AglynContracts", "AglynCore"]),
    .testTarget(name: "AglynSiteTests", dependencies: ["AglynSite", "AglynCore", "AglynContracts", "AglynPluginHost"]),
  ]
)
