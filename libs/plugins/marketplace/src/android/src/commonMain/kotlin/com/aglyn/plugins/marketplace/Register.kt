package com.aglyn.plugins.marketplace

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.ScreenLayout
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The Marketplace plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. The workspace's
 * Marketplace page (`/{org}/marketplace`): browse, a listing's page, the
 * installed plugins and the licenses; a quick action opens browse. Its spec screens
 * (screens/marketplace.screens.json) publish the site as a template, from Backup &
 * restore's `siteTemplate` zone, and present the Publisher Agreement that needs.
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
  r.screen(MARKETPLACE_SELL_SCREEN, title = "Selling", icon = "storefront") { context, params -> SellScreen(context, params["section"]) }
  // A marketplace plugin's own settings, from its manifest, opened from its page in the workspace's plugins.
  r.screen(MARKETPLACE_PLUGIN_SETTINGS_SCREEN, title = "Plugin settings", icon = "settings") { context, params ->
    PluginSettingsScreen(context, params["listing"].orEmpty())
  }
  // The workspace's plugin pages hand the marketplace two slots (the console's `PluginWidgetSlot`): the plugins installed
  // from it, on the list, and one plugin's installation on its page.
  r.widget("marketplace.org-installs", title = "Installed from the marketplace", order = 10, slot = "orgPluginInstalls") { context ->
    OrgPluginInstallsCard(context)
  }
  r.widget("marketplace.plugin-installation", title = "Installation", order = 10, slot = "pluginInstallation") { context ->
    PluginInstallationCard(context)
  }
  // A site's component and layout pages offer Publish to marketplace only where a plugin fills this slot (the console's
  // `hostArtifactPublish` zone); the publish itself is this plugin's spec screens, so the widget draws nothing of its own.
  r.widget("marketplace.artifact-publish", title = "Publish to marketplace", order = 10, slot = "hostArtifactPublish") { _ -> }
  r.quickAction("marketplace.open", title = "Marketplace", icon = "storefront", order = 60, screen = MARKETPLACE_BROWSE_SCREEN)
  r.deepLink("marketplace.page", path = "/marketplace", screen = MARKETPLACE_BROWSE_SCREEN)
  r.deepLink("marketplace.listing-page", path = "/marketplace/:listingId", screen = MARKETPLACE_LISTING_SCREEN)
  SpecScreens.register(MarketplaceScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, r)
}
