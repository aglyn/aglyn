// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynSite

final class EntryTrafficTests: XCTestCase {
  func testFoldsAPathTheWayTheBeaconWritesIt() {
    XCTAssertEqual(analyticsPathKey("/blog/v1.2"), "/blog/v1_2")
    XCTAssertEqual(analyticsPathKey("/a.b$c#d[e"), "/a_b_c_d_e")
    XCTAssertEqual(analyticsPathKey(""), "/")
    XCTAssertEqual(analyticsPathKey("/" + String(repeating: "x", count: 300)).count, 200)
  }

  func testCountsOnlyTheEntrysOwnPath() {
    let days = [
      TrafficDay(day: "2026-11-14", data: ["paths": ["/blog/hello": 3, "/": 40]]),
      TrafficDay(day: "2026-11-15", data: nil),
      TrafficDay(day: "2026-11-16", data: ["paths": ["/blog/hello": 5]]),
    ]
    let summary = EntryTrafficSummary(days: days, path: "/blog/hello")
    XCTAssertEqual(summary.counts.map(\.total), [3, 0, 5])
    XCTAssertEqual(summary.total, 8)
    XCTAssertEqual(summary.best?.day, "2026-11-16")
    XCTAssertNil(EntryTrafficSummary(days: days, path: "/blog/other").best)
  }
}
