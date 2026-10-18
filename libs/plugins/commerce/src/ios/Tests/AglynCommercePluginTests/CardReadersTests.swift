// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynCommercePlugin

/// The readers screen's server side: what the readers route lists, and when a pairing may be sent.
final class CardReadersTests: XCTestCase {
  func testTheReadersRouteListsEachSmartReaderWithItsRegister() {
    let list = readPosReadersList(
      .object([
        "available": true, "testMode": true, "locationReady": false,
        "readers": .array([
          .object([
            "id": "tmr_1", "label": "Front counter", "registerId": "r1", "deviceType": "bbpos_wisepos_e",
            "serialNumber": "WSC-1", "status": "online", "livemode": false,
          ]),
          .object(["label": "No id, so not listed"]),
        ]),
      ]))
    XCTAssertTrue(list.available)
    XCTAssertTrue(list.testMode)
    XCTAssertFalse(list.locationReady)
    XCTAssertEqual(list.readers.map(\.id), ["tmr_1"])
    XCTAssertEqual(list.readers.first?.registerID, "r1")
    XCTAssertEqual(list.readers.first?.online, true)
  }

  func testAPairingNeedsTheReadersCode() {
    XCTAssertNil(checkReaderPairing(code: "sepia-cerulean-aqua", address: nil))
    XCTAssertEqual(checkReaderPairing(code: "ab", address: nil), "Enter the code the reader shows on its screen.")
    XCTAssertEqual(checkReaderPairing(code: "not a code!", address: nil), "Enter the code the reader shows on its screen.")
  }

  func testAStoreWithNoReaderAddressGivesOne() {
    var address = ReaderAddress(line1: "100 Main St", city: "Austin", state: "TX", postalCode: "78701", country: "us")
    XCTAssertNil(checkReaderPairing(code: "sepia-cerulean-aqua", address: address))
    address.city = " "
    XCTAssertEqual(checkReaderPairing(code: "sepia-cerulean-aqua", address: address), "Enter the street, city and postal code.")
    address.city = "Austin"
    address.country = "USA"
    XCTAssertEqual(
      checkReaderPairing(code: "sepia-cerulean-aqua", address: address), "Enter the two-letter country code, such as US.")
    XCTAssertEqual(address.json.objectValue["country"], "USA")
  }
}
