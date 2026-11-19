// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// The feed's header sorts (the console's NOTIFICATION_SORTS): any order with no filter on; with one on, newest first and why.
final class NotificationSortTests: XCTestCase {
  func testOrdersAsTheConsoleHeadersDo() {
    XCTAssertEqual(NotificationSort.oldest.path, "createdAt")
    XCTAssertFalse(NotificationSort.oldest.descending)
    XCTAssertEqual(NotificationSort.newFirst.path, "read")
    XCTAssertFalse(NotificationSort.newFirst.descending, "read false first: New, then Read")
    XCTAssertTrue(NotificationSort.titleDescending.descending)
    XCTAssertNil(NotificationSort.typeAscending.notice(filtered: false))
    XCTAssertEqual(NotificationSort.typeAscending.inForce(filtered: true), .newest)
    XCTAssertEqual(NotificationSort.typeAscending.notice(filtered: true), "Sorted by When: Type sorts only with no filter on.")
    XCTAssertNil(NotificationSort.newest.notice(filtered: true))
  }
}
