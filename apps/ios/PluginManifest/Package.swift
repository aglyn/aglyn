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
    .package(path: "Plugins/AglynAdConversionsPlugin"),
    .package(path: "Plugins/AglynAiPlugin"),
    .package(path: "Plugins/AglynBookingsPlugin"),
    .package(path: "Plugins/AglynCommercePlugin"),
    .package(path: "Plugins/AglynCouriersPlugin"),
    .package(path: "Plugins/AglynCrmPlugin"),
    .package(path: "Plugins/AglynDeliveryAppsPlugin"),
    .package(path: "Plugins/AglynEmailPlugin"),
    .package(path: "Plugins/AglynEventsCalendarPlugin"),
    .package(path: "Plugins/AglynFormsPlugin"),
    .package(path: "Plugins/AglynFulfillmentNetworksPlugin"),
    .package(path: "Plugins/AglynFunnelsPlugin"),
    .package(path: "Plugins/AglynInboxPlugin"),
    .package(path: "Plugins/AglynInventorySyncPlugin"),
    .package(path: "Plugins/AglynLiveChatPlugin"),
    .package(path: "Plugins/AglynMarketingPlugin"),
    .package(path: "Plugins/AglynMarketingPlatformsPlugin"),
    .package(path: "Plugins/AglynMarketplacesPlugin"),
    .package(path: "Plugins/AglynOutreachPlugin"),
    .package(path: "Plugins/AglynPostPurchasePlugin"),
    .package(path: "Plugins/AglynPrintOnDemandPlugin"),
    .package(path: "Plugins/AglynRedirectsPlugin"),
    .package(path: "Plugins/AglynSalesChannelsPlugin"),
    .package(path: "Plugins/AglynSmsPlugin"),
    .package(path: "Plugins/AglynTaxEnginesPlugin"),
    .package(path: "Plugins/AglynWorkflowsPlugin"),
    .package(path: "Plugins/AglynZapierPlugin"),
  ],
  targets: [
    .target(
      name: "AglynPluginManifest",
      dependencies: [
        .product(name: "AglynPluginHost", package: "apple"),
        .product(name: "AglynAdConversionsPlugin", package: "AglynAdConversionsPlugin"),
        .product(name: "AglynAiPlugin", package: "AglynAiPlugin"),
        .product(name: "AglynBookingsPlugin", package: "AglynBookingsPlugin"),
        .product(name: "AglynCommercePlugin", package: "AglynCommercePlugin"),
        .product(name: "AglynCouriersPlugin", package: "AglynCouriersPlugin"),
        .product(name: "AglynCrmPlugin", package: "AglynCrmPlugin"),
        .product(name: "AglynDeliveryAppsPlugin", package: "AglynDeliveryAppsPlugin"),
        .product(name: "AglynEmailPlugin", package: "AglynEmailPlugin"),
        .product(name: "AglynEventsCalendarPlugin", package: "AglynEventsCalendarPlugin"),
        .product(name: "AglynFormsPlugin", package: "AglynFormsPlugin"),
        .product(name: "AglynFulfillmentNetworksPlugin", package: "AglynFulfillmentNetworksPlugin"),
        .product(name: "AglynFunnelsPlugin", package: "AglynFunnelsPlugin"),
        .product(name: "AglynInboxPlugin", package: "AglynInboxPlugin"),
        .product(name: "AglynInventorySyncPlugin", package: "AglynInventorySyncPlugin"),
        .product(name: "AglynLiveChatPlugin", package: "AglynLiveChatPlugin"),
        .product(name: "AglynMarketingPlugin", package: "AglynMarketingPlugin"),
        .product(name: "AglynMarketingPlatformsPlugin", package: "AglynMarketingPlatformsPlugin"),
        .product(name: "AglynMarketplacesPlugin", package: "AglynMarketplacesPlugin"),
        .product(name: "AglynOutreachPlugin", package: "AglynOutreachPlugin"),
        .product(name: "AglynPostPurchasePlugin", package: "AglynPostPurchasePlugin"),
        .product(name: "AglynPrintOnDemandPlugin", package: "AglynPrintOnDemandPlugin"),
        .product(name: "AglynRedirectsPlugin", package: "AglynRedirectsPlugin"),
        .product(name: "AglynSalesChannelsPlugin", package: "AglynSalesChannelsPlugin"),
        .product(name: "AglynSmsPlugin", package: "AglynSmsPlugin"),
        .product(name: "AglynTaxEnginesPlugin", package: "AglynTaxEnginesPlugin"),
        .product(name: "AglynWorkflowsPlugin", package: "AglynWorkflowsPlugin"),
        .product(name: "AglynZapierPlugin", package: "AglynZapierPlugin"),
      ]
    ),
  ]
)
