// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynHardware

private final class MemoryStore: TapToPayAnnouncementStore {
  var keys: Set<String> = []
  func seen(_ key: String) -> Bool { keys.contains(key) }
  func markSeen(_ key: String) { keys.insert(key) }
}

final class TapToPayAnnouncementTests: XCTestCase {
  func testItShowsOnceToAPersonOnThisDevice() {
    let store = MemoryStore()
    let announcement = TapToPayAnnouncement(store: store)
    XCTAssertTrue(announcement.shouldShow(offered: true, uid: "u1", saleInProgress: false))
    announcement.markShown(uid: "u1")
    XCTAssertFalse(announcement.shouldShow(offered: true, uid: "u1", saleInProgress: false))
    // The next launch reads the same device memory.
    XCTAssertFalse(TapToPayAnnouncement(store: store).shouldShow(offered: true, uid: "u1", saleInProgress: false))
  }

  func testASecondPersonOnTheSameDeviceSeesItOnceToo() {
    let store = MemoryStore()
    let announcement = TapToPayAnnouncement(store: store)
    announcement.markShown(uid: "u1")
    XCTAssertTrue(announcement.shouldShow(offered: true, uid: "u2", saleInProgress: false))
    announcement.markShown(uid: "u2")
    XCTAssertFalse(announcement.shouldShow(offered: true, uid: "u2", saleInProgress: false))
  }

  func testABuildThatDoesNotOfferTapToPayNeverShowsIt() {
    let announcement = TapToPayAnnouncement(store: MemoryStore())
    XCTAssertFalse(announcement.shouldShow(offered: false, uid: "u1", saleInProgress: false))
    XCTAssertFalse(TapToPayIPhone.offered(entitlements: SigningEntitlements(keys: []), onPhone: true))
    XCTAssertFalse(
      announcement.shouldShow(
        offered: TapToPayIPhone.offered(entitlements: SigningEntitlements(keys: []), onPhone: true), uid: "u1", saleInProgress: false))
    XCTAssertFalse(
      announcement.shouldShow(
        offered: TapToPayIPhone.offered(entitlements: SigningEntitlements(keys: [TapToPayIPhone.entitlement]), onPhone: false),
        uid: "u1", saleInProgress: false),
      "an iPad never offers Tap to Pay on iPhone")
  }

  func testItNeverInterruptsASaleAndWaitsForTheNextClearRegister() {
    let announcement = TapToPayAnnouncement(store: MemoryStore())
    XCTAssertFalse(announcement.shouldShow(offered: true, uid: "u1", saleInProgress: true))
    XCTAssertTrue(announcement.shouldShow(offered: true, uid: "u1", saleInProgress: false), "a sale in progress does not count as seen")
  }

  func testNobodySignedInSeesNothing() {
    let store = MemoryStore()
    let announcement = TapToPayAnnouncement(store: store)
    XCTAssertFalse(announcement.shouldShow(offered: true, uid: nil, saleInProgress: false))
    XCTAssertFalse(announcement.shouldShow(offered: true, uid: "", saleInProgress: false))
    announcement.markShown(uid: "")
    XCTAssertTrue(store.keys.isEmpty)
  }

  func testTheMemoryIsPerEdition() {
    XCTAssertEqual(TapToPayAnnouncement.key(uid: "u1"), "aglyn.tapToPayAnnouncement.\(TapToPayAnnouncement.edition).u1")
  }

  func testTheDeviceStoreRemembersAcrossInstances() throws {
    let suite = "TapToPayAnnouncementTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    TapToPayAnnouncement(store: UserDefaultsAnnouncementStore(defaults)).markShown(uid: "u1")
    XCTAssertFalse(
      TapToPayAnnouncement(store: UserDefaultsAnnouncementStore(defaults)).shouldShow(offered: true, uid: "u1", saleInProgress: false))
  }

  func testApplesWordsAreKeptAsApprovedAndTheNameIsNeverShortened() {
    XCTAssertEqual(TapToPayAnnouncementCopy.headline, "Tap to Pay on iPhone")
    XCTAssertEqual(TapToPayAnnouncementCopy.enable, "Enable now")
    XCTAssertEqual(TapToPayAnnouncementCopy.termsApply, "Terms apply.")
    XCTAssertTrue(TapToPayAnnouncementCopy.fullDisclaimer.hasPrefix("Tap to Pay on iPhone requires a supported payment app"))
    for words in [TapToPayAnnouncementCopy.subheadline] + TapToPayAnnouncementCopy.disclaimers {
      XCTAssertFalse(words.contains("Apple Tap to Pay"))
      XCTAssertFalse(words.replacingOccurrences(of: "Tap to Pay on iPhone", with: "").contains("Tap to Pay"))
    }
  }

  @MainActor
  func testEnableNowStartsTheSetup() {
    XCTAssertTrue(TapToPaySetUpScreen.startsSetUp(TapToPaySetUpScreen.params))
    XCTAssertFalse(TapToPaySetUpScreen.startsSetUp([:]))
  }
}
