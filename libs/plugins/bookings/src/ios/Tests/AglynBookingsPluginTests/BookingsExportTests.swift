// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynBookingsPlugin

/// The Bookings list's Export opens the export sheet on the list as it stands, in the bookings transfer's filter terms.
final class BookingsExportTests: XCTestCase {
  func testExportsTheUpcomingBookingsOrOneBookersOnes() {
    let upcoming = bookingsExportRequest(hostID: "h1", booker: nil, nowMs: 1_800_000_000_123.7)
    XCTAssertEqual(upcoming.resource, "bookings")
    XCTAssertEqual(upcoming.hostID, "h1")
    XCTAssertEqual(upcoming.scope, ["kind": "filter", "filter": ["upcoming": true, "asOfMs": 1_800_000_000_123]])
    XCTAssertEqual(upcoming.filter, ["upcoming": true, "asOfMs": 1_800_000_000_123])
    XCTAssertEqual(upcoming.filterLabel, "Upcoming bookings")
    let one = bookingsExportRequest(hostID: "h1", booker: "ada@example.com", nowMs: 0)
    XCTAssertEqual(one.scope, ["kind": "filter", "filter": ["email": "ada@example.com"]])
    XCTAssertEqual(one.filterLabel, "Bookings for ada@example.com")
  }
}
