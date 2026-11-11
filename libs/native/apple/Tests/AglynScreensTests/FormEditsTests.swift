// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import XCTest

@testable import AglynScreens

/// A settings Save pressed right after opening is never pressed on the cache's copy and never refused for it (AGL-4047,
/// the console's #2576): a document only the cache answered holds the forms seeded from it until the server's copy is in,
/// what was typed is kept as edits over that copy, and untouched fields follow it. Kotlin's FormEditsTest asserts the same.
@MainActor
final class FormEditsTests: XCTestCase {
  /// `users/u1` answers from the cache only on the first read; a later read has the server's copy behind the cache's.
  private final class Reader: FirestoreReader, @unchecked Sendable {
    var reads = 0
    /// The server answers before the cache does (a document the device has not cached).
    var serverFirst = false
    let cached: [String: Any]
    let server: [String: Any]?
    init(cached: [String: Any], server: [String: Any]?) {
      self.cached = cached
      self.server = server
    }

    func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void)
      -> FirestoreListening
    {
      onChange(.success([]))
      return NoListener()
    }

    func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void)
      -> FirestoreListening
    {
      onChange(.success(FirestoreDocument(id: "u1", data: cached)))
      return NoListener()
    }

    func listenDocumentAnswer(
      _ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreAnswer<FirestoreDocument?>, Error>) -> Void
    ) -> FirestoreListening {
      reads += 1
      if serverFirst, let server {
        onChange(.success(FirestoreAnswer(FirestoreDocument(id: "u1", data: server), fromCache: false)))
        return NoListener()
      }
      onChange(.success(FirestoreAnswer(FirestoreDocument(id: "u1", data: cached, fromCache: true), fromCache: true)))
      if reads > 1, let server { onChange(.success(FirestoreAnswer(FirestoreDocument(id: "u1", data: server), fromCache: false))) }
      return NoListener()
    }

    func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
    func deleteDocument(_ path: [String]) async throws {}
  }

  override func setUp() async throws {
    FirestoreLoads.serverDeadline = .milliseconds(100)
  }

  override func tearDown() async throws {
    FirestoreLoads.serverDeadline = .seconds(12)
  }

  private func model(_ reader: Reader) throws -> ScreenModel {
    let spec = try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X", "load": ["me": ["doc": "users/{user.uid}"]]]))
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" })
    return ScreenModel(spec: spec, context: ["user": ["uid": "u1"]], api: api, reader: reader, writer: nil)
  }

  func testACachedSeedIsHeldUntilTheServersCopyReplacesIt() async throws {
    let model = try model(Reader(cached: ["firstName": "Ann", "city": "Old"], server: ["firstName": "Ann", "city": "Austin"]))
    await model.load()
    XCTAssertEqual(model.context["checking"]?["me"], .bool(true), "the cache's copy holds the form")
    XCTAssertEqual(model.context["data"]?["me"]?["city"], "Old")
    XCTAssertNil(model.context["data"]?["me"]?[FirestoreLoads.fromCacheKey], "the marker never reaches the data")
    for _ in 0..<50 where model.context["checking"]?["me"] != nil { try await Task.sleep(for: .milliseconds(20)) }
    XCTAssertEqual(model.context["checking"], .object([:]), "the server's copy lifts the hold")
    XCTAssertEqual(model.context["data"]?["me"]?["city"], "Austin", "and replaces the cache's")
  }

  func testAServerAnswerOnTheFirstReadHoldsNothing() async throws {
    let reader = Reader(cached: ["city": "Austin"], server: ["city": "Austin"])
    reader.serverFirst = true
    let model = try model(reader)
    await model.load()
    XCTAssertEqual(model.context["checking"], .object([:]))
    XCTAssertEqual(model.context["data"]?["me"]?["city"], "Austin")
  }

  func testEditsAreKeptOverAFresherSeedAndLandedOnesFollowIt() {
    let typed: [String: FieldValue] = ["firstName": .text("Annie"), "city": .text("Dallas")]
    // The server's copy arrives: the typed name and city are kept; untouched fields were never edits.
    XCTAssertEqual(FormEdits.settled(typed, pressed: nil, seed: ["firstName": .text("Ann"), "city": .text("Austin")]), typed)
    // A save landed: what the seed shows now, and what the press wrote (formatted on the way), follow the seed again.
    let pressed: [String: FieldValue] = ["firstName": .text("Annie"), "phone": .text("512 555 0123")]
    let after = FormEdits.settled(
      typed.merging(["phone": .text("512 555 0123")]) { a, _ in a }, pressed: pressed,
      seed: ["firstName": .text("Annie"), "city": .text("Austin"), "phone": .text("+15125550123")])
    XCTAssertEqual(after, ["city": .text("Dallas")], "typed while the save ran, so still unsaved")
  }

  func testAFormIsHeldOnlyByTheLoadsItReads() {
    let checking: JSONValue = ["me": true, "site": true]
    XCTAssertEqual(FormEdits.heldBy(object: "data.me", initials: ["{item.firstName}"], checking: checking), ["me"])
    XCTAssertEqual(FormEdits.heldBy(object: nil, initials: ["{data.site.name ?? data.org.name}"], checking: checking), ["site"])
    XCTAssertEqual(FormEdits.heldBy(object: nil, initials: ["{data.settings.x}"], checking: ["set": true]), [], "not a longer key")
    XCTAssertEqual(FormEdits.heldBy(object: "data.me", initials: [], checking: ["me": false]), [])
    XCTAssertEqual(FormEdits.checkingText("profile"), "Checking your profile with the server…")
    XCTAssertEqual(FormEdits.checkingText(nil), "Checking your settings with the server…")
  }
}
