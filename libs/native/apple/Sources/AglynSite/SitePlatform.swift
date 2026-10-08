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

/// The SF Symbols the content screens use.
enum SiteSymbols {
  static let site = "globe"
  static let page = "doc.text"
  static let home = "house"
  static let group = "folder"
  static let media = "photo.on.rectangle"
  static let error = "exclamationmark.triangle"
}

/// The picked site's areas, as its overview lists them, in the console's order.
public enum SiteAreas: CaseIterable, Sendable {
  case pages, media

  public var screen: String { self == .pages ? sitePagesScreen : siteMediaScreen }
  public var title: String { self == .pages ? "Pages" : "Media" }
  public var supporting: String {
    self == .pages ? "Publish, organize and open pages in the Besigner" : "Photos, videos and documents for your pages"
  }
  public var systemImage: String { self == .pages ? SiteSymbols.page : SiteSymbols.media }
}

/// Every id this registration adds, by kind, the way a plugin's `mobile.contributes` declares them.
public let sitePlatformContributes: [String: [String]] = [
  "screens": [siteSitesScreen, siteSiteScreen, sitePagesScreen, siteMediaScreen],
  "quickActions": ["site.sites-open", "site.pages-open", "site.media-open"],
  "deepLinks": ["site.sites-page", "site.pages-page", "site.page-view", "site.page-besigner-list", "site.media-page"],
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
