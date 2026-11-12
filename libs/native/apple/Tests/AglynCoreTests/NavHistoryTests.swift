// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// The title bar's Back and Forward walk whole places: the screen with the sidebar's mode and scope it was opened in.
final class NavHistoryTests: XCTestCase {
  private struct Place: Equatable {
    var screen: String
    var mode = "main"
    var site: String?
  }

  func testBackAndForwardWalkThePlacesOpened() {
    var history = NavHistory(Place(screen: "home"))
    history.record(Place(screen: "orders"))
    history.record(Place(screen: "pages"))
    XCTAssertEqual(history.back(), Place(screen: "orders"))
    XCTAssertEqual(history.forward(), Place(screen: "pages"))
    XCTAssertNil(history.forward())
    XCTAssertEqual(history.back()?.screen, "orders")
    history.record(Place(screen: "analytics"))
    XCTAssertFalse(history.canGoForward, "a new place drops what was ahead")
    XCTAssertEqual(history.places.map(\.screen), ["home", "orders", "analytics"])
  }

  /// The same screen in another mode or scope is another place, so Back out of Workspace settings, or out of the whole
  /// workspace into the site it left, returns to that mode and scope (the iPad drive of 2026-11-11 found the content
  /// came back over the settings list).
  func testTheSameScreenInAnotherModeOrScopeIsAnotherPlace() {
    var history = NavHistory(Place(screen: "home", site: "s1"))
    history.record(Place(screen: "home", site: nil))
    history.record(Place(screen: "home", mode: "workspaceSettings", site: nil))
    history.record(Place(screen: "home", mode: "workspaceSettings", site: nil))
    XCTAssertEqual(history.places.count, 3, "the place on screen again is not recorded twice")
    XCTAssertEqual(history.back(), Place(screen: "home", site: nil))
    XCTAssertEqual(history.back(), Place(screen: "home", site: "s1"))
    XCTAssertFalse(history.canGoBack)
  }

  /// The site a scope switch picks arrives after the screen it opens: it fills in that place, never adds one.
  func testReplacingTheCurrentPlaceKeepsWhereBackGoes() {
    var history = NavHistory(Place(screen: "orders", site: "s1"))
    history.record(Place(screen: "home", site: "s1"))
    history.replaceCurrent(Place(screen: "home", site: "s2"))
    XCTAssertEqual(history.places, [Place(screen: "orders", site: "s1"), Place(screen: "home", site: "s2")])
    XCTAssertEqual(history.back(), Place(screen: "orders", site: "s1"))
  }

  func testOnlyTheNewestPlacesAreKept() {
    var history = NavHistory(Place(screen: "0"), limit: 3)
    for n in 1...5 { history.record(Place(screen: "\(n)")) }
    XCTAssertEqual(history.places.map(\.screen), ["3", "4", "5"])
    XCTAssertEqual(history.current.screen, "5")
    XCTAssertEqual(history.back()?.screen, "4")
  }
}
