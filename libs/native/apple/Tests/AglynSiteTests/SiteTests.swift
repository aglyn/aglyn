// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import XCTest

@testable import AglynSite

/// The Kotlin `SiteTest`'s cases on the Swift port: the registration, the
/// console links it answers, the Pages hub's tree, and the Sites and media
/// library queries.
@MainActor
final class SiteTests: XCTestCase {
  private func registry() -> NativePluginRegistry {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load(NativePlatformEntries.entries, into: registry)
    XCTAssertEqual(result.loaded, [sitePlatformID], "\(result.failed)")
    XCTAssertEqual(result.failed, [])
    return registry
  }

  private func doc(_ id: String, _ fields: [String: Any]) -> FirestoreDocument {
    FirestoreDocument(id: id, data: fields)
  }

  private func has(_ query: FirestoreQuery, _ path: String, _ op: ListQueryOp, _ value: Any?) -> Bool {
    query.filters.contains { constraint in
      guard constraint.path == path, constraint.op == op else { return false }
      switch value {
      case nil: return constraint.value is NSNull
      case let text as String: return constraint.value as? String == text
      case let flag as Bool: return constraint.value as? Bool == flag
      case let list as [String]: return (constraint.value as? [Any])?.compactMap { $0 as? String } == list
      default: return false
      }
    }
  }

  /// Create site says first what stops it, in the console's own words (`create-host-dialog`).
  func testCreateSiteSaysWhatStopsItAsTheConsole() {
    XCTAssertEqual(
      CreateSiteBlock.limit(3).message,
      "Your plan includes 3 sites, and this workspace is using all of them. Upgrade or add extra sites from Billing.")
    XCTAssertEqual(
      CreateSiteBlock.limit(1).message,
      "Your plan includes one site, and this workspace is using all of them. Upgrade or add extra sites from Billing.")
    XCTAssertEqual(
      CreateSiteBlock.role.message,
      "Your role in this workspace does not allow creating sites. Ask a workspace owner or admin to create it, or to "
        + "change your role.")
  }

  /// The plan's site limit is said before the click, counted as the console's create-site dialog counts it: the set
  /// entries of the org's `hosts` directory against `hostLimit`.
  func testTheSiteLimitCountsAsTheConsolesDialogDoes() {
    let three: [String: Any] = ["a": true, "b": true, "c": "host-c"]
    XCTAssertEqual(siteLimitBlock(limit: 3, directory: three), .limit(3))
    XCTAssertEqual(siteLimitBlock(limit: 1, directory: ["a": ["at": 1]]), .limit(1))
    // Removed sites (null, false) and empty entries do not count, as `filter(Boolean)` does not.
    XCTAssertNil(siteLimitBlock(limit: 3, directory: ["a": true, "b": NSNull(), "c": false, "d": 0, "e": ""]))
    XCTAssertNil(siteLimitBlock(limit: 3, directory: ["a": true, "b": true]))
    // No directory yet counts none.
    XCTAssertNil(siteLimitBlock(limit: 3, directory: [:]))
  }

  func testRegistersEveryDeclaredContribution() {
    let registry = registry()
    XCTAssertEqual(registry.screen("site.pages")?.requiresSite, true)
    XCTAssertEqual(registry.screen("site.sites")?.requiresSite, false)
    XCTAssertEqual(
      registry.quickActions(for: .aglyn).map(\.id), ["site.sites-open", "site.pages-open", "site.media-open"])
    XCTAssertTrue(registry.quickActions(for: .pos).isEmpty)
  }

  func testOpensTheConsolesPagesSitesAndMediaNatively() {
    let registry = registry()
    XCTAssertEqual(
      registry.resolve("https://app.aglyn.com/acme/hosts/shop/screens"),
      .screen("site.pages", ["orgSlug": "acme", "hostSlug": "shop"]))
    XCTAssertEqual(
      registry.resolve("/acme/hosts/shop/screens/p1/versions/v1/view"),
      .screen("site.pages", ["orgSlug": "acme", "hostSlug": "shop", "screenId": "p1", "versionId": "v1"]))
    XCTAssertEqual(registry.resolve("/acme/hosts"), .screen("site.sites", ["orgSlug": "acme"]))
    XCTAssertEqual(registry.resolve("/acme/media"), .screen("site.media", ["orgSlug": "acme"]))
    XCTAssertEqual(
      registry.resolve("/acme/hosts/shop/media"), .screen("site.media", ["orgSlug": "acme", "hostSlug": "shop"]))
    // The Besigner itself still opens in the web view.
    XCTAssertEqual(
      registry.resolve("/acme/hosts/shop/screens/p1/versions/v1/besigner"),
      .besigner("/acme/hosts/shop/screens/p1/versions/v1/besigner"))
  }

