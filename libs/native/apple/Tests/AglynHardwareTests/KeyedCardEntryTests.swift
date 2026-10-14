// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynHardware

final class KeyedCardEntryTests: XCTestCase {
  private let intent = "pi_3Q1x2yZabcDEFghi"

  private func request(
    id: String? = nil, secret: String? = nil, key: String = "pk_test_51Habc", cents: Int = 1_250
  ) -> KeyedCardRequest {
    KeyedCardRequest(
      paymentIntentID: id ?? intent, clientSecret: secret ?? "\(intent)_secret_AbCdEfGh12345678", publishableKey: key,
      amountCents: cents, merchantName: "Aglyn POS")
  }

  func testAWellFormedRequestHasNoProblem() {
    XCTAssertNil(request().problem)
  }

  func testASecretThatNamesAnotherIntentIsRefused() {
    XCTAssertNotNil(request(secret: "pi_3Q9other0000000_secret_AbCdEfGh12345678").problem)
  }

  func testAMissingOrMalformedIntentIsRefused() {
    XCTAssertNotNil(request(id: "").problem)
    XCTAssertNotNil(request(id: "cs_123").problem)
  }

  func testAKeyThatIsNotAPublishableKeyIsRefused() {
    XCTAssertEqual(request(key: "").problem, "Card entry is not set up for this site.")
    XCTAssertEqual(request(key: "sk_live_123").problem, "Card entry is not set up for this site.")
  }

  func testNothingToChargeIsRefused() {
    XCTAssertEqual(request(cents: 0).problem, "There is nothing to charge.")
  }

  func testAnOutcomeNamesItsIntent() {
    XCTAssertEqual(KeyedCardOutcome.confirmed(paymentIntentID: intent).paymentIntentID, intent)
    XCTAssertEqual(KeyedCardOutcome.canceled(paymentIntentID: intent).paymentIntentID, intent)
    XCTAssertEqual(KeyedCardOutcome.failed(paymentIntentID: intent, message: "No").paymentIntentID, intent)
  }
}
