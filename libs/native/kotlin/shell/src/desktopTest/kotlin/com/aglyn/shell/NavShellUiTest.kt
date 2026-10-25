package com.aglyn.shell

import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.doubleClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.getBoundsInRoot
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
    onNode(androidx.compose.ui.test.hasText("Pages", substring = true) and androidx.compose.ui.test.hasAnyAncestor(androidx.compose.ui.test.hasTestTag("title-crumb"))).assertIsDisplayed()
    // The old drawer's double site heading is gone.
    assertEquals(0, onAllNodesWithTextCount("Site · Acme Shop"))
  }

  @Test
  fun aDeletedSiteOnScreenLeavesForTheWorkspacesSitesNeverTheNextSite() = runComposeUiTest {
    val shop = com.aglyn.core.FirestoreDoc("h1", "users/u1/hostMemberships/h1", mapOf("orgId" to "o1", "displayName" to "Acme Shop", "subdomain" to "shop", "role" to "admin"))
    val blog = com.aglyn.core.FirestoreDoc("h2", "users/u1/hostMemberships/h2", mapOf("orgId" to "o1", "displayName" to "Acme Blog", "subdomain" to "blog", "role" to "admin"))
    val memberships = kotlinx.coroutines.flow.MutableStateFlow(listOf(blog, shop))
    val services = testServices(userDoc = emptyMap(), liveCollections = mapOf("users/u1/hostMemberships" to memberships))
    val navigator = ShellNavigator()
    setContent { AglynShell(services, navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { services.workspace.state.value.site != null }
    services.workspace.selectSite("h1")
    waitUntil(timeoutMillis = 3_000) { services.workspace.state.value.site?.id == "h1" }
    // The site's Danger zone is open when the site goes (deleted here, on the web or on another device).
    runOnIdle { navigator.select(NavKeys.of("core.site.delete")) }
    waitForIdle()
    memberships.value = listOf(blog)
    // The whole workspace's Sites, as View all sites opens; never Acme Blog with its Danger zone still open.
    waitUntil(timeoutMillis = 3_000) { navigator.top == NavKeys.of("site.sites") }
    assertTrue(services.workspace.state.value.wholeWorkspace)
    assertEquals(null, services.workspace.state.value.site)
  }

  @Test
  fun siteSettingsIsAModeWithItsOwnListAndAWayBack() = runComposeUiTest {
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-site-siteSettings") > 0 }
    onNodeWithTag("nav-site-siteSettings").performScrollTo().performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("settings-mode-back") > 0 }
    // "‹ Acme Shop" over the mode's title (Figma Sidebar, Scope = Settings), and its own search.
    onNodeWithTag("settings-mode-back").assertTextContains("Acme Shop")
    onNodeWithTag("settings-mode-title").assertTextContains("Site settings")
    onNodeWithTag("settings-mode-search").assertExists()
    onNodeWithTag("nav-siteSettings-users").assertIsDisplayed()
    onNodeWithTag("nav-siteSettings-seo").assertIsDisplayed()
    // The first row opens with the mode.
    assertEquals(NavKeys.of("core.site.users"), navigator.top)
    onNodeWithTag("settings-mode-back").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-site-home") > 0 }
    assertEquals(0, onAllNodesWithTagCount("nav-siteSettings-users"))
  }

  @Test
  fun theHomeTabWearsAWhiteLabelWorkspacesOwnMark() = runComposeUiTest {
    setContent {
      AglynShell(
        testServices(
          userDoc = emptyMap(),
          orgDoc = mapOf("brandingProfile" to mapOf("faviconUrl" to "https://cdn.example.com/acme-mark.png")),
          apiBody = { path -> if (path == "/api/orgs/entitlements") """{"plan":"agency","features":{"whiteLabel":true},"quotas":{}}""" else null },
        ),
      )
    }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("home-tab-brand-mark") > 0 }
    assertEquals(0, onAllNodesWithTagCount("home-tab-mark"))
  }

  @Test
  fun theHomeTabIsTheMarkWithoutWhiteLabel() = runComposeUiTest {
    setContent {
      AglynShell(
        testServices(
          userDoc = emptyMap(),
          orgDoc = mapOf("brandingProfile" to mapOf("faviconUrl" to "https://cdn.example.com/acme-mark.png")),
          apiBody = { path -> if (path == "/api/orgs/entitlements") """{"plan":"pro","features":{"whiteLabel":false},"quotas":{}}""" else null },
        ),
      )
    }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("home-tab-mark") > 0 }
    assertEquals(0, onAllNodesWithTagCount("home-tab-brand-mark"))
  }

  @Test
  fun theTitleBarSearchIsAFieldWithADropdownUnderIt() = runComposeUiTest {
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("search-or-jump-field") > 0 }
    // A click puts the caret in the field itself; the dropdown hangs under it (no dialog).
    onNodeWithTag("search-or-jump-field").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("one-box") > 0 }
    // Typing groups the results; ↵ opens the highlighted one and closes the dropdown.
    onNodeWithTag("search-or-jump-field").performTextInput("pages")
    waitUntil(timeoutMillis = 3_000) { onAllNodes(androidx.compose.ui.test.hasText("Screens & settings")).fetchSemanticsNodes().isNotEmpty() }
    onNode(androidx.compose.ui.test.hasText("See all results", substring = true)).assertExists()
    onNodeWithTag("search-or-jump-field").performKeyInput { pressKey(androidx.compose.ui.input.key.Key.Enter) }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("one-box") == 0 }
    waitUntil(timeoutMillis = 3_000) { navigator.top == NavKeys.of("site.pages") }
    // Esc closes it.
    onNodeWithTag("search-or-jump-field").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("one-box") > 0 }
    onNodeWithTag("search-or-jump-field").performKeyInput { pressKey(androidx.compose.ui.input.key.Key.Escape) }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("one-box") == 0 }
  }

  @Test
  fun seeAllResultsOpensTheFullResultsInTheTab() = runComposeUiTest {
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("search-or-jump-field") > 0 }
    onNodeWithTag("search-or-jump-field").performClick()
    onNodeWithTag("search-or-jump-field").performTextInput("pages")
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("one-box-seeAll-see-all") > 0 }
    onNodeWithTag("one-box-seeAll-see-all").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("search-results") > 0 }
    assertEquals(0, onAllNodesWithTagCount("one-box"))
    onNodeWithTag("search-results-field").assertTextContains("pages")
  }

  @Test
  fun aDoubleClickOnTheTabRowZoomsTheWindow() = runComposeUiTest {
    var zooms = 0
    setContent {
      androidx.compose.runtime.CompositionLocalProvider(LocalWindowDoubleClick provides { zooms++ }) { AglynShell(testServices(userDoc = emptyMap())) }
    }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("tab-strip") > 0 }
    // The row's empty end, past the tabs and +, stands in for the title bar.
    onNodeWithTag("tab-strip").performTouchInput { doubleClick(androidx.compose.ui.geometry.Offset(width - 40f, height / 2f)) }
    waitUntil(timeoutMillis = 3_000) { zooms == 1 }
  }

  @Test
  fun aWindowThatDrawsItsCaptionPutsItsButtonsAndDragAreaInTheTabRow() = runComposeUiTest {
    val caption = WindowCaption { androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.testTag("caption-buttons")) }
    setContent {
      androidx.compose.runtime.CompositionLocalProvider(LocalWindowCaption provides caption) { AglynShell(testServices(userDoc = emptyMap())) }
    }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("caption-buttons") > 0 }
    onNodeWithTag("window-caption-drag").assertExists()
    waitUntil(timeoutMillis = 3_000) { caption.drag != null }
    // The drag area is the row's empty stretch: it starts after the tabs and the + button.
    assertTrue(caption.drag!!.left > 0f && caption.drag!!.right > caption.drag!!.left)
  }

  @Test
  fun aSiteIsDrilledIntoWithAWayBackAndASwitcher() = runComposeUiTest {
    setContent { AglynShell(testServices(userDoc = emptyMap())) }
    signIn()
    // Inside a site: "‹ Acme" back to the workspace, then the site's title row (Figma Sidebar 12:703, Scope = Site).
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("scope-back-to-workspace") > 0 }
    onNodeWithTag("scope-back-to-workspace").assertTextContains("Acme")
    onNodeWithTag("site-picker-button").assertTextContains("Acme Shop")
    // Its ▾ opens the switcher anchored under it, searchable; Esc closes it.
    onNodeWithTag("site-picker-button").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("site-switcher") > 0 }
    onNodeWithTag("site-switcher-search").assertExists()
    onNodeWithTag("site-switcher-all").assertExists()
    onNodeWithTag("site-switcher-search").performKeyInput { pressKey(androidx.compose.ui.input.key.Key.Escape) }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("site-switcher") == 0 }
    // Back slides out to the whole workspace.
    onNodeWithTag("scope-back-to-workspace").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("workspace-menu-button") > 0 && onAllNodesWithTagCount("site-picker-button") == 0 }
  }

  @Test
  fun groupRowsSitFurtherInThanTheirHeading() = runComposeUiTest {
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-group-website") > 0 }
    onNodeWithTag("nav-group-website").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-site-pages") > 0 }
    waitForIdle()
    // A top-level row's icon starts at the row padding; a grouped row's 12 further in (Figma: 8 / 20 at Compact).
    val home = onNodeWithTag("nav-site-home-icon", useUnmergedTree = true).fetchSemanticsNode().positionInRoot.x
    val pages = onNodeWithTag("nav-site-pages-icon", useUnmergedTree = true).fetchSemanticsNode().positionInRoot.x
    assertEquals(12f, (pages - home) / density.density, 0.5f)
    // One selection pill sits behind the selected row.
    onNodeWithTag("nav-site-pages").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-selection-pill") > 0 }
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
    onNodeWithTag("settings-mode-back").assertTextContains("Acme")
    onNodeWithTag("settings-mode-title").assertTextContains("Workspace settings")
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

  /**
   * On a phone, Menu › Website › Pages opens with its section tabs, and each tab swaps the area in place: Components,
   * Layouts, Templates and Content are one tap from Pages, never a screen deeper (AGL-3993).
   */
  @Test
  fun aPhonesMenuReachesEverySectionOfPages() = runDesktopComposeUiTest(width = 400, height = 820) {
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("tab-menu") > 0 }
    onNodeWithTag("tab-menu").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("phone-menu") > 0 }
    onNodeWithTag("nav-group-website").performClick()
    onNodeWithTag("nav-site-pages").performClick()
    waitUntil(timeoutMillis = 3_000) { navigator.top == NavKeys.of("site.pages") }
    onNodeWithTag("section-tabs").assertIsDisplayed()
    for (section in listOf("components", "layouts", "templates", "content", "pages")) {
      onNodeWithTag("section-$section").performClick()
      waitUntil(timeoutMillis = 3_000) { navigator.top == NavKeys.of("site.$section") }
      assertTrue(navigator.stack.isEmpty(), "site.$section is one tap from Pages, not pushed")
      onNodeWithTag("section-tabs").assertIsDisplayed()
    }
  }

  /**
   * On a phone, Aglyn AI is one tap away on every screen, as the tablet's and the desktop's title bar has it (AGL-4001):
   * the top bar's ✦ opens the AI sheet on a tab's first screen and on a pushed one, and the panel reads the place.
   */
  @Test
  fun aPhonesAiIsOneTapAwayOnEveryScreen() = runDesktopComposeUiTest(width = 400, height = 820) {
    val navigator = ShellNavigator()
    val params = mutableListOf<Map<String, String>>()
    val ai = com.aglyn.pluginhost.NativePluginManifestEntry("ai", mapOf("widgets" to listOf("ai.assist-panel"))) { registrar ->
      registrar.widget("ai.assist-panel", title = "Assist", order = 10, slot = ASSIST_PANEL_SLOT) {
        params += com.aglyn.pluginhost.LocalSlotParams.current
        androidx.compose.material3.Text("The panel", androidx.compose.ui.Modifier.testTag("fake-assist"))
      }
    }
    setContent { AglynShell(testServices(userDoc = emptyMap(), plugins = listOf(ai)), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("phone-ai") > 0 }
    onNodeWithTag("phone-ai").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("fake-assist") > 0 }
    // The sheet is titled with the brand's name, as Figma and the Apple apps have it, and reads Home in the site.
    onNodeWithText("Aglyn AI").assertExists()
    val home = params.last()
    assertEquals("Home", home["place"])
    assertEquals("home", home["icon"])
    assertEquals("Acme Shop", home["scope"])
    onNodeWithTag("ai-sheet-close").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("fake-assist") == 0 }
    // A pushed screen keeps the top bar's ✦ under its back arrow.
    navigator.push(Route.Screen("site.pages"))
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("title-back") > 0 }
    onNodeWithTag("phone-ai").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("fake-assist") > 0 }
  }

  @Test
  fun theCreateMenuListsTheManifestsItemsForTheScope() = runComposeUiTest {
    setContent { AglynShell(testServices(userDoc = emptyMap())) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("rail-create") > 0 }
    onNodeWithTag("rail-create").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("create-page") > 0 }
    onNodeWithTag("create-page").assertIsDisplayed()
    // No plugin is on in this site, so no plugin's item is offered, and the console has no "Booking" create.
    assertEquals(0, onAllNodesWithTagCount("create-product"))
    assertEquals(0, onAllNodesWithTagCount("create-booking"))
  }

  @Test
  fun createIsGatedByTheMembersStampElseTheirRole() {
    // The role's grants, then a custom role's values, then the member's own overrides (the console's resolver).
    val owner = memberPermissions(mapOf("role" to "owner", "permissions" to mapOf("hosts.create" to false)), "owner")
    assertEquals(false, owner["hosts.create"])
    assertEquals(true, owner["data.manage"])
    val editor = memberPermissions(mapOf("role" to "editor"), "editor")
    assertEquals(true, editor["data.manage"])
    assertEquals(false, editor["hosts.create"])
    val custom = memberPermissions(mapOf("role" to "viewer", "roleId" to "r1"), "viewer", mapOf("permissions" to mapOf("hosts.create" to true)))
    assertEquals(true, custom["hosts.create"])
    assertEquals(false, memberPermissions(null, "viewer")["hosts.create"])
    assertEquals("admin", createHostRole("author", "owner"))
    assertEquals("author", createHostRole("author", "editor"))
  }

  @Test
  fun pinningFromThePickerWritesTheAccountsPins() = runComposeUiTest {
    val writes = Writes()
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap(), writer = writes), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("workspace-rail") > 0 }
    runOnIdle { navigator.command = ShellCommand.SWITCH_WORKSPACE }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("picker-pin-o1") > 0 }
    onNodeWithTag("picker-pin-o1").performClick()
    waitUntil(timeoutMillis = 3_000) { writes.all.any { "pinnedOrgs" in it.second } }
    assertEquals("users/u1" to mapOf("pinnedOrgs" to listOf("o1")), writes.all.last { "pinnedOrgs" in it.second })
    onNodeWithTag("picker-pin-o1").assertTextContains("Pinned", substring = true)
  }

  @Test
  fun aWorkspacePickedFromThePickerOpensOnItsHome() = runComposeUiTest {
    // Picked from "All workspaces" while a site page is open, a workspace lands on its Home, as a rail tile does, never
    // on "Pick a site first" (driven on the tablet: Orders, then Harbor Light Yoga from the picker).
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-site-overview") > 0 }
    onNodeWithTag("nav-group-website").performClick()
    onNodeWithTag("nav-site-pages").performClick()
    waitUntil(timeoutMillis = 3_000) { navigator.top != ShellNavigator.HOME }
    runOnIdle { navigator.command = ShellCommand.SWITCH_WORKSPACE }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("picker-org-o1") > 0 }
    onNodeWithTag("picker-org-o1").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("scope-picker") == 0 }
    waitUntil(timeoutMillis = 3_000) { navigator.top == ShellNavigator.HOME }
  }

  @Test
  fun aTabKeepsItsScreenWholeAndWearsItsIcon() = runDesktopComposeUiTest(width = 1280, height = 800) {
    // Figma Titlebar/Tab 8:111, Apple's rule: the screen's name stays whole; the site before it truncates first.
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-site-overview") > 0 }
    runOnIdle { navigator.command = ShellCommand.NEW_TAB }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("tab-1") > 0 }
    onNodeWithTag("nav-group-website").performClick()
    onNodeWithTag("nav-site-pages").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodes(androidx.compose.ui.test.hasTestTag("tab-1") and androidx.compose.ui.test.hasText("Pages", substring = true)).fetchSemanticsNodes().isNotEmpty() }
    onNode(androidx.compose.ui.test.hasText("Pages") and androidx.compose.ui.test.hasAnyAncestor(androidx.compose.ui.test.hasTestTag("tab-title-1")), useUnmergedTree = true).assertIsDisplayed()
    onNode(androidx.compose.ui.test.hasText("Acme Shop — ") and androidx.compose.ui.test.hasAnyAncestor(androidx.compose.ui.test.hasTestTag("tab-title-1")), useUnmergedTree = true).assertExists()
  }

  @Test
  fun aShortWindowStillReachesTheSidebarsLastRow() = runDesktopComposeUiTest(width = 1280, height = 420) {
    // The rows scroll above the foot (the plan card), so the card never covers Site settings.
    setContent { AglynShell(testServices(userDoc = emptyMap())) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-site-siteSettings") > 0 }
    onNodeWithTag("nav-group-website").performClick()
    onNodeWithTag("nav-site-siteSettings").performScrollTo().assertIsDisplayed()
    val row = onNodeWithTag("nav-site-siteSettings").getBoundsInRoot()
    val sidebar = onNodeWithTag("nav-sidebar").getBoundsInRoot()
    assertTrue(row.bottom <= sidebar.bottom, "Site settings ends at ${row.bottom}, the sidebar at ${sidebar.bottom}")
  }

  @Test
  fun tabsKeepTheirOwnPlaceAndReopenWhenClosed() = runComposeUiTest {
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-site-overview") > 0 }
    // The title bar carries the pinned Home tab; the desktop's menu bar opens another (Tab ▸ New tab).
    assertEquals(0, onAllNodesWithTagCount("tab-1"))
    runOnIdle { navigator.command = ShellCommand.NEW_TAB }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("tab-1") > 0 }
    onNode(androidx.compose.ui.test.hasTestTag("tab-0") and androidx.compose.ui.test.hasContentDescription("Home", substring = true)).assertExists()
    onNodeWithTag("nav-group-website").performClick()
    onNodeWithTag("nav-site-pages").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodes(androidx.compose.ui.test.hasTestTag("tab-1") and androidx.compose.ui.test.hasText("Pages", substring = true)).fetchSemanticsNodes().isNotEmpty() }
    // The Home tab kept its own place.
    assertEquals(ShellNavigator.HOME, navigator.top)
    onNodeWithTag("tab-0").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("home") > 0 }
    // The pinned Home tab never closes.
    runOnIdle { navigator.command = ShellCommand.CLOSE_TAB }
    waitForIdle()
    onNodeWithTag("tab-1").assertIsDisplayed()
    // Closing the other tab drops the strip; Reopen brings it back where it was.
    onNodeWithTag("tab-close-1").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("tab-1") == 0 }
    runOnIdle { navigator.command = ShellCommand.REOPEN_TAB }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("tab-1") > 0 }
    onNodeWithTag("tab-1").assertTextContains("Pages", substring = true)
    runOnIdle { navigator.command = ShellCommand.TAB_OVERVIEW }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("tab-overview-dialog") > 0 }
    onNodeWithTag("overview-tab-0").assertIsDisplayed()
    onNodeWithTag("overview-tab-1").assertIsDisplayed()
  }

  @Test
  fun aTabKeepsItsOwnScopeWhileAnotherMoves() = runComposeUiTest {
    val navigator = ShellNavigator()
    val services = testServices(userDoc = emptyMap())
    setContent { AglynShell(services, navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { services.workspace.state.value.site?.id == "h1" }
    runOnIdle { navigator.command = ShellCommand.NEW_TAB }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("tab-1") > 0 }
    // The new tab goes to the whole workspace; the first tab stays in its site.
    runOnIdle { services.workspace.selectWholeWorkspace() }
    waitUntil(timeoutMillis = 3_000) { services.workspace.state.value.site == null }
    onNodeWithTag("tab-0").performClick()
    waitUntil(timeoutMillis = 3_000) { services.workspace.state.value.site?.id == "h1" }
    onNodeWithTag("tab-1").performClick()
    waitUntil(timeoutMillis = 3_000) { services.workspace.state.value.site == null && services.workspace.state.value.org?.id == "o1" }
  }

  @Test
  fun theTitleBarHasHelpAndTheShortcutsList() = runComposeUiTest {
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("title-bar") > 0 }
    runOnIdle { navigator.command = ShellCommand.SHORTCUTS }
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("keyboard-shortcuts") > 0 }
    onNodeWithText("Reopen the last closed tab").assertIsDisplayed()
  }

  @Test
  fun helpDocsOpensThePageOfTheRowOnScreen() = runComposeUiTest {
    val navigator = ShellNavigator()
    setContent { AglynShell(testServices(userDoc = emptyMap()), navigator) }
    signIn()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("scope-back-to-workspace") > 0 }
    onNodeWithTag("scope-back-to-workspace").performClick()
    waitUntil(timeoutMillis = 3_000) { onAllNodesWithTagCount("nav-workspace-sites") > 0 }
    onNodeWithTag("nav-workspace-sites").performClick()
    onNodeWithTag("help-button").performClick()
    onNodeWithTag("help-docs").performClick()
    waitUntil(timeoutMillis = 3_000) { navigator.current is Route.Web }
    assertEquals("https://docs.aglyn.com/getting-started/console-tour#the-sites-list", (navigator.current as Route.Web).url)
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