  func testTheBesignerOpensUnderThePickedSite() {
    var opened: [String] = []
    let context = NativePluginContext(
      uid: "u", orgID: "o", hostID: "h", orgSlug: "acme", hostSlug: "shop", firestore: NullReader(),
      api: ConsoleAPIClient(origin: "https://console.test") { _ in nil }, navigate: { _, _ in },
      openBesigner: { opened.append($0) })
    XCTAssertTrue(context.openBesigner(DeepLinks.besignerScreen("p1", versionID: "v1"), scope: .site))
    XCTAssertEqual(opened, ["/acme/hosts/shop/screens/p1/versions/v1/besigner"])
    XCTAssertNil(context.siteRole)
  }

  func testBuildsTheHubTreeInSiblingOrderWithLiveAddresses() {
    let pages = [
      PageNode(doc("home", ["displayName": "Home", "slug": "/", "order": 0])),
      PageNode(doc("blog", ["displayName": "Blog", "slug": "blog", "order": 2])),
      PageNode(doc("post", ["displayName": "Post", "slug": "post", "parentId": "blog"])),
      PageNode(doc("folder", ["displayName": "Legal", "kind": "group", "order": 1])),
      PageNode(doc("terms", ["displayName": "Terms", "slug": "terms", "parentId": "folder"])),
      PageNode(doc("orphan", ["displayName": "Orphan", "parentId": "missing", "order": 3])),
      PageNode(doc("gone", ["displayName": "Gone", "deletedAt": Date(timeIntervalSince1970: 1)])),
      PageNode(doc("mail", ["displayName": "Mail", "kind": "email"])),
    ].compactMap { $0 }
    XCTAssertEqual(pages.count, 6)
    let routing = SiteRouting(routes: ["home": "/", "post": "blog/post", "terms": "terms"], subdomain: "shop")
    let tree = pageTree(pages, routing: routing)
    XCTAssertEqual(tree.map(\.page.id), ["home", "folder", "terms", "blog", "post", "orphan"])
    XCTAssertEqual(tree.map(\.depth), [0, 0, 1, 0, 1, 0])
    XCTAssertEqual(tree.first { $0.page.id == "post" }?.livePath, "/blog/post")
    XCTAssertEqual(tree.first?.home, true)
    XCTAssertEqual(tree.first { $0.page.id == "folder" }?.childCount, 1)
    XCTAssertEqual(pageStatus(tree.first { $0.page.id == "blog" }!).label, "Draft")
    XCTAssertEqual(pageStatus(tree.first { $0.page.id == "folder" }!).label, "Group")
    XCTAssertEqual(pageStatus(tree.first { $0.page.id == "post" }!), PageStatus(label: "Published", live: true))
    XCTAssertEqual(livePageURL(routing, livePath: "/blog/post"), "https://shop.aglyn.app/blog/post")
    XCTAssertEqual(movableParents(pages, pageID: "blog").map(\.id).sorted(), ["folder", "home", "orphan", "terms"])
  }

  func testACycleStillShowsEveryPageOnce() {
    let pages = [
      PageNode(doc("a", ["displayName": "A", "parentId": "b"])),
      PageNode(doc("b", ["displayName": "B", "parentId": "a"])),
    ].compactMap { $0 }
    XCTAssertEqual(Set(pageTree(pages, routing: SiteRouting()).map(\.page.id)), ["a", "b"])
  }

