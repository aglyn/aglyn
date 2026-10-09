package com.aglyn.plugins.marketplace

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.ScreenLayout

/**
 * The Marketplace plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. The workspace's
 * Marketplace page (`/{org}/marketplace`): browse, a listing's page, the
 * installed plugins and the licenses; a quick action opens browse.
 */
fun registerMarketplaceNative(r: NativePluginRegistrar) {
  r.screen(MARKETPLACE_BROWSE_SCREEN, title = "Marketplace", icon = "storefront", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    BrowseScreen(context, initialListingId = params["listing"])
  }
  r.screen(MARKETPLACE_LISTING_SCREEN, title = "Listing", icon = "storefront") { context, params ->
    val listingId = params["listing"] ?: params["listingId"]
    if (listingId == null) BrowseScreen(context) else ListingScreen(context, listingId)
  }
  r.screen(MARKETPLACE_INSTALLED_SCREEN, title = "Installed", requiresSite = true, icon = "extension") { context, _ -> InstalledScreen(context) }
  r.screen(MARKETPLACE_LICENCES_SCREEN, title = "Licenses", icon = "receipt") { context, _ -> LicencesScreen(context) }
  r.quickAction("marketplace.open", title = "Marketplace", icon = "storefront", order = 60, screen = MARKETPLACE_BROWSE_SCREEN)
  r.deepLink("marketplace.page", path = "/marketplace", screen = MARKETPLACE_BROWSE_SCREEN)
  r.deepLink("marketplace.listing-page", path = "/marketplace/:listingId", screen = MARKETPLACE_LISTING_SCREEN)
}
