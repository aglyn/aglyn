package com.aglyn.pluginhost

import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PluginHostTest {
  private lateinit var registry: NativePluginRegistry

  @BeforeTest
  fun reset() {
    registry = NativePluginRegistry()
  }

  private fun NativePluginRegistrar.list(id: String) = screen(id, title = id) { _, _ -> }

  @Test
  fun refusesASecondRegistrationOfTheSameId() {
    registry.registrarFor("a").list("a.list")
    val error = assertFailsWith<IllegalArgumentException> {
      registry.registrarFor("b").add(NativeScreen("b", "a.list", "x") { _, _ -> })
    }
    assertTrue(error.message!!.contains("already registered"))
  }

  @Test
  fun holdsAQuickActionToExactlyOneTarget() {
    val r = registry.registrarFor("a")
    assertTrue(assertFailsWith<IllegalArgumentException> { r.quickAction("a.go", "Go", "add", 1) }.message!!.contains("exactly one"))
    assertTrue(
      assertFailsWith<IllegalArgumentException> { r.quickAction("a.go", "Go", "add", 1, screen = "a.list", consolePath = "/a") }
        .message!!.contains("exactly one"),
    )
    r.quickAction("a.go", "Go", "add", 1, screen = "a.list")
  }

  @Test
  fun refusesADeepLinkThatIsNotAConsolePath() {
    val error = assertFailsWith<IllegalArgumentException> { registry.registrarFor("a").deepLink("a.link", "a", "a.list") }
    assertTrue(error.message!!.contains("starts with"))
  }

  private fun entry(
    id: String = "a",
    contributes: Map<String, List<String>> = mapOf("screens" to listOf("a.list")),
    register: (NativePluginRegistrar) -> Unit = { it.list("a.list") },
  ) = NativePluginManifestEntry(id, contributes, register)

  @Test
  fun loadsAPluginWhoseRegistrarMatchesItsDeclaration() {
    assertEquals(PluginLoadResult(listOf("a"), emptyList()), registry.load(listOf(entry())))
    assertEquals("a", registry.screen("a.list")?.pluginId)
  }

  @Test
  fun refusesAnUndeclaredRegistrationAndKeepsLoadingTheOthers() {
    val result = registry.load(
      listOf(
        entry(register = { it.tab("a.tab", "A", "x", "a.list", 1) }),
        entry(id = "b", contributes = mapOf("screens" to listOf("b.list")), register = { it.list("b.list") }),
      ),
    )
    assertEquals(listOf("b"), result.loaded)
    assertEquals("a", result.failed[0].pluginId)
    assertTrue(result.failed[0].error.contains("does not declare"))
  }

  @Test
  fun refusesARegistrationUnderAnotherPluginId() {
    val result = registry.load(listOf(entry(register = { it.add(NativeScreen("b", "a.list", "x") { _, _ -> }) })))
    assertTrue(result.failed[0].error.contains("registers only its own"))
  }

  @Test
  fun reportsADeclaredIdTheRegistrarNeverRegistered() {
    val result = registry.load(listOf(entry(contributes = mapOf("screens" to listOf("a.list"), "widgets" to listOf("a.card")))))
    assertTrue(result.failed[0].error.contains("never registers widgets \"a.card\""))
    assertEquals(emptyList(), registry.widgets())
    // A plugin that failed halfway leaves nothing behind.
    assertNull(registry.screen("a.list"))
  }

  @Test
  fun reportsARegistrarThatThrows() {
    val result = registry.load(listOf(entry(register = { error("offline") })))
    assertEquals(listOf(PluginLoadFailure("a", "offline")), result.failed)
  }

  @Test
  fun filtersContributionsByApp() {
    val r = registry.registrarFor("a")
    r.quickAction("a.one", "One", "x", 2, screen = "a.list")
    r.quickAction("a.pos", "Pos", "x", 1, screen = "a.list", apps = setOf(NativeApp.POS))
    assertEquals(listOf("a.one"), registry.quickActions(NativeApp.AGLYN).map { it.id })
    assertEquals(listOf("a.pos", "a.one"), registry.quickActions().map { it.id })
  }
}

class DeepLinksTest {
  private val links = listOf(
    NativeDeepLink("r", "r.page", "/redirects", "r.list"),
    NativeDeepLink("r", "r.one", "/redirects/:id", "r.detail"),
  )

  @Test
  fun opensASitePageAPluginAnswersNativelyWithTheScopeAsParams() {
    assertEquals(
      NativeLinkTarget.Screen("r.detail", mapOf("tab" to "x", "orgSlug" to "acme", "hostSlug" to "shop", "id" to "r 1")),
      DeepLinks.resolve("https://app.aglyn.com/acme/hosts/shop/redirects/r%201?tab=x", links),
    )
    assertEquals("r.list", (DeepLinks.resolve("aglyn://acme/hosts/shop/redirects", links) as NativeLinkTarget.Screen).screen)
  }

  @Test
  fun opensEveryOtherConsolePathInTheConsoleAndRefusesWhatIsNotAConsoleLink() {
    assertEquals(NativeLinkTarget.Console("/acme/hosts/shop/besigner"), DeepLinks.resolve("/acme/hosts/shop/besigner", links))
    assertNull(DeepLinks.resolve("//evil.example/x", links))
    assertNull(DeepLinks.resolve("javascript:alert(1)", links))
    assertNull(DeepLinks.consolePathOf(""))
  }

  @Test
  fun treatsTheConsoleTopLevelSectionsAsUnscoped() {
    assertEquals(ConsoleScopeSplit(rest = "/billing/plans"), DeepLinks.splitConsoleScope("/billing/plans"))
    assertEquals(ConsoleScopeSplit(orgSlug = "acme", rest = "/crm"), DeepLinks.splitConsoleScope("/acme/crm"))
  }

  @Test
  fun scopesAPluginPathUnderThePick() {
    assertEquals("/acme/hosts/shop/redirects", scopedConsolePath("/redirects", ConsoleScope.SITE, "acme", "shop"))
    assertEquals("/acme/hosts", scopedConsolePath("/redirects", ConsoleScope.SITE, "acme", null))
    assertEquals("/acme", scopedConsolePath("/", ConsoleScope.ORG, "acme", "shop"))
    assertEquals("/", scopedConsolePath("/x", ConsoleScope.ORG, null, null))
    assertEquals("/x", scopedConsolePath("x", ConsoleScope.ABSOLUTE, null, null))
  }
}

class ConsoleScreenTest {
  @Test
  fun registersADeclaredScreenTheConsoleServes() {
    val registry = NativePluginRegistry()
    registry.registrarFor("a").consoleScreen("a.orders", "Orders", "/commerce/orders")
    val screen = registry.screen("a.orders")!!
    assertEquals("/commerce/orders", screen.consolePath)
    assertEquals(ConsoleScope.SITE, screen.consoleScope)
    assertTrue(screen.requiresSite)
    assertEquals("/acme/hosts/shop/commerce/orders", scopedConsolePath(screen.consolePath!!, screen.consoleScope, "acme", "shop"))
  }

  @Test
  fun refusesAConsoleScreenThatIsNotAConsolePath() {
    val error = assertFailsWith<IllegalArgumentException> {
      NativePluginRegistry().registrarFor("a").consoleScreen("a.orders", "Orders", "commerce/orders")
    }
    assertTrue(error.message!!.contains("starts with /"))
  }
}
