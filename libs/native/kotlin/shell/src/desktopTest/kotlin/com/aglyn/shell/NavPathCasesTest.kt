package com.aglyn.shell

import com.aglyn.contracts.AccountItemRef
import com.aglyn.contracts.NativeNavConsoleRef
import com.aglyn.contracts.NativeNavConsoleSurface
import com.aglyn.contracts.NativeNavGroup
import com.aglyn.contracts.NativeNavIcon
import com.aglyn.contracts.NativeNavListId
import com.aglyn.contracts.NativeNavRow
import com.aglyn.contracts.ResolvedNavList
import com.aglyn.pluginhost.DeepLinks
import com.aglyn.pluginhost.NativeDeepLink
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.pluginhost.NavArea
import com.aglyn.pluginhost.NavPath
import com.aglyn.pluginhost.NavPathMode
import com.aglyn.pluginhost.NavPaths
import com.aglyn.pluginhost.NavShellPage
import com.aglyn.pluginhost.NavStep
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Every way into a place lands where a link to it does (AGL-4059): a link, an App Link and an `aglyn://` link, a
 * notification, a push, a search row, a Starred and a Recent item and a screens-and-settings match each give the same
 * path, the levels navigating there by hand passes, against the real nav manifest. The cases are shared with the Apple kit
 * (`libs/native/contracts/nav-path-cases.json`).
 */
class NavPathCasesTest {
  private val fixture = Json.parseToJsonElement(File(System.getProperty("aglyn.contractsDir"), "nav-path-cases.json").readText()).jsonObject

  private val routes = fixture.getValue("routes").jsonArray.map {
    val route = it.jsonObject
    val path = route.text("path")!!
    NativeDeepLink("fixture", path, path, route.text("screen")!!)
  }

  private val lists = run {
    val rows = fixture.getValue("staff").jsonArray.map { id ->
      val screen = id.jsonPrimitive.content
      NativeNavRow(console = NativeNavConsoleRef(screen, NativeNavConsoleSurface.NATIVE_ONLY), icon = NativeNavIcon("", ""), id = screen, label = screen, screen = screen)
    }
    NavPaths.lists(staff = ResolvedNavList(listOf(NativeNavGroup(foldable = false, id = "staff", rows = rows)), NativeNavListId.UNKNOWN)) { true }
  }

  @Test
  fun everyEntryPointLandsWhereALinkWould() {
    var entries = 0
    for (case in fixture.getValue("cases").jsonArray.map { it.jsonObject }) {
      val name = case.text("name")
      val expected = path(case.getValue("expect").jsonObject)
      val stays = case.getValue("expect").jsonObject["starredRowStays"]?.jsonPrimitive?.booleanOrNull
      assertEquals(stays, expected.keepsStarredRow, "$name: the starred row stays selected")
      for (entry in case.getValue("entries").jsonArray.map { it.jsonObject }) {
        val via = entry.text("via")
        assertEquals(expected, open(entry)?.unscoped, "$name, via $via")
        scopeOf(entry)?.let { assertEquals(case.text("scope"), it, "$name, via $via: the scope it opens on") }
        entries += 1
      }
    }
    assertTrue(entries > 50, "the fixture's entries")
  }

  /** A link that names a workspace and site opens on them; one that names none opens where the window stands. */
  @Test
  fun aLinkNamesTheWorkspaceAndSiteItOpensOn() {
    val site = NavPaths.link("https://console.example.com/acme/hosts/shop/products/orders?order=o1", routes, lists, inSite = false)
    assertEquals("acme", site?.scope?.orgSlug)
    assertEquals("shop", site?.scope?.hostSlug)
    val workspace = NavPaths.link("/acme/crm/leads/l1", routes, lists, inSite = true)
    assertEquals("acme", workspace?.scope?.orgSlug)
    assertNull(workspace?.scope?.hostSlug)
    assertEquals(NavPath(area = NavArea.Shell(NavShellPage.NOTIFICATIONS)), NavPaths.link("/manage/notifications", routes, lists, inSite = true)?.path)
    assertNull(NavPaths.link("javascript:alert(1)", routes, lists, inSite = true))
  }

