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

  /// Switching Commerce off for a site that runs User Accounts asks the console's `PluginDisableCascadeDialog`
  /// question: it names User Accounts and what each one does to the published site (AGL-4221).
  func testSiteOffQuestionNamesTheCascadeAsTheConsoleDoes() throws {
    let org: JSONValue = ["enabledPlugins": ["commerce", "accounts", "forms", "funnels"]]
    let rows = SwitchboardRows.site(org, ["enabledPlugins": ["accounts"]])
    let commerce = try XCTUnwrap(row(rows, "commerce"))
    let name = PluginCatalog.label("commerce")
    let accounts = PluginCatalog.label("accounts")
    XCTAssertEqual(commerce["confirmOff"], .bool(true))
    XCTAssertEqual(commerce["offTitle"]?.stringValue, "Disabling \(name) also disables 1 other plugin")
    XCTAssertEqual(commerce["offLabel"]?.stringValue, "Continue and disable those too")
    XCTAssertEqual(
      commerce["offMessage"]?.stringValue,
      [
        "These plugins depend on \(name) and cannot run without it. Continuing switches them off for this site.",
        "\(name) (the one you switched off)\nElements already placed on published pages stop rendering.",
        "\(accounts) — depends on \(name)\nPages it serves stop being served on published sites.",
        "Turning \(name) back on later does NOT switch these back on — you will need to re-enable each one yourself.",
        ContractValues.shared.pluginCascadeIsDeclaredOnly,
      ].joined(separator: "\n\n"))

    // Forms asks with nothing depending on it (its `siteOff.confirm`): what stops, then what keeps running.
    let forms = try XCTUnwrap(row(rows, "forms"))
    let siteOff = try XCTUnwrap(PluginCatalog.plugin("forms")?.siteOff)
    XCTAssertEqual(forms["confirmOff"], .bool(true))
    XCTAssertEqual(forms["offTitle"]?.stringValue, "Switch \(PluginCatalog.label("forms")) off for this site?")
    XCTAssertEqual(forms["offLabel"]?.stringValue, "Switch \(PluginCatalog.label("forms")) off")
    XCTAssertEqual(forms["offMessage"]?.stringValue, "\(siteOff.stops)\n\n\(siteOff.keeps)")

    // Funnels goes off at once, so it never asks.
    XCTAssertEqual(try XCTUnwrap(row(rows, "funnels"))["confirmOff"], .bool(false))
  }

  /// An action's question carries the body and confirming button its spec names, and keeps its own label otherwise.
  func testAnActionsQuestionCarriesItsBodyAndButton() throws {
    let scope: JSONValue = ["item": ["offTitle": "T", "offMessage": "M", "offLabel": "L"]]
    let named = try XCTUnwrap(
      ActionSpec([
        "id": "off", "label": "Turn off for this site", "confirm": "{item.offTitle}", "confirmMessage": "{item.offMessage}",
        "confirmLabel": "{item.offLabel}",
      ]))
    XCTAssertEqual(named.confirmText(in: scope), "T")
    XCTAssertEqual(named.confirmMessageText(in: scope), "M")
    XCTAssertEqual(named.confirmButtonLabel(in: scope), "L")
    let plain = try XCTUnwrap(ActionSpec(["id": "off", "label": "Turn off for this site", "confirm": "Sure?"]))
    XCTAssertNil(plain.confirmMessageText(in: scope))
    XCTAssertEqual(plain.confirmButtonLabel(in: scope), "Turn off for this site")
  }
}
