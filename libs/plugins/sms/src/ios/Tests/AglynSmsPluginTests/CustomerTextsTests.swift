// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSmsPlugin

private final class FakeWriter: FirestoreWriter, @unchecked Sendable {
  var merged: [([String], [String: Any])] = []
  var fail = false
  func merge(_ path: [String], _ data: [String: Any]) async throws {
    if fail { throw ConsoleAPIError(status: 0, message: "permission denied") }
    merged.append((path, data))
  }
}

private struct FakeAPI: TextsAPI {
  var answer: TextChannel
  func channel() async -> TextChannel { answer }
}

@MainActor
final class CustomerTextsTests: XCTestCase {
  func testTextsAreOnUnlessTheStoreTurnedThemOff() {
    let texts = CustomerTexts(api: FakeAPI(answer: .available), writer: FakeWriter(), hostID: "h1")
    XCTAssertTrue(texts.enabled(nil))
    XCTAssertTrue(texts.enabled([:]))
    XCTAssertTrue(texts.enabled(["buyerNotifications": ["receipt": false]]))
    XCTAssertFalse(texts.enabled(["buyerNotifications": ["texts": false]]))
    XCTAssertTrue(texts.enabled(["buyerNotifications": "garbage"]))
  }

  func testTheChannelAnswerGatesTheSwitch() async {
    let texts = CustomerTexts(api: FakeAPI(answer: .unavailable), writer: FakeWriter(), hostID: "h1")
    XCTAssertEqual(texts.channel, .checking)
    await texts.check()
    XCTAssertEqual(texts.channel, .unavailable)
  }

  func testASwitchWritesOnlyItsOwnKeyUnderTheStoreSettings() async {
    let writer = FakeWriter()
    let texts = CustomerTexts(api: FakeAPI(answer: .available), writer: writer, hostID: "h1")
    await texts.set(false)
    XCTAssertEqual(writer.merged.count, 1)
    XCTAssertEqual(writer.merged[0].0, ["hosts", "h1", "settings", "store"])
    XCTAssertEqual((writer.merged[0].1["buyerNotifications"] as? [String: Bool]), ["texts": false])
    XCTAssertNil(texts.error)
    XCTAssertFalse(texts.saving)
  }

  func testARefusedWriteSaysSoInTheCardsWords() async {
    let writer = FakeWriter()
    writer.fail = true
    let texts = CustomerTexts(api: FakeAPI(answer: .available), writer: writer, hostID: "h1")
    await texts.set(true)
    XCTAssertEqual(texts.error, "That setting could not be saved. Try again.")
    XCTAssertFalse(texts.saving)
  }
}