  func testASiteRowShowsItsCustomDomainElseThePlatformAddress() {
    let custom = SiteRow(doc("s1", ["displayName": "Acme", "subdomain": "acme", "cname": "acme.example"]))
    XCTAssertEqual(custom.shownAddress, "acme.example")
    let platform = SiteRow(doc("s2", ["displayName": "Acme", "subdomain": "acme"]))
    XCTAssertEqual(platform.shownAddress, HostStatus.siteAddress("acme"))
    // A row mirrored before it carried `cname`: the host document's own custom domain wins once it is read.
    XCTAssertEqual(platform.shownAddress(hostCname: "acme.example"), "acme.example")
    XCTAssertEqual(platform.shownAddress(hostCname: " "), HostStatus.siteAddress("acme"))
    XCTAssertEqual(custom.shownAddress(hostCname: nil), "acme.example")
  }

  func testPlansTheSitesListOnTheMembersOwnRows() {
    let query = sitesQuery(uid: "u", orgID: "org1", search: "dem", domain: .connected, limit: 31)
    XCTAssertEqual(query.path, "users/u/hostMemberships")
    XCTAssertEqual(query.limit, 31)
    XCTAssertTrue(has(query, "orgId", .equal, "org1"))
    XCTAssertTrue(has(query, "hasCustomDomain", .equal, true))
    XCTAssertTrue(has(query, "searchTokens", .arrayContains, "dem"))
    let plain = sitesQuery(uid: "u", orgID: "org1", search: " ", domain: .all, limit: 31)
    XCTAssertEqual(plain.filters.count, 1)
    XCTAssertEqual(plain.order.first?.field, "nameLower")
    XCTAssertEqual(suggestSubdomain("My New Site!"), "my-new-site")
    XCTAssertEqual(suggestSubdomain("  ---Café & Bar---  "), "caf-bar")
    XCTAssertEqual(suggestSubdomain(String(repeating: "ab ", count: 20)).count, 29)
    XCTAssertTrue(isValidSubdomain("my-new-site"))
    XCTAssertFalse(isValidSubdomain("ab"))
    XCTAssertFalse(isValidSubdomain("-site"))
    XCTAssertEqual(cleanSubdomainInput("My Site_2!"), "mysite2")
  }

  func testCreatesTheSiteWithTheStarterInTheSameRequest() {
    XCTAssertEqual(
      createSiteBody(orgID: "org1", name: "  My Shop ", subdomain: " MyShop "),
      // The console's "Create the starter site"; without it the server may leave the site empty for a guided start the app does not have.
      ["displayName": "My Shop", "subdomain": "myshop", "orgId": "org1", "start": "starter"])
  }

  func testPlansTheLibraryQueryAsTheConsoleDoes() {
    let site = mediaQuery(
      scope: .site(hostID: "h"), folder: .one("f1"), scopeTokens: nil, type: "image", sort: .name,
      search: "Hero-banner")
    XCTAssertEqual(site.path, "hosts/h/media")
    XCTAssertTrue(has(site, "folderId", .equal, "f1"))
    XCTAssertTrue(has(site, "kind", .equal, "image"))
    XCTAssertTrue(has(site, "nameTokens", .arrayContains, "hero"))
    XCTAssertEqual(site.order.map(\.field), ["nameLower"])
    XCTAssertEqual(site.order.first?.descending, false)
    // A reader limited to some sites: the scope is the array clause, and search is "starts with".
    let scoped = mediaQuery(
      scope: .org(orgID: "o", forHostID: "h"), folder: .root, scopeTokens: ["org", "host:h"], type: nil,
      sort: .newest, search: "Hero")
    XCTAssertEqual(scoped.path, "orgs/o/media")
    XCTAssertTrue(has(scoped, "visibleTo", .arrayContainsAny, ["org", "host:h"]))
    XCTAssertTrue(has(scoped, "folderId", .equal, nil))
    XCTAssertFalse(scoped.filters.contains { $0.path == "nameTokens" })
    // A prefix range must lead the order (the contract's rule), so the name orders it, ascending.
    XCTAssertEqual(scoped.order.first?.field, "nameLower")
    XCTAssertEqual(scoped.order.first?.descending, false)
  }

