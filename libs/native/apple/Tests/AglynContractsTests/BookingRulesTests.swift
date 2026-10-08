// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the bookings rules' cases in function-cases.generated.json.
final class BookingRulesTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    let list = ((Self.functions[name] as? [String: Any])?["cases"] as? [[String: Any]]) ?? []
    XCTAssertFalse(list.isEmpty, "no cases for \(name)")
    return list.map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  private func decode<T: Decodable>(_ type: T.Type, _ value: Any) -> T {
    try! JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]))
  }

  private func managed(_ value: Any) -> ManagedBooking { managedBooking(value as? [String: Any] ?? [:]) }
  private func int(_ value: Any) -> Int { (value as! NSNumber).intValue }
  private func string(_ value: Any) -> String? { value as? String }

  func testManageRules() {
    for c in cases("bookingState") {
      XCTAssertEqual(bookingState(managed(c.args[0]), nowMs: int(c.args[1])).rawValue, c.result as? String, "\(c.args)")
    }
    for c in cases("bookingActions") {
      XCTAssertEqual(bookingActions(managed(c.args[0]), nowMs: int(c.args[1])), decode(BookingActions.self, c.result), "\(c.args)")
    }
    for c in cases("bookingOutstandingCents") {
      XCTAssertEqual(bookingOutstandingCents(managed(c.args[0])), int(c.result), "\(c.args)")
    }
    for c in cases("checkInRefusal") {
      XCTAssertEqual(checkInRefusal(managed(c.args[0]), checkedIn: c.args[1] as! Bool, nowMs: int(c.args[2])), string(c.result), "\(c.args)")
    }
    for c in cases("rescheduleRefusal") {
      XCTAssertEqual(rescheduleRefusal(managed(c.args[0]), startsAtMs: int(c.args[1]), nowMs: int(c.args[2])), string(c.result), "\(c.args)")
    }
    for c in cases("bookingDurationMs") {
      XCTAssertEqual(bookingDurationMs(managed(c.args[0]), fallbackMinutes: (c.args[1] as! NSNumber).doubleValue), int(c.result), "\(c.args)")
    }
  }

  func testReminderBand() {
    for c in cases("isBookingReminderDue") {
      XCTAssertEqual(isBookingReminderDue(c.args[0] as! [String: Any], nowMs: int(c.args[1])), c.result as? Bool, "\(c.args)")
    }
  }

  func testPriceRules() {
    for c in cases("bookingPriceText") {
      let service = c.args[0] as? [String: Any]
      XCTAssertEqual(bookingPriceText(priceUsd: service?["priceUsd"], priceDisplay: service?["priceDisplay"]), c.result as? String, "\(c.args)")
    }
    for c in cases("bookingChargeUsd") {
      let service = c.args[0] as? [String: Any]
      XCTAssertEqual(bookingChargeUsd(priceUsd: service?["priceUsd"], priceDisplay: service?["priceDisplay"]), (c.result as! NSNumber).doubleValue, "\(c.args)")
    }
    for c in cases("bookingPriceDisplay") {
      XCTAssertEqual(bookingPriceDisplay(c.args[0]).rawValue, c.result as? String, "\(c.args)")
    }
  }

  func testInPersonRules() {
    for c in cases("bookingInPersonState") {
      XCTAssertEqual(bookingInPersonState(c.args[0] as! [String: Any], nowMs: int(c.args[1])).rawValue, c.result as? String, "\(c.args)")
    }
    for c in cases("bookingInPersonAmountProblem") {
      let number = c.args[0] as? NSNumber
      let cents = number.flatMap { $0.doubleValue == $0.doubleValue.rounded() ? $0.intValue : nil }
      XCTAssertEqual(bookingInPersonAmountProblem(cents), string(c.result), "\(c.args)")
    }
    for c in cases("bookingSuggestedCents") {
      let service = c.args[0] as? [String: Any]
      let ours = service.flatMap { bookingSuggestedCents(priceUsd: $0["priceUsd"], priceDisplay: $0["priceDisplay"]) }
      XCTAssertEqual(ours, (c.result as? NSNumber)?.intValue, "\(c.args)")
    }
  }

  func testServiceForm() {
    for c in cases("parseBookingWindows") {
      XCTAssertEqual(parseBookingWindows(c.args[0] as! String), decode([BookingWindow].self, c.result), "\(c.args)")
    }
    for c in cases("formatBookingWindows") {
      let windows = c.args[0] is NSNull ? nil : decode([BookingWindow].self, c.args[0])
      XCTAssertEqual(formatBookingWindows(windows), c.result as? String, "\(c.args)")
    }
    for c in cases("newBookingServiceDraft") {
      XCTAssertEqual(newBookingServiceDraft(timeZone: c.args[0] as! String), decode(BookingServiceDraft.self, c.result), "\(c.args)")
    }
    for c in cases("bookingServiceDraftFrom") {
      XCTAssertEqual(bookingServiceDraftFrom(c.args[0] as! [String: Any]), decode(BookingServiceDraft.self, c.result), "\(c.args)")
    }
    for c in cases("bookingServiceFields") {
      XCTAssertEqual(bookingServiceFields(decode(BookingServiceDraft.self, c.args[0])), decode(BookingServiceFields.self, c.result), "\(c.args)")
    }
    for c in cases("bookingServiceDraftProblem") {
      XCTAssertEqual(bookingServiceDraftProblem(name: (c.args[0] as! [String: Any])["name"] as! String), string(c.result), "\(c.args)")
    }
  }
}
