// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

/// Create site asks a style before it makes anything (AGL-4049): the sheet opens with nothing picked, a name and an
/// address are not enough, and once a card is picked the site is made and opened. Runs against the seeded emulator stack
/// with Config/Local.xcconfig's debug sign-in, on an iPhone, an iPad and the Mac. `-AglynDemoRoute` opens Sites with its
/// `new=1`, the door Create new and the site switcher use.
final class CreateSiteUITests: XCTestCase {
  private func capture(_ app: XCUIApplication, _ name: String) {
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  /// A frame in points, for the side-by-side against Figma.
  private func measure(_ element: XCUIElement, _ name: String) {
    let frame = element.frame
    let line = "\(name): x \(frame.minX) y \(frame.minY) w \(frame.width) h \(frame.height)"
    let measured = XCTAttachment(string: line)
    measured.name = "measure \(name)"
    measured.lifetime = .keepAlways
    add(measured)
  }

  func testCreateSiteWaitsForAStyleThenOpensTheSite() throws {
    let app = XCUIApplication()
    app.launchArguments += [
      "-AglynAutoSignIn", "YES", "-AglynNoPushPrompt", "YES", "-AglynAuthTransport", "rest",
      "-AglynDemoRoute", "site.sites", "-AglynDemoParams", "new=1",
    ]
    #if os(macOS)
      // One window: a Mac otherwise restores every window the last run left open.
      app.launchArguments += ["-ApplePersistenceIgnoreState", "YES"]
    #endif
    app.launch()
    let keep = app.buttons["keep-pins-confirm"].firstMatch
    if keep.waitForExistence(timeout: 20) { keep.tap() }

    let any = app.descendants(matching: .any)
    let name = any["site-name"].firstMatch
    XCTAssertTrue(name.waitForExistence(timeout: 40), "Create site did not open")
    let confirm = any["sheet-confirm"].firstMatch
    let required = any["site-style-required"].firstMatch
    XCTAssertTrue(required.waitForExistence(timeout: 10), "The sheet does not say a style is needed")
    XCTAssertFalse(confirm.isEnabled, "Create site is on with nothing filled in")
    capture(app, "1-opened")
    measure(any["option-card-business"].firstMatch, "card")

    let site = "Style \(Int(Date().timeIntervalSince1970) % 1_000_000)"
    name.tap()
    name.typeText(site)
    let card = any["option-card-business"].firstMatch
    XCTAssertTrue(card.waitForExistence(timeout: 10), "The style cards are not in the sheet")
    XCTAssertFalse(card.isSelected, "A style was picked before anyone chose one")
    XCTAssertFalse(any["option-card-trades"].firstMatch.isSelected, "A style was picked before anyone chose one")
    XCTAssertFalse(confirm.isEnabled, "A name and an address created a site with no style")
    capture(app, "2-named-no-style")

    // The logo fields are optional and sit between the address and the styles.
    XCTAssertTrue(any["site-brand-logo"].firstMatch.exists, "The logo field is not in the sheet")
    XCTAssertTrue(any["site-brand-favicon"].firstMatch.exists, "The favicon field is not in the sheet")

    card.tap()
    XCTAssertTrue(card.isSelected, "The card did not take the pick")
    XCTAssertFalse(required.exists, "It still asks for a style after one was picked")
    XCTAssertTrue(confirm.isEnabled, "Create site stayed off after a style was picked")
    capture(app, "3-picked")

    confirm.tap()
    // Made and opened: the sheet closes on the new site, its own sidebar or Home.
    let closed = NSPredicate(format: "exists == false")
    let gone = expectation(for: closed, evaluatedWith: name)
    wait(for: [gone], timeout: 90)
    capture(app, "4-created")
  }
}
