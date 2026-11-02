// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

/// Create site with the marketplace's starters (AGL-4049), and publishing a site as one. Runs against the seeded emulator
/// stack with `release_site_starters` on for the workspace, its first-party starters seeded, a paid starter it does not own
/// and a paid one it does, on an iPhone, an iPad and the Mac. Nothing is picked when the sheet opens; a free or owned pick
/// creates at once; a paid or AI pick says so at the foot of the sheet and goes to the console's Create site.
final class CreateSiteStarterUITests: XCTestCase {
  private func capture(_ app: XCUIApplication, _ name: String) {
    // The Mac's own window only: the app's screenshot there is the whole display, with whatever else is open on it.
    #if os(macOS)
      let shot = XCTAttachment(screenshot: app.windows.firstMatch.screenshot())
    #else
      let shot = XCTAttachment(screenshot: app.screenshot())
    #endif
    shot.name = name
    shot.lifetime = .keepAlways
    add(shot)
  }

  /// A frame in points, for the side-by-side against Figma.
  private func measure(_ element: XCUIElement, _ name: String) {
    let frame = element.frame
    let measured = XCTAttachment(string: "\(name): x \(frame.minX) y \(frame.minY) w \(frame.width) h \(frame.height)")
    measured.name = "measure \(name)"
    measured.lifetime = .keepAlways
    add(measured)
  }

  /// Scrolls until `element` can be tapped. Slowly: a query walks every element of a long sheet, and XCTest's own logging
  /// from a tight loop of them gets the app's process quarantined and killed.
  private func reveal(_ element: XCUIElement, in app: XCUIApplication) {
    for _ in 0..<30 where !element.isHittable {
      usleep(600_000)
      #if os(macOS)
        app.scrollViews.firstMatch.scroll(byDeltaX: 0, deltaY: -240)
      #else
        app.swipeUp(velocity: .fast)
      #endif
    }
  }

