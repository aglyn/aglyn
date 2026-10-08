package com.aglyn.site

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.ScreenLayout
import com.aglyn.site.artifacts.ArtifactKind
import com.aglyn.site.artifacts.ArtifactsScreen
import com.aglyn.site.content.ContentScreen
import com.aglyn.site.content.SITE_CONTENT_SCREEN
import com.aglyn.site.media.MediaScreen
import com.aglyn.site.media.SITE_MEDIA_SCREEN
import com.aglyn.site.pages.PagesScreen
import com.aglyn.site.setup.SITE_SETUP_SCREEN
import com.aglyn.site.setup.SITE_THEME_SCREEN
import com.aglyn.site.setup.SetupScreen
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
  CONTENT(SITE_CONTENT_SCREEN, "Content", "Blog posts and articles, by collection", "article"),
  COMPONENTS(ArtifactKind.COMPONENT.screen, "Components", "Designs you reuse across pages and emails", ArtifactKind.COMPONENT.icon),
  LAYOUTS(ArtifactKind.LAYOUT.screen, "Layouts", "The shared header and footer pages sit in", ArtifactKind.LAYOUT.icon),
  TEMPLATES(ArtifactKind.TEMPLATE.screen, "Templates", "Starting points for pages, components and layouts", ArtifactKind.TEMPLATE.icon),
  SETUP(SITE_SETUP_SCREEN, "Setup", "Details, SEO, tracking, theme and emails", "settings"),
}

/** Every id this registration adds, by kind, the way a plugin's `mobile.contributes` declares them. */
val SITE_PLATFORM_CONTRIBUTES: Map<String, List<String>> = mapOf(
  "screens" to listOf(SITE_SITES_SCREEN, SITE_SITE_SCREEN, SITE_PAGES_SCREEN, SITE_MEDIA_SCREEN, SITE_SETUP_SCREEN, SITE_THEME_SCREEN, SITE_CONTENT_SCREEN) +
    ArtifactKind.entries.map { it.screen },
  "quickActions" to listOf("site.sites-open", "site.pages-open", "site.media-open"),
  "deepLinks" to listOf("site.sites-page", "site.pages-page", "site.page-view", "site.page-besigner-list", "site.media-page") +
    ArtifactKind.entries.flatMap { listOf("site.${it.collection}-page", "site.${it.singular}-page") } + "site.layouts-list-page" +
    listOf("site.setup-page", "site.setup-section-page", "site.theme-page", "site.content-page", "site.collection-page", "site.entry-page"),
)

/**
 * The platform's own content screens (AGL-3668): Sites, Pages, the media
 * library, components, layouts, templates, the site's setup and theme, and
 * content collections.
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

  // Components, layouts and templates: the lists and each one's details page;
  // their `/versions/…/besigner` and `/preview` pages stay the Besigner's.
  for (kind in ArtifactKind.entries) {
    r.screen(kind.screen, title = kind.title, requiresSite = true, icon = kind.icon, layout = ScreenLayout.LIST_DETAIL) { context, params ->
      ArtifactsScreen(context, kind, initialId = params["id"])
    }
    r.deepLink("site.${kind.collection}-page", path = "/${kind.collection}", screen = kind.screen)
    r.deepLink("site.${kind.singular}-page", path = "/${kind.collection}/:id", screen = kind.screen)
  }
  r.deepLink("site.layouts-list-page", path = "/layouts/list", screen = ArtifactKind.LAYOUT.screen)

  // Setup: its sections (`/setup/seo`, or the old `/setup?tab=hostSeo`), and
  // the site's theme page, which is the Theme section on its own.
  r.screen(SITE_SETUP_SCREEN, title = "Setup", requiresSite = true, icon = "settings", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    SetupScreen(context, initialSection = params["section"] ?: params["tab"])
  }
  r.screen(SITE_THEME_SCREEN, title = "Theme", requiresSite = true, icon = "palette", layout = ScreenLayout.LIST_DETAIL) { context, _ ->
    SetupScreen(context, initialSection = "theme")
  }
  r.deepLink("site.setup-page", path = "/setup", screen = SITE_SETUP_SCREEN)
  r.deepLink("site.setup-section-page", path = "/setup/:section", screen = SITE_SETUP_SCREEN)
  r.deepLink("site.theme-page", path = "/theme", screen = SITE_THEME_SCREEN)

  // Content: the collections, one collection's entries, and one entry.
  r.screen(SITE_CONTENT_SCREEN, title = "Content", requiresSite = true, icon = "article", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    ContentScreen(context, initialCollection = params["collectionSlug"], initialEntry = params["entryId"]?.takeIf { it != "new" })
  }
  r.deepLink("site.content-page", path = "/content", screen = SITE_CONTENT_SCREEN)
  r.deepLink("site.collection-page", path = "/content/:collectionSlug", screen = SITE_CONTENT_SCREEN)
  r.deepLink("site.entry-page", path = "/content/:collectionSlug/entries/:entryId", screen = SITE_CONTENT_SCREEN)
}

/** The registration as a manifest row, for the shells to load before the plugins. */
val SitePlatformEntry = NativePluginManifestEntry(SITE_PLATFORM_ID, SITE_PLATFORM_CONTRIBUTES, ::registerSitePlatformNative)
