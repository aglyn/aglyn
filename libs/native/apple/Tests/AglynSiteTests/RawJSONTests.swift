// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynSite

final class RawJSONTests: XCTestCase {
  func testShowsTheDocumentAsTheConsoleDoes() {
    let json = firestoreRawJSON(
      id: "page-about",
      data: [
        "name": "About", "visibility": NSNumber(value: 2), "preview": NSNumber(value: true),
        "updatedAt": Date(timeIntervalSince1970: 1_700_000_000.5), "seo": ["title": "About us", "path": "/about"],
        "tags": ["a", "b"], "removed": NSNull(),
      ])
    XCTAssertEqual(
      json,
      """
      {
        "$id": "page-about",
        "name": "About",
        "preview": true,
        "removed": null,
        "seo": {
          "path": "/about",
          "title": "About us"
        },
        "tags": [
          "a",
          "b"
        ],
        "updatedAt": {
          "nanoseconds": 500000000,
          "seconds": 1700000000
        },
        "visibility": 2
      }
      """)
  }
}
