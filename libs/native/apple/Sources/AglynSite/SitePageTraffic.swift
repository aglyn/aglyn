// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

// WHICH PAGE OF A SITE A COUNTED PATH IS, for the Pages table (AGL-4253), ported from the console's
// `app-utils/page-traffic.ts` and `utils/site-page-labels.ts`. The table grouped views by SCREEN, and every product,
// store collection and post renders through ONE template screen, so a store's catalog showed as one row named after its
// template. Views now come from the day documents' per-path counts (`hosts/{id}/analytics/{day}.paths`) and the
// template is only how a path gets its name. A path is classified in the site loader's order: a routed screen that is
// not a template, then a plugin record at `/{segment}/{slug}`, then a content collection's list or entry, else an
// address nothing answers now. The Kotlin twin is `site/analytics/SitePageTraffic.kt`.

/// The routing map's key for the site root.
public let screenRootPath = "/"

/// What a counted path is, in the site loader's order.
public enum PagePathClass: Equatable, Sendable {
  /// One of the site's own pages, routed at this path.
  case page(screenID: String)
  /// A plugin's record page: `/{segment}/{slug}`.
  case record(segment: String, slug: String)
  /// A content collection's list, or one of its paged, cursor or category lists.
  case collectionList(collectionSlug: String)
  /// One entry of a content collection: `/{collection}/{entry}`.
  case entry(collectionSlug: String, entrySlug: String)
  /// Nothing on the site answers this path now.
  case other
}

public struct PagePathContext: Sendable {
  /// The host doc's routing map: screen id → route path (`/` or `a/b`).
  public var routes: [String: String]
  /// Screens a collection or the store renders records through.
  public var templateScreenIDs: Set<String>
  /// Path segments records are served under (`products`).
  public var recordSegments: Set<String>
  /// Slugs of the site's content collections.
  public var contentCollectionSlugs: Set<String>

  public init(routes: [String: String], templateScreenIDs: Set<String>, recordSegments: Set<String>, contentCollectionSlugs: Set<String>) {
    self.routes = routes
    self.templateScreenIDs = templateScreenIDs
    self.recordSegments = recordSegments
    self.contentCollectionSlugs = contentCollectionSlugs
  }
}

/// A counted path in the routing map's form: no leading or trailing slash, no query, the root as `/`.
public func normalizeCountedPath(_ path: String) -> String {
  let bare = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
  let trimmed = bare.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
  return trimmed.isEmpty ? screenRootPath : trimmed
}

/// The path as a visitor types it: always one leading slash.
public func displayCountedPath(_ path: String) -> String {
  let normalized = normalizeCountedPath(path)
  return normalized == screenRootPath ? "/" : "/\(normalized)"
}

/// Whether `segments` (a content collection's slug first) address its list or one entry; nil for neither
/// (`parseCollectionRoute`).
func collectionRoute(_ segments: [String]) -> (collectionSlug: String, entrySlug: String?)? {
  guard let slug = segments.first, !slug.isEmpty else { return nil }
  let rest = Array(segments.dropFirst())
  func positive(_ value: String) -> Bool { value.range(of: "^[1-9][0-9]*$", options: .regularExpression) != nil }
  func category(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespaces).lowercased()
      .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
      .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
  }
  switch rest.count {
  case 0: return (slug, nil)
  case 1: return (slug, rest[0])
  case 2 where rest[0] == "page": return positive(rest[1]) ? (slug, nil) : nil
  case 2 where rest[0] == "after" || rest[0] == "before":
    let cursor = (rest[1].removingPercentEncoding ?? rest[1]).trimmingCharacters(in: .whitespacesAndNewlines)
    return cursor.isEmpty ? nil : (slug, nil)
  case 2 where rest[0] == "category": return category(rest[1]).isEmpty ? nil : (slug, nil)
  case 4 where rest[0] == "category" && rest[2] == "page":
    return positive(rest[3]) && !category(rest[1]).isEmpty ? (slug, nil) : nil
  default: return nil
  }
}

public func classifyPagePath(_ path: String, _ context: PagePathContext) -> PagePathClass {
  let normalized = normalizeCountedPath(path)
  // The first owner in key order: Firestore hands a map out sorted, as the console reads it.
  let owner = context.routes.sorted { $0.key < $1.key }.first { $0.value == normalized }?.key
  if let owner, !context.templateScreenIDs.contains(owner) { return .page(screenID: owner) }
  if normalized == screenRootPath { return .other }
  let segments = normalized.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
  if segments.count == 2, context.recordSegments.contains(segments[0]) {
    return .record(segment: segments[0], slug: segments[1])
  }
  if context.contentCollectionSlugs.contains(segments[0]), let route = collectionRoute(segments) {
    if let entry = route.entrySlug { return .entry(collectionSlug: route.collectionSlug, entrySlug: entry) }
    return .collectionList(collectionSlug: route.collectionSlug)
  }
  return .other
}

