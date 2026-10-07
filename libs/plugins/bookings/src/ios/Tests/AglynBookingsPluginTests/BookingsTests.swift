// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynBookingsPlugin

final class BookingsTests: XCTestCase {
  private let now = 1_800_000_000_000

  private func row(_ data: [String: Any]) -> BookingRow { BookingRow(FirestoreDocument(id: "b1", data: data)) }

  func testARowReadsTheConsoleFields() {
    let booking = row([
      "serviceName": "Haircut", "name": "", "email": "ada@example.test", "startsAtMs": NSNumber(value: now + 3_600_000),
      "endsAtMs": NSNumber(value: now + 7_200_000), "status": "confirmed", "paidAmountCents": NSNumber(value: 4500),
      "refundedCents": NSNumber(value: 500), "timezone": "America/Chicago",
    ])
    XCTAssertEqual(booking.name, "ada@example.test")
    XCTAssertEqual(booking.paidAmountCents, 4500)
    XCTAssertEqual(booking.actions(now).refundCents, 4000)
    XCTAssertTrue(booking.actions(now).checkIn)
    XCTAssertEqual(bookingChip(booking, now: now).0, "Confirmed")
  }

  func testChipsNameTheState() {
    XCTAssertEqual(bookingChip(row(["status": "canceled"]), now: now).0, "Canceled")
    XCTAssertEqual(bookingChip(row(["status": "pendingPayment", "expiresAtMs": NSNumber(value: now - 1)]), now: now).0, "Payment not finished")
    XCTAssertEqual(bookingChip(row(["status": "confirmed", "checkedInAtMs": NSNumber(value: now)]), now: now).0, "Checked in")
  }

  func testQueriesUseTheConsoleIndexes() {
    let range = BookingQueries.range("h1", from: 10, to: 20, serviceID: "s1")
    XCTAssertEqual(range.path, "hosts/h1/bookings")
    XCTAssertEqual(range.allFilters.map(\.path), ["serviceId", "startsAtMs", "startsAtMs"])
    XCTAssertEqual(range.order.map(\.field), ["startsAtMs"])
    let booker = BookingQueries.booker("h1", email: " Ada@Example.test ", limit: 25)
    XCTAssertEqual(booker.allFilters.first?.value as? String, "ada@example.test")
    XCTAssertEqual(booker.limit, 26)
    XCTAssertTrue(booker.order.first?.descending == true)
  }

  func testCalendarRangesStepByTheirPeriod() {
    let anchor = Date(timeIntervalSince1970: 1_800_000_000)
    let (dayStart, dayEnd) = calendarRange(.day, anchor: anchor)
    XCTAssertEqual(AglynBookingsPluginTestsSupport.days(dayStart, dayEnd), 1)
    let (weekStart, weekEnd) = calendarRange(.week, anchor: anchor)
    XCTAssertEqual(AglynBookingsPluginTestsSupport.days(weekStart, weekEnd), 7)
    XCTAssertEqual(Calendar.current.component(.weekday, from: weekStart), 1)
    let (monthStart, _) = calendarRange(.month, anchor: anchor)
    XCTAssertEqual(Calendar.current.component(.day, from: monthStart), 1)
    XCTAssertEqual(Calendar.current.dateComponents([.day], from: stepAnchor(.week, anchor, -1), to: anchor).day, 7)
  }

  func testServicesHideDeletedAndSortByName() {
    let docs = [
      FirestoreDocument(id: "b", data: ["name": "beta", "durationMinutes": NSNumber(value: 45)]),
      FirestoreDocument(id: "a", data: ["name": "Alpha", "status": "draft", "priceUsd": NSNumber(value: 30)]),
      FirestoreDocument(id: "c", data: ["name": "Gone", "deletedAt": Date()]),
    ]
    let rows = visibleServices(docs)
    XCTAssertEqual(rows.map(\.id), ["a", "b"])
    XCTAssertTrue(rows[0].draft)
    XCTAssertEqual(rows[0].priceText, "$30")
    XCTAssertEqual(rows[1].durationMinutes, 45)
  }
}

enum AglynBookingsPluginTestsSupport {
  static func days(_ from: Date, _ to: Date) -> Int { Calendar.current.dateComponents([.day], from: from, to: to).day ?? 0 }
}
