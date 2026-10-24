// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import CoreGraphics
import ImageIO
import XCTest

@testable import AglynUI

/// A brand picture's art is drawn whole inside its badge, never cut by the badge's shape; the twin of Kotlin's
/// BrandArtTest.
final class BrandArtTests: XCTestCase {
  /// A `side`-pixel picture whose ink is the square from `from` up to `to` (exclusive), on a clear ground.
  private func square(_ side: Int, _ from: Int, _ to: Int) -> AglynBrandArt {
    AglynBrandArt(width: side, height: side) { x, y in (from..<to).contains(x) && (from..<to).contains(y) ? 1 : 0 }
  }

  /// A round seal whose circle touches all four edges of a `side`-pixel picture, on a clear ground.
  private func disc(_ side: Int) -> AglynBrandArt {
    let r = CGFloat(side) / 2
    return AglynBrandArt(width: side, height: side) { x, y in
      hypot(CGFloat(x) + 0.5 - r, CGFloat(y) + 0.5 - r) <= r ? 1 : 0
    }
  }

  func testArtIsMeasuredByItsInkNotItsCanvas() {
    // The kit's 2-pixel clear margin is canvas, not art: the box is the 20-pixel square, and its corners are ink.
    let art = square(24, 2, 22)
    XCTAssertEqual(art.bounds.minX, 2.0 / 24, accuracy: 1e-6)
    XCTAssertEqual(art.bounds.width, 20.0 / 24, accuracy: 1e-6)
    XCTAssertEqual(art.inkSide, 20.0 / 24, accuracy: 1e-6)
    XCTAssertTrue(art.opaqueCorners, "solid to the corners of its box: a tile, which fills")
    // Its farthest ink is the box's corner, 0.707 of its side from the center; the circle allows 0.5 − 0.06.
    XCTAssertEqual(art.scale(cornerFraction: 0.5), 0.44 / 0.70711, accuracy: 1e-3)
  }

  func testARoundedSquareOnlyCostsTheCornersTheirArc() {
    // A square mark with one clear pixel at each corner of its box, so it reads as a mark rather than a tile.
    let art = AglynBrandArt(width: 24, height: 24) { x, y in
      let corner = (x == 2 || x == 21) && (y == 2 || y == 21)
      return (2..<22).contains(x) && (2..<22).contains(y) && !corner ? 1 : 0
    }
    XCTAssertFalse(art.opaqueCorners)
    // A square badge has no corner to clear: only the margin is kept. A rounded one costs the corners their arc too.
    XCTAssertEqual(art.scale(cornerFraction: 0), 0.88, accuracy: 1e-3)
    // (Between a full corner's 0.769 and the square's 0.88: its corner pixel is clear.)
    XCTAssertEqual(art.scale(cornerFraction: 0.25), 0.806, accuracy: 1e-3)
    XCTAssertNil(art.badgeScale(cornerFraction: 0.25), "a square mark is not a badge: it keeps its room")
  }

  func testOffCenterInkIsCenteredByItsInk() {
    // A client logo with off-center ink: a 512-pixel canvas whose mark runs x 0–433 and y 43–468, read at 128.
    let art = AglynBrandArt(width: 128, height: 128) { x, y in (0..<108).contains(x) && (11..<117).contains(y) ? 1 : 0 }
    XCTAssertEqual(art.bounds.minX, 0, accuracy: 1e-6)
    XCTAssertEqual(art.bounds.maxX, 108.0 / 128, accuracy: 1e-6)
    XCTAssertEqual(art.bounds.minY, 11.0 / 128, accuracy: 1e-6)
    // Measured from its own center, the ink reaches exactly as far left as right.
    let xs = art.ink.map(\.x)
    XCTAssertEqual(xs.max() ?? 0, 0.5, accuracy: 1e-6)
    XCTAssertEqual(xs.min() ?? 0, 0.5, accuracy: 1e-6)
    XCTAssertEqual(art.inkSide, 108.0 / 128, accuracy: 1e-6)
  }

  func testARoundBadgeIsDrawnEdgeToEdge() {
    // A round seal touching all four edges: clear corners, so not opaque, but it already fits a rounded square whole.
    let art = disc(96)
    XCTAssertFalse(art.opaqueCorners)
    XCTAssertEqual(art.badgeScale(cornerFraction: 0.25) ?? 0, 1, accuracy: 0.02)
    XCTAssertEqual(art.badgeScale(cornerFraction: 0.5) ?? 0, 1, accuracy: 0.02)
    // On the rail it takes the whole tile, with no plate under it (Figma Type=Picture).
    let tile = AglynBrandFit.tile(side: 32, cornerRadius: 8, slot: 22).layout(art)
    XCTAssertEqual(tile.kind, .whole)
    XCTAssertFalse(tile.plate)
    XCTAssertEqual(tile.inkSide, 32, accuracy: 0.7)
  }

