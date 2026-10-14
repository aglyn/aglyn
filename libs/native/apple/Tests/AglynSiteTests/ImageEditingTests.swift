// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import XCTest

@testable import AglynContracts
@testable import AglynSite

final class ImageEditingTests: XCTestCase {
  private typealias Pixel = (UInt8, UInt8, UInt8)
  private let red: Pixel = (255, 0, 0)
  private let green: Pixel = (0, 255, 0)
  private let blue: Pixel = (0, 0, 255)
  private let yellow: Pixel = (255, 255, 0)
  private let white: Pixel = (255, 255, 255)

  /// A picture from rows of pixels, top row first, as PNG bytes.
  private func png(_ rows: [[Pixel]]) -> Data {
    let height = rows.count
    let width = rows[0].count
    var bytes: [UInt8] = []
    for row in rows { for pixel in row { bytes += [pixel.0, pixel.1, pixel.2, 255] } }
    let provider = CGDataProvider(data: Data(bytes) as CFData)!
    let image = CGImage(
      width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
      provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
    let output = NSMutableData()
    let destination = CGImageDestinationCreateWithData(output, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, nil)
    CGImageDestinationFinalize(destination)
    return output as Data
  }

  /// The pixels of a picture's bytes, top row first.
  private func pixels(_ data: Data) -> [[Pixel]] {
    let source = CGImageSourceCreateWithData(data as CFData, nil)!
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
    var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
    let context = CGContext(
      data: &bytes, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4,
      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    return (0..<image.height).map { y in (0..<image.width).map { x in let at = (y * image.width + x) * 4; return (bytes[at], bytes[at + 1], bytes[at + 2]) } }
  }

  private func same(_ a: [[Pixel]], _ b: [[Pixel]], tolerance: Int = 0, _ message: String = "", line: UInt = #line) {
    XCTAssertEqual(a.count, b.count, message, line: line)
    for (rowA, rowB) in zip(a, b) {
      XCTAssertEqual(rowA.count, rowB.count, message, line: line)
      for (p, q) in zip(rowA, rowB) {
        XCTAssertTrue(
          abs(Int(p.0) - Int(q.0)) <= tolerance && abs(Int(p.1) - Int(q.1)) <= tolerance && abs(Int(p.2) - Int(q.2)) <= tolerance,
          "\(message) \(p) vs \(q)", line: line)
      }
    }
  }

  private func plan(
    rotation: Int = 0, flipH: Bool = false, flipV: Bool = false, crop: (Int, Int, Int, Int), size: (Int, Int), png: Bool = true
  ) -> ImageEditPlan {
    ImageEditPlan(
      rotation: rotation, flipH: flipH, flipV: flipV, cropX: crop.0, cropY: crop.1, cropW: crop.2, cropH: crop.3, width: size.0, height: size.1, png: png)
  }

  /// A 4 x 2 picture whose corners are red (top left), green (top right), blue (bottom left) and yellow (bottom right).
  private var corners: ImageEditSession {
    ImageEditSession.open(png([[red, white, white, green], [blue, white, white, yellow]]))!
  }

  func testAQuarterTurnPutsTheCornersWhereTheConsoleCanvasDoes() throws {
    let session = corners
    XCTAssertEqual([session.width, session.height], [4, 2])
    let data = try XCTUnwrap(session.render(plan(rotation: 90, crop: (0, 0, 2, 4), size: (2, 4))))
    // Clockwise: the bottom left becomes the top left, the top left the top right.
    same(pixels(data), [[blue, red], [white, white], [white, white], [yellow, green]])
  }

  func testFlipsMirrorBeforeTheTurn() throws {
    let session = corners
    same(pixels(try XCTUnwrap(session.render(plan(flipH: true, crop: (0, 0, 4, 2), size: (4, 2))))), [[green, white, white, red], [yellow, white, white, blue]])
    same(pixels(try XCTUnwrap(session.render(plan(flipV: true, crop: (0, 0, 4, 2), size: (4, 2))))), [[blue, white, white, yellow], [red, white, white, green]])
    // Mirrored, then turned a half: the same as the other mirror.
    same(
      pixels(try XCTUnwrap(session.render(plan(rotation: 180, flipH: true, crop: (0, 0, 4, 2), size: (4, 2))))),
      [[blue, white, white, yellow], [red, white, white, green]])
  }

  func testACropIsCutFromTheTurnedPicture() throws {
    let data = try XCTUnwrap(corners.render(plan(crop: (2, 0, 2, 2), size: (2, 2))))
    same(pixels(data), [[white, green], [white, yellow]])
  }

  func testASmallerSizeDrawsTheWholeCrop() throws {
    let rows = (0..<20).map { _ in (0..<40).map { $0 < 20 ? red : blue } }
    let session = try XCTUnwrap(ImageEditSession.open(png(rows)))
    let image = pixels(try XCTUnwrap(session.render(plan(crop: (0, 0, 40, 20), size: (8, 4)))))
    XCTAssertEqual([image[0].count, image.count], [8, 4])
    same([[image[2][1]]], [[red]], tolerance: 6)
    same([[image[2][6]]], [[blue]], tolerance: 6)
  }

  func testAJpegIsWrittenWithNoTransparency() throws {
    let data = try XCTUnwrap(corners.render(plan(crop: (0, 0, 4, 2), size: (4, 2), png: false)))
    XCTAssertEqual([UInt8](data.prefix(2)), [0xFF, 0xD8])
    XCTAssertNotNil(ImageEditSession.open(data))
  }

  func testAPhotoSavedSidewaysIsOpenedUpright() throws {
    // 16 x 8 stored, left half red and right half blue; orientation 6 means "turn 90 degrees clockwise to view".
    let rows = (0..<8).map { _ in (0..<16).map { $0 < 8 ? red : blue } }
    let image = CGImageSourceCreateWithData(png(rows) as CFData, nil).flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) }!
    let output = NSMutableData()
    let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, [kCGImagePropertyOrientation: 6] as CFDictionary)
    CGImageDestinationFinalize(destination)
    let session = try XCTUnwrap(ImageEditSession.open(output as Data))
    XCTAssertEqual([session.width, session.height], [8, 16])
    let upright = pixels(try XCTUnwrap(session.render(plan(crop: (0, 0, 8, 16), size: (8, 16)))))
    same([[upright[2][4]]], [[red]], tolerance: 40, "top is red")
    same([[upright[13][4]]], [[blue]], tolerance: 40, "bottom is blue")
  }

  func testSomethingThatIsNotAnImageOpensAsNothing() {
    XCTAssertNil(ImageEditSession.open(Data([1, 2, 3, 4])))
  }

  func testTheSettingsTurnDragAndPlanAsTheConsoleDoes() {
    var settings = ImageEditSettings()
    settings.crop = ImageEditRect(x: 10, y: 10, w: 50, h: 50)
    settings.turn(clockwise: true)
    XCTAssertEqual(settings.rotation, 90)
    XCTAssertNil(settings.crop)
    XCTAssertEqual(settings.worked(sourceWidth: 4000, sourceHeight: 3000).width, 3000)
    settings.turn(clockwise: false)
    settings.turn(clockwise: false)
    XCTAssertEqual(settings.rotation, 270)

    var fresh = ImageEditSettings()
    XCTAssertEqual(fresh.previewSize(sourceWidth: 4000, sourceHeight: 3000).width, 480)
    XCTAssertEqual(fresh.previewSize(sourceWidth: 4000, sourceHeight: 3000).height, 360)
    XCTAssertEqual(fresh.previewSize(sourceWidth: 100, sourceHeight: 80).width, 100)
    // A drag past the edge is held at it.
    fresh.drag(from: (400, 300), to: (700, 500), previewWidth: 480, previewHeight: 360)
    XCTAssertEqual(fresh.crop, ImageEditRect(x: 400, y: 300, w: 80, h: 60))
    // A ratio locks the height to the width; a new one starts the crop over.
    fresh.setAspect(16.0 / 9)
    XCTAssertNil(fresh.crop)
    fresh.drag(from: (0, 0), to: (160, 10), previewWidth: 480, previewHeight: 360)
    XCTAssertEqual(fresh.crop, ImageEditRect(x: 0, y: 0, w: 160, h: 90))

    // A 4000 x 3000 photo, a crop of 100 x 50 preview pixels at (10, 20), shrunk to 400 wide.
    var saving = ImageEditSettings()
    saving.crop = ImageEditRect(x: 10, y: 20, w: 100, h: 50)
    saving.setMaxWidth("400")
    let out = saving.savePlan(sourceWidth: 4000, sourceHeight: 3000, fileName: "photo.jpg")
    XCTAssertEqual([out.cropX, out.cropY, out.cropW, out.cropH, out.width, out.height], [83, 167, 833, 417, 400, 200])
    XCTAssertFalse(out.png)
    XCTAssertTrue(saving.savePlan(sourceWidth: 4000, sourceHeight: 3000, fileName: "Logo.PNG").png)
    var typed = ImageEditSettings()
    typed.setMaxWidth("12a0 0")
    XCTAssertEqual(typed.maxWidth, "1200")
    typed.setMaxWidth("1234567")
    XCTAssertEqual(typed.maxWidth, "12345")
    XCTAssertFalse(ImageEditSettings().changed)
    XCTAssertTrue(typed.changed)
  }
}
