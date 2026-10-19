// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

#if os(macOS)
  import AppKit
  import SwiftUI
  import XCTest

  @testable import AglynUI

  /// A screen's head pieces stack: each scaffold modifier adds to what the screen publishes, none hides another.
  @MainActor
  final class ScreenChromeTests: XCTestCase {
    private final class Seen { var chrome = AglynScreenChrome() }

    private func chrome<V: View>(_ view: V) -> AglynScreenChrome {
      let seen = Seen()
      let host = NSHostingView(
        rootView: view.environment(\.aglynWideChrome, true).backgroundPreferenceValue(AglynScreenChromeKey.self) { value in
          seen.chrome = value
          return Color.clear
        })
      host.frame = NSRect(x: 0, y: 0, width: 400, height: 300)
      host.layoutSubtreeIfNeeded()
      RunLoop.main.run(until: Date().addingTimeInterval(0.2))
      return seen.chrome
    }

    func testPrimaryToolbarAndTitleAllReachTheHead() {
      let got = chrome(
        Text("List")
          .aglynPrimaryAction(id: "new", "New", systemImage: "plus") {}
          .aglynScreenToolbar(id: "more") { Button("Select") {} }
          .aglynScreenTitle("Products"))
      XCTAssertEqual(got.primary?.id, "new")
      XCTAssertEqual(got.entries.map(\.id), ["more"])
      XCTAssertEqual(got.title, "Products")
    }

    func testAnInnerTitleWinsOverAnOuterOne() {
      let got = chrome(Text("Detail").aglynScreenTitle("Croissant").aglynScreenTitle("Product"))
      XCTAssertEqual(got.title, "Croissant")
    }

    func testEditorActionsPutSaveFirstAndCancelBeside() {
      let got = chrome(Text("Editor").aglynEditorActions(id: "save", save: "Save", cancel: {}) {})
      XCTAssertEqual(got.primary?.id, "save")
      XCTAssertEqual(got.entries.map(\.id), ["save-cancel"])
    }
  }
#endif