/// Every path's views over the days, merged by the path's normalized form (`/shop` and `/shop/` are one row), most
/// viewed first; a zero or negative count is not a visit.
public func rollUpPathViews(_ days: [[String: Double]]) -> [(path: String, views: Double)] {
  var totals: [String: Double] = [:]
  for day in days {
    for (key, views) in day where views.isFinite && views > 0 {
      totals[normalizeCountedPath(key), default: 0] += views
    }
  }
  return totals.map { (path: $0.key, views: $0.value) }.sorted { $0.views != $1.views ? $0.views > $1.views : $0.path < $1.path }
}

/// The record pages the store serves (the console's `registerSitePathKind` calls in the commerce plugin): native has no
/// plugin registry for site paths, so the two kinds are named here.
public struct SitePathKind: Equatable, Sendable {
  public let segment: String
  public let groupLabel: String
  public let noun: String
  /// The site subcollection the records live in.
  public let collection: String
  /// Store collections share `collections` with content collections; only `kind: catalog` is one.
  public let catalogOnly: Bool

  public static let products = SitePathKind(segment: "products", groupLabel: "Products", noun: "product", collection: "products", catalogOnly: false)
  public static let storeCollections = SitePathKind(
    segment: "collections", groupLabel: "Collections", noun: "collection", collection: "collections", catalogOnly: true)
  public static let all = [products, storeCollections]

  public func accepts(_ data: [String: Any]) -> Bool { !catalogOnly || (data["kind"] as? String) == "catalog" }
}

/// One grouping of the Pages table: Pages, Products, a blog…
public struct SitePageGroup: Hashable, Sendable {
  public let id: String
  public let label: String
  public static let pages = SitePageGroup(id: "pages", label: "Pages")
  public static let other = SitePageGroup(id: "other", label: "Other addresses")
}

/// What a counted path is, in words a site owner reads: the product's name, the post's title, the page's title.
public struct SitePageLabel: Equatable, Sendable {
  /// The path as a visitor types it: `/products/nova`.
  public let path: String
  public let group: SitePageGroup
  public let title: String
  /// A second line when the title alone would mislead: a removed record.
  public let note: String?
  /// The live page; nil when nothing answers the path now.
  public let liveURL: URL?
  /// The routed screen, for a page that is one screen at one path: the only rows whose device and referrer counts are
  /// the page's own.
  public let screenID: String?
  /// The product a `/products/{slug}` row names, for opening its editor.
  public let productID: String?

  public init(
    path: String, group: SitePageGroup, title: String, note: String? = nil, liveURL: URL? = nil, screenID: String? = nil,
    productID: String? = nil
  ) {
    self.path = path
    self.group = group
    self.title = title
    self.note = note
    self.liveURL = liveURL
    self.screenID = screenID
    self.productID = productID
  }

  /// A path shown by its address, when the names could not be read.
  public static func unlabeled(_ path: String) -> SitePageLabel {
    SitePageLabel(path: displayCountedPath(path), group: .other, title: displayCountedPath(path))
  }
}

/// A site's facts the labels need: its routing map, its public origin and its collections (`hosts/{id}/collections`).
public struct SitePageFacts {
  public var routes: [String: String]
  public var origin: String?
  public var collections: [(id: String, data: [String: Any])]

  public init(routes: [String: String], origin: String?, collections: [(id: String, data: [String: Any])]) {
    self.routes = routes
    self.origin = origin
    self.collections = collections
  }

  private static func text(_ value: Any?) -> String { (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }

  /// Content collections by slug (a collection without `kind: catalog` is content).
  var contentBySlug: [String: [String: Any]] {
    var found: [String: [String: Any]] = [:]
    for one in collections where (one.data["kind"] as? String) != "catalog" {
      let slug = Self.text(one.data["slug"])
      if !slug.isEmpty, found[slug] == nil { found[slug] = one.data.merging(["$id": one.id]) { a, _ in a } }
    }
    return found
  }

  /// Every screen a collection designates as a list or entry template (`collectionTemplateScreenIds`).
  var templateScreenIDs: Set<String> {
    Set(collections.flatMap { one in ["listScreenId", "entryScreenId", "templateScreenId"].compactMap { one.data[$0] as? String } }.filter { !$0.isEmpty })
  }

  public var context: PagePathContext {
    PagePathContext(
      routes: routes, templateScreenIDs: templateScreenIDs, recordSegments: Set(SitePathKind.all.map(\.segment)),
      contentCollectionSlugs: Set(contentBySlug.keys))
  }
}

/// What the labels of some classified paths read: each source is one batch.
public struct SitePageReads: Equatable {
  public var screenIDs: [String] = []
  /// Record slugs by segment.
  public var recordSlugs: [String: [String]] = [:]
  /// Entry slugs by content collection slug.
  public var entrySlugs: [String: [String]] = [:]

