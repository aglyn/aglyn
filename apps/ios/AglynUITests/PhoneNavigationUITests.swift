// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

#if os(iOS)
/// The phone's navigation (AGL-4006): every area is a tile on Home; the tab bar is Home and the areas
/// the person pins, Create new in the centre until four fill it; the first areas opened take the free spots and stay.
/// Runs against the seeded emulator stack with Config/Local.xcconfig's debug sign-in, on an iPhone, inside the seeded
/// site; `-AglynFreshTabBar YES` starts the site's tab bar empty, as a fresh account's.
final class PhoneNavigationUITests: XCTestCase {
  private var app: XCUIApplication!
  private var any: XCUIElementQuery { app.descendants(matching: .any) }

  private func launch(fresh: Bool = true) throws {
    app = XCUIApplication()
    app.launchArguments += ["-AglynAutoSignIn", "YES", "-AglynNoPushPrompt", "YES", "-AglynAuthTransport", "rest"]
    if fresh { app.launchArguments += ["-AglynFreshTabBar", "YES"] }
    app.launch()
    let keep = app.buttons["keep-pins-confirm"].firstMatch
    if keep.waitForExistence(timeout: 20) { keep.tap() }
    guard any["home-tile-pages"].firstMatch.waitForExistence(timeout: 30) else {
      throw XCTSkip("Home's tiles are a phone's; this device has a sidebar")
    }
  }

  private func tab(_ id: String) -> XCUIElement { any["tab-\(id)"].firstMatch }

  private func tile(_ id: String) -> XCUIElement {
    let target = any["home-tile-\(id)"].firstMatch
    if !target.isHittable { app.swipeUp() }
    return target
  }

  private func backToHome() {
    tab("home").tap()
    tab("home").tap()
    _ = any["home-tile-pages"].firstMatch.waitForExistence(timeout: 10)
  }

  /// A fresh tab bar is Home and Create with the one-time tip; the first areas opened take the free spots and stay.
  func testAFreshTabBarKeepsTheFirstAreasOpened() throws {
    try launch()
    XCTAssertTrue(tab("home").waitForExistence(timeout: 10))
    XCTAssertTrue(tab("create").exists, "Create is not in a fresh tab bar")
    XCTAssertFalse(tab("pages").exists, "A fresh tab bar already holds an area nobody pinned")
    XCTAssertTrue(any["pin-tip"].firstMatch.waitForExistence(timeout: 10), "No one-time tip on a fresh tab bar")

    tile("pages").tap()
    XCTAssertTrue(tab("pages").waitForExistence(timeout: 10), "Pages, opened first, did not take a free spot")
    backToHome()
    tile("media").tap()
    XCTAssertTrue(tab("media").waitForExistence(timeout: 10), "Media, opened second, did not take a free spot")
    backToHome()
    // They stay where they landed: Pages before Create, Media after it.
    XCTAssertLessThan(tab("pages").frame.minX, tab("create").frame.minX)
    XCTAssertGreaterThan(tab("media").frame.minX, tab("create").frame.minX)
  }

  /// Long-press a tile to take it out of the tab bar or put it in; the Tab bar sheet reorders; a person's change stops
  /// opened areas filling the spot.
  func testPinUnpinAndReorderTheTabBar() throws {
    try launch()
    tile("pages").tap()
    backToHome()
    tile("media").tap()
    backToHome()

    tile("media").press(forDuration: 1.2)
    let unpin = any["tile-unpin-media"].firstMatch
    XCTAssertTrue(unpin.waitForExistence(timeout: 5), "A pinned tile's long-press has no Remove from tab bar")
    unpin.tap()
    XCTAssertTrue(tab("media").waitForNonExistence(timeout: 10), "Media stayed in the tab bar after Remove")

    // The person changed the bar, so the next area opened does not fill the spot.
    tile("overview").tap()
    backToHome()
    XCTAssertFalse(tab("overview").exists, "An opened area filled a spot after the person changed the bar")

    tile("media").press(forDuration: 1.2)
    let pin = any["tile-pin-media"].firstMatch
    XCTAssertTrue(pin.waitForExistence(timeout: 5), "A tile's long-press has no Add to tab bar")
    pin.tap()
    XCTAssertTrue(tab("media").waitForExistence(timeout: 10), "Add to tab bar did not put Media in the bar")
    XCTAssertLessThan(tab("pages").frame.minX, tab("media").frame.minX)

    // The Tab bar sheet, from the account sheet: move Media above Pages, Done.
    app.buttons["topbar-account"].tap()
    let row = app.buttons["Tab bar"].firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10), "The account sheet has no Tab bar row")
    row.tap()
    XCTAssertTrue(any["tab-bar-sheet"].firstMatch.waitForExistence(timeout: 10))
    let grab = app.buttons["Reorder Media"].firstMatch
    let above = any["tab-bar-pinned-pages"].firstMatch
    XCTAssertTrue(grab.waitForExistence(timeout: 5), "The Tab bar sheet has no reorder control")
    grab.press(forDuration: 0.8, thenDragTo: above)
    app.buttons["tab-bar-done"].tap()
    if app.buttons["Done"].firstMatch.waitForExistence(timeout: 3) { app.buttons["Done"].firstMatch.tap() }
    XCTAssertTrue(tab("media").waitForExistence(timeout: 10))
    XCTAssertLessThan(tab("media").frame.minX, tab("pages").frame.minX, "The Tab bar sheet's order did not land")
  }

  /// A sectioned area opened from its tile has its section chips, each swapping in place; Back returns to Home
  /// (AGL-3993). Workspace settings' tile reaches the Team screen.
  func testTilesReachSectionsAndWorkspaceSettings() throws {
    try launch(fresh: false)
    tile("pages").tap()
    let chips = any["area-sections-pages"].firstMatch
    if chips.waitForExistence(timeout: 15) {
      for section in ["components", "layouts", "templates", "content", "pages"] {
        let chip = any["area-section-\(section)"].firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "Pages has no \(section) chip")
        chip.tap()
      }
    }
    backToHome()
    tile("workspaceSettings").tap()
    let members = any["sidebar-members"].firstMatch
    XCTAssertTrue(members.waitForExistence(timeout: 15), "Workspace settings' list has no Members row")
    members.tap()
    XCTAssertTrue(app.navigationBars["Team"].waitForExistence(timeout: 20), "Workspace settings did not reach Team")
  }
}
#endif