  private func launched(route: String = "site.sites", params: String = "new=1") -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments += [
      "-AglynAutoSignIn", "YES", "-AglynNoPushPrompt", "YES", "-AglynAuthTransport", "rest",
      "-AglynDemoRoute", route, "-AglynDemoParams", params,
    ]
    #if os(macOS)
      app.launchArguments += ["-ApplePersistenceIgnoreState", "YES"]
    #endif
    app.launch()
    let keep = app.buttons["keep-pins-confirm"].firstMatch
    if keep.waitForExistence(timeout: 20), keep.isHittable { keep.tap() }
    return app
  }

  func testCreateSiteWaitsForAStarterThenOpensTheSite() throws {
    let app = launched()
    let name = app.textFields["site-name"].firstMatch
    XCTAssertTrue(name.waitForExistence(timeout: 40), "Create site did not open")
    let confirm = app.buttons["sheet-confirm"].firstMatch
    XCTAssertFalse(confirm.isEnabled, "Create site is on with nothing filled in")
    let site = "Starter \(Int(Date().timeIntervalSince1970) % 1_000_000)"
    name.tap()
    name.typeText(site)

    let row = app.buttons["starter-fp-starter-trades-base"].firstMatch
    reveal(row, in: app)
    XCTAssertTrue(row.waitForExistence(timeout: 20), "The starters are not in the sheet")
    XCTAssertFalse(app.staticTexts["site-style-required"].firstMatch.exists, "The styles are still in the sheet")
    measure(row, "row")
    XCTAssertFalse(row.isSelected, "A starter was picked before anyone chose one")
    XCTAssertFalse(app.buttons["starter-fp-starter-default"].firstMatch.isSelected, "A starter was picked before anyone chose one")
    XCTAssertFalse(confirm.isEnabled, "A name and an address created a site with no starter")
    capture(app, "1-nothing-picked")

    row.tap()
    XCTAssertTrue(row.isSelected, "The row did not take the pick")
    XCTAssertFalse(app.buttons["Buy on the web"].firstMatch.exists, "A free starter has nothing to say")
    XCTAssertTrue(confirm.isEnabled, "Create site stayed off after a free starter was picked")
    capture(app, "2-picked")

    confirm.tap()
    let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: name)
    wait(for: [gone], timeout: 90)
    let named = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", site)).firstMatch
    XCTAssertTrue(named.waitForExistence(timeout: 40), "The new site did not open")
    capture(app, "3-opened")
  }

  func testAPaidStarterSaysItsPriceAndGoesToTheWeb() throws {
    let app = launched()
    let name = app.textFields["site-name"].firstMatch
    XCTAssertTrue(name.waitForExistence(timeout: 40), "Create site did not open")
    name.tap()
    name.typeText("Paid \(Int(Date().timeIntervalSince1970) % 1_000_000)")
    let confirm = app.buttons["sheet-confirm"].firstMatch

    // One the workspace owns creates at once.
    let owned = app.buttons["starter-seed-starter-owned"].firstMatch
    reveal(owned, in: app)
    XCTAssertTrue(owned.waitForExistence(timeout: 20), "The owned starter is not listed")
    owned.tap()
    XCTAssertTrue(app.staticTexts["You own this starter. Create your site from it whenever you are ready."].waitForExistence(timeout: 5))
    XCTAssertTrue(confirm.isEnabled, "An owned starter should create at once")
    capture(app, "6-owned-picked")

    let paid = app.buttons["starter-seed-starter-paid"].firstMatch
    measure(paid, "paid row")
    paid.tap()
    let note = app.staticTexts["Northwind Bakery costs $12. Buy it on the web, then create your site from it."].firstMatch
    XCTAssertTrue(note.waitForExistence(timeout: 5), "The price is not said")
    measure(note, "note")
    XCTAssertFalse(confirm.isEnabled, "A starter nobody paid for created a site")
    capture(app, "5-paid-picked")

    // Buying leaves for the console's own Create site, on that pick.
    app.buttons["Buy on the web"].firstMatch.tap()
    let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: name)
    wait(for: [gone], timeout: 20)
    let browser = app.webViews.firstMatch
    XCTAssertTrue(browser.waitForExistence(timeout: 30), "The console's page did not open")
    sleep(4)
    capture(app, "7-web")
  }

  func testAnAIStarterGoesToTheWeb() throws {
    let app = launched()
    let name = app.textFields["site-name"].firstMatch
    XCTAssertTrue(name.waitForExistence(timeout: 40), "Create site did not open")
    name.tap()
    name.typeText("AI \(Int(Date().timeIntervalSince1970) % 1_000_000)")
    #if os(macOS)
      let mode = app.radioButtons["AI starters"].firstMatch
    #else
      let mode = app.buttons["AI starters"].firstMatch
    #endif
    reveal(mode, in: app)
    XCTAssertTrue(mode.waitForExistence(timeout: 20), "The AI starters are not offered")
    mode.tap()
    let row = app.buttons["starter-fp-starter-trades-ai"].firstMatch
    reveal(row, in: app)
    XCTAssertTrue(row.waitForExistence(timeout: 20), "The AI starters are not listed")
    row.tap()
    XCTAssertTrue(app.buttons["Continue on the web"].firstMatch.waitForExistence(timeout: 5), "An AI pick does not go to the web")
    XCTAssertFalse(app.buttons["sheet-confirm"].firstMatch.isEnabled, "An AI starter would create an empty site here")
    capture(app, "8-ai-picked")
  }

  func testPublishesTheSiteAsAStarter() throws {
    let app = launched(route: "core.site.backup", params: "site=mobile-demo-site")
    let row = app.buttons["zone-marketplace.publishStarter"].firstMatch
    reveal(row, in: app)
    XCTAssertTrue(row.waitForExistence(timeout: 40), "Backup & restore does not offer a starter")
    capture(app, "9-backup")
    row.tap()

    let choice = { (label: String) in app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch }
    let builtin = choice("This site's built-in theme")
    reveal(builtin, in: app)
    XCTAssertTrue(builtin.waitForExistence(timeout: 20), "The form did not open")
    capture(app, "10-publish-form")
    XCTAssertTrue(choice("The site's full theme").exists, "The site's own theme is not offered")
    let publish = app.buttons["submit-publish"].firstMatch
    XCTAssertFalse(publish.isEnabled, "Publish is on with no theme or agreement")
    builtin.tap()
    #if os(macOS)
      let agree = app.checkBoxes["field-agreement"].firstMatch
      reveal(agree, in: app)
      agree.tap()
    #else
      let agree = app.switches["field-agreement"].firstMatch
      reveal(agree, in: app)
      // The switch itself, at the row's end: the words beside it do not toggle it.
      agree.coordinate(withNormalizedOffset: CGVector(dx: 0.94, dy: 0.5)).tap()
    #endif
    reveal(publish, in: app)
    XCTAssertTrue(publish.isEnabled, "Publish stayed off")
    capture(app, "11-publish-filled")
    publish.tap()
    // Sent, and back on Backup & restore.
    XCTAssertTrue(row.waitForExistence(timeout: 40), "The publish did not go back")
    capture(app, "12-published")
  }
}