  public init(_ classes: [PagePathClass]) {
    for found in classes {
      switch found {
      case .page(let id): if !screenIDs.contains(id) { screenIDs.append(id) }
      case .record(let segment, let slug): if !(recordSlugs[segment] ?? []).contains(slug) { recordSlugs[segment, default: []].append(slug) }
      case .entry(let collection, let slug): if !(entrySlugs[collection] ?? []).contains(slug) { entrySlugs[collection, default: []].append(slug) }
      case .collectionList, .other: break
      }
    }
  }
}

/// What those reads found: screens by id, records by segment then slug, entries by collection slug then slug.
public struct SitePageFound {
  public var screens: [String: [String: Any]] = [:]
  public var records: [String: [String: (id: String, data: [String: Any])]] = [:]
  public var entries: [String: [String: (id: String, data: [String: Any])]] = [:]
  public init() {}
}

/// Names one classified path (`labelSitePaths`).
public func sitePageLabel(_ path: String, _ found: PagePathClass, facts: SitePageFacts, read: SitePageFound) -> SitePageLabel {
  func text(_ value: Any?) -> String { (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
  let shown = displayCountedPath(path)
  let live = facts.origin.flatMap { URL(string: "\($0)\(shown == "/" ? "" : shown)") }
  switch found {
  case .page(let screenID):
    let screen = read.screens[screenID]
    let title = [text(screen?["displayName"]), text(screen?["name"])].first { !$0.isEmpty } ?? (shown == "/" ? "Home" : shown)
    return SitePageLabel(path: shown, group: .pages, title: title, liveURL: live, screenID: screenID)
  case .record(let segment, let slug):
    let kind = SitePathKind.all.first { $0.segment == segment } ?? .products
    let record = read.records[segment]?[slug]
    let title = record.map { text($0.data["name"]) } ?? ""
    return SitePageLabel(
      path: shown, group: SitePageGroup(id: "record:\(segment)", label: kind.groupLabel), title: title.isEmpty ? shown : title,
      note: record == nil ? "Not a \(kind.noun) on this site now" : nil, liveURL: record == nil ? nil : live,
      productID: kind == .products ? record?.id : nil)
  case .collectionList(let collectionSlug), .entry(let collectionSlug, _):
    let owner = facts.contentBySlug[collectionSlug]
    let name = [text(owner?["displayName"]), text(owner?["name"])].first { !$0.isEmpty } ?? collectionSlug
    let group = SitePageGroup(id: "content:\(collectionSlug)", label: name)
    guard case .entry(_, let entrySlug) = found else {
      return SitePageLabel(path: shown, group: group, title: "\(name) (list page)", liveURL: live)
    }
    let entry = read.entries[collectionSlug]?[entrySlug]
    let title = entry.map { text($0.data["title"]) } ?? ""
    return SitePageLabel(
      path: shown, group: group, title: title.isEmpty ? shown : title, note: entry == nil ? "Not in \(name) now" : nil,
      liveURL: entry == nil ? nil : live)
  case .other:
    return SitePageLabel(path: shown, group: .other, title: shown, note: "No page answers this address now")
  }
}

/// One row of the Pages table.
public struct SitePageRow: Identifiable, Sendable {
  public var id: String { path }
  public let path: String
  public let views: Double
  public let label: SitePageLabel
  /// This page's own device and referrer counts; nil where they are not counted per page.
  public let screen: ScreenTrafficRow?

  public init(path: String, views: Double, label: SitePageLabel, screen: ScreenTrafficRow?) {
    self.path = path
    self.views = views
    self.label = label
    self.screen = screen
  }
}

/// The kinds the rows hold, most visited first, Other addresses always last, each with its rows and views.
public func sitePageGroups(_ rows: [SitePageRow]) -> [(group: SitePageGroup, count: Int, views: Double)] {
  var order: [SitePageGroup] = []
  var tally: [SitePageGroup: (count: Int, views: Double)] = [:]
  for row in rows {
    if tally[row.label.group] == nil { order.append(row.label.group) }
    let one = tally[row.label.group] ?? (0, 0)
    tally[row.label.group] = (one.count + 1, one.views + row.views)
  }
  return order.map { (group: $0, count: tally[$0]!.count, views: tally[$0]!.views) }
    .enumerated()
    .sorted { a, b in
      if a.element.group == .other { return false }
      if b.element.group == .other { return true }
      return a.element.views != b.element.views ? a.element.views > b.element.views : a.offset < b.offset
    }
    .map(\.element)
}
