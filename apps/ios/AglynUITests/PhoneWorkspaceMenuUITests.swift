// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

#if os(iOS)
/// A phone reaches Workspace settings, and its Members, the way a Mac does (AGL-3945): Menu leads with the workspace's
/// header, whose ▾ opens the workspace menu. Runs against the seeded emulator stack with Config/Local.xcconfig's debug
/// sign-in, on an iPhone.
final class PhoneWorkspaceMenuUITests: XCTestCase {
  func testMenuOpensWorkspaceSettingsAndItsMembers() throws {
    let app = XCUIApplication()
    app.launchArguments += ["-AglynAutoSignIn", "YES", "-AglynNoPushPrompt", "YES", "-AglynAuthTransport", "rest"]
    app.launch()
    let keep = app.buttons["keep-pins-confirm"].firstMatch
    if keep.waitForExistence(timeout: 20) { keep.tap() }

    let menuTab = app.tabBars.buttons["Menu"]
    guard menuTab.waitForExistence(timeout: 20) else { throw XCTSkip("Menu is a phone's tab; this device has a sidebar") }
    menuTab.tap()

    let any = app.descendants(matching: .any)
    let header = any["sidebar-workspace-menu"].firstMatch
    XCTAssertTrue(header.waitForExistence(timeout: 10), "Menu has no workspace header")
    header.tap()
    let settings = app.buttons["Workspace settings"].firstMatch
    XCTAssertTrue(settings.waitForExistence(timeout: 5), "The workspace menu has no Workspace settings")
    settings.tap()

    // Workspace settings opens on its first row, Members (the Team screen); its list leads back to the other rows.
    let team = app.navigationBars["Team"]
    if !team.waitForExistence(timeout: 10) {
      let members = any["sidebar-members"].firstMatch
      XCTAssertTrue(members.waitForExistence(timeout: 10), "Workspace settings has no Members row")
      members.tap()
    }
    XCTAssertTrue(team.waitForExistence(timeout: 20), "Workspace settings did not reach the Team screen")
  }

  /// Menu › Website › Pages opens with its section chips, and each chip swaps the area in place, so Components,
  /// Layouts, Templates and Content are one tap from Pages and Back returns to Menu (AGL-3993); a store's Products the
  /// same (Orders offers its sections in its Filter menu). Runs inside the seeded stack's picked site.
  func testMenuReachesEverySectionOfASectionedArea() throws {
    let app = XCUIApplication()
    app.launchArguments += ["-AglynAutoSignIn", "YES", "-AglynNoPushPrompt", "YES", "-AglynAuthTransport", "rest"]
    app.launch()
    let keep = app.buttons["keep-pins-confirm"].firstMatch
    if keep.waitForExistence(timeout: 20) { keep.tap() }
    let menuTab = app.tabBars.buttons["Menu"]
    guard menuTab.waitForExistence(timeout: 20) else { throw XCTSkip("Menu is a phone's tab; this device has a sidebar") }
    let any = app.descendants(matching: .any)

    func openFromMenu(_ row: String, group: String) -> Bool {
      menuTab.tap()
      let target = any["sidebar-\(row)"].firstMatch
      if !target.waitForExistence(timeout: 5) {
        let head = any["sidebar-group-\(group)"].firstMatch
        guard head.waitForExistence(timeout: 5) else { return false }
        head.tap()
      }
      guard target.waitForExistence(timeout: 5) else { return false }
      if !target.isHittable { app.swipeUp() }
      target.tap()
      return true
    }

    let areas: [(row: String, group: String, sections: [String], required: Bool)] = [
      ("pages", "website", ["components", "layouts", "templates", "content", "pages"], true),
      ("products", "sell", ["promotions", "analytics", "catalog"], false),
    ]
    for area in areas {
      guard openFromMenu(area.row, group: area.group) else {
        if area.required { XCTFail("Menu has no \(area.row) row") }
        continue
      }
      let chips = any["area-sections-\(area.row)"].firstMatch
      XCTAssertTrue(chips.waitForExistence(timeout: 15), "\(area.row) opened from Menu without its section chips")
      for section in area.sections {
        let chip = any["area-section-\(section)"].firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "\(area.row) has no \(section) chip")
        chip.tap()
        XCTAssertTrue(chips.waitForExistence(timeout: 10), "\(area.row) › \(section) lost the section chips")
      }
      // One Back returns to Menu: each chip swapped the area in place rather than pushing another screen.
      app.navigationBars.buttons.element(boundBy: 0).tap()
      XCTAssertTrue(any["sidebar-\(area.row)"].firstMatch.waitForExistence(timeout: 10), "Back from \(area.row) did not return to Menu")
    }
  }
}
#endif
