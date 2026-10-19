// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import CoreGraphics
import XCTest

@testable import AglynUI

/// A brand picture's art is drawn whole inside its badge, never cut by the badge's shape; the twin of Kotlin's
/// BrandArtTest.
final class BrandArtTests: XCTestCase {
  /// A `side`-pixel picture whose ink is the square from `from` up to `to` (exclusive), on a clear ground.
  private func square(_ side: Int, _ from: Int, _ to: Int) -> AglynBrandArt {
    AglynBrandArt(width: side, height: side) { x, y in (from..<to).contains(x) && (from..<to).contains(y) ? 1 : 0 }
  }

  func testAFaviconRunningToItsCornersShrinksToClearACircle() {
    // The logo kit's mark: 20 of 24 pixels of art, a 2-pixel clear margin, ink right into its corners.
    let art = square(24, 2, 22)
    XCTAssertFalse(art.opaqueCorners)
    // Its farthest ink is 10/24 out on both axes, 0.589 from the center; the circle allows 0.5 − 0.06.
    XCTAssertEqual(art.scale(cornerFraction: 0.5), 0.44 / 0.58926, accuracy: 1e-3)
  }

  func testARoundedSquareOnlyCostsTheCornersTheirArc() {
    let art = square(24, 2, 22)
    // The corner point lands on the inset arc: |k·(10/24, 10/24) − (0.25, 0.25)| = 0.19.
    XCTAssertEqual(art.scale(cornerFraction: 0.25), 0.92245, accuracy: 1e-3)
    // A square badge has no corner to clear, and art is never enlarged past its fit.
    XCTAssertEqual(art.scale(cornerFraction: 0), 1, accuracy: 1e-6)
  }

  func testArtThatAlreadyClearsTheShapeIsLeftAsSupplied() {
    // A logo uploaded with its own room around it: 20 of 32 pixels.
    let padded = square(32, 6, 26)
    XCTAssertEqual(padded.scale(cornerFraction: 0.25), 1, accuracy: 1e-6)
    XCTAssertGreaterThan(padded.scale(cornerFraction: 0.5), 0.99)
  }

  func testAWideMarkIsMeasuredAgainstItsLongerSide() {
    // A wordmark-shaped bar, full width, 4 of 40 pixels tall, in a 40 × 20 picture.
    let art = AglynBrandArt(width: 40, height: 20) { _, y in (8..<12).contains(y) ? 1 : 0 }
    // Its ends sit 0.5 out on x and 0.05 on y; the circle allows 0.44 along that line.
    XCTAssertEqual(art.scale(cornerFraction: 0.5), 0.44 / hypot(0.5, 0.05), accuracy: 1e-3)
  }

  func testAnOpaquePictureFillsAsItAlwaysHas() {
    XCTAssertTrue(AglynBrandArt(width: 16, height: 16) { _, _ in 1 }.opaqueCorners)
    // One clear corner is enough to read it as a mark, which is then drawn whole.
    XCTAssertFalse(AglynBrandArt(width: 16, height: 16) { x, y in x == 0 && y == 0 ? 0 : 1 }.opaqueCorners)
  }

  func testAClearPictureHasNothingToFit() {
    let art = AglynBrandArt(width: 16, height: 16) { _, _ in 0 }
    XCTAssertTrue(art.ink.isEmpty)
    XCTAssertEqual(art.scale(cornerFraction: 0.5), 1, accuracy: 1e-6)
  }

  /// The same measure read off decoded pixels, as the badge reads a downloaded favicon.
  func testADecodedPictureReadsLikeItsPixels() throws {
    let side = 24
    let context = try XCTUnwrap(CGContext(
      data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ))
    context.setFillColor(CGColor(red: 0.88, green: 0.25, blue: 0.98, alpha: 1))
    context.fill(CGRect(x: 2, y: 2, width: 20, height: 20))
    let image = try XCTUnwrap(context.makeImage())
    let art = AglynBrandArt(image: image)
    XCTAssertFalse(art.opaqueCorners)
    XCTAssertEqual(art.scale(cornerFraction: 0.5), 0.44 / 0.58926, accuracy: 1e-3)
  }
}
