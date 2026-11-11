// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.shell

import com.aglyn.contracts.NativeNavListId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The title bar's Back and Forward put back the sidebar's settings mode with the destination (AGL-3996). */
class ShellHistoryTest {
  private class Chrome {
    var settingsMode: NativeNavListId? = null
  }

  @Test
  fun backOutOfASettingsModeReturnsToTheListThePlaceWasOpenedIn() {
    val chrome = Chrome()
    val navigator = ShellNavigator()
    navigator.settingsMode = chrome::settingsMode
    navigator.select(ShellNavigator.screenKey("commerce.orders"))
    chrome.settingsMode = NativeNavListId.WORKSPACE_SETTINGS
    navigator.select(ShellNavigator.screenKey("core.team"))

    navigator.historyBack()
    assertEquals(ShellNavigator.screenKey("commerce.orders"), navigator.top)
    assertNull(chrome.settingsMode)
    navigator.historyForward()
    assertEquals(ShellNavigator.screenKey("core.team"), navigator.top)
    assertEquals(NativeNavListId.WORKSPACE_SETTINGS, chrome.settingsMode)
  }

  @Test
  fun theSameDestinationInAnotherModeIsAnotherPlace() {
    val chrome = Chrome()
    val navigator = ShellNavigator()
    navigator.settingsMode = chrome::settingsMode
    chrome.settingsMode = NativeNavListId.SITE_SETTINGS
    navigator.select(ShellNavigator.HOME)
    navigator.historyBack()
    assertEquals(ShellNavigator.HOME, navigator.top)
    assertNull(chrome.settingsMode)
  }
}
