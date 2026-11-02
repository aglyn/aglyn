package com.aglyn.plugins.marketplace

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.runDesktopComposeUiTest
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.KeyValueStore
import com.aglyn.core.Live
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.NativeWidget
import com.aglyn.pluginhost.StarterPickerZone
import com.aglyn.pluginhost.WidgetSize
import com.aglyn.site.sites.SitesScreen
import com.aglyn.ui.AglynTheme
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Create site with the marketplace's starters (AGL-4049), driven through the real Sites screen and this plugin's widget in its
 * zone. Nothing is picked when it opens; a free or owned pick creates at once; a paid one goes to the web; and a workspace
 * the starters are not offered to, or that has none, gets the styles.
 */
@OptIn(ExperimentalTestApi::class)
class StarterPickerUiTest {
  private val free = """{"listingId":"fp-starter-trades-base","displayName":"Home services & trades","authorName":"Aglyn","official":true,"priceUsd":0,"previewImageUrl":null,"facets":{"kind":"trades","pages":5,"mode":"base"}}"""
  private val paid = """{"listingId":"north-bakery","displayName":"Northwind Bakery","authorName":"Northwind","priceUsd":12,"owned":false,"previewImageUrl":null,"facets":{"pages":3,"mode":"base"}}"""
  private val owned = """{"listingId":"north-owned","displayName":"Northwind Studio","authorName":"Northwind","priceUsd":12,"owned":true,"previewImageUrl":null,"facets":{"pages":2,"mode":"base"}}"""
  private val ai = """{"listingId":"fp-starter-trades-ai","displayName":"Trades, with AI","authorName":"Aglyn","priceUsd":0,"previewImageUrl":null,"facets":{"kind":"trades","pages":0,"mode":"ai"}}"""

  private class Owner(private val reader: FirestoreReader, override val api: ConsoleApiClient, private val staff: Boolean) : NativePluginContext {
    val opened = mutableListOf<String>()
    override val uid = "u1"
    override val orgId = "o1"
    override val hostId: String? = null
    override val orgSlug = "acme"
    override val hostSlug: String? = null
    override val orgRole = "owner"
    override val firestore = reader
    override val deviceStore = object : KeyValueStore {
      override fun get(key: String): String? = null
      override fun set(key: String, value: String?) {}
    }
    override suspend fun isStaff() = staff
    override fun selectSite(hostId: String) {
      opened += hostId
    }
    override fun navigate(screenId: String, params: NativeParams) {}
    override fun openBesigner(path: String, scope: ConsoleScope) = false
    override fun slotWidgets(slot: String) =
      if (slot == StarterPickerZone.SLOT) {
        listOf(NativeWidget("marketplace", "marketplace.starter-picker", "Choose your starter", 10, WidgetSize.FULL, false, setOf(NativeApp.AGLYN), slot) { StarterPickerWidget(it) })
      } else {
        emptyList()
      }
  }

  private fun orgReader(flags: String?) = object : FirestoreReader {
    override suspend fun get(path: String): FirestoreDoc? =
      if (path == "orgs/o1" && flags != null) FirestoreDoc("o1", path, mapOf("releaseFlags" to mapOf(flags to true))) else null
    override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
  }

  private class Seen {
    val paths = mutableListOf<String>()
    var created: String? = null
    val urls = mutableListOf<String>()
  }

  private fun owner(seen: Seen, rows: (String) -> Pair<Int, String>, staff: Boolean = true, flags: String? = null): Owner {
    val json = headersOf(HttpHeaders.ContentType, "application/json")
    val engine = MockEngine { request ->
      val path = request.url.encodedPath
      seen.paths += request.url.toString()
      when (path) {
        "/api/marketplace/starters" -> rows(request.url.parameters["mode"].orEmpty()).let { (status, body) -> respond(body, HttpStatusCode.fromValue(status), json) }
        "/api/hosts/create" -> {
          seen.created = String((request.body as OutgoingContent.ByteArrayContent).bytes())
          respond("""{"hostId":"h9","subdomain":"my-shop"}""", headers = json)
        }
        else -> respond("{}", headers = json)
      }
    }
    return Owner(orgReader(flags), ConsoleApiClient("http://localhost", HttpClient(engine) { expectSuccess = false }, { "t" }, sleep = {}), staff)
  }

