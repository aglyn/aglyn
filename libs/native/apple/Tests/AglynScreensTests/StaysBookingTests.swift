// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// The front desk's walk-in: priced and checked against the resource's live stays and blocks, then booked as the console's card
/// books it. The Kotlin renderer's `CommerceWalkInTest` holds the same cases.
final class StaysBookingTests: XCTestCase {
  private final class Desk: FirestoreReader, @unchecked Sendable {
    var resource: [String: Any]?
    var stays: [[String: Any]]
    var failQuery = false
    var queries: [FirestoreQuery] = []

    init(resource: [String: Any]? = nil, stays: [[String: Any]] = [], useDefaultResource: Bool = true) {
      self.resource =
        resource
        ?? (useDefaultResource
          ? [
            "nightlyRateUsd": 120, "minNights": 2,
            "blocks": [["fromDayMs": Double(Stays.day("2026-12-24")!), "toDayMs": Double(Stays.day("2026-12-27")!)]],
          ] : nil)
      self.stays = stays
    }

    @MainActor
    func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening {
      queries.append(query)
      if failQuery {
        onChange(.failure(ConsoleAPIError(status: 0, message: "offline")))
      } else {
        onChange(.success(stays.enumerated().map { FirestoreDocument(id: "s\($0.offset)", data: $0.element) }))
      }
      return NoListener()
    }

    @MainActor
    func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening {
      onChange(.success(path == ["hosts", "h1", "resources", "r1"] ? resource.map { FirestoreDocument(id: "r1", data: $0) } : nil))
      return NoListener()
    }

    func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
    func deleteDocument(_ path: [String]) async throws {}
  }

  private final class Written: FirestoreWriter, @unchecked Sendable {
    var calls: [(path: [String], data: [String: Any])] = []
    func merge(_ path: [String], _ data: [String: Any]) async throws { calls.append((path, data)) }
  }

  private func stay(_ from: String, _ to: String, _ status: String = "confirmed") -> [String: Any] {
    ["resourceId": "r1", "checkInDayMs": Double(Stays.day(from)!), "checkOutDayMs": Double(Stays.day(to)!), "status": status]
  }

  @MainActor
  private func book(_ desk: Desk, _ form: JSONValue, writer: Written = Written()) async throws -> (ActionOutcome, Written) {
    let spec = try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"]))
    let model = ScreenModel(spec: spec, context: ["site": ["id": "h1"], "form": form], api: nil, reader: desk, writer: writer)
    let action = try XCTUnwrap(
      ActionSpec([
        "label": "Walk-in", "success": "Walk-in reserved",
        "write": ["stay": ["resource": "{form.resourceId}", "checkIn": "{form.checkIn}", "checkOut": "{form.checkOut}", "guestName": "{form.guestName}"]],
      ]))
    return (await model.run(action, in: model.context), writer)
  }

  private let form: JSONValue = ["resourceId": "r1", "checkIn": "2026-10-12", "checkOut": "2026-10-15", "guestName": "Ada"]

  @MainActor
  func testAFreeStayIsPricedAndBookedConfirmedWithNothingPaid() async throws {
    let desk = Desk()
    let (outcome, written) = try await book(desk, form)
    guard case .done(let message, _) = outcome else { return XCTFail("\(outcome)") }
    XCTAssertEqual(message, "Walk-in reserved")
    let call = try XCTUnwrap(written.calls.first)
    XCTAssertEqual(Array(call.path.prefix(3)), ["hosts", "h1", "reservations"])
    XCTAssertEqual(call.data["status"] as? String, "confirmed")
    XCTAssertEqual(call.data["resourceId"] as? String, "r1")
    XCTAssertEqual(call.data["guestName"] as? String, "Ada")
    XCTAssertEqual((call.data["nights"] as? NSNumber)?.intValue, 3)
    XCTAssertEqual((call.data["totalCents"] as? NSNumber)?.intValue, 36000)
    XCTAssertEqual((call.data["paidCents"] as? NSNumber)?.intValue, 0)
    XCTAssertEqual((call.data["depositCents"] as? NSNumber)?.intValue, 0)
    XCTAssertEqual((call.data["checkInDayMs"] as? NSNumber)?.int64Value, Stays.day("2026-10-12"))
    // The check asks for this resource's stays that end after the walk-in arrives, the booking door's own query.
    let query = try XCTUnwrap(desk.queries.first)
    XCTAssertEqual(query.collection, ["hosts", "h1", "reservations"])
    XCTAssertEqual(query.equals.map(\.field), ["resourceId"])
    XCTAssertEqual(query.filters.map(\.path), ["checkOutDayMs"])
  }

  @MainActor
  func testDatesThatClashWithALiveStayOrABlockAreTakenAndNothingIsWritten() async throws {
    for taken in [stay("2026-10-13", "2026-10-14"), stay("2026-10-10", "2026-10-13", "checked_in")] {
      let (outcome, written) = try await book(Desk(stays: [taken]), form)
      guard case .failed(let message) = outcome else { return XCTFail("\(outcome)") }
      XCTAssertEqual(message, "Those dates are taken")
      XCTAssertTrue(written.calls.isEmpty)
    }
    let (blocked, written) = try await book(Desk(), ["resourceId": "r1", "checkIn": "2026-12-23", "checkOut": "2026-12-26", "guestName": ""])
    guard case .failed(let message) = blocked else { return XCTFail("\(blocked)") }
    XCTAssertEqual(message, "Those dates are taken")
    XCTAssertTrue(written.calls.isEmpty)
    // A cancelled stay and back-to-back stays do not stand in the way.
    let free = Desk(stays: [stay("2026-10-13", "2026-10-14", "cancelled"), stay("2026-10-10", "2026-10-12"), stay("2026-10-15", "2026-10-17")])
    guard case .done = try await book(free, form).0 else { return XCTFail("a free range was refused") }
  }

  @MainActor
  func testWhatCannotBeBookedIsSaidInWords() async throws {
    func said(_ desk: Desk, _ form: JSONValue) async throws -> String {
      guard case .failed(let message) = try await book(desk, form).0 else { return "booked" }
      return message
    }
    let oneNight: JSONValue = ["resourceId": "r1", "checkIn": "2026-10-12", "checkOut": "2026-10-13"]
    let none: JSONValue = ["resourceId": "r1", "checkIn": "2026-10-12", "checkOut": "2026-10-12"]
    let noDate: JSONValue = ["resourceId": "r1", "checkIn": "2026-10-12", "checkOut": ""]
    let offline = Desk()
    offline.failQuery = true
    let saidMinimum = try await said(Desk(), oneNight)
    let saidNone = try await said(Desk(), none)
    let saidNoDate = try await said(Desk(), noDate)
    let saidGone = try await said(Desk(useDefaultResource: false), form)
    let saidOffline = try await said(offline, form)
    XCTAssertEqual(saidMinimum, "Minimum stay is 2 nights")
    XCTAssertEqual(saidNone, "Choose at least one night")
    XCTAssertEqual(saidNoDate, "Choose a resource and both dates.")
    XCTAssertEqual(saidGone, "That resource is gone.")
    XCTAssertEqual(saidOffline, "Could not check those dates. Try again.")
  }

  @MainActor
  func testAGuestWithNoNameIsBookedWithoutOne() async throws {
    let (_, written) = try await book(Desk(), ["resourceId": "r1", "checkIn": "2026-10-12", "checkOut": "2026-10-14", "guestName": ""])
    XCTAssertTrue(written.calls.first?.data["guestName"] is NSNull)
  }
}
