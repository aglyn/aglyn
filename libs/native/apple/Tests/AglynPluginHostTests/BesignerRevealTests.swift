// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest
@testable import AglynWebView

/// The in-app Besigner's cover lifts only on the editor's painted signal (AGL-4002): a load slower than the cap
/// once showed the web view a frame before the editor had drawn.
final class BesignerRevealTests: XCTestCase {
  private let editor = "/acme/hosts/shop/forms/contact/versions/v1/besigner"

  func testTheEditorShowsOnlyOnceItHasPainted() {
    XCTAssertEqual(BesignerReveal.phase(elapsed: .seconds(1), path: editor, painted: false), .opening)
    XCTAssertEqual(BesignerReveal.phase(elapsed: .seconds(1), path: editor, painted: true), .shown)
  }

  func testASlowLoadStaysCoveredAndSaysItIsStillOpening() {
    XCTAssertEqual(BesignerReveal.phase(elapsed: .seconds(12), path: editor, painted: false), .stillOpening)
    XCTAssertEqual(BesignerReveal.phase(elapsed: .seconds(90), path: editor, painted: false), .stillOpening)
    // …and steps aside the moment the editor paints, however late.
    XCTAssertEqual(BesignerReveal.phase(elapsed: .seconds(90), path: editor, painted: true), .shown)
  }

  func testTheSignInHandOffNeverUncoversWhateverItDraws() {
    let entry = "/auth/besigner"
    XCTAssertEqual(BesignerReveal.phase(elapsed: .seconds(1), path: entry, painted: true), .opening)
    XCTAssertEqual(BesignerReveal.phase(elapsed: .seconds(30), path: entry, painted: true), .stillOpening)
    XCTAssertEqual(BesignerReveal.phase(elapsed: .seconds(30), path: "/acme/hosts/shop/forms", painted: true), .stillOpening)
  }

  func testThePaintedSignalWaitsForTheEditorBarAndNoLoadingOverlay() {
    let script = BesignerReveal.paintedScript
    XCTAssertTrue(script.contains("aglyn-besigner-logo-full"))
    // Mounted is enough: the compact bar (an iPad split, a phone) hides the wordmark, and the iPad drive sat on
    // "Still opening" over a drawn editor while the signal asked for it on screen.
    XCTAssertFalse(script.contains("getBoundingClientRect"))
    XCTAssertTrue(script.contains(".progress-bar-top"))
    XCTAssertTrue(script.contains("readyState"))
  }
}
