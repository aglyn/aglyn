// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynUI

/// The Facets ground against the Figma build spec (53:1638), whose points are fractions of the frame.
final class FacetsTests: XCTestCase {
  private func percent(_ layout: AglynFacetsLayout, _ name: String, size: CGSize) -> [[Double]] {
    let plane = layout.planes.first { $0.name == name }!
    return plane.points.map {
      [Double(($0.x / size.width * 1000).rounded() / 10), Double(($0.y / size.height * 1000).rounded() / 10)]
    }
  }

  func testThePhonePlanesMatchTheSpec() {
    let size = CGSize(width: 440, height: 956)
    let layout = AglynFacetsLayout(size: size, dark: false)
    XCTAssertEqual(percent(layout, "top", size: size), [[70, 0], [100, 0], [100, 20.1]])
    XCTAssertEqual(percent(layout, "band", size: size), [[-5, 88], [125, 46.9], [125, 60.9], [-5, 102]])
    XCTAssertEqual(percent(layout, "corner", size: size), [[40, 100], [100, 81], [100, 100]])
    XCTAssertEqual(percent(layout, "accent", size: size), [[56, 100], [100, 86.1], [100, 89.3], [66.2, 100]])
    XCTAssertEqual(layout.planes.map(\.opacity), [0.16, 0.10, 0.20, 0.38])
    for (actual, expected) in zip(
      [layout.softLight.minX, layout.softLight.minY, layout.softLight.width, layout.softLight.height],
      [242, -286.8, 308, 669.2] as [CGFloat])
    {
      XCTAssertEqual(actual, expected, accuracy: 0.01)
    }
    XCTAssertEqual(layout.softLightBlur, 61.6, accuracy: 0.01)
  }

  func testTheTabletAndDesktopPlanesMatchTheSpec() {
    let tablet = CGSize(width: 1376, height: 1032)
    let t = AglynFacetsLayout(size: tablet, dark: true)
    XCTAssertEqual(percent(t, "top", size: tablet)[2], [100, 58.2])
    XCTAssertEqual(percent(t, "band", size: tablet)[1], [125, -31.1])
    XCTAssertEqual(percent(t, "accent", size: tablet), [[56, 100], [100, 59.7], [100, 66.7], [63.6, 100]])
    XCTAssertEqual(t.planes.map(\.opacity), [0.26, 0.18, 0.34, 0.50])
    let desktop = CGSize(width: 1440, height: 900)
    let d = AglynFacetsLayout(size: desktop, dark: false)
    XCTAssertEqual(percent(d, "corner", size: desktop)[1], [100, 34])
    XCTAssertEqual(percent(d, "accent", size: desktop), [[56, 100], [100, 51.6], [100, 58.6], [62.4, 100]])
  }

  func testTheLaunchFrameSitsAStepOutAndFainter() {
    let size = CGSize(width: 440, height: 956)
    let rest = AglynFacetsLayout(size: size, dark: false, settle: 1)
    let launch = AglynFacetsLayout(size: size, dark: false, settle: 0)
    for (a, b) in zip(rest.planes, launch.planes) {
      let moved = hypot(b.points[0].x - a.points[0].x, b.points[0].y - a.points[0].y)
      XCTAssertEqual(moved, 12, accuracy: 0.001, a.name)
      XCTAssertEqual(b.opacity, a.opacity * 0.9, accuracy: 0.0001, a.name)
    }
  }

  func testTheGradientRunsAsFigmaDrawsIt() {
    // Figma's transform on every plane: u = −0.883x − 0.469y + 1.176 in the plane's unit box (pink toward the top left).
    let line = AglynFacetsLayout.gradientLine(in: CGRect(x: 0, y: 0, width: 1, height: 1))
    XCTAssertEqual(line.start.x, 0.9415, accuracy: 0.001)
    XCTAssertEqual(line.start.y, 0.7345, accuracy: 0.001)
    XCTAssertEqual(line.end.x, 0.0585, accuracy: 0.001)
    XCTAssertEqual(line.end.y, 0.2655, accuracy: 0.001)
  }

  func testIPadLaysThePlanesOnASquareOfItsLongerSide() {
    XCTAssertEqual(
      AglynFacetsLayout.canvas(for: CGSize(width: 1032, height: 1376), square: true),
      CGRect(x: -172, y: 0, width: 1376, height: 1376))
    XCTAssertEqual(
      AglynFacetsLayout.canvas(for: CGSize(width: 440, height: 956), square: false),
      CGRect(x: 0, y: 0, width: 440, height: 956))
  }

  @MainActor
  func testTheIntroPlaysOncePerProcess() {
    _ = AglynLaunchIntro()
    let second = AglynLaunchIntro()
    XCTAssertTrue(second.finished)
    XCTAssertTrue(second.revealed)
    XCTAssertEqual(second.settle, 1)
  }
}
