// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

/// The Pages list reads its tree a level at a time (AGL-3896): 25 top-level rows a page, one `parentId in` query per
/// drawn batch for counts and chevrons, children never read twice, a search reads the rest.
@MainActor
final class PagesTreeTests: XCTestCase {
  /// A site's screens in memory, answering the two query shapes the tree asks.
  private final class Store {
    var docs: [String: [String: Any]] = [:]
    var asked: [String] = []

    func fetch(_ query: FirestoreQuery) -> [FirestoreDocument] {
      var ids = docs.keys.sorted()
      for filter in query.filters {
        if filter.path == "__name__", let after = filter.value as? String {
          asked.append("window>\(after)")
          ids = ids.filter { $0 > after }
        } else if filter.path == "parentId", let parents = filter.value as? [String] {
          asked.append("in:\(parents.count)")
          ids = ids.filter { parents.contains(docs[$0]?["parentId"] as? String ?? "\u{0}") }
        }
      }
      if query.filters.isEmpty { asked.append("window") }
      if let limit = query.limit { ids = Array(ids.prefix(limit)) }
      return ids.map { FirestoreDocument(id: $0, data: docs[$0] ?? [:]) }
    }

    func read(_ path: [String]) -> FirestoreDocument? {
      guard let id = path.last, let data = docs[id] else { return nil }
      return FirestoreDocument(id: id, data: data)
    }
  }

  /// 60 top-level pages; p00 holds three pages, p00a holds two, interleaved by id with the top level.
  private func site() -> Store {
    let store = Store()
    for index in 0..<60 { store.docs[String(format: "p%02d", index)] = ["displayName": "Page \(index)", "order": Double(index)] }
    store.docs["p00"]?["kind"] = "group"
    for child in ["p00a", "p00b", "p00c"] { store.docs[child] = ["displayName": "Child \(child)", "parentId": "p00"] }
    for grand in ["p00a1", "p00a2"] { store.docs[grand] = ["displayName": "Grandchild \(grand)", "parentId": "p00a"] }
    store.docs["p01"]?["parentId"] = ""  // an empty parent is the top level too
    store.docs["p02"]?["deletedAt"] = Date()
    return store
  }

  private func tree(_ store: Store) -> PagesTree {
    PagesTreeSession.expanded = [:]
    return PagesTree(hostID: "h") { query in store.fetch(query) }
  }

  func testTheFirstPageDrawsTwentyFiveTopLevelRowsCollapsedWithCounts() async {
    let store = site()
    let tree = tree(store)
    await tree.start()
    let rows = tree.rows(routing: SiteRouting())
    XCTAssertEqual(rows.count, 25)
    XCTAssertTrue(rows.allSatisfy { $0.depth == 0 })
    XCTAssertFalse(rows.contains { $0.id == "p02" }, "a deleted page is never drawn")
    XCTAssertEqual(rows.first { $0.id == "p00" }?.childCount, 3)
    XCTAssertFalse(tree.exhausted)
    // Windows until 25 top-level rows were drawn, then ONE `in` query for the batch's children.
    XCTAssertEqual(store.asked.filter { $0.hasPrefix("in:") }, ["in:25"])
  }

  func testExpandingShowsTheChildrenAndAsksOnceForTheirChildren() async {
    let store = site()
    let tree = tree(store)
    await tree.start()
    store.asked = []
    await tree.expand("p00")
    var rows = tree.rows(routing: SiteRouting())
    XCTAssertEqual(rows.filter { $0.depth == 1 }.map(\.id), ["p00a", "p00b", "p00c"])
    XCTAssertEqual(rows.first { $0.id == "p00a" }?.childCount, 2)
    XCTAssertEqual(store.asked, ["in:3"])
    // Collapsing and opening again reads nothing.
    tree.collapse("p00")
    store.asked = []
    await tree.expand("p00")
    await tree.expand("p00a")
    XCTAssertEqual(store.asked, ["in:2"], "only the grandchildren's own children are new")
    rows = tree.rows(routing: SiteRouting())
    XCTAssertEqual(rows.filter { $0.depth == 2 }.map(\.id), ["p00a1", "p00a2"])
    // The open rows are remembered for this site for the session.
    XCTAssertEqual(PagesTreeSession.expanded["h"], ["p00", "p00a"])
  }

  func testMoreLoadsTheNextTopLevelRowsUntilTheCollectionEnds() async {
    let store = site()
    let tree = tree(store)
    await tree.start()
    await tree.loadMore()
    XCTAssertEqual(tree.rows(routing: SiteRouting()).count, 50)
    await tree.loadMore()
    XCTAssertEqual(tree.rows(routing: SiteRouting()).count, 59)
    XCTAssertTrue(tree.exhausted)
  }

  func testASearchReadsEveryWindowAndFindsADeepPage() async {
    let store = site()
    let tree = tree(store)
    await tree.start()
    await tree.loadAll()
    XCTAssertEqual(tree.matches("grandchild p00a2", routing: SiteRouting()).map(\.id), ["p00a2"])
    XCTAssertTrue(tree.exhausted)
  }

  func testAChangeIsPatchedFromOneRereadOfThePage() async {
    let store = site()
    let tree = tree(store)
    await tree.start()
    await tree.expand("p00")
    store.asked = []
    store.docs["p00b"]?["parentId"] = nil  // moved to the top level
    store.docs["p00c"] = nil  // deleted
    await tree.reread(["p00b", "p00c"]) { path in store.read(path) }
    XCTAssertEqual(store.asked, [], "no query beyond the two document reads")
    XCTAssertEqual(tree.childCount("p00"), 1)
    let rows = tree.rows(routing: SiteRouting())
    XCTAssertTrue(rows.contains { $0.id == "p00b" && $0.depth == 0 })
    XCTAssertFalse(rows.contains { $0.id == "p00c" })
  }
}
