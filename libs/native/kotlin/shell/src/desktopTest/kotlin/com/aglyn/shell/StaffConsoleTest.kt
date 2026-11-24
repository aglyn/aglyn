package com.aglyn.shell

import com.aglyn.core.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import com.aglyn.contracts.NativeNavListId

/** The account menu's Staff console (AGL-3667, the console's user menu), as Apple's ShellTests. */
class StaffConsoleTest {
  @Test
  fun onlyAStaffTokenIsOfferedTheStaffConsole() {
    assertNotNull(staffConsoleAction(isStaff = true) {})
    assertNull(staffConsoleAction(isStaff = false) {})
  }

  @Test
  fun aWideWindowOpensTheStaffListOnItsFirstRow() {
    val chrome = NavChromeState(InMemoryKeyValueStore())
    val navigator = ShellNavigator()
    chrome.accountMenu = true
    openStaffConsole(chrome, navigator, wide = true, firstKey = NavKeys.of("core.staff.overview"))
    assertEquals(STAFF_MODE, chrome.settingsMode)
    assertEquals(NavKeys.of("core.staff.overview"), navigator.top)
    assertFalse(chrome.accountMenu, "the menu closes")
  }

  @Test
  fun aPhoneOpensTheStaffListAsItsMenu() {
    val chrome = NavChromeState(InMemoryKeyValueStore())
    val navigator = ShellNavigator()
    openStaffConsole(chrome, navigator, wide = false, firstKey = NavKeys.of("core.staff.overview"))
    assertEquals(STAFF_MODE, chrome.settingsMode)
    assertEquals(ShellNavigator.MENU, navigator.top)
  }

  @Test
  fun backFromAPhonesStaffListReturnsToThePlaceItWasOpenedOver() {
    val chrome = NavChromeState(InMemoryKeyValueStore())
    val navigator = ShellNavigator()
    navigator.select(NavKeys.of("commerce.orders"))
    navigator.push(Route.Web("https://example.test/receipt"))
    openStaffConsole(chrome, navigator, wide = false, firstKey = NavKeys.of("core.staff.overview"))
    assertEquals(ShellNavigator.MENU, navigator.top)
    assertTrue(navigator.stack.isEmpty())
    assertTrue(leaveStaffConsole(chrome, navigator))
    assertEquals(NavKeys.of("commerce.orders"), navigator.top)
    assertEquals(listOf<Route>(Route.Web("https://example.test/receipt")), navigator.stack.toList())
    assertNull(chrome.settingsMode)
    assertFalse(leaveStaffConsole(chrome, navigator), "only once, and only from the staff list")
  }

  @Test
  fun backFromAStaffListOpenedOverASettingsListReturnsToThatList() {
    val chrome = NavChromeState(InMemoryKeyValueStore())
    val navigator = ShellNavigator()
    chrome.settingsMode = NativeNavListId.WORKSPACE_SETTINGS
    navigator.select(ShellNavigator.MENU)
    openStaffConsole(chrome, navigator, wide = false, firstKey = null)
    assertEquals(STAFF_MODE, chrome.settingsMode)
    assertTrue(leaveStaffConsole(chrome, navigator))
    assertEquals(NativeNavListId.WORKSPACE_SETTINGS, chrome.settingsMode)
    assertEquals(ShellNavigator.MENU, navigator.top)
  }

  @Test
  fun aStaffScreenOpenedFromTheListIsNotLeftByTheListsBack() {
    val chrome = NavChromeState(InMemoryKeyValueStore())
    val navigator = ShellNavigator()
    navigator.select(NavKeys.of("commerce.orders"))
    openStaffConsole(chrome, navigator, wide = false, firstKey = null)
    navigator.select(NavKeys.of("core.staff.orgs"))
    assertFalse(leaveStaffConsole(chrome, navigator), "a staff screen goes back to the list first")
  }

  @Test
  fun theSwitchersStaffRowClosesTheSwitcher() {
    val chrome = NavChromeState(InMemoryKeyValueStore())
    chrome.picker = PickerStep.WORKSPACE
    openStaffConsole(chrome, ShellNavigator(), wide = false, firstKey = null)
    assertNull(chrome.picker)
  }

  @Test
  fun allWorkspacesOpensThePickerOnItsWorkspaceStep() {
    val chrome = NavChromeState(InMemoryKeyValueStore())
    val navigator = ShellNavigator()
    navigator.select(NavKeys.of("commerce.orders"))
    chrome.accountMenu = true
    openAllWorkspaces(chrome)
    assertEquals(PickerStep.WORKSPACE, chrome.picker)
    assertFalse(chrome.accountMenu, "the account sheet closes")
    assertEquals(NavKeys.of("commerce.orders"), navigator.top, "nothing on screen changes until a workspace is picked")
    assertEquals("All workspaces", ALL_WORKSPACES_TITLE)
  }
}
