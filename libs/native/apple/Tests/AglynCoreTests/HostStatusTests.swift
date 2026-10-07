// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

final class HostStatusTests: XCTestCase {
  private let now = Date(timeIntervalSince1970: 1_800_000_000)

  func testLiveCountsPublishedScreens() {
    let status = HostStatus.describe(["screens": ["a": 1, "b": 2]], now: now)
    XCTAssertEqual(status.kind, .live)
    XCTAssertEqual(status.detail, "2 published pages.")
    XCTAssertEqual(HostStatus.describe(["screens": ["a": 1]], now: now).detail, "1 published page.")
  }

  func testDraftWithNothingPublished() {
    XCTAssertEqual(HostStatus.describe([:], now: now).kind, .draft)
    XCTAssertEqual(HostStatus.describe(nil, now: now).label, "Draft")
  }

  func testMaintenanceBeatsPublished() {
    XCTAssertEqual(HostStatus.describe(["screens": ["a": 1], "maintenance": true], now: now).kind, .maintenance)
  }

  func testSuspendedUntilItLapses() {
    let ms = now.timeIntervalSince1970 * 1000
    XCTAssertEqual(HostStatus.describe(["screens": ["a": 1], "suspendedAt": 5], now: now).kind, .suspended)
    XCTAssertEqual(
      HostStatus.describe(["screens": ["a": 1], "suspendedAt": 5, "suspendedUntilMs": ms + 1], now: now).kind, .suspended)
    XCTAssertEqual(
      HostStatus.describe(["screens": ["a": 1], "suspendedAt": 5, "suspendedUntilMs": ms - 1], now: now).kind, .live)
    XCTAssertEqual(HostStatus.describe(["suspendedAt": 0, "maintenance": true], now: now).kind, .maintenance)
  }

  func testSiteAddress() {
    XCTAssertEqual(HostStatus.siteAddress("demo-site"), "demo-site.aglyn.app")
    XCTAssertNil(HostStatus.siteAddress(" "))
    XCTAssertNil(HostStatus.siteAddress(nil))
  }

  func testRelativeTime() {
    let ago = { (seconds: Double) in relativeTime(self.now.addingTimeInterval(-seconds), now: self.now) }
    XCTAssertEqual(ago(-60), "Just now")
    XCTAssertEqual(ago(30), "Just now")
    XCTAssertEqual(ago(12 * 60), "12 min ago")
    XCTAssertEqual(ago(3 * 3600), "3 hr ago")
    XCTAssertEqual(ago(30 * 3600), "Yesterday")
    XCTAssertEqual(ago(4 * 86400), "4 days ago")
    XCTAssertEqual(ago(15 * 86400), "2 wk ago")
    XCTAssertEqual(ago(160 * 86400), "5 mo ago")
    XCTAssertEqual(ago(800 * 86400), "2 yr ago")
  }
}
