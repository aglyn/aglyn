// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynWaiversPlugin

final class WaiverCheckInTests: XCTestCase {
  func testASignedWaiverInFullNeedsNothing() {
    let look = WaiverStatusLook(WaiverStatusAnswer(signed: true, label: "Waiver signed", matched: true))
    XCTAssertTrue(look.signedInFull)
    XCTAssertFalse(look.needed)
    XCTAssertFalse(look.notMatched)
  }

  func testSignedForSomeRidersStillNeedsTheRest() {
    let look = WaiverStatusLook(WaiverStatusAnswer(signed: true, label: "Signed for 2 of 3 riders"))
    XCTAssertFalse(look.signedInFull)
    XCTAssertTrue(look.needed)
  }

  func testNotMatchedOffersFindByName() {
    let look = WaiverStatusLook(
      WaiverStatusAnswer(signed: false, label: "Waiver not matched — check by name", matched: false, searchName: "Lena Fischer"))
    XCTAssertTrue(look.notMatched)
    XCTAssertTrue(look.needed)
  }

  func testNoAnswerReadsNotOnFile() {
    XCTAssertEqual(WaiverStatusLook(nil).label, "Waiver not on file")
  }

  func testTheAnswerDecodes() {
    let json: JSONValue = ["signed": true, "label": "Waiver signed", "coveredNames": ["Ana"], "matched": true]
    XCTAssertEqual(WaiverStatusAnswer(json), WaiverStatusAnswer(signed: true, label: "Waiver signed", matched: true))
  }

  func testTheQuerySendsTheContactAndOnlyMoreThanOnePerson() {
    let query = waiverStatusQuery(hostID: "h1", dayKey: "2026-11-07", email: "a@b.co", contactID: "c1", name: " ", unitsDue: 1)
    let sent = Dictionary(uniqueKeysWithValues: query.compactMap { key, value in value.map { (key, $0) } })
    XCTAssertEqual(sent, ["hostId": "h1", "dayKey": "2026-11-07", "email": "a@b.co", "contactId": "c1"])
    let three = waiverStatusQuery(hostID: "h1", dayKey: "2026-11-07", email: nil, contactID: nil, name: "Ana", unitsDue: 3)
    XCTAssertEqual(three.first { $0.0 == "people" }?.1, "3")
  }
}
