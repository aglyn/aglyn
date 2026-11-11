// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// The in-app Besigner's focus mode and its back gesture (AGL-4056).
final class BesignerFocusTests: XCTestCase {
  private let shown = BesignerFocus.Columns(railHidden: false, sidebarHidden: false)

  func testOpeningTheEditorFoldsTheRailAndTheSidebar() {
    var focus = BesignerFocus()
    XCTAssertFalse(focus.active)
    XCTAssertEqual(focus.enter(shown), .focused)
    XCTAssertTrue(focus.active)
  }

  func testLeavingRestoresTheColumnsAsTheyWere() {
    var focus = BesignerFocus()
    let before = BesignerFocus.Columns(railHidden: true, sidebarHidden: false)
    _ = focus.enter(before)
    XCTAssertEqual(focus.leave(), before)
    XCTAssertFalse(focus.active)
    // Leaving twice, or without entering, changes nothing.
    XCTAssertNil(focus.leave())
  }

  func testOpeningAgainKeepsTheFirstMemory() {
    var focus = BesignerFocus()
    _ = focus.enter(shown)
    _ = focus.enter(.focused)
    XCTAssertEqual(focus.leave(), shown)
  }

  func testTheToggleBringsBothBackAndFoldsBothAgain() {
    var focus = BesignerFocus()
    _ = focus.enter(shown)
    // The title bar's switcher toggle shows the rail: the sidebar follows it.
    XCTAssertEqual(focus.toggled(.init(railHidden: false, sidebarHidden: true)), shown)
    XCTAssertEqual(focus.toggled(.init(railHidden: true, sidebarHidden: false)), .focused)
    // Leaving still restores what was there before the editor opened, whatever was toggled meanwhile.
    XCTAssertEqual(focus.leave(), shown)
  }

  func testOutsideTheEditorTheToggleIsUntouched() {
    let asked = BesignerFocus.Columns(railHidden: false, sidebarHidden: true)
    XCTAssertEqual(BesignerFocus().toggled(asked), asked)
  }

  func testABackSwipeCompletesPastAThirdOrOnAFlick() {
    XCTAssertTrue(BackGesture.completes(travel: 140, speed: 0, width: 390))
    XCTAssertTrue(BackGesture.completes(travel: 40, speed: 900, width: 390))
    XCTAssertFalse(BackGesture.completes(travel: 60, speed: 100, width: 390))
    // A swipe pulled back toward the edge, or one that went the other way, does not.
    XCTAssertFalse(BackGesture.completes(travel: 150, speed: -300, width: 390))
    XCTAssertFalse(BackGesture.completes(travel: -200, speed: 900, width: 390))
  }
}