  private fun ComposeUiTest.open(context: Owner, seen: Seen) {
    setContent {
      CompositionLocalProvider(
        LocalUriHandler provides object : UriHandler {
          override fun openUri(uri: String) {
            seen.urls += uri
          }
        },
      ) { AglynTheme(dark = false) { SitesScreen(context, startNew = true) } }
    }
  }

  private fun ComposeUiTest.see(tag: String) {
    waitUntil(timeoutMillis = 5_000) { onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty() }
  }

  private fun ComposeUiTest.toRow(tag: String) {
    see(tag)
    onNodeWithTag("option-card-list").performScrollToNode(hasTestTag(tag))
  }

  @Test
  fun nothingIsPickedAndAFreePickCreatesFromTheListingWithNoStyle() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val seen = Seen()
    val context = owner(seen, { 200 to """{"rows":[$free,$paid],"labels":{}}""" })
    open(context, seen)
    toRow("starter-fp-starter-trades-base")
    onNodeWithTag("starter-fp-starter-trades-base").assertIsNotSelected()
    onNodeWithTag("starter-north-bakery").assertIsNotSelected()
    onNodeWithTag("site-name").performTextInput("My Shop")
    onNodeWithTag("create-site-confirm").assertIsNotEnabled()
    // Nothing of the styles is left in the sheet.
    onNodeWithTag("site-style-required").assertDoesNotExist()
    onNodeWithTag("site-starter-required").assertIsDisplayed()

