package com.aglyn.shell

import com.aglyn.core.InMemoryKeyValueStore
import com.aglyn.webview.BesignerBack
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The in-app Besigner's focus mode and its one way back (AGL-4056), as Apple's BesignerFocusTests. */
class BesignerFocusTest {
  @Test
  fun openingTheEditorFoldsTheRailAndTheSidebarAndLeavingRestoresThem() {
    val device = InMemoryKeyValueStore()
    val chrome = NavChromeState(device)
    chrome.toggleRail() // The person keeps the rail hidden.
    chrome.enterFocus()
    assertTrue(chrome.inFocus)
    assertTrue(chrome.railHidden)
    assertTrue(chrome.sidebarHidden)
    chrome.leaveFocus()
    assertFalse(chrome.inFocus)
    assertTrue(chrome.railHidden)
    assertFalse(chrome.sidebarHidden)
  }

  @Test
  fun theToggleBringsBothBackWithoutStoringTheFold() {
    val device = InMemoryKeyValueStore()
    val chrome = NavChromeState(device)
    chrome.enterFocus()
    chrome.toggleRail()
    assertFalse(chrome.railHidden)
    assertFalse(chrome.sidebarHidden, "the sidebar follows the rail")
    chrome.toggleRail()
    assertTrue(chrome.railHidden)
    assertTrue(chrome.sidebarHidden)
    // The fold is never the person's own choice: the next launch shows both.
    assertNull(device.get("aglyn.nav.railHidden"))
    assertNull(device.get("aglyn.nav.sidebarHidden"))
    chrome.leaveFocus()
    assertFalse(chrome.railHidden)
    assertFalse(chrome.sidebarHidden)
  }

  @Test
  fun openingAgainKeepsTheFirstMemory() {
    val chrome = NavChromeState(InMemoryKeyValueStore())
    chrome.enterFocus()
    chrome.enterFocus()
    chrome.leaveFocus()
    assertFalse(chrome.railHidden)
    assertFalse(chrome.sidebarHidden)
  }

  @Test
  fun backPressesTheBesignersControlOnlyWhileOneIsOnScreen() {
    val back = BesignerBack()
    assertFalse(back.press(), "no Besigner: the shell goes back itself")
    var pressed = 0
    back.handler = { pressed++ }
    assertTrue(back.press())
    assertEquals(1, pressed)
  }
}
