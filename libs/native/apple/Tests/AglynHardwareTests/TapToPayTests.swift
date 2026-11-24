// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynHardware

/// Tap to Pay on iPhone as Apple's review asks for it: the button's press, who may accept Apple's terms, and the words.
final class TapToPayTests: XCTestCase {
  private let ready = CardCollectorState.connected(label: "Tap to Pay on iPhone", kind: .tapToPay, testMode: true)

  func testTheButtonIsNamedAndDrawnTheWayAppleAsks() {
    XCTAssertEqual(TapToPayIPhone.title, "Tap to Pay on iPhone")
    XCTAssertTrue(["wave.3.right.circle", "wave.3.right.circle.fill"].contains(TapToPayIPhone.symbol))
    XCTAssertEqual(TapToPayIPhone.minimumOSMajor, 18)
  }

  func testAPressTakesTheCardOnceReadyAndConnectsFirstOtherwise() {
    XCTAssertEqual(tapToPayPress(osMajor: 18, state: ready, progress: nil), .collect)
    XCTAssertEqual(tapToPayPress(osMajor: 26, state: .disconnected, progress: nil), .connect)
    // A Bluetooth reader being connected is not Tap to Pay: the press connects Tap to Pay.
    XCTAssertEqual(
      tapToPayPress(
        osMajor: 18, state: .connected(label: "Stripe Reader M2", kind: .bluetooth, testMode: true), progress: nil),
      .connect)
  }

  func testAPressWhileTheIPhoneIsBeingSetUpSaysSoWithItsProgress() {
    XCTAssertEqual(
      tapToPayPress(osMajor: 18, state: .disconnected, progress: 0.4),
      .explain(.preparing(progress: 0.4)))
    XCTAssertEqual(
      tapToPayPress(osMajor: 18, state: .connecting("Starting Tap to Pay…"), progress: nil),
      .explain(.preparing(progress: nil)))
  }

  func testOnOlderIOSThePressAsksForAnUpdateAndNeverGreysOut() {
    XCTAssertEqual(tapToPayPress(osMajor: 17, state: ready, progress: nil), .explain(.needsUpdate))
    XCTAssertTrue(TapToPayNotice.needsUpdate.message.contains("iOS 18"))
  }

  /// Apple 1.6: whether the terms are accepted is Apple's answer at each press. A press after "not turned on" (or any
  /// other failure) connects again, so the SDK is asked afresh; no earlier answer is kept to stop it.
  func testEveryPressAsksTheSDKAgainWhateverItAnsweredLastTime() {
    XCTAssertEqual(tapToPayPress(osMajor: 18, state: .disconnected, progress: nil), .connect)
    XCTAssertEqual(tapToPayPress(osMajor: 18, state: .unavailable("Tap to Pay on iPhone isn’t turned on yet"), progress: nil), .connect)
  }

  func testOnlyAglynStaffMayAcceptApplesTerms() {
    XCTAssertTrue(tapToPayTermsPermitted(isStaff: true))
    XCTAssertFalse(tapToPayTermsPermitted(isStaff: false))
  }

  func testTermsErrorsReadAsContactSupportNotAsTheSDKsWords() {
    for code in [
      "TAP_TO_PAY_READER_TOS_NOT_YET_ACCEPTED", "TAP_TO_PAY_READER_MERCHANT_BLOCKED",
      "TAP_TO_PAY_READER_INVALID_MERCHANT", "TAP_TO_PAY_READER_ACCOUNT_DEACTIVATED",
    ] {
      XCTAssertEqual(tapToPayNotice(code: code), .notTurnedOn, code)
    }
    XCTAssertEqual(TapToPayNotice.notTurnedOn.title, "Tap to Pay on iPhone isn’t turned on yet")
    XCTAssertEqual(TapToPayNotice.notTurnedOn.message, "Contact support to turn it on. Take this payment another way for now.")
    XCTAssertEqual(
      friendlyConnectError(code: "TAP_TO_PAY_READER_TOS_NOT_YET_ACCEPTED", message: "SDK words"),
      TapToPayNotice.notTurnedOn.message)
    XCTAssertNil(tapToPayNotice(code: "BLUETOOTH_DISABLED"))
  }

  func testAnOldIOSIsAskedToUpdateNotCalledTheWrongIPhone() {
    XCTAssertEqual(
      friendlyDiscoveryError(code: "TAP_TO_PAY_UNSUPPORTED_OS_VERSION", message: nil), TapToPayNotice.needsUpdate.message)
    XCTAssertTrue(
      friendlyDiscoveryError(code: "TAP_TO_PAY_UNSUPPORTED_DEVICE", message: nil).contains("iPhone XS or later"))
  }

  func testACardNotApprovedWhileAwayIsNotified() {
    let note = CardNotApprovedNotification(amount: "$24.79", place: "Front counter")
    XCTAssertEqual(note.title, "Card not approved")
    XCTAssertEqual(note.body, "$24.79 at Front counter was not charged. Open the sale to take the payment another way.")
    XCTAssertEqual(
      CardNotApprovedNotification(amount: "$5.00", place: nil).body,
      "$5.00 was not charged. Open the sale to take the payment another way.")
  }
}