  func testPlansTheLibraryFiltersAsTheConsoleDoes() {
    let filters = MediaFilters(
      orientation: "landscape", alt: "false", tag: " Hero ", minMegabytes: "1", maxMegabytes: "2.5")
    XCTAssertEqual(filters.count, 5)
    XCTAssertEqual(MediaFilters().count, 0)
    let site = mediaQuery(
      scope: .site(hostID: "h"), folder: .all, scopeTokens: nil, type: "image", sort: .newest, search: "",
      filters: filters)
    XCTAssertTrue(has(site, "orientation", .equal, "landscape"))
    XCTAssertTrue(has(site, "hasAlt", .equal, false))
    // Tags are stored trimmed and lower-cased, so the one asked for is too.
    XCTAssertTrue(has(site, "tags", .arrayContains, "hero"))
    // The size is typed in megabytes and stored in bytes.
    func size(_ op: ListQueryOp) -> Double? {
      site.filters.first { $0.path == "sizeBytes" && $0.op == op }.flatMap { ($0.value as? NSNumber)?.doubleValue }
    }
    XCTAssertEqual(size(.greaterThanOrEqual), 1_048_576)
    XCTAssertEqual(size(.lessThanOrEqual), 2_621_440)
    // A reader limited to some sites has no Tags filter: the scope holds the query's one array clause.
    let scoped = mediaQuery(
      scope: .org(orgID: "o", forHostID: "h"), folder: .all, scopeTokens: ["org", "host:h"], type: nil,
      sort: .newest, search: "", filters: filters)
    XCTAssertFalse(scoped.filters.contains { $0.path == "tags" })
    // A blank box asks nothing, and a megabyte box takes digits and one point.
    XCTAssertEqual(MediaFilters(tag: "  ", minMegabytes: " ").clauses(scoped: false), [])
    XCTAssertEqual(megabytesInput("1a2.5.7"), "12.57")
    // The day a file was uploaded and who uploaded it: a range on the creation time, and an equality.
    let dated = mediaQuery(
      scope: .site(hostID: "h"), folder: .all, scopeTokens: nil, type: nil, sort: .newest, search: "",
      filters: MediaFilters(uploadedAfter: "2026-03-14", uploadedBefore: "2026-03-15", uploadedBy: "u1"))
    XCTAssertEqual(MediaFilters(uploadedAfter: "2026-03-14", uploadedBefore: "2026-03-15", uploadedBy: "u1").count, 3)
    XCTAssertTrue(has(dated, "uploadedBy", .equal, "u1"))
    XCTAssertTrue(dated.filters.contains { $0.path == "createdAt" && $0.op == .greaterThanOrEqual })
    XCTAssertTrue(dated.filters.contains { $0.path == "createdAt" && $0.op == .lessThan })
    // A search and a tag are both array clauses, which one query cannot hold: the plan says which it left out.
    let notices = mediaPlanNotices(
      mediaPlan(
        folder: .all, scopeTokens: nil, type: nil, sort: .newest, search: "hero",
        filters: MediaFilters(tag: "sunset")))
    XCTAssertFalse(notices.isEmpty, "\(notices)")
  }

  func testWritesTheScopeIntoEveryMediaRoute() {
    let client = ConsoleAPIClient(origin: "https://console.test") { _ in "t" }
    let org = MediaAPI(api: client, scope: .org(orgID: "o", forHostID: "h"))
    XCTAssertEqual(
      org.body(["action": "create-folder", "name": "Covers", "parentId": nil]),
      ["orgId": "o", "forHostId": "h", "action": "create-folder", "name": "Covers", "parentId": nil])
    let site = MediaAPI(api: client, scope: .site(hostID: "h"))
    XCTAssertEqual(site.body(["mediaId": "m1", "tags": ["a", "b"]]), ["hostId": "h", "mediaId": "m1", "tags": ["a", "b"]])
    XCTAssertEqual(MediaScope.org(orgID: "o", forHostID: nil).cdnScope, "org:o")
  }

