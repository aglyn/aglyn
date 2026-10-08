package com.aglyn.site

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.ScreenLayout
import com.aglyn.site.media.MediaScreen
import com.aglyn.site.media.SITE_MEDIA_SCREEN
import com.aglyn.site.pages.PagesScreen
import com.aglyn.site.pages.SITE_PAGES_SCREEN
import com.aglyn.site.sites.CurrentSiteScreen
import com.aglyn.site.sites.SITE_SITES_SCREEN
import com.aglyn.site.sites.SITE_SITE_SCREEN
import com.aglyn.site.sites.SitesScreen

/** The owner of the platform's own content screens: core, not a plugin. */
const val SITE_PLATFORM_ID = "site"

/** The picked site's areas, as its overview lists them, in the console's order. */
enum class SiteAreas(val screen: String, val title: String, val supporting: String, val icon: String) {
  PAGES(SITE_PAGES_SCREEN, "Pages", "Publish, organize and open pages in the Besigner", "description"),
  MEDIA(SITE_MEDIA_SCREEN, "Media", "Photos, videos and documents for your pages", "photo_library"),
}

/** Every id this registration adds, by kind, the way a plugin's `mobile.contributes` declares them. */
val SITE_PLATFORM_CONTRIBUTES: Map<String, List<String>> = mapOf(
  "screens" to listOf(SITE_SITES_SCREEN, SITE_SITE_SCREEN, SITE_PAGES_SCREEN, SITE_MEDIA_SCREEN),
  "quickActions" to listOf("site.sites-open", "site.pages-open", "site.media-open"),
  "deepLinks" to listOf("site.sites-page", "site.pages-page", "site.page-view", "site.page-besigner-list", "site.media-page"),
)

/**
 * The platform's own content screens (AGL-3668): Sites, Pages and the media library so far.
 * They are core features, so the shells load this entry beside the generated
 * plugin manifest, through the same registrar and the same declaration
 * check a plugin gets.
 */
fun registerSitePlatformNative(r: NativePluginRegistrar) {
  r.screen(SITE_SITES_SCREEN, title = "Sites", icon = "public", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    SitesScreen(context, initialSiteId = params["site"])
  }
  r.screen(SITE_SITE_SCREEN, title = "Site", requiresSite = true, icon = "public") { context, params -> CurrentSiteScreen(context, params) }
  r.screen(SITE_PAGES_SCREEN, title = "Pages", requiresSite = true, icon = "description", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    PagesScreen(context, initialPageId = params["page"] ?: params["screenId"])
  }

  r.screen(SITE_MEDIA_SCREEN, title = "Media", icon = "photo_library", layout = ScreenLayout.LIST_DETAIL) { context, params -> MediaScreen(context, params) }
  r.quickAction("site.media-open", title = "Media", icon = "photo_library", order = 20, screen = SITE_MEDIA_SCREEN)
  r.quickAction("site.pages-open", title = "Pages", icon = "description", order = 10, requiresSite = true, screen = SITE_PAGES_SCREEN)
  r.quickAction("site.sites-open", title = "Sites", icon = "public", order = 5, screen = SITE_SITES_SCREEN)

  r.deepLink("site.sites-page", path = "/hosts", screen = SITE_SITES_SCREEN)
  r.deepLink("site.pages-page", path = "/screens", screen = SITE_PAGES_SCREEN)
  r.deepLink("site.page-besigner-list", path = "/screens/list", screen = SITE_PAGES_SCREEN)
  // `/{org}/media` (the workspace library) and `/{org}/hosts/{site}/media` both end in `/media`; the screen reads which from the link's site.
  r.deepLink("site.media-page", path = "/media", screen = SITE_MEDIA_SCREEN)
  r.deepLink("site.page-view", path = "/screens/:screenId/versions/:versionId/view", screen = SITE_PAGES_SCREEN)
}

/** The registration as a manifest row, for the shells to load before the plugins. */
val SitePlatformEntry = NativePluginManifestEntry(SITE_PLATFORM_ID, SITE_PLATFORM_CONTRIBUTES, ::registerSitePlatformNative)
