// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import XCTest

@testable import AglynScreens

/// A Save pressed while it is held is kept and runs once the server's copy is in, or is refused after the guard's wait
/// (AGL-4047, the console's `useHeldSave`, #2643). Kotlin's HeldPressTest asserts the same.
final class HeldPressTests: XCTestCase {
  func testAPressWithNothingHeldRunsAtOnce() {
    var held = AglynHeldPress()
    XCTAssertTrue(held.pressed(checking: false))
    XCTAssertFalse(held.waiting)
  }

  func testAPressDuringTheHoldIsKeptAndRunsWhenItLifts() {
    var held = AglynHeldPress()
    XCTAssertFalse(held.pressed(checking: true), "kept, not run on the cache's copy")
    XCTAssertTrue(held.waiting)
    XCTAssertFalse(held.pressed(checking: true), "a second press is the same press")
    XCTAssertEqual(held.press, 1)
    XCTAssertFalse(held.lifted(checking: true), "still held")
    XCTAssertTrue(held.lifted(checking: false), "the server's copy is in: run it")
    XCTAssertFalse(held.waiting)
    XCTAssertFalse(held.lifted(checking: false), "it runs once")
  }

  func testAKeptPressWithNoConfirmationIsRefusedAndSavesNothing() {
    var held = AglynHeldPress()
    _ = held.pressed(checking: true)
    held.timedOut(seedUnconfirmedText("store settings"))
    XCTAssertFalse(held.waiting)
    XCTAssertEqual(
      held.refusal,
      "We could not confirm your store settings with the server yet, so nothing was saved. What you entered is still here. "
        + "Check your connection and save again in a moment.")
    XCTAssertFalse(held.lifted(checking: false), "a refused press never runs later")
    XCTAssertTrue(held.pressed(checking: false), "the next press runs")
    XCTAssertNil(held.refusal, "and clears the refusal")
  }

  func testALiftBeforeTheWaitEndsMeansNoRefusal() {
    var held = AglynHeldPress()
    _ = held.pressed(checking: true)
    _ = held.lifted(checking: false)
    held.timedOut("late")
    XCTAssertNil(held.refusal)
  }

  func testAFormsRefusalNamesItsSubject() {
    XCTAssertEqual(FormEdits.unconfirmedText("profile"), seedUnconfirmedText("profile"))
    XCTAssertEqual(FormEdits.unconfirmedText(nil), seedUnconfirmedText("settings"))
  }
}
