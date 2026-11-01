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

  /// Scrolls the sheet until `element` is on screen: a form builds its rows as they come into view, and the styles sit
  /// below the fold on an iPad's form sheet.
  private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
    for _ in 0..<14 where !(element.exists && element.isHittable) {
      #if os(macOS)
        app.scrollViews.firstMatch.scroll(byDeltaX: 0, deltaY: -240)
      #else
        app.swipeUp(velocity: .slow)
      #endif
    }
  }

  private func launched() -> XCUIApplication {
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
    return app
  }

  #if os(iOS)
    /// A logo chosen from the photo library goes in with the new site, and the favicon left blank follows it. Needs a
    /// photo on the device (`xcrun simctl addmedia`). The Mac's picker is the system's own window, out of a test's reach.
    func testALogoGoesInWithTheNewSite() throws {
      let app = launched()
      let any = app.descendants(matching: .any)
      let name = any["site-name"].firstMatch
      XCTAssertTrue(name.waitForExistence(timeout: 40), "Create site did not open")
      let site = "Logo \(Int(Date().timeIntervalSince1970) % 1_000_000)"
      name.tap()
      name.typeText(site)
      app.buttons["Choose Logo"].firstMatch.tap()
      let library = any["image-file-photos"].firstMatch
      XCTAssertTrue(library.waitForExistence(timeout: 10), "The field offers no photo library")
      library.tap()
      let photo = app.images.matching(NSPredicate(format: "label BEGINSWITH 'Photo'")).firstMatch
      XCTAssertTrue(photo.waitForExistence(timeout: 20), "The photo library did not open")
      capture(app, "0-library")
      photo.tap()
      let held = app.buttons["Replace Logo"].firstMatch
      XCTAssertTrue(held.waitForExistence(timeout: 20), "The field did not take the picture")
      capture(app, "1-logo-held")

      let card = any["option-card-business"].firstMatch
      reveal(card, in: app)
      XCTAssertTrue(card.waitForExistence(timeout: 10), "The style cards are not in the sheet")
      card.tap()
      app.buttons["sheet-confirm"].firstMatch.tap()
      let named = any.matching(NSPredicate(format: "label CONTAINS %@", site)).firstMatch
      XCTAssertTrue(named.waitForExistence(timeout: 90), "The new site did not open")
      capture(app, "2-logo-site-opened")
    }
  #endif

  func testCreateSiteWaitsForAStyleThenOpensTheSite() throws {
    let app = launched()

    let any = app.descendants(matching: .any)
    let name = any["site-name"].firstMatch
    XCTAssertTrue(name.waitForExistence(timeout: 40), "Create site did not open")
    // The button itself: the identifier also lands on the toolbar item around it, which is never disabled.
    let confirm = app.buttons["sheet-confirm"].firstMatch
    let required = any["site-style-required"].firstMatch
    // The logo fields are optional and sit between the address and the styles.
    XCTAssertTrue(any["site-brand-logo"].firstMatch.waitForExistence(timeout: 10), "The logo field is not in the sheet")
    XCTAssertFalse(confirm.isEnabled, "Create site is on with nothing filled in")
    capture(app, "1-opened")

    let site = "Style \(Int(Date().timeIntervalSince1970) % 1_000_000)"
    name.tap()
    name.typeText(site)
    let card = any["option-card-business"].firstMatch
    reveal(card, in: app)
    XCTAssertTrue(card.waitForExistence(timeout: 10), "The style cards are not in the sheet")
    XCTAssertTrue(required.exists, "The sheet does not say a style is needed")
    measure(card, "card")
    XCTAssertFalse(card.isSelected, "A style was picked before anyone chose one")
    XCTAssertFalse(any["option-card-trades"].firstMatch.isSelected, "A style was picked before anyone chose one")
    XCTAssertFalse(confirm.isEnabled, "A name and an address created a site with no style")
    capture(app, "2-named-no-style")

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

    // The site opens on its Home, and Create site does not come back over it (AGL-4129).
    let named = any.matching(NSPredicate(format: "label CONTAINS %@", site)).firstMatch
    XCTAssertTrue(named.waitForExistence(timeout: 40), "The new site did not open")
    sleep(3)
    XCTAssertFalse(name.exists, "Create site opened again over the new site")
    XCTAssertFalse(any["sites-list"].firstMatch.exists, "Sites is still in front of the new site")
    capture(app, "5-opened")
  }
}
