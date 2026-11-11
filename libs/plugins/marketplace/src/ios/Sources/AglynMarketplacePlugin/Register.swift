// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import SwiftUI

/// The Marketplace plugin's native registration: the same ids its `mobile.contributes` declares in plugins.config.json (the
/// Kotlin registrar names the same ones). The workspace's Marketplace page (`/{org}/marketplace`): browse, a listing's
/// page, the installed plugins and the licenses; a quick action opens browse.
@MainActor
public func registerMarketplaceNative(_ r: NativePluginRegistrar) {
  r.screen(marketplaceBrowseScreen, title: "Marketplace", icon: "storefront") { context, params in
    BrowseScreen(context: context, initialListingID: params["listing"])
  }
  r.screen(marketplaceListingScreen, title: "Listing", icon: "storefront") { context, params in
    if let listingID = params["listing"] ?? params["listingId"] {
      ListingScreen(context: context, listingID: listingID)
    } else {
      BrowseScreen(context: context)
    }
  }
  r.screen(marketplaceInstalledScreen, title: "Installed", requiresSite: true, icon: "puzzlepiece.extension") { context, _ in
    InstalledScreen(context: context)
  }
  r.screen(marketplaceLicencesScreen, title: "Licenses", icon: "doc.text") { context, _ in LicencesScreen(context: context) }
  r.screen(marketplaceSellScreen, title: "Selling", icon: "storefront") { context, params in
    SellScreen(context: context, initialSection: params["section"])
  }
  // A marketplace plugin's own settings, from its manifest, opened from its page in the workspace's plugins.
  r.screen(marketplacePluginSettingsScreen, title: "Plugin settings", icon: "gearshape") { context, params in
    PluginSettingsScreen(context: context, listingID: params["listing"] ?? "")
  }
  // The workspace's plugin pages hand the marketplace two slots (the console's `PluginWidgetSlot`): the plugins installed
  // from it, on the list, and one plugin's installation on its page.
  r.widget("marketplace.org-installs", title: "Installed from the marketplace", order: 10, slot: "orgPluginInstalls") {
    OrgPluginInstallsCard(context: $0)
  }
  r.widget("marketplace.plugin-installation", title: "Installation", order: 10, slot: "pluginInstallation") {
    PluginInstallationCard(context: $0)
  }
  // A site's page for one installed plugin hands the marketplace the connections its manifest declares (the console's
  // `sitePluginConnections` zone): connect, choose, sync and disconnect, for that site.
  r.widget("marketplace.site-connections", title: "Connections", order: 10, slot: "sitePluginConnections") {
    SitePluginConnectionsCard(context: $0)
  }
  // A site's component and layout pages offer Publish to marketplace only where a plugin fills this slot (the console's
  // `hostArtifactPublish` zone); the publish itself is this plugin's spec screens, so the widget draws nothing of its own.
  r.widget("marketplace.artifact-publish", title: "Publish to marketplace", order: 10, slot: "hostArtifactPublish") { _ in EmptyView() }
  // Create site lists the marketplace's starters through this slot (the console's `hostStarterPicker` zone), and never
  // names the plugin that fills it.
  r.widget("marketplace.starter-picker", title: "Choose your starter", order: 10, slot: StarterPickerZone.slot) {
    StarterPickerWidget(context: $0)
  }
  r.quickAction("marketplace.open", title: "Marketplace", icon: "storefront", order: 60, screen: marketplaceBrowseScreen)
  r.deepLink("marketplace.page", path: "/marketplace", screen: marketplaceBrowseScreen)
  // The hub's sections are pages of their own (`/marketplace/payouts`), and win over a listing's `/marketplace/{id}`; the
  // one section the app has no screen for (upload) is never read as a listing id (AGL-4215).
  r.deepLink("marketplace.browse-page", path: "/marketplace/browse", screen: marketplaceBrowseScreen)
  r.deepLink("marketplace.installed-page", path: "/marketplace/installed", screen: marketplaceInstalledScreen)
  r.deepLink("marketplace.licences-page", path: "/marketplace/licences", screen: marketplaceLicencesScreen)
  r.deepLink("marketplace.sell-page", path: "/marketplace/:section(profile|listings|payouts|sales)", screen: marketplaceSellScreen)
  r.deepLink("marketplace.listing-page", path: "/marketplace/:listingId(!upload)", screen: marketplaceListingScreen)
  // Publishing the site as a template, from Backup & restore's `siteTemplate` zone, and the Publisher Agreement it needs.
  SpecScreens.register(ScreenCatalog.load(from: .module), into: r)
}
