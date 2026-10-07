// swift-tools-version: 5.10
//
// AglynKit: the Apple foundation every Aglyn app and plugin builds on
// (docs/mobile/native-architecture.md §2–§3). iOS, iPadOS and native macOS
// from one source; nothing here imports web or server code.

import PackageDescription

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
  ],
  dependencies: [
    .package(url: "https://github.com/firebase/firebase-ios-sdk.git", from: "12.0.0"),
  ],
  targets: [
    .target(
      name: "AglynCore",
      dependencies: [
        .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),
        .product(name: "FirebaseFirestore", package: "firebase-ios-sdk"),
      ]
    ),
    .target(name: "AglynUI", resources: [.process("Resources")]),
    .target(name: "AglynContracts"),
    .target(name: "AglynHardware"),
    .target(name: "AglynWebView", dependencies: ["AglynCore"]),
    .target(name: "AglynPluginHost", dependencies: ["AglynCore", "AglynUI", "AglynWebView"]),
    .testTarget(name: "AglynCoreTests", dependencies: ["AglynCore"]),
    .testTarget(name: "AglynPluginHostTests", dependencies: ["AglynPluginHost", "AglynWebView"]),
  ]
)