  /** A screen the build lacks is no area: the place opens over Home with the levels on the way to it. */
  @Test
  fun aPlaceWithNoRowOpensOverHomeWithItsLevels() {
    val trimmed = NavPaths.lists { !it.startsWith("commerce.") }
    assertEquals(
      NavPath(
        area = NavArea.Shell(NavShellPage.HOME),
        pushed = listOf(NavStep.Screen("commerce.products"), NavStep.Screen("commerce.orders"), NavStep.Screen("commerce.order", mapOf("order" to "o1", "orderId" to "o1"))),
      ),
      NavPaths.link("/acme/hosts/shop/products/orders?order=o1", routes, trimmed, inSite = true)?.path?.unscoped,
    )
  }

  @Test
  fun aConsoleAddressIsTheRouteThatTakesTheMostOfThePlace() {
    assertEquals("/screens", NavPaths.consoleAddress("site.pages", emptyMap(), routes))
    assertEquals("/screens/s%201", NavPaths.consoleAddress("site.pages", mapOf("screenId" to "s 1"), routes))
    assertEquals("/products/orders?order=o1", NavPaths.consoleAddress("commerce.order", mapOf("orderId" to "o1"), routes))
    assertEquals("/marketplace/payouts", NavPaths.consoleAddress("marketplace.sell", mapOf("section" to "payouts"), routes))
    assertNull(NavPaths.consoleAddress("marketplace.sell", mapOf("section" to "upload"), routes))
    assertNull(NavPaths.consoleAddress("commerce.order", emptyMap(), routes))
    assertEquals("marketplace", NavPaths.searchRowId("workspace.marketplace.payouts"))
    assertEquals("seo", NavPaths.searchRowId("siteSettings.seo"))
    assertNull(NavPaths.searchRowId("seo"))
  }

  /** The platform's own routes (Sites, Pages, Setup, the core spec screens) place a page and a setting as the cases do. */
  @Test
  fun thePlatformsOwnRoutesPlaceAPageAndASetting() {
    val platform = NativePluginRegistry().also { it.load(PLATFORM_ENTRIES) }.deepLinks()
    val all = NavPaths.lists { true }
    assertEquals(
      NavPath(area = NavArea.Row("pages", "site.pages"), pushed = listOf(NavStep.Screen("site.pages", mapOf("screenId" to "s1")))),
      NavPaths.link("/acme/hosts/shop/screens/s1", platform, all, inSite = false)?.path?.unscoped,
    )
    assertEquals(
      NavPath(NavPathMode.SITE_SETTINGS, NavArea.Row("seo", "site.setup", mapOf("section" to "seo"))),
      NavPaths.link("/acme/hosts/shop/setup/seo", platform, all, inSite = false)?.path?.unscoped,
    )
    assertNotNull(NavPaths.consoleAddress("site.pages", mapOf("screenId" to "s1"), platform))
  }

  /**
   * A workspace-only place opened from inside a site leaves for the whole workspace, as on the Mac and iPhone: its scope is
   * not settled while the site is on screen, and the pick is the workspace with no site.
   */
  @Test
  fun aWorkspacePlaceFromInsideASiteLeavesForTheWholeWorkspace() {
    val scope = linkScopeOf("/acme/marketplace/payouts", inSite)!!
    assertTrue(scope.whole)
    kotlin.test.assertFalse(linkScopeSettled(scope, inSite))
    assertEquals("org-acme" to null, linkScopePick(scope, inSite))
    val whole = inSite.copy(site = null, wholeWorkspace = true)
    assertTrue(linkScopeSettled(scope, whole))
    assertNull(linkScopePick(scope, whole))
    val payouts = AccountItemRef(id = "marketplace", kind = "screen", label = "Payouts", orgId = "org-acme", params = mapOf("section" to "payouts"), screen = "marketplace.sell")
    kotlin.test.assertFalse(linkScopeSettled(placeScope(payouts), inSite))
    // A site's own place, opened from that site, is already there.
    assertTrue(linkScopeSettled(placeScope(payouts.copy(hostId = "h1", id = "orders", screen = "commerce.orders", params = null)), inSite))
  }

