// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import XCTest

@testable import AglynScreens

/// The switchboard rows carry the lists the console's switchboards write.
final class SwitchboardRowsTests: XCTestCase {
  private func row(_ value: JSONValue, _ id: String) -> JSONValue? {
    value["rows"].array.first { $0["id"]?.stringValue == id }
  }

  private func strings(_ value: JSONValue?) -> [String] { value.array.compactMap(\.stringValue) }

  func testWorkspaceRowsSendTheWholeListWithTheCascadeOff() throws {
    let org: JSONValue = ["enabledPlugins": ["commerce", "accounts", "crm"]]
    let rows = SwitchboardRows.org(org)
    let commerce = try XCTUnwrap(row(rows, "commerce"))
    XCTAssertEqual(commerce["on"], .bool(true))
    XCTAssertEqual(commerce["cascade"]?.stringValue, PluginCatalog.label("accounts"))
    let off = strings(commerce["disable"])
    XCTAssertFalse(off.contains("commerce"))
    XCTAssertFalse(off.contains("accounts"))
    XCTAssertTrue(off.contains("crm"))
    let bookings = try XCTUnwrap(row(rows, "bookings"))
    XCTAssertEqual(bookings["on"], .bool(false))
    XCTAssertTrue(strings(bookings["enable"]).contains("bookings"))
    XCTAssertEqual(try XCTUnwrap(row(rows, "mui"))["locked"], .bool(true))
    // A workspace that never stored a list runs every plugin.
    XCTAssertEqual(row(SwitchboardRows.org(.null), "bookings")?["on"], .bool(true))
  }

  func testSiteRowsWriteConsentOrRefusal() throws {
    let org: JSONValue = ["enabledPlugins": ["commerce", "accounts", "crm"]]
    let host: JSONValue = ["disabledPlugins": ["crm"]]
    let rows = SwitchboardRows.site(org, host)
    let crm = try XCTUnwrap(row(rows, "crm"))
    XCTAssertEqual(crm["state"]?.stringValue, "off-for-site")
    XCTAssertEqual(strings(crm["turnOn"]?["disabledPlugins"]), [])
    let accounts = try XCTUnwrap(row(rows, "accounts"))
    XCTAssertEqual(accounts["state"]?.stringValue, "awaiting-opt-in")
    XCTAssertEqual(strings(accounts["turnOn"]?["enabledPlugins"]), ["accounts"])
    let bookings = try XCTUnwrap(row(rows, "bookings"))
    XCTAssertEqual(bookings["state"]?.stringValue, "off-for-workspace")
    XCTAssertEqual(bookings["workspaceOn"], .bool(false))
    let commerce = try XCTUnwrap(row(rows, "commerce"))
    XCTAssertEqual(commerce["on"], .bool(true))
    XCTAssertEqual(strings(commerce["turnOff"]?["disabledPlugins"]), ["crm", "commerce"])
  }
}
