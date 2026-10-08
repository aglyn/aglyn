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
    XCTAssertEqual(scoped.order.first?.field, "createdAt")
    XCTAssertEqual(scoped.order.first?.descending, true)
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
