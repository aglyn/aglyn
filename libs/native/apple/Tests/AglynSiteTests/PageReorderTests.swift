// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

final class PageReorderTests: XCTestCase {
  private func nodes(_ rows: [(String, [String: Any])]) -> [String: PageNode] {
    Dictionary(uniqueKeysWithValues: rows.compactMap { id, data in PageNode(FirestoreDocument(id: id, data: data)).map { (id, $0) } })
  }

  func testCountsAPagesPlaceAmongItsSiblingsInTheHubsOrder() {
    let all = nodes([
      ("home", ["displayName": "Home", "order": 0]),
      ("about", ["displayName": "About", "order": 1]),
      ("pricing", ["displayName": "Pricing", "order": 2]),
      ("team", ["displayName": "Team", "parentId": "about", "order": 0]),
      ("careers", ["displayName": "Careers", "parentId": "about", "order": 1]),
      ("orphan", ["displayName": "Orphan", "parentId": "gone"]),
    ])
    XCTAssertEqual(pageSiblingPlace("home", in: all), PageSiblingPlace(parentID: nil, index: 0, count: 4))
    XCTAssertNil(pageSiblingPlace("home", in: all)?.upIndex)
    XCTAssertEqual(pageSiblingPlace("home", in: all)?.downIndex, 1)
    // A page under a parent the cache does not hold sits at the top level, after every ordered page.
    XCTAssertEqual(pageSiblingPlace("orphan", in: all), PageSiblingPlace(parentID: nil, index: 3, count: 4))
    XCTAssertNil(pageSiblingPlace("orphan", in: all)?.downIndex)
    let careers = pageSiblingPlace("careers", in: all)
    XCTAssertEqual(careers, PageSiblingPlace(parentID: "about", index: 1, count: 2))
    XCTAssertEqual(careers?.upIndex, 0)
    XCTAssertNil(careers?.downIndex)
    XCTAssertNil(pageSiblingPlace("nope", in: all))
  }
}