  func testAMarkSitsOnThePlateInTheSlot() {
    // A state-outline-like mark with ink in its box's top-left corner, so it is a mark, not a badge.
    let art = AglynBrandArt(width: 64, height: 64) { x, y in
      (0..<54).contains(x) && (5..<58).contains(y) && (y < 30 || x > 10) ? 1 : 0
    }
    XCTAssertNil(art.badgeScale(cornerFraction: 0.25))
    let tile = AglynBrandFit.tile(side: 32, cornerRadius: 8, slot: 22).layout(art)
    XCTAssertEqual(tile, AglynBrandLayout(kind: .whole, inkSide: 22, plate: true))
    // A photo covers the tile: its shorter side spans it.
    let photo = AglynBrandArt(width: 40, height: 20) { _, _ in 1 }
    XCTAssertEqual(
      AglynBrandFit.tile(side: 32, cornerRadius: 8, slot: 22).layout(photo),
      AglynBrandLayout(kind: .fill, inkSide: 64, plate: false))
  }

  func testAWideMarkIsMeasuredAgainstItsLongerSide() {
    // A wordmark-shaped bar, full width, 4 of 40 pixels tall, in a 40 × 20 picture: its box is 40 × 4.
    let art = AglynBrandArt(width: 40, height: 20) { _, y in (8..<12).contains(y) ? 1 : 0 }
    XCTAssertEqual(art.aspect, 10, accuracy: 1e-6)
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
    XCTAssertNil(art.badgeScale(cornerFraction: 0.5))
  }

  /// The same measure read off decoded pixels, as the badge reads a downloaded favicon, rows counted from the top.
  func testADecodedPictureReadsLikeItsPixels() throws {
    let side = 24
    let context = try XCTUnwrap(CGContext(
      data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ))
    context.setFillColor(CGColor(red: 0.88, green: 0.25, blue: 0.98, alpha: 1))
    // Core Graphics counts up from the bottom: this is the picture's top-left quarter.
    context.fill(CGRect(x: 0, y: 12, width: 12, height: 12))
    let image = try XCTUnwrap(context.makeImage())
    let art = AglynBrandArt(image: image)
    XCTAssertEqual(art.bounds, CGRect(x: 0, y: 0, width: 0.5, height: 0.5))
    XCTAssertTrue(art.opaqueCorners)
  }

  /// A logo is decoded at the pixels it is drawn at and cut to its ink: a 952-pixel round seal drawn 32 points on a
  /// 2× screen comes out 64 pixels, never minified by the GPU (AGL-4027).
  func testAPictureIsDecodedAtItsDrawnPixelsAndCutToItsInk() throws {
    let side = 952
    let context = try XCTUnwrap(CGContext(
      data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ))
    context.setFillColor(CGColor(red: 0.5, green: 0.1, blue: 0.1, alpha: 1))
    // A seal in the left 800 pixels: off-center ink with clear canvas to its right.
    context.fillEllipse(in: CGRect(x: 0, y: 76, width: 800, height: 800))
    let png = NSMutableData()
    let destination = try XCTUnwrap(CGImageDestinationCreateWithData(png, "public.png" as CFString, 1, nil))
    CGImageDestinationAddImage(destination, try XCTUnwrap(context.makeImage()), nil)
    XCTAssertTrue(CGImageDestinationFinalize(destination))
    let source = try XCTUnwrap(CGImageSourceCreateWithData(png as CFData, nil))
    let read = try XCTUnwrap(AglynBrandImageLoader.thumbnail(source, maxPixels: AglynBrandArt.readSide))
    XCTAssertLessThanOrEqual(max(read.width, read.height), AglynBrandArt.readSide)
    let art = AglynBrandArt(image: read)
    XCTAssertNotNil(art.badgeScale(cornerFraction: 0.25))
    let request = AglynBrandRequest(
      url: try XCTUnwrap(URL(string: "https://example.test/seal.png")), fit: .tile(side: 32, cornerRadius: 8, slot: 22),
      scale: 2)
    let pixels = request.pixels(art)
    XCTAssertEqual(Double(pixels), 64, accuracy: 1)
    let image = try XCTUnwrap(AglynBrandImageLoader.decode(source, art: art, pixels: pixels))
    // Cut to the seal's box, so its longer side is the pixels it is drawn at, give or take the rounding out.
    XCTAssertEqual(Double(max(image.width, image.height)), Double(pixels), accuracy: 2)
    XCTAssertEqual(Double(image.width) / Double(image.height), 1, accuracy: 0.05)
  }

  /// A logo that fails to load is tried again (AGL-3991): a CDN route still starting answered the first request with an
  /// error, and the workspace's initials stayed in its place for good.
  func testAFailedPictureIsTriedAgainUntilItLoads() async throws {
    let context = try XCTUnwrap(CGContext(
      data: nil, width: 4, height: 4, bitsPerComponent: 8, bytesPerRow: 16,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ))
    let image = try XCTUnwrap(context.makeImage())
    let picture = AglynBrandImage(image: image, art: AglynBrandArt(image: image))
    let url = try XCTUnwrap(URL(string: "https://example.test/logo.png"))
    var tries = 0
    let loaded = await AglynBrandImageLoader.loadRetrying(url, delays: [.zero, .zero, .zero]) { _ in
      tries += 1
      return tries < 3 ? nil : picture
    }
    XCTAssertTrue(loaded === picture)
    XCTAssertEqual(tries, 3)

    tries = 0
    let never = await AglynBrandImageLoader.loadRetrying(url, delays: [.zero, .zero]) { _ in
      tries += 1
      return nil
    }
    XCTAssertNil(never)
    XCTAssertEqual(tries, 3, "the first try and one per delay")
    XCTAssertEqual(AglynBrandImageLoader.retryDelays, [.seconds(1), .seconds(3), .seconds(8)])
  }
}
