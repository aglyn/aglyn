// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import SwiftUI

/// The owner of the platform's own content screens: core, not a plugin.
public let sitePlatformID = "site"

public let siteSitesScreen = "site.sites"
public let siteSiteScreen = "site.site"
public let sitePagesScreen = "site.pages"
public let siteMediaScreen = "site.media"
public let siteContentScreen = "site.content"
public let siteSetupScreen = "site.setup"
/// The site's theme page (`/theme`): the Theme section on its own.
public let siteThemeScreen = "site.theme"

/// The SF Symbols the content screens use.
enum SiteSymbols {
  static let site = "globe"
  static let page = "doc.text"
  static let home = "house"
  static let group = "folder"
  static let media = "photo.on.rectangle"
  static let error = "exclamationmark.triangle"
  static let content = "doc.richtext"
  static let setup = "gearshape"
  static let theme = "paintpalette"
}

/// The picked site's areas, as its overview lists them, in the console's order.
public enum SiteAreas: CaseIterable, Sendable {
  case pages, media, content, setup

  public var screen: String {
    switch self {
    case .pages: sitePagesScreen
    case .media: siteMediaScreen
    case .content: siteContentScreen
    case .setup: siteSetupScreen
    }
  }

  public var title: String {
    switch self {
    case .pages: "Pages"
    case .media: "Media"
    case .content: "Content"
    case .setup: "Setup"
    }
  }

  public var supporting: String {
    switch self {
    case .pages: "Publish, organize and open pages in the Besigner"
    case .media: "Photos, videos and documents for your pages"
    case .content: "Blog posts and articles, by collection"
    case .setup: "Details, SEO, tracking, theme and emails"
    }
  }

  public var systemImage: String {
    switch self {
    case .pages: SiteSymbols.page
    case .media: SiteSymbols.media
    case .content: SiteSymbols.content
    case .setup: SiteSymbols.setup
    }
  }
}

/// Every id this registration adds, by kind, the way a plugin's `mobile.contributes` declares them.
public let sitePlatformContributes: [String: [String]] = [
  "screens": [siteSitesScreen, siteSiteScreen, sitePagesScreen, siteMediaScreen, siteSetupScreen, siteThemeScreen, siteContentScreen],
  "quickActions": ["site.sites-open", "site.pages-open", "site.media-open"],
  "deepLinks": ["site.sites-page", "site.pages-page", "site.page-view", "site.page-besigner-list", "site.media-page",
    "site.setup-page", "site.setup-section-page", "site.theme-page",
    "site.content-page", "site.collection-page", "site.entry-page",
  ],
]

/// The platform's own content screens (AGL-3668): Sites, Pages and the media
/// library. They are core features, so the shells load this entry beside
/// the generated plugin manifest, through the same registrar and the same
/// declaration check a plugin gets.
@MainActor
public func registerSitePlatformNative(_ r: NativePluginRegistrar) {
  r.screen(siteSitesScreen, title: "Sites", icon: SiteSymbols.site) { context, params in
    SitesScreen(context: context, initialSiteID: params["site"])
  }
  r.screen(siteSiteScreen, title: "Site", requiresSite: true, icon: SiteSymbols.site) { context, params in
    CurrentSiteScreen(context: context, params: params)
  }
  r.screen(sitePagesScreen, title: "Pages", requiresSite: true, icon: SiteSymbols.page) { context, params in
    PagesScreen(context: context, initialPageID: params["page"] ?? params["screenId"])
  }
  r.screen(siteMediaScreen, title: "Media", icon: SiteSymbols.media) { context, params in
    MediaScreen(context: context, params: params)
  }
  // Setup: its sections (`/setup/seo`, or the old `/setup?tab=hostSeo`), and
  // the site's theme page, which is the Theme section on its own.
  r.screen(siteSetupScreen, title: "Setup", requiresSite: true, icon: SiteSymbols.setup) { context, params in
    SetupScreen(context: context, initialSection: params["section"] ?? params["tab"])
  }
  r.screen(siteThemeScreen, title: "Theme", requiresSite: true, icon: SiteSymbols.theme) { context, _ in
    SetupScreen(context: context, initialSection: "theme")
  }
  // Content: the collections, one collection's entries, and one entry.
  r.screen(siteContentScreen, title: "Content", requiresSite: true, icon: SiteSymbols.content) { context, params in
    ContentScreen(context: context, initialCollection: params["collectionSlug"], initialEntry: params["entryId"])
  }
  r.quickAction("site.media-open", title: "Media", icon: SiteSymbols.media, order: 20, screen: siteMediaScreen)
  r.quickAction(
    "site.pages-open", title: "Pages", icon: SiteSymbols.page, order: 10, screen: sitePagesScreen, requiresSite: true)
  r.quickAction("site.sites-open", title: "Sites", icon: SiteSymbols.site, order: 5, screen: siteSitesScreen)

  r.deepLink("site.sites-page", path: "/hosts", screen: siteSitesScreen)
  r.deepLink("site.pages-page", path: "/screens", screen: sitePagesScreen)
  r.deepLink("site.page-besigner-list", path: "/screens/list", screen: sitePagesScreen)
  // `/{org}/media` (the workspace library) and `/{org}/hosts/{site}/media` both
  // end in `/media`; the screen reads which from the link's site.
  r.deepLink("site.media-page", path: "/media", screen: siteMediaScreen)
  r.deepLink("site.setup-page", path: "/setup", screen: siteSetupScreen)
  r.deepLink("site.setup-section-page", path: "/setup/:section", screen: siteSetupScreen)
  r.deepLink("site.theme-page", path: "/theme", screen: siteThemeScreen)
  r.deepLink("site.content-page", path: "/content", screen: siteContentScreen)
  r.deepLink("site.collection-page", path: "/content/:collectionSlug", screen: siteContentScreen)
  r.deepLink("site.entry-page", path: "/content/:collectionSlug/entries/:entryId", screen: siteContentScreen)
  r.deepLink("site.page-view", path: "/screens/:screenId/versions/:versionId/view", screen: sitePagesScreen)
}

/// The registration as a manifest row, for the shells to load before the plugins.
public let sitePlatformEntry = NativePluginManifestEntry(
  id: sitePlatformID, contributes: sitePlatformContributes, register: registerSitePlatformNative)

/// The platform's own registrations the shells load before the generated
/// plugin manifest (the Kotlin shell's `PLATFORM_ENTRIES`).
@MainActor
public enum NativePlatformEntries {
  public static var entries: [NativePluginManifestEntry] { [sitePlatformEntry] }
}
