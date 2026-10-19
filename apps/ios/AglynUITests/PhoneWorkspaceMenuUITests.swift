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
}
#endif