  /** The workspace and site the entries are opened from: the case table's site, on screen. */
  private val inSite = run {
    val org = com.aglyn.core.WorkspaceOrg("org-acme", "Acme", "acme", "owner")
    val site = com.aglyn.core.WorkspaceSite("h1", "org-acme", "Shop", "shop", "admin")
    com.aglyn.core.WorkspaceState(orgs = listOf(org), sites = listOf(site), org = org, site = site, ready = true)
  }

  /** Where an entry opens: `site`, `workspace` (the whole workspace) or `unchanged`; null for a search row (the scope in use). */
  private fun scopeOf(entry: JsonObject): String? {
    fun name(scope: LinkScope?) = when {
      scope == null -> "unchanged"
      scope.whole -> "workspace"
      else -> "site"
    }
    val link = entry.text("link")
    return when (entry.text("via")) {
      "link", "universal", "aglyn", "search" -> name(link?.let { linkScopeOf(it, inSite) })
      "notification", "push" -> {
        val stored = DeepLinks.notificationLink(link, entry.text("orgSlug"), entry.text("hostId"), entry.text("hostSubdomain"))
        if (entry.text("orgSlug") == null || stored?.let { linkScopeOf(it, inSite) } == null) {
          name(stored?.let { linkScopeOf(it, inSite) })
        } else {
          name(notificationScope("org-acme", entry.text("hostId"), stored, inSite))
        }
      }
      "starred", "recent" -> name(placeScope(Json.decodeFromJsonElement(AccountItemRef.serializer(), entry.getValue("item"))))
      else -> null
    }
  }

  // Replaying an entry

  private fun open(entry: JsonObject): NavPath? {
    val link = entry.text("link")
    return when (entry.text("via")) {
      "link", "universal", "aglyn", "search" -> NavPaths.link(link, routes, lists, inSite = false)?.path
      "notification", "push" -> NavPaths.link(
        DeepLinks.notificationLink(link, entry.text("orgSlug"), entry.text("hostId"), entry.text("hostSubdomain")), routes, lists, inSite = false,
      )?.path
      "starred", "recent" -> NavPaths.place(Json.decodeFromJsonElement(AccountItemRef.serializer(), entry.getValue("item")), routes, lists)
      "searchScreen" -> NavPaths.place(
        entry.text("screen")!!, entry.params("params"), entry.text("rowId")?.let(NavPaths::searchRowId),
        entry["inSite"]?.jsonPrimitive?.booleanOrNull ?: false, routes, lists,
      )
      else -> null
    }
  }

  private fun path(json: JsonObject): NavPath {
    val mode = NavPathMode.entries.first { it.raw == json.text("mode") }
    val area = json.getValue("area").jsonObject
    val navArea = area.text("shell")?.let { shell -> NavArea.Shell(NavShellPage.entries.first { it.raw == shell }) }
      ?: NavArea.Row(area.text("row")!!, area.text("screen")!!, area.params("params"))
    val pushed = (json["pushed"] as? JsonArray).orEmpty().map { it.jsonObject }.map { step ->
      step.text("screen")?.let { NavStep.Screen(it, step.params("params")) }
        ?: step.text("besigner")?.let { NavStep.Besigner(it) }
        ?: NavStep.Unavailable(step.text("unavailable")!!)
    }
    return NavPath(mode, navArea, pushed)
  }

  private fun JsonObject.text(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull

  private fun JsonObject.params(key: String): Map<String, String> =
    (this[key] as? JsonObject)?.mapValues { it.value.jsonPrimitive.content }.orEmpty()
}
