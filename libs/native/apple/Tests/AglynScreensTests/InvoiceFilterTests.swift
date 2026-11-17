// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// The Invoices list's filters, as the console plans them (`planInvoiceQuery`): one status, a whole invoice number, and
/// the Date as local-day bounds in Unix seconds, each left off when empty.
final class InvoiceFilterTests: XCTestCase {
  private func midnight(_ year: Int, _ month: Int, _ day: Int) -> Int64 {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .current
    return Int64(calendar.date(from: DateComponents(year: year, month: month, day: day))!.timeIntervalSince1970)
  }

  func testADayIsItsLocalMidnightAndTheNextOnesForTheEnd() {
    XCTAssertEqual(ScreenValues.formatted(.string("2026-11-01"), as: "dayseconds", in: .null), String(midnight(2026, 11, 1)))
    XCTAssertEqual(ScreenValues.formatted(.string("2026-11-30"), as: "dayseconds/end", in: .null), String(midnight(2026, 12, 1)))
    XCTAssertEqual(ScreenValues.formatted(.string(""), as: "dayseconds", in: .null), "")
    XCTAssertEqual(ScreenValues.formatted(nil, as: "dayseconds/end", in: .null), "")
  }

  @MainActor
  func testTheInvoicesLoadAsksForWhatWasPicked() throws {
    let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.billing.invoices" })
    let load = try XCTUnwrap(spec.loads.first { $0.key == "invoices" })
    let picked: JSONValue = [
      "org": ["id": "o1"], "params": ["status": "open", "number": "A-1 2", "from": "2026-11-01", "to": "2026-11-30"],
    ]
    XCTAssertEqual(
      ScreenValues.renderURL(load.url, in: picked),
      "/api/billing/invoices?orgId=o1&status=open&number=A-1%202&createdGte=\(midnight(2026, 11, 1))&createdLt=\(midnight(2026, 12, 1))")
    XCTAssertEqual(
      ScreenValues.renderURL(load.url, in: ["org": ["id": "o1"]]),
      "/api/billing/invoices?orgId=o1&status=&number=&createdGte=&createdLt=")
    XCTAssertNotNil(spec.raw["actions"].array.compactMap(ActionSpec.init).first { $0.id == "filter" })
  }
}
