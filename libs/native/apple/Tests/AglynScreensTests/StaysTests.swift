// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// Reservation pricing and availability replayed from libs/native/screens/stays-cases.json, which the console's own functions
/// produced (the Kotlin renderer replays the same file).
final class StaysTests: XCTestCase {
  private func cases() throws -> [String: Any] {
    let data = try Data(contentsOf: ScreenSpecTests.screensDir.appendingPathComponent("stays-cases.json"))
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
  }

  private func day(_ iso: Any?) throws -> Int64 { try XCTUnwrap(Stays.day(iso as? String ?? "")) }

  func testEveryQuoteIsTheConsoles() throws {
    for item in try XCTUnwrap(try cases()["quotes"] as? [[String: Any]]) {
      let label = "\(item["resource"] ?? "") \(item["checkIn"] ?? "") to \(item["checkOut"] ?? "")"
      let resource = try XCTUnwrap(Stays.resource(item["spec"] as? [String: Any]))
      let quote = Stays.quote(resource, checkIn: try day(item["checkIn"]), checkOut: try day(item["checkOut"]))
      let want = try XCTUnwrap(item["quote"] as? [String: Any])
      func whole(_ key: String) -> Int64 { Int64((want[key] as? NSNumber)?.doubleValue ?? -1) }
      XCTAssertEqual(Int64(quote.nights), whole("nights"), label)
      XCTAssertEqual(quote.subtotalCents, whole("subtotalCents"), label)
      XCTAssertEqual(quote.depositCents, whole("depositCents"), label)
      XCTAssertEqual(quote.totalCents, whole("totalCents"), label)
      XCTAssertEqual(quote.nightlyCents, (want["nightlyCents"] as? [NSNumber] ?? []).map { Int64($0.doubleValue) }, label)
      XCTAssertEqual(quote.problem, want["problem"] as? String, label)
    }
  }

  func testEveryAvailabilityIsTheConsoles() throws {
    let file = try cases()
    let now = Int64((file["nowMs"] as? NSNumber)?.doubleValue ?? 0)
    let booked = (file["stays"] as? [[String: Any]] ?? []).compactMap(Stays.booked)
    let closed = try XCTUnwrap(Stays.resource(["nightlyRateUsd": 1.0, "blocks": file["blocks"] as Any]))
    for item in try XCTUnwrap(file["availability"] as? [[String: Any]]) {
      let label = "\(item["checkIn"] ?? "") to \(item["checkOut"] ?? "")"
      let got = Stays.isRangeAvailable(closed, booked: booked, checkIn: try day(item["checkIn"]), checkOut: try day(item["checkOut"]), now: now)
      XCTAssertEqual(got, (item["available"] as? Bool) ?? false, label)
    }
  }

  func testADateReadsAsUtcMidnightAndAnythingElseIsNoDate() throws {
    XCTAssertEqual(Stays.day("1970-01-01"), 0)
    XCTAssertEqual(Stays.day("2026-10-14"), 1_791_936_000_000)
    XCTAssertEqual(try XCTUnwrap(Stays.day("2024-03-01")) - Stays.dayMs, Stays.day("2024-02-29"), "a leap day")
    XCTAssertNil(Stays.day("2026-13-01"))
    XCTAssertNil(Stays.day("soon"))
    XCTAssertNil(Stays.resource(["name": "Room"]))
  }
}
