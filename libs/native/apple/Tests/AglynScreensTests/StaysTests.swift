// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
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

  func testEveryUnitsValueReadsAsTheConsolesDoes() throws {
    let items = try XCTUnwrap(try cases()["units"] as? [[String: Any]])
    XCTAssertGreaterThan(items.count, 10)
    for item in items {
      let want = (item["units"] as? NSNumber)?.intValue
      // A case without `raw` is a resource that never stored `units`.
      let got = item.keys.contains("raw") ? Stays.units(item["raw"]) : Stays.units(nil)
      XCTAssertEqual(got, want, "\(item["raw"] ?? "absent")")
      XCTAssertEqual(Stays.resource(["nightlyRateUsd": 1.0, "units": item["raw"] ?? NSNull()])?.units, item.keys.contains("raw") ? want : 1)
    }
  }

  func testEverySeveralUnitNightIsCountedAsTheConsoleCountsIt() throws {
    let file = try cases()
    let now = Int64((file["nowMs"] as? NSNumber)?.doubleValue ?? 0)
    let scenarios = try XCTUnwrap(file["multiUnit"] as? [[String: Any]])
    XCTAssertTrue(scenarios.contains { ($0["units"] as? NSNumber)?.intValue ?? 0 > 1 })
    for scenario in scenarios {
      let name = scenario["name"] as? String ?? ""
      var stored: [String: Any] = ["nightlyRateUsd": 1.0, "blocks": scenario["blocks"] as Any]
      if let units = scenario["units"] { stored["units"] = units }
      let resource = try XCTUnwrap(Stays.resource(stored))
      let booked = (scenario["stays"] as? [[String: Any]] ?? []).compactMap(Stays.booked)
      for item in try XCTUnwrap(scenario["availability"] as? [[String: Any]]) {
        let label = "\(name): \(item["checkIn"] ?? "") to \(item["checkOut"] ?? "")"
        let got = Stays.isRangeAvailable(resource, booked: booked, checkIn: try day(item["checkIn"]), checkOut: try day(item["checkOut"]), now: now)
        XCTAssertEqual(got, (item["available"] as? Bool) ?? false, label)
      }
      let want = try XCTUnwrap(scenario["nights"] as? [[String: Any]])
      let nights = Stays.unitsLeftByNight(resource, booked: booked, from: try day(scenario["nightsFrom"]), nights: want.count, now: now)
      XCTAssertEqual(nights.count, want.count, name)
      for (night, expected) in zip(nights, want) {
        XCTAssertEqual(night.dayMs, try day(expected["day"]), name)
        XCTAssertEqual(night.unitsLeft, (expected["unitsLeft"] as? NSNumber)?.intValue, "\(name) \(expected["day"] ?? "")")
        XCTAssertEqual(night.units, (expected["units"] as? NSNumber)?.intValue, name)
      }
    }
  }

  func testTheUnitBoundsAndHoldWindowAreTheContractsAndTheEditorAsksTheSame() throws {
    XCTAssertEqual(Stays.maxUnits, ContractValues.shared.maxResourceUnits)
    XCTAssertEqual(Stays.maxUnits, 500)
    XCTAssertEqual(Stays.pendingHoldMs, 30 * 60 * 1000)
    // The resource editor's units field takes the same bounds and says them in the console's words.
    let data = try Data(
      contentsOf: ScreenSpecTests.screensDir.appendingPathComponent(
        "../../plugins/commerce/src/ios/Sources/AglynCommercePlugin/Resources/commerce-queues.screens.json"))
    let file = try XCTUnwrap(JSONValue.decode(data))
    let screen = try XCTUnwrap(file["screens"].array.first { $0["id"]?.stringValue == "commerce.reservations" })
    let resources = try XCTUnwrap(screen["blocks"].array.first { $0["id"]?.stringValue == "resources" })
    let edit = try XCTUnwrap(resources["actions"].array.first { $0["id"]?.stringValue == "edit" })
    let units = try XCTUnwrap(edit["prompt"].array.compactMap(FieldSpec.init).first { $0.key == "units" })
    XCTAssertEqual(units.label, "Spots or units available")
    XCTAssertEqual(units.max, Double(Stays.maxUnits))
    XCTAssertEqual(units.min, 1)
    XCTAssertEqual(units.mismatch, "A whole number from 1 to \(Stays.maxUnits)")
    XCTAssertEqual(units.help, "How many identical ones you have, like 12 RV hookups")
    XCTAssertTrue(units.refuses("501", in: [:]))
    XCTAssertTrue(units.refuses("0", in: [:]))
    XCTAssertTrue(units.refuses("twelve", in: [:]))
    XCTAssertTrue(units.unmet("twelve", in: [:]))
    XCTAssertFalse(units.refuses("12", in: [:]))
    XCTAssertFalse(units.unmet("", in: [:]))
  }

  func testTheLookAheadCountsEachSeveralUnitResourcesNextNights() throws {
    let today = try XCTUnwrap(Stays.day("2026-10-26"))
    let resources: JSONValue = [
      "items": [
        ["$id": "rv", "name": "RV hookups", "units": 12, "blocks": [["fromDayMs": .number(Double(today + 3 * Stays.dayMs)), "toDayMs": .number(Double(today + 4 * Stays.dayMs))]]],
        ["$id": "cabin", "name": "Cabin"],
      ]
    ]
    func stay(_ resource: String, _ from: Int64, _ to: Int64, _ status: String = "confirmed") -> JSONValue {
      ["resourceId": .string(resource), "checkInDayMs": .number(Double(today + from * Stays.dayMs)), "checkOutDayMs": .number(Double(today + to * Stays.dayMs)), "status": .string(status)]
    }
    let stays: JSONValue = ["items": .array(Array(repeating: stay("rv", 0, 1), count: 12) + Array(repeating: stay("rv", 1, 2), count: 10) + [stay("rv", 1, 2, "cancelled"), stay("cabin", 0, 3)])]
    let ahead = Stays.unitsAhead(resources: resources, stays: stays, today: today, now: today)
    XCTAssertNil(ahead["cabin"], "a one-unit resource has no look-ahead")
    let nights = ahead["rv"].array
    XCTAssertEqual(nights.count, Stays.lookaheadNights)
    XCTAssertEqual(nights.first?["label"], "Mon, Oct 26")
    XCTAssertEqual(nights.map { ScreenValues.text($0["unitsLeft"]) }.prefix(5), ["0", "2", "12", "0", "12"])
    XCTAssertEqual(nights.map { $0["tone"]?.stringValue ?? "" }.prefix(4), ["error", "warning", "neutral", "error"])
    XCTAssertEqual(Stays.nightLabel(try XCTUnwrap(Stays.day("2027-01-01"))), "Fri, Jan 1")
  }

  func testTodayIsTheDevicesCalendarDayAsUtcMidnight() throws {
    // 03:30 UTC on Oct 26 is still the evening of Oct 25 in Chicago.
    let late = Date(timeIntervalSince1970: Double(try XCTUnwrap(Stays.day("2026-10-26"))) / 1000 + 3.5 * 3600)
    XCTAssertEqual(Stays.localToday(late, in: try XCTUnwrap(TimeZone(identifier: "America/Chicago"))), Stays.day("2026-10-25"))
    XCTAssertEqual(Stays.localToday(late, in: try XCTUnwrap(TimeZone(identifier: "UTC"))), Stays.day("2026-10-26"))
  }

  func testATakenWalkInIsSaidInTheConsolesWords() {
    XCTAssertEqual(Stays.takenMessage(StayResource(nightlyRateUsd: 1)), "Those dates are taken")
    XCTAssertEqual(Stays.takenMessage(StayResource(nightlyRateUsd: 1, units: 12)), "Every unit is taken on at least one of those nights")
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
