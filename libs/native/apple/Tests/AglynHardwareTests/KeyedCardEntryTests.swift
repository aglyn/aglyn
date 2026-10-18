// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynHardware

final class KeyedCardEntryTests: XCTestCase {
  private func request(key: String = "pk_test_51Habc", cents: Int = 1_250) -> KeyedCardRequest {
    KeyedCardRequest(publishableKey: key, amountCents: cents, amountText: "$12.50", merchantName: "Aglyn POS")
  }

  func testAWellFormedRequestHasNoProblem() {
    XCTAssertNil(request().problem)
  }

  func testAKeyThatIsNotAPublishableKeyIsRefused() {
    XCTAssertEqual(request(key: "").problem, "Card entry is not set up for this site.")
    XCTAssertEqual(request(key: "sk_live_123").problem, "Card entry is not set up for this site.")
  }

  func testNothingToChargeIsRefused() {
    XCTAssertEqual(request(cents: 0).problem, "There is nothing to charge.")
  }
}
