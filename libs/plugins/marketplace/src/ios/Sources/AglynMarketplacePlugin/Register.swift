// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
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
  r.quickAction("marketplace.open", title: "Marketplace", icon: "storefront", order: 60, screen: marketplaceBrowseScreen)
  r.deepLink("marketplace.page", path: "/marketplace", screen: marketplaceBrowseScreen)
  r.deepLink("marketplace.listing-page", path: "/marketplace/:listingId", screen: marketplaceListingScreen)
}
