// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynPluginHost

/// The picker's list and the stored value's reading match the server's (AGL-3890).
final class NotificationSoundsTests: XCTestCase {
  func testTheListLeadsWithTheDefaultXylophone() {
    XCTAssertEqual(AglynNotificationSounds.all.count, 9)
    XCTAssertEqual(AglynNotificationSounds.all.first?.id, "xylophone")
    XCTAssertEqual(AglynNotificationSounds.defaultID, "xylophone")
    XCTAssertEqual(AglynNotificationSounds.field, "notificationSound")
    XCTAssertTrue(AglynNotificationSounds.all.allSatisfy { $0.apple == "aglyn-\($0.id).caf" })
  }

  func testAStoredIdPicksItsSoundAndAnythingElseTheDefault() {
    XCTAssertEqual(AglynNotificationSounds.sound(for: "cowbell")?.label, "Cowbell")
    XCTAssertEqual(AglynNotificationSounds.sound(for: nil)?.id, "xylophone")
    XCTAssertEqual(AglynNotificationSounds.sound(for: "kazoo")?.id, "xylophone")
    XCTAssertEqual(AglynNotificationSounds.sound(for: 3)?.id, "xylophone")
  }
}
