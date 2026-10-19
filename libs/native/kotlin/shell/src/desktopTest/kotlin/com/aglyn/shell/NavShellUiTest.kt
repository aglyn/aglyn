package com.aglyn.shell

import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.test.runDesktopComposeUiTest
import com.aglyn.core.AccountSessions
import com.aglyn.core.FirestoreWriter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The navigation shell (AGL-3946): the rail, the scope's manifest lists, settings as a mode, the phone's tabs, pins and Add account. */
@OptIn(ExperimentalTestApi::class)
class NavShellUiTest {
  private class Writes : FirestoreWriter {
    val all = mutableListOf<Pair<String, Map<String, Any?>>>()
    override suspend fun merge(path: String, data: Map<String, Any?>) { all += path to data }
  }

  private fun ComposeUiTest.signIn(email: String = "dana@example.test") {
    onNodeWithTag("sign-in-email").performTextInput(email)
    onNodeWithTag("sign-in-password").performTextInput("right")
    onNodeWithTag("sign-in-submit").performClick()
  }

  @Test
  fun aSiteShowsTheManifestsGroupsInTheConsolesWords() = runComposeUiTest {
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-site-overview") > 0 }
    onNodeWithTag("nav-site-home").assertIsDisplayed()
    onNodeWithTag("nav-site-overview").assertTextContains("Overview")
    // Website is folded until opened (it holds nothing in use yet); it lists the site's Pages and Media.
    assertEquals(0, onAllNodesWithTagCount("nav-site-pages"))
    onNodeWithTag("nav-group-website").performClick()
    onNodeWithTag("nav-site-pages").assertIsDisplayed()
    onNodeWithTag("nav-site-media").assertIsDisplayed()
    onNodeWithTag("nav-site-pages").performClick()
    waitUntil(timeoutMillis = 3_000) { navigator.top == NavKeys.of("site.pages") }
    onNode(androidx.compose.ui.test.hasText("Pages") and androidx.compose.ui.test.hasAnyAncestor(androidx.compose.ui.test.hasTestTag("title-bar"))).assertIsDisplayed()
    // The old drawer's double site heading is gone.
    assertEquals(0, onAllNodesWithTextCount("Site · Acme Shop"))
  }

