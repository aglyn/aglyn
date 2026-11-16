package com.aglyn.shell

import com.aglyn.core.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull

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
}
