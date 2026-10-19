// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynUI

/// The card grid's column count never traps: a scroll view on the Mac sizes its content with an unbounded width, which
/// crashed Marketing ("Double value cannot be converted to Int") before the grid read it as "every column fits".
final class CardGridTests: XCTestCase {
  func testAnUnboundedWidthFitsEveryColumn() {
    let grid = AglynCardGrid(minimum: 160, maxColumns: 3, spacing: 12)
    XCTAssertEqual(grid.columns(for: .infinity), 3)
    XCTAssertEqual(grid.columns(for: .nan), 3)
  }

  func testABoundedWidthFitsWhatItHolds() {
    let grid = AglynCardGrid(minimum: 160, maxColumns: 3, spacing: 12)
    XCTAssertEqual(grid.columns(for: 0), 1)
    XCTAssertEqual(grid.columns(for: -20), 1)
    XCTAssertEqual(grid.columns(for: 331), 1)
    XCTAssertEqual(grid.columns(for: 332), 2)
    XCTAssertEqual(grid.columns(for: 2000), 3)
  }
}
