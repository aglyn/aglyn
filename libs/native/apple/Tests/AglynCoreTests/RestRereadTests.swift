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

  /// A write through REST re-reads every live read at once (a support session, an unsigned Mac build): the editor shows
  /// its own save, not a poll 30 seconds later (AGL-3971).
  func testAWriteReReadsAtOnce() async throws {
    let reader = RestFirestoreReader(
      projectID: "demo", emulatorHost: "127.0.0.1:1", transport: RecordingTransport([(200, "{}"), (200, "{}"), (200, "{}")]),
      idToken: { "token" })
    for write in 0..<3 {
      let reread = expectation(forNotification: RestFirestoreReader.rereadNotification, object: nil)
      switch write {
      case 0: try await reader.setDocument(["orgs", "o", "contactFields", "f"], ["label": "Budget"], merge: true)
      case 1: try await reader.updateDocument(["orgs", "o", "contacts", "c"], ["custom": ["budget": 1500]])
      default: try await reader.deleteDocument(["orgs", "o", "contactFields", "f"])
      }
      await fulfillment(of: [reread], timeout: 2)
    }
  }

  func testTheWaitEndsOnItsIntervalWithNoRequest() async {
    let start = ContinuousClock.now
    await RestFirestoreReader.pause(.milliseconds(50))
    XCTAssertLessThan(ContinuousClock.now - start, .seconds(5))
  }
}
