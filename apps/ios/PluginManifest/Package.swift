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
    .package(path: "Plugins/AglynAiPlugin"),
    .package(path: "Plugins/AglynBookingsPlugin"),
    .package(path: "Plugins/AglynCommercePlugin"),
    .package(path: "Plugins/AglynCrmPlugin"),
    .package(path: "Plugins/AglynEmailPlugin"),
    .package(path: "Plugins/AglynEventsCalendarPlugin"),
    .package(path: "Plugins/AglynFormsPlugin"),
    .package(path: "Plugins/AglynFulfillmentNetworksPlugin"),
    .package(path: "Plugins/AglynFunnelsPlugin"),
    .package(path: "Plugins/AglynInboxPlugin"),
    .package(path: "Plugins/AglynMarketingPlugin"),
    .package(path: "Plugins/AglynOutreachPlugin"),
    .package(path: "Plugins/AglynPostPurchasePlugin"),
    .package(path: "Plugins/AglynRedirectsPlugin"),
    .package(path: "Plugins/AglynSmsPlugin"),
    .package(path: "Plugins/AglynTaxEnginesPlugin"),
    .package(path: "Plugins/AglynWorkflowsPlugin"),
  ],
  targets: [
    .target(
      name: "AglynPluginManifest",
      dependencies: [
        .product(name: "AglynPluginHost", package: "apple"),
        .product(name: "AglynAiPlugin", package: "AglynAiPlugin"),
        .product(name: "AglynBookingsPlugin", package: "AglynBookingsPlugin"),
        .product(name: "AglynCommercePlugin", package: "AglynCommercePlugin"),
        .product(name: "AglynCrmPlugin", package: "AglynCrmPlugin"),
        .product(name: "AglynEmailPlugin", package: "AglynEmailPlugin"),
        .product(name: "AglynEventsCalendarPlugin", package: "AglynEventsCalendarPlugin"),
        .product(name: "AglynFormsPlugin", package: "AglynFormsPlugin"),
        .product(name: "AglynFulfillmentNetworksPlugin", package: "AglynFulfillmentNetworksPlugin"),
        .product(name: "AglynFunnelsPlugin", package: "AglynFunnelsPlugin"),
        .product(name: "AglynInboxPlugin", package: "AglynInboxPlugin"),
        .product(name: "AglynMarketingPlugin", package: "AglynMarketingPlugin"),
        .product(name: "AglynOutreachPlugin", package: "AglynOutreachPlugin"),
        .product(name: "AglynPostPurchasePlugin", package: "AglynPostPurchasePlugin"),
        .product(name: "AglynRedirectsPlugin", package: "AglynRedirectsPlugin"),
        .product(name: "AglynSmsPlugin", package: "AglynSmsPlugin"),
        .product(name: "AglynTaxEnginesPlugin", package: "AglynTaxEnginesPlugin"),
        .product(name: "AglynWorkflowsPlugin", package: "AglynWorkflowsPlugin"),
      ]
    ),
  ]
)
