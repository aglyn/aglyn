// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// Coming back from the Besigner re-reads at once on a REST-read build, rather than a poll later.
final class RestRereadTests: XCTestCase {
  func testRereadNowEndsTheWaitBetweenTwoReads() async {
    let start = ContinuousClock.now
    async let waited: Void = RestFirestoreReader.pause(.seconds(30))
    try? await Task.sleep(for: .milliseconds(200))
    RestFirestoreReader.rereadNow()
    await waited
    XCTAssertLessThan(ContinuousClock.now - start, .seconds(5), "the wait ended when a re-read was asked for")
  }

  func testTheWaitEndsOnItsIntervalWithNoRequest() async {
    let start = ContinuousClock.now
    await RestFirestoreReader.pause(.milliseconds(50))
    XCTAssertLessThan(ContinuousClock.now - start, .seconds(5))
  }
}
