// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

/// Site settings › Plugins: a switch asks what the console asks and saves what it saves. Turning Forms off asks first
/// (its `siteOff.confirm`, the console's dialog), and Cancel saves nothing; turning Funnels off and on saves at once.
/// On the iPad the question was never shown, so its switches did nothing (AGL-4221). Runs against the seeded emulator
/// stack with Config/Local.xcconfig's debug sign-in, on the Mac and iPad.
final class SitePluginSwitchUITests: XCTestCase {
  private var app: XCUIApplication!
  private var any: XCUIElementQuery { app.descendants(matching: .any) }

  override func setUp() {
    continueAfterFailure = false
    app = XCUIApplication()
    app.launchArguments += ["-AglynAutoSignIn", "YES", "-AglynNoPushPrompt", "YES", "-AglynAuthTransport", "rest"]
    #if os(macOS)
      app.launchArguments += ["-ApplePersistenceIgnoreState", "YES"]
    #endif
    app.launch()
    app.activate()
    let keep = app.buttons["keep-pins-confirm"].firstMatch
    if keep.waitForExistence(timeout: 20) { keep.tap() }
    tap("rail-org-mobile-demo-org", timeout: 20)
    tap("sidebar-sites")
    tap("site-mobile-demo-site", timeout: 20)
    tap("sidebar-siteSettings")
    if !any["sidebar-plugins"].firstMatch.waitForExistence(timeout: 5) { tap("sidebar-group-admin") }
    tap("sidebar-plugins")
  }

  private func tap(_ id: String, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
    let element = any[id].firstMatch
    XCTAssertTrue(element.waitForExistence(timeout: timeout), "No \(id)", file: file, line: line)
    element.tap()
  }

  private func pluginSwitch(_ label: String) -> XCUIElement { app.switches["\(label) on this site"].firstMatch }

  private func isOn(_ element: XCUIElement) -> Bool { (element.value as? String) == "1" }

  func testTurningFormsOffAsksAndCancelSavesNothing() {
    let forms = pluginSwitch("Forms")
    XCTAssertTrue(forms.waitForExistence(timeout: 20), "Forms' switch is listed")
    XCTAssertTrue(isOn(forms), "Forms runs on the seeded site")
    forms.tap()
    let turnOff = app.buttons["Turn off for this site"].firstMatch
    XCTAssertTrue(turnOff.waitForExistence(timeout: 5), "Turning Forms off asks first, as the console does")
    app.buttons["Cancel"].firstMatch.tap()
    XCTAssertFalse(turnOff.waitForExistence(timeout: 2), "Cancel closes the question")
    XCTAssertTrue(isOn(pluginSwitch("Forms")), "Cancel saved nothing")
  }

  func testTurningFunnelsOffAndOnSavesAtOnce() {
    let funnels = pluginSwitch("Funnels")
    XCTAssertTrue(funnels.waitForExistence(timeout: 20), "Funnels' switch is listed")
    XCTAssertTrue(isOn(funnels), "Funnels runs on the seeded site")
    funnels.tap()
    XCTAssertTrue(app.staticTexts["Site plugins saved"].waitForExistence(timeout: 20), "Turning Funnels off saved")
    let off = NSPredicate(format: "value == '0'")
    expectation(for: off, evaluatedWith: pluginSwitch("Funnels"))
    waitForExpectations(timeout: 20)

    // And back on, leaving the seeded site as it was.
    pluginSwitch("Funnels").tap()
    let on = NSPredicate(format: "value == '1'")
    expectation(for: on, evaluatedWith: pluginSwitch("Funnels"))
    waitForExpectations(timeout: 20)
  }
}
