// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynSite

/// The console's `page-traffic.spec.ts` cases on the Swift port (AGL-4253), and the labels `site-page-labels.ts` gives.
final class SitePageTrafficTests: XCTestCase {
  private let context = PagePathContext(
    routes: ["home": "/", "about": "about", "tpl": "blog", "pdp": "pdp-template"], templateScreenIDs: ["tpl", "pdp"],
    recordSegments: ["products"], contentCollectionSlugs: ["blog"])

  func testARoutedPageIsAPage() {
    XCTAssertEqual(classifyPagePath("/about", context), .page(screenID: "about"))
    XCTAssertEqual(classifyPagePath("/", context), .page(screenID: "home"))
  }

  func testATemplateRoutedAtAPathIsNeverThePageThere() {
    XCTAssertEqual(classifyPagePath("/blog", context), .collectionList(collectionSlug: "blog"))
    XCTAssertEqual(classifyPagePath("/pdp-template", context), .other)
  }

  func testARecordAnEntryAndAPagedList() {
    XCTAssertEqual(classifyPagePath("/products/nova", context), .record(segment: "products", slug: "nova"))
    XCTAssertEqual(classifyPagePath("/blog/hello", context), .entry(collectionSlug: "blog", entrySlug: "hello"))
    XCTAssertEqual(classifyPagePath("/blog/page/2", context), .collectionList(collectionSlug: "blog"))
    XCTAssertEqual(classifyPagePath("/blog/category/Open Source", context), .collectionList(collectionSlug: "blog"))
    XCTAssertEqual(classifyPagePath("/blog/page/0", context), .other)
  }

  func testAnythingElseIsNotAPageOfTheSiteNow() {
    XCTAssertEqual(classifyPagePath("/wp-admin", context), .other)
    XCTAssertEqual(classifyPagePath("/products/a/b", context), .other)
  }

  func testRollUpMergesOnePagesFormsAndDropsZeroCounts() {
    let rows = rollUpPathViews([["/a": 2, "/a/": 1, "/b": 0], ["": 4], [:]])
    XCTAssertEqual(rows.map(\.path), ["/", "a"])
    XCTAssertEqual(rows.map(\.views), [4, 3])
    XCTAssertEqual(normalizeCountedPath("/shop/"), "shop")
    XCTAssertEqual(normalizeCountedPath("/shop?x=1"), "shop")
    XCTAssertEqual(displayCountedPath("shop"), "/shop")
    XCTAssertEqual(displayCountedPath("/"), "/")
  }

  func testEachPathIsNamedForWhatItIs() {
    let facts = SitePageFacts(
      routes: ["home": "/", "pdp": "pdp"], origin: "https://shop.example",
      collections: [
        (id: "c1", data: ["slug": "blog", "displayName": "Journal", "entryScreenId": "pdp"]),
        (id: "c2", data: ["slug": "summer", "kind": "catalog", "name": "Summer"]),
      ])
    let paths = ["/", "products/nova", "products/gone", "collections/summer", "blog", "blog/hello", "blog/missing", "wp-admin"]
    let classes = paths.map { classifyPagePath($0, facts.context) }
    let reads = SitePageReads(classes)
    XCTAssertEqual(reads.screenIDs, ["home"])
    XCTAssertEqual(reads.recordSlugs["products"], ["nova", "gone"])
    XCTAssertEqual(reads.recordSlugs["collections"], ["summer"])
    XCTAssertEqual(reads.entrySlugs["blog"], ["hello", "missing"])
    var found = SitePageFound()
    found.screens["home"] = ["displayName": "Welcome"]
    found.records["products"] = ["nova": (id: "p1", data: ["name": "Nova Jacket"])]
    found.records["collections"] = ["summer": (id: "c2", data: ["name": "Summer", "kind": "catalog"])]
    found.entries["blog"] = ["hello": (id: "e1", data: ["title": "Hello world"])]
    let labels = zip(paths, classes).map { sitePageLabel($0.0, $0.1, facts: facts, read: found) }

    XCTAssertEqual(labels[0], SitePageLabel(path: "/", group: .pages, title: "Welcome", liveURL: URL(string: "https://shop.example"), screenID: "home"))
    XCTAssertEqual(labels[1].title, "Nova Jacket")
    XCTAssertEqual(labels[1].group, SitePageGroup(id: "record:products", label: "Products"))
    XCTAssertEqual(labels[1].productID, "p1")
    XCTAssertEqual(labels[1].liveURL, URL(string: "https://shop.example/products/nova"))
    XCTAssertEqual(labels[2].title, "/products/gone")
    XCTAssertEqual(labels[2].note, "Not a product on this site now")
    XCTAssertNil(labels[2].liveURL)
    XCTAssertEqual(labels[3].title, "Summer")
    XCTAssertEqual(labels[3].group.label, "Collections")
    XCTAssertNil(labels[3].productID)
    XCTAssertEqual(labels[4].title, "Journal (list page)")
    XCTAssertEqual(labels[4].group, SitePageGroup(id: "content:blog", label: "Journal"))
    XCTAssertEqual(labels[5].title, "Hello world")
    XCTAssertEqual(labels[6].note, "Not in Journal now")
    XCTAssertEqual(labels[7], SitePageLabel(path: "/wp-admin", group: .other, title: "/wp-admin", note: "No page answers this address now"))
  }

  func testAStoreCollectionIsOnlyACatalogOne() {
    XCTAssertTrue(SitePathKind.storeCollections.accepts(["kind": "catalog"]))
    XCTAssertFalse(SitePathKind.storeCollections.accepts(["kind": "content"]))
    XCTAssertTrue(SitePathKind.products.accepts([:]))
  }

  func testKindsAreMostVisitedFirstAndOtherAddressesLast() {
    func row(_ path: String, _ views: Double, _ group: SitePageGroup) -> SitePageRow {
      SitePageRow(path: path, views: views, label: SitePageLabel(path: path, group: group, title: path), screen: nil)
    }
    let products = SitePageGroup(id: "record:products", label: "Products")
    let groups = sitePageGroups([row("x", 50, .other), row("/", 5, .pages), row("p/a", 4, products), row("p/b", 3, products)])
    XCTAssertEqual(groups.map(\.group), [products, .pages, .other])
    XCTAssertEqual(groups.map(\.count), [2, 1, 1])
    XCTAssertEqual(groups.map(\.views), [7, 5, 50])
  }
}
