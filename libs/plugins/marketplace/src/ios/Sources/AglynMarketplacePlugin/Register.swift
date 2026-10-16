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
  // A site's component and layout pages offer Publish to marketplace only where a plugin fills this slot (the console's
  // `hostArtifactPublish` zone); the publish itself is this plugin's spec screens, so the widget draws nothing of its own.
  r.widget("marketplace.artifact-publish", title: "Publish to marketplace", order: 10, slot: "hostArtifactPublish") { _ in EmptyView() }
  r.quickAction("marketplace.open", title: "Marketplace", icon: "storefront", order: 60, screen: marketplaceBrowseScreen)
  r.deepLink("marketplace.page", path: "/marketplace", screen: marketplaceBrowseScreen)
  r.deepLink("marketplace.listing-page", path: "/marketplace/:listingId", screen: marketplaceListingScreen)
  // Publishing the site as a template, from Backup & restore's `siteTemplate` zone, and the Publisher Agreement it needs.
  SpecScreens.register(ScreenCatalog.load(from: .module), into: r)
}
