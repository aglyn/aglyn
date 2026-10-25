// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// The front desk's walk-in: priced and checked against the resource's live stays and blocks for the instant answer, then booked
/// through the console's walk-in route, which asks again inside its transaction. The Kotlin renderer's `CommerceWalkInTest`
/// holds the same cases.
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

  private static let route = "/api/commerce/reservations/walk-in"

  /// A desk's screen: one model, so a second press of the same walk-in is a retry of it.
  @MainActor
  private final class Booking {
    let desk: Desk
    let transport: RecordingTransport
    let written = Written()
    let model: ScreenModel
    let action: ActionSpec

    init(_ desk: Desk, responses: [(Int, String)] = [(200, #"{"reservationId":"x"}"#)]) throws {
      self.desk = desk
      transport = RecordingTransport(responses: responses)
      let spec = try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"]))
      model = ScreenModel(
        spec: spec, context: ["site": ["id": "h1"]],
        api: ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport), reader: desk, writer: written)
      action = try XCTUnwrap(
        ActionSpec([
          "label": "Walk-in", "success": "Walk-in reserved",
          "write": [
            "stay": [
              "resource": "{form.resourceId}", "checkIn": "{form.checkIn}", "checkOut": "{form.checkOut}", "guestName": "{form.guestName}",
              "route": .string(StaysBookingTests.route),
            ]
          ],
        ]))
    }

    func book(_ form: JSONValue) async -> ActionOutcome {
      await model.run(action, in: ScreenContext.with(model.context, "form", form))
    }

    var bodies: [JSONValue] { transport.requests.compactMap { JSONValue.decode($0.httpBody ?? Data()) } }
  }

  private let form: JSONValue = ["resourceId": "r1", "checkIn": "2026-10-12", "checkOut": "2026-10-15", "guestName": "Ada"]

  @MainActor
  func testAFreeStayIsBookedThroughTheWalkInRoute() async throws {
    let booking = try Booking(Desk())
    let outcome = await booking.book(form)
    guard case .done(let message, _) = outcome else { return XCTFail("\(outcome)") }
    XCTAssertEqual(message, "Walk-in reserved")
    XCTAssertTrue(booking.written.calls.isEmpty, "the route writes the stay, not the device")
    let request = try XCTUnwrap(booking.transport.requests.first)
    XCTAssertEqual(request.url?.path, Self.route)
    XCTAssertEqual(request.httpMethod, "POST")
    let body = try XCTUnwrap(booking.bodies.first)
    XCTAssertEqual(body["hostId"], "h1")
    XCTAssertEqual(body["resourceId"], "r1")
    XCTAssertEqual(body["guestName"], "Ada")
    XCTAssertEqual(body["checkInDayMs"]?.numberValue, Double(Stays.day("2026-10-12")!))
    XCTAssertEqual(body["checkOutDayMs"]?.numberValue, Double(Stays.day("2026-10-15")!))
    let id = try XCTUnwrap(body["reservationId"]?.stringValue)
    XCTAssertNotNil(id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression), id)
    // The check asks for this resource's stays that end after the walk-in arrives, the booking door's own query.
    let query = try XCTUnwrap(booking.desk.queries.first)
    XCTAssertEqual(query.collection, ["hosts", "h1", "reservations"])
    XCTAssertEqual(query.equals.map(\.field), ["resourceId"])
    XCTAssertEqual(query.filters.map(\.path), ["checkOutDayMs"])
  }

  @MainActor
  func testARetryResendsItsReservationIdAndTheNextWalkInMintsItsOwn() async throws {
    let booking = try Booking(
      Desk(), responses: [(500, #"{"error":"Walk-in failed"}"#), (200, #"{"reservationId":"x","replayed":true}"#), (200, "{}")])
    guard case .failed(let message) = await booking.book(form) else { return XCTFail("a 500 was booked") }
    XCTAssertEqual(message, "Walk-in failed")
    guard case .done = await booking.book(form) else { return XCTFail("the retry failed") }
    guard case .done = await booking.book(form) else { return XCTFail("the next walk-in failed") }
    let ids = booking.bodies.map { $0["reservationId"]?.stringValue ?? "" }
    XCTAssertEqual(ids.count, 3)
    XCTAssertEqual(ids[0], ids[1], "a retry of the same walk-in finds its own stay")
    XCTAssertNotEqual(ids[1], ids[2], "a booked walk-in lets go of its id")
    // A changed walk-in is a new attempt.
    let other = try Booking(Desk(), responses: [(500, "{}"), (200, "{}")])
    _ = await other.book(form)
    _ = await other.book(["resourceId": "r1", "checkIn": "2026-10-12", "checkOut": "2026-10-16", "guestName": "Ada"])
    XCTAssertNotEqual(other.bodies[0]["reservationId"], other.bodies[1]["reservationId"])
  }

  @MainActor
  func testTheRoutesRefusalIsWhatThePersonIsTold() async throws {
    for (status, error) in [(409, "Every unit is taken on at least one of those nights"), (403, "Editing requires the editor role")] {
      let booking = try Booking(Desk(), responses: [(status, #"{"error":"\#(error)"}"#)])
      guard case .failed(let message) = await booking.book(form) else { return XCTFail("\(status) was booked") }
      XCTAssertEqual(message, error)
    }
  }

  @MainActor
  func testDatesThatClashWithALiveStayOrABlockAreTakenAndNeverReachTheRoute() async throws {
    for taken in [stay("2026-10-13", "2026-10-14"), stay("2026-10-10", "2026-10-13", "checked_in")] {
      let booking = try Booking(Desk(stays: [taken]))
      guard case .failed(let message) = await booking.book(form) else { return XCTFail("a taken range was booked") }
      XCTAssertEqual(message, "Those dates are taken")
      XCTAssertTrue(booking.transport.requests.isEmpty)
    }
    let blocked = try Booking(Desk())
    guard case .failed(let message) = await blocked.book(["resourceId": "r1", "checkIn": "2026-12-23", "checkOut": "2026-12-26", "guestName": ""]) else {
      return XCTFail("a blocked range was booked")
    }
    XCTAssertEqual(message, "Those dates are taken")
    XCTAssertTrue(blocked.transport.requests.isEmpty)
    // A cancelled stay and back-to-back stays do not stand in the way.
    let free = try Booking(Desk(stays: [stay("2026-10-13", "2026-10-14", "cancelled"), stay("2026-10-10", "2026-10-12"), stay("2026-10-15", "2026-10-17")]))
    guard case .done = await free.book(form) else { return XCTFail("a free range was refused") }
  }

  @MainActor
  func testASeveralUnitResourceTakesWalkInsUntilEveryUnitOfSomeNightIsTaken() async throws {
    let hookups: [String: Any] = ["nightlyRateUsd": 60, "units": 2]
    // One of two hookups taken on the 13th: there is still one for every night.
    let open = try Booking(Desk(resource: hookups, stays: [stay("2026-10-13", "2026-10-14")]))
    guard case .done = await open.book(form) else { return XCTFail("a free unit was refused") }
    XCTAssertEqual(open.transport.requests.count, 1)
    // Both taken on the 13th (a cancelled stay does not count): refused in the console's words, nothing sent.
    let full = try Booking(
      Desk(resource: hookups, stays: [stay("2026-10-13", "2026-10-14"), stay("2026-10-12", "2026-10-14", "checked_in"), stay("2026-10-12", "2026-10-15", "cancelled")]))
    guard case .failed(let message) = await full.book(form) else { return XCTFail("a full night was booked") }
    XCTAssertEqual(message, "Every unit is taken on at least one of those nights")
    XCTAssertTrue(full.transport.requests.isEmpty)
    // A block still closes every unit.
    let blocked = try Booking(
      Desk(resource: hookups.merging(["blocks": [["fromDayMs": Double(Stays.day("2026-10-14")!), "toDayMs": Double(Stays.day("2026-10-15")!)]]]) { $1 }))
    guard case .failed = await blocked.book(form) else { return XCTFail("a blocked night was booked") }
  }

  @MainActor
  func testWhatCannotBeBookedIsSaidInWords() async throws {
    func said(_ desk: Desk, _ form: JSONValue) async throws -> String {
      guard case .failed(let message) = await (try Booking(desk)).book(form) else { return "booked" }
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
    let booking = try Booking(Desk())
    _ = await booking.book(["resourceId": "r1", "checkIn": "2026-10-12", "checkOut": "2026-10-14", "guestName": ""])
    XCTAssertNil(booking.bodies.first?["guestName"])
    XCTAssertEqual(booking.bodies.count, 1)
  }
}
