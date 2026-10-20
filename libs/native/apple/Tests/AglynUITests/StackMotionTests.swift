// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynUI

@MainActor
final class StackMotionTests: XCTestCase {
  func testThePushedScreenComesInFromTheTrailingSideAndAnUncoveredOneFromTheLeading() {
    let ledger = AglynStackLedger()
    // A section's first screen: nothing moved, so it does not slide (its section cross-fades instead).
    XCTAssertEqual(ledger.move(to: 0), .none)
    XCTAssertEqual(ledger.move(to: 1), .push)
    XCTAssertEqual(ledger.move(to: 2), .push)
    XCTAssertEqual(ledger.move(to: 1), .pop)
    // Back to the root in one step (the section's row tapped again) uncovers the root from the leading side.
    XCTAssertEqual(ledger.move(to: 3), .push)
    XCTAssertEqual(ledger.move(to: 0), .pop)
    // A screen appearing again with the stack where it was (a tab or window coming back) does not move.
    XCTAssertEqual(ledger.move(to: 0), .none)
  }

  func testASectionOpenedAgainOnTheScreenItWasLeftOnDoesNotSlideIt() {
    let ledger = AglynStackLedger(depth: 2)
    XCTAssertEqual(ledger.move(to: 2), .none)
    XCTAssertEqual(ledger.move(to: 1), .pop)
  }

  func testTheDirectionIsTheSideOnTheXAxis() {
    XCTAssertEqual(AglynStackMove.push.direction, 1)
    XCTAssertEqual(AglynStackMove.pop.direction, -1)
    XCTAssertEqual(AglynStackMove.none.direction, 0)
  }

  func testThePushIsTheDrillsSpringAndItsFadeEndsFirst() {
    XCTAssertEqual(AglynShellMotion.pushDuration, 0.25, accuracy: 0.001)
    XCTAssertLessThan(AglynShellMotion.pushFade, AglynShellMotion.pushDuration)
    XCTAssertGreaterThan(AglynShellMotion.pushDistance, 0)
  }
}
