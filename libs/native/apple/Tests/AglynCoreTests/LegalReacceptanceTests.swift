// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// The re-acceptance banner (AGL-2316) in the console's words: thanked first when the documents moved, our gap when no record.
final class LegalReacceptanceTests: XCTestCase {
  private let us = Locale(identifier: "en_US")

  func testSupersededThanksWithTheDayAndNamesWhatChanged() throws {
    let status = try XCTUnwrap(LegalStatus([
      "reacceptanceRequired": true, "reacceptanceReason": "version-superseded",
      "latestAcceptedAt": "2026-11-02T15:00:00.000Z", "changedDocumentKeys": ["terms", "privacy"],
    ]))
    let copy = try XCTUnwrap(LegalReacceptanceCopy.make(status, brand: "Aglyn", locale: us))
    XCTAssertEqual(copy.lead, "Thanks for agreeing to Aglyn’s ")
    XCTAssertTrue(copy.tail.hasPrefix(" on November 2, 2026. We’ve updated them since"))
    XCTAssertEqual(copy.caption, "What changed: the Terms of Service and the Privacy Policy. Your earlier agreement stays on record — this adds to it.")
  }

  func testSupersededWithoutADayStillAcknowledges() throws {
    let status = LegalStatus(reacceptanceRequired: true, reason: .versionSuperseded, latestAcceptedAt: nil, changedDocumentKeys: nil)
    let copy = try XCTUnwrap(LegalReacceptanceCopy.make(status, brand: "Aglyn", locale: us))
    XCTAssertEqual(copy.lead, "You’ve already agreed to Aglyn’s ")
    XCTAssertFalse(copy.tail.contains(" on "))
    XCTAssertEqual(copy.caption, "Your earlier agreement stays on record — this adds to it.")
  }

  func testNoRecordIsOurGapAndNothingIsAskedWhenCurrent() throws {
    let never = LegalStatus(reacceptanceRequired: true, reason: .neverAccepted, latestAcceptedAt: nil, changedDocumentKeys: nil)
    XCTAssertEqual(LegalReacceptanceCopy.make(never, brand: "Aglyn")?.lead, "We don’t have a record of your acceptance of Aglyn’s ")
    let current = LegalStatus(reacceptanceRequired: false, reason: .none, latestAcceptedAt: nil, changedDocumentKeys: nil)
    XCTAssertNil(LegalReacceptanceCopy.make(current, brand: "Aglyn"))
  }
}
