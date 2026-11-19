// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// A link from another app opens as a new tab of the Mac window in front, never a window of its own (AGL-4059).
final class ExternalLinksTests: XCTestCase {
  private let now = Date(timeIntervalSince1970: 1_000_000)
  private func window(_ id: Int, openedAgo seconds: TimeInterval) -> ExternalLinks.Window {
    ExternalLinks.Window(id: id, opened: now.addingTimeInterval(-seconds))
  }

  /// The reported bug: the system made a new window for the link while one was open. The open window takes the link
  /// as a new tab, and the window made only to carry it closes.
  func testAWindowMadeForTheLinkHandsItToTheWindowAlreadyOpen() {
    let open = window(1, openedAgo: 600)
    let messenger = window(2, openedAgo: 0.2)
    XCTAssertEqual(
      ExternalLinks.choose(windows: [messenger, open], receiver: messenger, now: now), .newTab(window: 1, closing: 2))
    // Before the new window holds the shell, it is not among the windows yet; it still closes.
    XCTAssertEqual(
      ExternalLinks.choose(windows: [open], receiver: ExternalLinks.Window(id: -1, opened: messenger.opened), now: now),
      .newTab(window: 1, closing: -1))
  }

  /// With several windows open, the one in front takes it.
  func testTheWindowInFrontTakesIt() {
    let front = window(3, openedAgo: 60)
    let back = window(1, openedAgo: 600)
    let messenger = window(4, openedAgo: 0.1)
    XCTAssertEqual(
      ExternalLinks.choose(windows: [messenger, front, back], receiver: messenger, now: now), .newTab(window: 3, closing: 4))
  }

  /// A window that has been open a while and hears the link itself opens it in a new tab, and stays.
  func testAnOpenWindowThatHearsTheLinkOpensItInANewTab() {
    let open = window(1, openedAgo: 600)
    XCTAssertEqual(ExternalLinks.choose(windows: [open], receiver: open, now: now), .newTab(window: 1, closing: nil))
    // A link the system routes to a window behind still opens in the one in front.
    let front = window(2, openedAgo: 300)
    XCTAssertEqual(ExternalLinks.choose(windows: [front, open], receiver: open, now: now), .newTab(window: 2, closing: nil))
  }

  /// The link launched the app: its one window opens it as a new tab once it holds the shell, and is never closed.
  func testALinkThatLaunchedTheAppWaitsForItsWindow() {
    let first = window(1, openedAgo: 0.5)
    XCTAssertEqual(ExternalLinks.choose(windows: [], receiver: first, now: now), .waitForWindow)
    XCTAssertEqual(ExternalLinks.choose(windows: [first], receiver: first, now: now), .newTab(window: 1, closing: nil))
  }

  /// One click heard twice (as a URL and as a user activity, or by two windows) opens once; the same link clicked
  /// again later opens again.
  func testOneClickOpensOnce() {
    var repeats = ExternalLinks.Repeats()
    let link = "https://app.aglyn.com/acme/hosts/shop/admin/plugins/pIbeqgnNLn"
    XCTAssertTrue(repeats.isNew(link, at: now))
    XCTAssertFalse(repeats.isNew(link, at: now.addingTimeInterval(0.3)))
    XCTAssertTrue(repeats.isNew("aglyn://acme/hosts/shop/admin/plugins", at: now.addingTimeInterval(0.4)))
    XCTAssertTrue(repeats.isNew(link, at: now.addingTimeInterval(0.5)))
    XCTAssertTrue(repeats.isNew(link, at: now.addingTimeInterval(3)))
  }
}
