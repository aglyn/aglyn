// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

#if os(macOS)
  import AppKit
  import SwiftUI
  import XCTest

  @testable import AglynUI

  /// A card's hairline only draws (AGL-4112): a click anywhere on a row in the card reaches the row, the card's middle
  /// included. A one-row card (Danger zone's Delete site) centers its row on that middle, where the hairline took the
  /// click and the row's confirm never opened on the Mac.
  @MainActor
  final class CardSurfaceTests: XCTestCase {
    private final class Clicks {
      var count = 0
    }

    func testAClickThroughTheMiddleOfAOneRowCardReachesItsRow() throws {
      let clicks = Clicks()
      let width: CGFloat = 400
      let margin: CGFloat = 20
      let card = VStack(spacing: 0) {
        Button {
          clicks.count += 1
        } label: {
          HStack {
            Label("Delete site", systemImage: "trash")
            Spacer()
          }
        }
        .buttonStyle(.aglynRow)
        .padding(AglynFormMetrics.rowPadding)
        .frame(maxWidth: .infinity, minHeight: AglynFormMetrics.rowMinHeight, alignment: .leading)
      }
      .aglynCardSurface()
      .frame(width: width)
      .padding(margin)

      let host = NSHostingView(rootView: card)
      host.frame = NSRect(x: 0, y: 0, width: width + 2 * margin, height: AglynFormMetrics.rowMinHeight + 2 * margin)
      let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
      window.contentView = host
      window.orderFrontRegardless()
      defer { window.orderOut(nil) }
      host.layoutSubtreeIfNeeded()

      // The card's middle line, then a point above and below it, across the row: each one click on the row.
      let middle = margin + AglynFormMetrics.rowMinHeight / 2
      let points = [margin + 60, margin + width / 2, margin + width - 40].flatMap { x in
        [middle, middle - 6, middle + 6].map { NSPoint(x: x, y: $0) }
      }
      for point in points { click(window, at: point) }
      XCTAssertEqual(clicks.count, points.count, "every click on the row reaches it, the card's middle included")
    }

    private func click(_ window: NSWindow, at point: NSPoint) {
      for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
        guard
          let event = NSEvent.mouseEvent(
            with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
        else { return XCTFail("no mouse event") }
        window.sendEvent(event)
      }
      RunLoop.main.run(until: Date().addingTimeInterval(0.05))
    }
  }
#endif