    toRow("starter-fp-starter-trades-base")
    onNodeWithTag("starter-fp-starter-trades-base").performClick()
    onNodeWithTag("starter-fp-starter-trades-base").assertIsSelected()
    onNodeWithTag("site-starter-required").assertDoesNotExist()
    onNodeWithTag("create-site-confirm").assertIsEnabled()
    onNodeWithTag("create-site-confirm").performClick()
    waitUntil(timeoutMillis = 5_000) { context.opened.isNotEmpty() }
    assertEquals(listOf("h9"), context.opened)
    val body = Json.parseToJsonElement(seen.created.orEmpty()).jsonObject
    assertEquals("fp-starter-trades-base", body["starter"]?.jsonObject?.get("listingId")?.jsonPrimitive?.content)
    assertEquals("starter", body["start"]?.jsonPrimitive?.content)
    assertFalse("style" in body)
  }

  @Test
  fun aPaidPickSaysItsPriceAndGoesToTheWeb() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val seen = Seen()
    val context = owner(seen, { 200 to """{"rows":[$free,$paid],"labels":{}}""" })
    open(context, seen)
    onNodeWithTag("site-name").performTextInput("My Shop")
    toRow("starter-north-bakery")
    onNodeWithText("$12").assertIsDisplayed()
    onNodeWithTag("starter-north-bakery").performClick()
    onNodeWithText("Northwind Bakery costs $12. Buy it on the web, then create your site from it.").assertIsDisplayed()
    onNodeWithTag("create-site-confirm").assertIsNotEnabled()
    onNodeWithTag("starter-web").performClick()
    waitUntil(timeoutMillis = 5_000) { seen.urls.isNotEmpty() }
    assertEquals(listOf("http://localhost/acme/hosts?create=site&starter=north-bakery"), seen.urls)
    assertEquals(null, seen.created)
  }

  @Test
  fun anOwnedPickCreatesAtOnce() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val seen = Seen()
    val context = owner(seen, { 200 to """{"rows":[$owned],"labels":{}}""" })
    open(context, seen)
    onNodeWithTag("site-name").performTextInput("My Shop")
    toRow("starter-north-owned")
    onNodeWithText("Owned").assertIsDisplayed()
    onNodeWithTag("starter-north-owned").performClick()
    onNodeWithText("You own this starter. Create your site from it whenever you are ready.").assertIsDisplayed()
    onNodeWithTag("create-site-confirm").assertIsEnabled()
  }

  @Test
  fun anAiPickGoesToTheWebAndNothingCarriesAcross() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val seen = Seen()
    val context = owner(seen, { mode -> 200 to (if (mode == "ai") """{"rows":[$ai],"labels":{}}""" else """{"rows":[$free],"labels":{}}""") })
    open(context, seen)
    onNodeWithTag("site-name").performTextInput("My Shop")
    toRow("starter-fp-starter-trades-base")
    onNodeWithTag("starter-fp-starter-trades-base").performClick()
    onNodeWithTag("create-site-confirm").assertIsEnabled()
    onNodeWithTag("starter-mode-ai").performClick()
    toRow("starter-fp-starter-trades-ai")
    // Another kind of starter is another list.
    onNodeWithTag("create-site-confirm").assertIsNotEnabled()
    onNodeWithTag("starter-fp-starter-trades-ai").assertIsNotSelected()
    onNodeWithTag("starter-fp-starter-trades-ai").performClick()
    onNodeWithTag("create-site-confirm").assertIsNotEnabled()
    onNodeWithText("Continue on the web").performClick()
    waitUntil(timeoutMillis = 5_000) { seen.urls.isNotEmpty() }
    assertEquals(listOf("http://localhost/acme/hosts?create=site&starter=fp-starter-trades-ai"), seen.urls)
  }

  @Test
  fun aWorkspaceTheStartersAreNotOfferedToGetsTheStyles() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val seen = Seen()
    val context = owner(seen, { 200 to """{"rows":[$free],"labels":{}}""" }, staff = false)
    open(context, seen)
    see("site-style-required")
    onNodeWithTag("option-card-business").assertIsNotSelected()
    onNodeWithTag("starter-list").assertDoesNotExist()
    assertTrue(seen.paths.none { "/api/marketplace/starters" in it })
  }

  @Test
  fun theFlagOnForTheWorkspaceOffersThemToAnyMember() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val seen = Seen()
    val context = owner(seen, { 200 to """{"rows":[$free],"labels":{}}""" }, staff = false, flags = "release_site_starters")
    open(context, seen)
    see("starter-fp-starter-trades-base")
    onNodeWithTag("site-style-required").assertDoesNotExist()
  }

  @Test
  fun aRefusalOrAnEmptyCatalogHandsBackToTheStyles() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val refused = Seen()
    open(owner(refused, { 403 to """{"error":"Site starters are not available for this workspace yet"}""" }), refused)
    see("site-style-required")
    onNodeWithTag("starter-list").assertDoesNotExist()
  }

  @Test
  fun anEmptyCatalogHandsBackToTheStyles() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val seen = Seen()
    open(owner(seen, { 200 to """{"rows":[],"labels":{}}""" }), seen)
    see("site-style-required")
  }

  @Test
  fun aSearchThatFindsNothingSaysSoAndKeepsThePicker() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val seen = Seen()
    var calls = 0
    open(owner(seen, { calls += 1; 200 to (if (calls == 1) """{"rows":[$free],"labels":{}}""" else """{"rows":[],"labels":{}}""") }), seen)
    see("starter-fp-starter-trades-base")
    onNodeWithTag("starter-search").performClick()
    onNode(hasSetTextAction() and hasText("Search starters")).performTextInput("zzz")
    waitUntil(timeoutMillis = 5_000) { onAllNodesWithText("No starters match — try fewer words").fetchSemanticsNodes().isNotEmpty() }
    onNodeWithTag("site-style-required").assertDoesNotExist()
  }
}
