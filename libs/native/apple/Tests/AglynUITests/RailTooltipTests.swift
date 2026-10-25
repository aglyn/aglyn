// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynUI

/// The rail's name bubble (AGL-3996): fast to show, and gliding from tile to tile without waiting again.
@MainActor
final class RailTooltipTests: XCTestCase {
  func testTheFirstTileWaitsBrieflyAndTheNextGlides() {
    XCTAssertEqual(AglynRailTooltipTiming.wait(showing: nil), .milliseconds(150))
    XCTAssertEqual(AglynRailTooltipTiming.wait(showing: "org-1"), .zero)
  }

  func testAPointerRestingOnATileShowsItsNameThenMovingGlidesAndLeavingHides() async throws {
    let state = AglynRailTooltipState()
    state.hover("org-1", inside: true)
    XCTAssertNil(state.shown)
    try await Task.sleep(for: .milliseconds(260))
    XCTAssertEqual(state.shown, "org-1")
    // Onto the next tile: the bubble moves at once.
    state.hover("org-1", inside: false)
    state.hover("org-2", inside: true)
    XCTAssertEqual(state.shown, "org-2")
    // Off the rail: gone after the glide window.
    state.hover("org-2", inside: false)
    try await Task.sleep(for: .milliseconds(260))
    XCTAssertNil(state.shown)
  }

  func testAQuickPassOverATileShowsNothing() async throws {
    let state = AglynRailTooltipState()
    state.hover("org-1", inside: true)
    state.hover("org-1", inside: false)
    try await Task.sleep(for: .milliseconds(260))
    XCTAssertNil(state.shown)
  }
}
