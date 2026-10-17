// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynUI

final class SelectionTests: XCTestCase {
  func testArrowKeysStepThroughTheIDs() {
    let ids = ["a", "b", "c"]
    XCTAssertEqual(AglynSelectionKeys.step(ids, from: nil, down: true), "a")
    XCTAssertEqual(AglynSelectionKeys.step(ids, from: nil, down: false), "c")
    XCTAssertEqual(AglynSelectionKeys.step(ids, from: "a", down: true), "b")
    XCTAssertEqual(AglynSelectionKeys.step(ids, from: "b", down: false), "a")
    XCTAssertNil(AglynSelectionKeys.step(ids, from: "c", down: true))
    XCTAssertNil(AglynSelectionKeys.step(ids, from: "a", down: false))
    XCTAssertNil(AglynSelectionKeys.step([String](), from: nil, down: true))
    // A selection no longer listed starts again from the near end.
    XCTAssertEqual(AglynSelectionKeys.step(ids, from: "gone", down: true), "a")
  }

  func testSelectedWinsOverHoverAndPressAndGoesNeutralWhenTheWindowIsNotKey() {
    XCTAssertEqual(AglynRowState.of(selected: true, windowActive: true, pressed: true, hovered: true), .selected)
    XCTAssertEqual(AglynRowState.of(selected: true, windowActive: false, pressed: false, hovered: false), .selectedInactive)
    XCTAssertEqual(AglynRowState.of(selected: false, windowActive: true, pressed: true, hovered: true), .pressed)
    XCTAssertEqual(AglynRowState.of(selected: false, windowActive: false, pressed: false, hovered: true), .hovered)
    XCTAssertEqual(AglynRowState.of(selected: false, windowActive: true, pressed: false, hovered: false), .idle)
  }
}
