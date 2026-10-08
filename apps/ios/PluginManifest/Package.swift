// swift-tools-version: 5.9
// GENERATED — do not edit. Regenerate with: node tools/scripts/generate-plugin-manifests.mjs
//
// The native plugin manifest package: the app targets depend on it and on
// AglynKit, never on a plugin. Source of truth: plugins.config.json.

import PackageDescription

let package = Package(
  name: "AglynPluginManifest",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [.library(name: "AglynPluginManifest", targets: ["AglynPluginManifest"])],
  dependencies: [
    .package(path: "../../../libs/native/apple"),
    .package(path: "Plugins/AglynCommercePlugin"),
    .package(path: "Plugins/AglynCrmPlugin"),
    .package(path: "Plugins/AglynInboxPlugin"),
    .package(path: "Plugins/AglynRedirectsPlugin"),
  ],
  targets: [
    .target(
      name: "AglynPluginManifest",
      dependencies: [
        .product(name: "AglynPluginHost", package: "apple"),
        .product(name: "AglynCommercePlugin", package: "AglynCommercePlugin"),
        .product(name: "AglynCrmPlugin", package: "AglynCrmPlugin"),
        .product(name: "AglynInboxPlugin", package: "AglynInboxPlugin"),
        .product(name: "AglynRedirectsPlugin", package: "AglynRedirectsPlugin"),
      ]
    ),
  ]
)
