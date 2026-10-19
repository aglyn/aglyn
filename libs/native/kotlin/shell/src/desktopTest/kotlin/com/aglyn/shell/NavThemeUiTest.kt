package com.aglyn.shell

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.runComposeUiTest
import com.aglyn.contracts.AppDensity
import com.aglyn.contracts.AppThemeName
import com.aglyn.core.FirestoreWriter
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Whole-app theming (AGL-3946 Phase 4): the Theme settings write the account's theme, and the app wears it at once. */
@OptIn(ExperimentalTestApi::class)
class NavThemeUiTest {
  private class Writes : FirestoreWriter {
    val all = mutableListOf<Pair<String, Map<String, Any?>>>()
    override suspend fun merge(path: String, data: Map<String, Any?>) { all += path to data }
  }

  private fun ComposeUiTest.signIn() {
    onNodeWithTag("sign-in-email").performTextInput("dana@example.test")
    onNodeWithTag("sign-in-password").performTextInput("right")
    onNodeWithTag("sign-in-submit").performClick()
  }

  private fun ComposeUiTest.count(tag: String) = onAllNodes(androidx.compose.ui.test.hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().size

  @Test
  fun theThemeSettingsSaveOnTheAccountAndTheAppWearsThem() = runComposeUiTest {
    val writes = Writes()
    val services = testServices(userDoc = emptyMap(), writer = writes)
    var background = 1f
    setContent {
      AglynShell(services, dark = false)
      // What the app's scheme is now, read off the shell's own theme.
      AccountTheme(services, dark = false) { background = MaterialTheme.colorScheme.background.luminance() }
    }
    signIn()
    waitUntil(timeoutMillis = 3_000) { count("rail-account") > 0 }
    onNodeWithTag("rail-account").performClick()
    onNodeWithTag("account-menu-theme").performClick()
    waitUntil(timeoutMillis = 3_000) { count("theme-settings") > 0 }
    onNodeWithTag("theme-night").performScrollTo().performClick()
    waitUntil(timeoutMillis = 3_000) { services.accountPrefs.state.value.theme.theme == AppThemeName.NIGHT }
    // Night is dark whatever the appearance says.
    waitUntil(timeoutMillis = 3_000) { background < 0.1f }
    assertTrue(writes.all.any { (path, data) -> path == "users/u1" && (data["appTheme"] as? Map<*, *>)?.get("theme") == "night" })
    onNodeWithTag("theme-density-1").performScrollTo().performClick()
    waitUntil(timeoutMillis = 3_000) { services.accountPrefs.state.value.theme.density == AppDensity.COMPACT }
    onNodeWithTag("accent-violet").performScrollTo().performClick()
    waitUntil(timeoutMillis = 3_000) { services.accountPrefs.state.value.theme.accent == "#7A5CF0" }
    // This device only: the account's theme stays; the device's copy is what the app wears.
    val synced = writes.all.size
    onNodeWithTag("theme-device-only").performScrollTo().performClick()
    waitUntil(timeoutMillis = 3_000) { services.accountPrefs.state.value.deviceTheme != null }
    onNodeWithTag("theme-aglyn").performScrollTo().performClick()
    waitUntil(timeoutMillis = 3_000) { services.accountPrefs.state.value.theme.theme == AppThemeName.AGLYN }
    assertEquals(synced, writes.all.size)
    assertEquals(AppThemeName.NIGHT, services.accountPrefs.state.value.syncedTheme.theme)
  }

  @Test
  fun settingsListsTheTheme() = runComposeUiTest {
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { count("rail-account") > 0 }
    runOnIdle { navigator.select(ShellNavigator.SETTINGS) }
    waitUntil(timeoutMillis = 3_000) { count("settings-theme") > 0 }
    onNodeWithTag("settings-theme").performScrollTo().performClick()
    waitUntil(timeoutMillis = 3_000) { count("theme-settings") > 0 }
    onNodeWithTag("theme-appearance").assertIsDisplayed()
  }
}