  func testChoosesAFileTheWayTheConsolesPickerStoresIt() throws {
    func file(_ id: String, _ fields: [String: Any] = [:]) throws -> MediaItem {
      try XCTUnwrap(
        MediaItem(doc(id, ["fileName": "\(id).jpg", "contentType": "image/jpeg"].merging(fields) { _, new in new })))
    }
    // A site's own file: its reference.
    XCTAssertEqual(
      ChosenMedia(item: try file("m1", ["cdnPath": "/api/media/cdn/h/m1"]), scope: .site(hostID: "h")).reference,
      "media:h/m1")
    // A workspace file shared with only some sites is requested through the form that names this site; an org-wide one is not.
    let restricted = try file("m2", ["cdnPath": "/api/media/cdn/org:o1/m2", "visibleTo": ["host:h"]])
    XCTAssertEqual(
      ChosenMedia(item: restricted, scope: .org(orgID: "o1", forHostID: "h")).reference, "media:org:o1:h/m2")
    let wide = try file("m3", ["cdnPath": "/api/media/cdn/org:o1/m3", "visibleTo": ["org"]])
    XCTAssertEqual(ChosenMedia(item: wide, scope: .org(orgID: "o1", forHostID: "h")).reference, "media:org:o1/m3")
    // No CDN path: the Storage address names the asset; any other address is kept.
    let storage = "https://firebasestorage.googleapis.com/v0/b/bucket/o/hosts%2Fh%2Fmedia%2Fm4?alt=media"
    XCTAssertEqual(ChosenMedia(item: try file("m4", ["url": storage]), scope: .site(hostID: "h")).reference, "media:h/m4")
    XCTAssertEqual(
      ChosenMedia(item: try file("m5", ["url": "https://elsewhere.test/p.png"]), scope: .site(hostID: "h")).reference,
      "https://elsewhere.test/p.png")
    // A film's measured length, in whole seconds.
    XCTAssertEqual(try file("m6", ["video": ["durationMs": 63_400, "width": 1920, "height": 1080]]).videoSeconds, 63)
    XCTAssertNil(try file("m7").videoSeconds)
    // A film's captured poster frame is recorded on its document; without one, its poster address is no picture.
    XCTAssertTrue(try file("m8", ["poster": ["width": 640]]).hasPoster)
    XCTAssertFalse(try file("m9").hasPoster)
  }

  func testReadsAFileAndBuildsItsAddresses() throws {
    let item = try XCTUnwrap(
      MediaItem(
        doc(
          "m1",
          [
            "fileName": "hero.jpg", "contentType": "image/jpeg", "sizeBytes": 2_621_440,
            "cdnPath": "/api/media/cdn/h/m1",
          ])))
    XCTAssertEqual(item.kind, "image")
    XCTAssertEqual(item.src(origin: "https://console.test/"), "https://console.test/api/media/cdn/h/m1")
    XCTAssertEqual(item.thumbnail(origin: "https://console.test"), "https://console.test/api/media/cdn/h/m1?w=320")
    XCTAssertEqual(formatBytes(item.sizeBytes), "2.5 MB")
    XCTAssertEqual(formatBytes(4_194_304), "4 MB")
    XCTAssertEqual(formatBytes(839_680), "820 KB")
    XCTAssertEqual(formatBytes(12), "12 B")
    XCTAssertNil(MediaItem(doc("m2", ["deletedAt": Date(timeIntervalSince1970: 1)])))
    let folders = [
      MediaFolder(id: "a", name: "Blog", parentID: nil, order: nil),
      MediaFolder(id: "b", name: "Covers", parentID: "a", order: 1),
    ]
    let byID = Dictionary(uniqueKeysWithValues: folders.map { ($0.id, $0) })
    XCTAssertEqual(folderPath(folders[1], byID: byID), "Blog / Covers")
    XCTAssertEqual(sortedFolders(folders).map(\.id), ["b", "a"])
  }

  func testAMemberLimitedToSomeSitesReadsTheLibraryThroughTheirTokens() {
    XCTAssertNil(OrgAccess.libraryScope(doc("u", ["role": "owner"])))
    XCTAssertNil(OrgAccess.libraryScope(doc("u", ["role": "editor"])))
    XCTAssertEqual(
      OrgAccess.libraryScope(doc("u", ["role": "editor", "hostAccess": ["h1": "editor"]])), ["org", "host:h1"])
    XCTAssertEqual(
      OrgAccess.libraryScope(doc("u", ["role": "viewer", "allHosts": false, "scopeTokens": ["org", "host:x"]])),
      ["org", "host:x"])
  }
}

/// A reader with nothing in it, for contexts the tests build.
final class NullReader: FirestoreReader, @unchecked Sendable {
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void)
    -> FirestoreListening
  { NoListener() }
  func listenDocument(
    _ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void
  ) -> FirestoreListening { NoListener() }
  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}
}
