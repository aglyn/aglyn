// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// Replays the console's Customize dashboard rules (function-cases.generated.json).
final class DashboardWidgetsTests: XCTestCase {
  private func prefs(_ value: Any) -> DashboardWidgetPrefs {
    let map = value as? [String: Any] ?? [:]
    return DashboardWidgetPrefs(hidden: map["hidden"] as? [String] ?? [], order: map["order"] as? [String] ?? [])
  }

  private func plain(_ prefs: DashboardWidgetPrefs) -> [String: [String]] { ["hidden": prefs.hidden, "order": prefs.order] }

  private func expected(_ value: Any) -> [String: [String]] {
    let map = value as? [String: Any] ?? [:]
    return ["hidden": map["hidden"] as? [String] ?? [], "order": map["order"] as? [String] ?? []]
  }

  func testReadsTheWorkspacesArrangement() throws {
    for item in try functionCases("readDashboardWidgetPrefs") {
      let read = DashboardWidgets.read(item.args[0], orgID: item.args[1] as? String)
      XCTAssertEqual(plain(read), expected(item.result), "\(item.args)")
    }
  }

  func testHidesAndShows() throws {
    for item in try functionCases("isDashboardWidgetHidden") {
      XCTAssertEqual(
        DashboardWidgets.isHidden(prefs(item.args[0]), item.args[1] as? String ?? ""), item.result as? Bool,
        "\(item.args)")
    }
    for item in try functionCases("setDashboardWidgetHidden") {
      let next = DashboardWidgets.setHidden(
        prefs(item.args[0]), item.args[1] as? String ?? "", hidden: item.args[2] as? Bool ?? false)
      XCTAssertEqual(plain(next), expected(item.result), "\(item.args)")
    }
  }

  func testMovesAndOrders() throws {
    for item in try functionCases("moveDashboardWidget") {
      let next = DashboardWidgets.move(
        prefs(item.args[0]), groupIDs: item.args[1] as? [String] ?? [], item.args[2] as? String ?? "",
        delta: (item.args[3] as? NSNumber)?.intValue ?? 0)
      XCTAssertEqual(plain(next), expected(item.result), "\(item.args)")
    }
    for item in try functionCases("orderDashboardWidgets") {
      let widgets = (item.args[0] as? [[String: Any]] ?? []).compactMap { $0["widgetId"] as? String }
      let ordered = DashboardWidgets.ordered(widgets, order: item.args[1] as? [String] ?? []) { $0 }
      let want = (item.result as? [[String: Any]] ?? []).compactMap { $0["widgetId"] as? String }
      XCTAssertEqual(ordered, want, "\(item.args)")
    }
  }

  /// A native card is stored under the console's id when it is one of the console's cards.
  func testNativeCardsUseTheConsolesIDs() {
    XCTAssertEqual(DashboardWidgets.storedID("commerce.glance"), "commerce-glance")
    XCTAssertEqual(DashboardWidgets.storedID("commerce.today"), "commerce.today")
    XCTAssertEqual(DashboardWidgets.field, "dashboardWidgets")
    XCTAssertEqual(DashboardWidgets.trafficID, "core-host-analytics")
  }
}
