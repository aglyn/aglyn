// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import XCTest

@testable import AglynScreens

/// A site's plugin switches act on the lists the server holds (AGL-4047, the console's #2552): the screen holds them
/// while the site's read is only the cache's, a press applies the move to the server's lists rather than a copy read
/// earlier, and a read that failed is refused. Kotlin's SitePluginSwitchTest asserts the same.
@MainActor
final class SitePluginSwitchTests: XCTestCase {
  /// The site document answers from the cache first (`cached`), then from the server (`server`) unless that is nil.
  private final class Reader: FirestoreReader, @unchecked Sendable {
    let org: [String: Any]
    let cached: [String: Any]?
    let server: [String: Any]?
    let fails: Bool
    init(org: [String: Any], cached: [String: Any]?, server: [String: Any]?, fails: Bool = false) {
      self.org = org
      self.cached = cached
      self.server = server
      self.fails = fails
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
      onChange(.success(path.first == "orgs" ? FirestoreDocument(id: "o1", data: org) : nil))
      return NoListener()
    }

    func listenDocumentAnswer(
      _ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreAnswer<FirestoreDocument?>, Error>) -> Void
    ) -> FirestoreListening {
      if path.first == "orgs" {
        onChange(.success(FirestoreAnswer(FirestoreDocument(id: "o1", data: org), fromCache: false)))
        return NoListener()
      }
      if fails {
        onChange(.failure(URLError(.userAuthenticationRequired)))
        return NoListener()
      }
      if let cached { onChange(.success(FirestoreAnswer(FirestoreDocument(id: "h1", data: cached, fromCache: true), fromCache: true))) }
      if let server { onChange(.success(FirestoreAnswer(FirestoreDocument(id: "h1", data: server), fromCache: false))) }
      return NoListener()
    }

    func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
    func deleteDocument(_ path: [String]) async throws {}
  }

  private final class Writer: FirestoreWriter, @unchecked Sendable {
    var calls: [String] = []
    func merge(_ path: [String], _ data: [String: Any]) async throws {
      let fields = data.keys.sorted().map { "\($0)=\((data[$0] as? [String]) ?? [])" }.joined(separator: ",")
      calls.append("merge \(path.joined(separator: "/")) {\(fields)}")
    }
    func update(_ path: [String], _ data: [String: Any]) async throws {}
  }

  private let org: [String: Any] = ["enabledPlugins": ["commerce", "accounts", "crm", "bookings"]]

  override func setUp() async throws {
    FirestoreLoads.serverDeadline = .milliseconds(100)
  }

  override func tearDown() async throws {
    FirestoreLoads.serverDeadline = .seconds(12)
  }

  private func action(on: Bool) throws -> ActionSpec {
    try XCTUnwrap(
      ActionSpec(["id": on ? "on" : "off", "label": "Switch", "sitePluginSwitch": ["pluginId": "{item.id}", "on": .bool(on)], "success": "Site plugins saved"]))
  }

  private let press: JSONValue = ["site": ["id": "h1"], "org": ["id": "o1"], "item": ["id": "bookings"]]

  private func model(_ reader: Reader, _ writer: Writer = Writer()) throws -> ScreenModel {
    let spec = try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X", "load": ["plugins": ["switchboard": "site"]]]))
    return ScreenModel(spec: spec, context: ["site": ["id": "h1"], "org": ["id": "o1"]], api: nil, reader: reader, writer: writer)
  }

  func testTheListWaitsForTheServerAndHoldsTheSwitchesWhileOnlyTheCacheHasAnswered() async throws {
    let confirmed = try await FirestoreLoads.serverDocument(Reader(org: org, cached: [:], server: ["disabledPlugins": ["crm"]]), "hosts/h1")
    XCTAssertTrue(confirmed.confirmed)
    XCTAssertEqual(confirmed.document?.data["disabledPlugins"] as? [String], ["crm"], "the server's lists, not the cache's")
    let cachedOnly = try await FirestoreLoads.serverDocument(Reader(org: org, cached: [:], server: nil), "hosts/h1")
    XCTAssertFalse(cachedOnly.confirmed)
  }

  func testAPressAppliesTheMoveToTheServersListsNotTheCopyOnScreen() async throws {
    // Since the cache's snapshot, crm was switched off for this site elsewhere: switching bookings off must keep it off.
    let writer = Writer()
    let outcome = try await model(Reader(org: org, cached: [:], server: ["disabledPlugins": ["crm"]]), writer).run(action(on: false), in: press)
    guard case .done(let message, _) = outcome else { return XCTFail("\(outcome)") }
    XCTAssertEqual(message, "Site plugins saved")
    XCTAssertEqual(writer.calls, ["merge hosts/h1 {disabledPlugins=[\"crm\", \"bookings\"],enabledPlugins=[]}"])
  }

  func testAPressTheServerHasNotConfirmedOrAReadThatFailedSavesNothing() async throws {
    let unconfirmed = Writer()
    let held = try await model(Reader(org: org, cached: [:], server: nil), unconfirmed).run(action(on: true), in: press)
    guard case .failed(let heldMessage) = held else { return XCTFail("\(held)") }
    XCTAssertEqual(heldMessage, SwitchboardRows.unconfirmedText)
    XCTAssertTrue(unconfirmed.calls.isEmpty)

    let unread = Writer()
    let failed = try await model(Reader(org: org, cached: nil, server: nil, fails: true), unread).run(action(on: true), in: press)
    guard case .failed(let failedMessage) = failed else { return XCTFail("\(failed)") }
    XCTAssertEqual(failedMessage, SwitchboardRows.unreadableText)
    XCTAssertTrue(unread.calls.isEmpty)
  }
}
