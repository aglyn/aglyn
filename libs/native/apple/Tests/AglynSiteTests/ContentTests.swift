// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import XCTest

@testable import AglynSite

/// The Kotlin `SiteTest`'s content cases on the Swift port.
@MainActor
final class ContentTests: XCTestCase {
  private func doc(_ id: String, _ fields: [String: Any]) -> FirestoreDocument { FirestoreDocument(id: id, data: fields) }

  func testReadsCollectionsAndPlansTheEntriesQuery() {
    let docs = [
      doc("blog", ["displayName": "Blog", "slug": "blog", "categories": [["id": "news", "name": "News"]]]),
      doc("menu", ["displayName": "Menu", "kind": "catalog"]),
      doc("a", ["displayName": "Announcements", "kind": "content", "slug": "news"]),
    ]
    XCTAssertEqual(sortedCollections(docs).map(\.id), ["a", "blog"])
    XCTAssertEqual(sortedCollections(docs).last?.categories, [ContentCategory(id: "news", name: "News")])
    let query = entryQuery(hostID: "h", collectionID: "blog", status: "published", search: "Spring men", limit: 26)
    XCTAssertEqual(query.path, "hosts/h/collections/blog/entries")
    XCTAssertEqual(query.limit, 26)
    XCTAssertTrue(query.filters.contains { $0.path == "status" && $0.op == .equal && $0.value as? String == "published" })
    XCTAssertTrue(query.filters.contains { $0.path == "titleTokens" && $0.op == .arrayContains && $0.value as? String == "spring" })
    XCTAssertEqual(query.order.first?.field, "updatedAt")
    XCTAssertEqual(query.order.first?.descending, true)
    let plain = entryQuery(hostID: "h", collectionID: "blog", status: nil, search: "  ", limit: 26)
    XCTAssertTrue(plain.filters.isEmpty)
    XCTAssertEqual(contentSlug("  Spring Menu — 2026! "), "spring-menu-2026")
    XCTAssertEqual(newCategoryID("News", existing: [ContentCategory(id: "news", name: "News")]), "news-2")
    XCTAssertEqual(newCategoryID("!!!", existing: []), "category")
    XCTAssertTrue(isCollectionSlug("blog-2"))
    XCTAssertFalse(isCollectionSlug("Blog"))
    XCTAssertFalse(isCollectionSlug("blog--2"))
  }

  func testSavesAnEntryAsTheEditorDoes() {
    let entry = ContentEntry(
      doc("e1", ["title": "Spring", "slug": "spring", "category": "Old", "status": "draft"]))
    var draft = EntryDraft(entry)
    draft.title = "Spring menu"
    draft.slug = ""
    draft.categoryID = "news"
    draft.coverImage = ""
    draft.coverImageAlt = "ignored"
    draft.tags = [" a ", ""]
    let payload = draft.payload()
    XCTAssertEqual(payload["slug"] as? String, "spring-menu")
    XCTAssertEqual(
      payload["titleTokens"] as? [String], ["s", "sp", "spr", "spri", "sprin", "spring", "m", "me", "men", "menu"])
    XCTAssertEqual(payload["coverImageAlt"] as? FirestoreSentinel, .delete)
    XCTAssertEqual(payload["categoryId"] as? String, "news")
    XCTAssertEqual(payload["category"] as? FirestoreSentinel, .delete)
    XCTAssertEqual(payload["tags"] as? [String], ["a"])
    XCTAssertEqual(payload["coverVideo"] as? FirestoreSentinel, .delete)
    XCTAssertEqual(payload["coverVideoDuration"] as? FirestoreSentinel, .delete)
    XCTAssertEqual(payload["authorId"] as? FirestoreSentinel, .delete)
    XCTAssertFalse(entry.hasByline)
    XCTAssertEqual(entry.legacyCategory, "Old")
    var cleared = draft
    cleared.categoryID = nil
    XCTAssertEqual(cleared.payload()["categoryId"] as? FirestoreSentinel, .delete)
    XCTAssertNil(cleared.payload()["category"])
  }

  func testKeepsTheCoverVideoLengthOnlyWithAVideo() {
    var draft = EntryDraft(ContentEntry(doc("e", ["title": "T", "slug": "t"])))
    draft.coverImage = "https://x/y.png"
    draft.coverImageAlt = "A view"
    draft.coverVideo = "media:abc"
    draft.coverVideoDuration = "12.4"
    let payload = draft.payload()
    XCTAssertEqual(payload["coverImageAlt"] as? String, "A view")
    XCTAssertEqual(payload["coverVideoDuration"] as? Int, 12)
    draft.coverVideo = ""
    XCTAssertEqual(draft.payload()["coverVideoDuration"] as? FirestoreSentinel, .delete)
  }

  func testReadsAnEntryAndItsStatusWords() {
    let published = Date(timeIntervalSince1970: 1_000_000)
    let entry = ContentEntry(
      doc("e", ["title": " ", "authorName": "Pat", "status": "scheduled", "publishAt": published, "tags": ["x", 4]]))
    XCTAssertEqual(entry.title, "Untitled")
    XCTAssertTrue(entry.hasByline)
    XCTAssertTrue(entry.isLive)
    XCTAssertEqual(entry.tags, ["x"])
    XCTAssertEqual(entry.publishAt, published)
    XCTAssertEqual(entryStatusLabel("published"), ContractValues.shared.entryStatusOptions.first { $0.value == "published" }?.label)
    XCTAssertEqual(entryStatusLabel("weird"), "Weird")
    XCTAssertEqual(EntryDraft(entry).title, "")
    XCTAssertTrue(isFuture(Date().addingTimeInterval(60)))
    XCTAssertFalse(isFuture(Date().addingTimeInterval(-60)))
    XCTAssertEqual(formatUTC(Date(timeIntervalSince1970: 0)), "1970-01-01 00:00 UTC")
    XCTAssertEqual(
      templateScreens([
        doc("a", ["displayName": "Zed"]), doc("b", ["kind": "group"]), doc("c", ["displayName": "Alpha", "kind": "template"]),
        doc("d", ["displayName": "Gone", "deletedAt": Date()]),
      ]).map(\.id), ["c", "a"])
  }

  func testContentAnswersTheConsolesLinksNatively() {
    let registry = NativePluginRegistry()
    _ = NativePluginLoader.load(NativePlatformEntries.entries, into: registry)
    XCTAssertEqual(registry.screen("site.content")?.requiresSite, true)
    XCTAssertEqual(
      registry.resolve("/acme/hosts/shop/content/blog"),
      .screen("site.content", ["orgSlug": "acme", "hostSlug": "shop", "collectionSlug": "blog"]))
    XCTAssertEqual(
      registry.resolve("/acme/hosts/shop/content/blog/entries/e1"),
      .screen("site.content", ["orgSlug": "acme", "hostSlug": "shop", "collectionSlug": "blog", "entryId": "e1"]))
    XCTAssertEqual(SiteAreas.content.screen, "site.content")
  }
}
