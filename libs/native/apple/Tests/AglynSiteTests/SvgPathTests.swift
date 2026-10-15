// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI
import XCTest

@testable import AglynUI

final class SvgPathTests: XCTestCase {
  func testAMaterialDesignIconPathIsDrawnWithinItsTwentyFourUnitSquare() throws {
    // Material Design Icons "cart": lines, relative moves, curves and arcs.
    let cart = try XCTUnwrap(
      svgPath(
        "M17,18C15.89,18 15,18.89 15,20A2,2 0 0,0 17,22A2,2 0 0,0 19,20C19,18.89 18.1,18 17,18M1,2V4H3L6.6,11.59L5.24,14.04C5.09,14.32 5,14.65 5,15A2,2 0 0,0 7,17H19V15H7.42A0.25,0.25 0 0,1 7.17,14.75C7.17,14.7 7.18,14.66 7.2,14.63L8.1,13H15.55C16.3,13 16.96,12.58 17.3,11.97L20.88,5.5C20.95,5.34 21,5.17 21,5A1,1 0 0,0 20,4H5.21L4.27,2H1Z"
      ))
    let bounds = cart.boundingRect
    XCTAssertGreaterThanOrEqual(bounds.minX, -0.01)
    XCTAssertGreaterThanOrEqual(bounds.minY, -0.01)
    XCTAssertLessThanOrEqual(bounds.maxX, 24.01)
    XCTAssertLessThanOrEqual(bounds.maxY, 24.01)
    XCTAssertGreaterThan(bounds.width, 15)
    XCTAssertGreaterThan(bounds.height, 15)
    XCTAssertFalse(cart.isEmpty)
  }

  func testLowercaseCommandsAreRelativeAndNumbersMayRunTogether() throws {
    let square = try XCTUnwrap(svgPath("M2 2h10v10H2z")).boundingRect
    XCTAssertEqual([square.minX, square.minY, square.maxX, square.maxY], [2, 2, 12, 12])
    // "1.5.5" is 1.5 and .5; "-3-4" is -3 and -4; flags run into the numbers after them.
    let packed = try XCTUnwrap(svgPath("M1.5.5l-3-4z")).boundingRect
    XCTAssertEqual([packed.minX, packed.minY, packed.maxX, packed.maxY], [-1.5, -3.5, 1.5, 0.5])
    let arc = try XCTUnwrap(svgPath("M12 2a10 10 0 1020 0")).boundingRect
    XCTAssertEqual(arc.minX, 12, accuracy: 0.001)
    XCTAssertGreaterThan(arc.height, 9)
  }

  func testAHalfCircleArcReachesItsApex() throws {
    // From (2, 12) to (22, 12) over a radius of ten, sweeping through the top.
    let half = try XCTUnwrap(svgPath("M2 12A10 10 0 0 1 22 12")).boundingRect
    XCTAssertEqual(half.minX, 2, accuracy: 0.01)
    XCTAssertEqual(half.maxX, 22, accuracy: 0.01)
    XCTAssertEqual(half.minY, 2, accuracy: 0.01)
    XCTAssertEqual(half.maxY, 12, accuracy: 0.01)
  }

  func testNothingOrBlankIsNoShapeAndNonsenseIsNotAPath() {
    XCTAssertNil(svgPath(nil))
    XCTAssertNil(svgPath("   "))
    XCTAssertNil(svgPath("not a path"))
    XCTAssertNil(svgPath("M1"))
    XCTAssertNil(svgPath("L1 1"))
  }
}