  @Test
  fun siteSettingsIsAModeWithItsOwnListAndAWayBack() = runComposeUiTest {
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-site-siteSettings") > 0 }
    onNodeWithTag("nav-site-siteSettings").performScrollTo().performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("settings-mode-back") > 0 }
    onNodeWithTag("settings-mode-back").assertTextContains("Acme Shop settings")
    onNodeWithTag("nav-siteSettings-users").assertIsDisplayed()
    onNodeWithTag("nav-siteSettings-seo").assertIsDisplayed()
    // The first row opens with the mode.
    assertEquals(NavKeys.of("core.site.users"), navigator.top)
    onNodeWithTag("settings-mode-back").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-site-home") > 0 }
    assertEquals(0, onAllNodesWithTagCount("nav-siteSettings-users"))
  }

  @Test
  fun theWholeWorkspaceHasItsOwnListAndMenu() = runComposeUiTest {
    setContent { AglynShell(testServices(userDoc = emptyMap())) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("scope-back-to-workspace") > 0 }
    onNodeWithTag("scope-back-to-workspace").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("workspace-menu-button") > 0 }
    onNodeWithTag("nav-workspace-sites").assertIsDisplayed()
    assertEquals(0, onAllNodesWithTagCount("nav-site-overview"))
    onNodeWithTag("workspace-menu-button").performClick()
    onNodeWithTag("workspace-menu-invite").assertIsDisplayed()
    onNodeWithTag("workspace-menu-billing").assertIsDisplayed()
    onNodeWithTag("workspace-menu-settings").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("settings-mode-back") > 0 }
    onNodeWithTag("settings-mode-back").assertTextContains("Acme settings")
    onNodeWithTag("nav-workspaceSettings-members").assertIsDisplayed()
  }

  @Test
  fun aPhoneHasTheScopeChipTheTabsAndTheMenu() = runDesktopComposeUiTest(width = 400, height = 820) {
    setContent { AglynShell(testServices(userDoc = emptyMap())) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("phone-tabs") > 0 }
    onNodeWithTag("scope-chip").assertTextContains("Acme Shop", substring = true)
    onNodeWithTag("tab-home").assertIsDisplayed()
    onNodeWithTag("tab-create").assertIsDisplayed()
    assertEquals(0, onAllNodesWithTagCount("workspace-rail"))
    onNodeWithTag("tab-menu").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("phone-menu") > 0 }
    onNodeWithTag("nav-group-website").performClick()
    onNodeWithTag("nav-site-pages").assertIsDisplayed()
    // The chip opens the picker's first step.
    onNodeWithTag("scope-chip").performClick()
    onNodeWithTag("picker-org-o1").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("picker-site-h1") > 0 }
    onNodeWithTag("picker-whole-workspace").assertIsDisplayed()
  }

  @Test
  fun pinningFromThePickerWritesTheAccountsPins() = runComposeUiTest {
    val writes = Writes()
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap(), writer = writes), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("workspace-rail") > 0 }
    runOnIdle { navigator.command = ShellCommand.FIND }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("picker-pin-o1") > 0 }
    onNodeWithTag("picker-pin-o1").performClick()
    waitUntil(timeoutMillis = 3_000) { writes.all.any { "pinnedOrgs" in it.second } }
    assertEquals("users/u1" to mapOf("pinnedOrgs" to listOf("o1")), writes.all.last { "pinnedOrgs" in it.second })
    onNodeWithTag("picker-pin-o1").assertTextContains("Pinned", substring = true)
  }

  @Test
  fun addAccountSignsInASecondAccountAndSwitchesBack() = runComposeUiTest {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    val services = testServices(userDoc = emptyMap(), authFor = { prefs ->
      AccountSessions(scope, { slot -> FakeAuth(if (slot == AccountSessions.PRIMARY) "u1" else "u-$slot") }, prefs)
    })
    val accounts = services.accounts!!
    setContent { AglynShell(services) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("rail-account") > 0 }
    onNodeWithTag("rail-account").performClick()
    onNodeWithTag("account-menu-add").performClick()
    // The sign-in screens, framed for adding, with a way back to the account that stays.
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("add-account") > 0 }
    onNodeWithText("Add an account").assertIsDisplayed()
    signIn("lee@example.test")
    waitUntil(timeoutMillis = 3_000) { accounts.accounts.value.size == 2 && onAllNodesWithTagCount("add-account") == 0 }
    assertEquals("a1", accounts.active.value)
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("rail-account") > 0 }
    onNodeWithTag("rail-account").performClick()
    onNodeWithTag("account-menu-account-0").performClick()
    waitUntil(timeoutMillis = 3_000) { accounts.active.value == AccountSessions.PRIMARY }
    // Signing out ends only the account on screen; the other comes on screen.
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("rail-account") > 0 }
    onNodeWithTag("rail-account").performClick()
    onNodeWithTag("sign-out").performClick()
    waitUntil(timeoutMillis = 3_000) { accounts.active.value == "a1" }
    assertTrue(accounts.accounts.value.none { it.uid == "u1" })
  }
}

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.onAllNodesWithTagCount(tag: String): Int =
  onAllNodes(androidx.compose.ui.test.hasTestTag(tag), useUnmergedTree = true).fetchSemanticsNodes().size

@OptIn(ExperimentalTestApi::class)
private fun ComposeUiTest.onAllNodesWithTextCount(text: String): Int =
  onAllNodes(androidx.compose.ui.test.hasText(text), useUnmergedTree = true).fetchSemanticsNodes().size
