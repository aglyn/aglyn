package com.aglyn.shell

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
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
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.site.sites.SitesScreen
import com.aglyn.ui.AglynTheme
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Create site asks a style before it makes anything (AGL-4049): nothing is picked when the sheet opens, the button stays
 * off until a card is, and the pick is what the request carries. Driven through the real Sites screen.
 */
@OptIn(ExperimentalTestApi::class)
class CreateSiteStyleUiTest {
  private object NoReads : FirestoreReader {
    override suspend fun get(path: String): FirestoreDoc? = null
    override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
  }

  private class Owner(override val api: ConsoleApiClient) : NativePluginContext {
    val opened = mutableListOf<String>()
    override val uid = "u1"
    override val orgId = "o1"
    override val hostId: String? = null
    override val orgSlug = "acme"
    override val hostSlug: String? = null
    override val orgRole = "owner"
    override val firestore: FirestoreReader = NoReads
    override val deviceStore = object : KeyValueStore {
      override fun get(key: String): String? = null
      override fun set(key: String, value: String?) {}
    }
    override fun selectSite(hostId: String) {
      opened += hostId
    }
    override fun navigate(screenId: String, params: NativeParams) {}
    override fun openBesigner(path: String, scope: ConsoleScope) = false
  }

  @Test
  fun createSiteWaitsForAStyleAndSendsTheOnePicked() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val bodies = mutableListOf<String>()
    val engine = MockEngine { request ->
      bodies += String((request.body as OutgoingContent.ByteArrayContent).bytes())
      respond("""{"hostId":"h9","subdomain":"my-shop"}""", headers = headersOf(HttpHeaders.ContentType, "application/json"))
    }
    val owner = Owner(ConsoleApiClient("http://localhost", HttpClient(engine), { "t" }))
    setContent { AglynTheme(dark = false) { SitesScreen(owner, startNew = true) } }

    onNodeWithTag("create-site-sheet").assertIsDisplayed()
    onNodeWithTag("create-site-confirm").assertIsNotEnabled()
    // A name and an address are not enough, and no card starts picked.
    onNodeWithTag("site-name").performTextInput("My Shop")
    onNodeWithTag("create-site-confirm").assertIsNotEnabled()
    onNodeWithTag("site-style-required").assertIsDisplayed()
    onNodeWithTag("option-card-business").assertIsNotSelected()
    onNodeWithTag("option-card-trades").assertIsNotSelected()

    onNodeWithTag("option-card-trades").performClick()
    onNodeWithTag("option-card-trades").assertIsSelected()
    onNodeWithTag("site-style-required").assertDoesNotExist()
    onNodeWithTag("create-site-confirm").assertIsEnabled()

    onNodeWithTag("create-site-confirm").performClick()
    waitUntil(timeoutMillis = 5_000) { owner.opened.isNotEmpty() }
    assertEquals(listOf("h9"), owner.opened)
    val body = Json.parseToJsonElement(bodies.single()).jsonObject
    assertEquals("trades", body["style"]?.jsonPrimitive?.content)
    assertEquals("starter", body["start"]?.jsonPrimitive?.content)
    assertEquals("my-shop", body["subdomain"]?.jsonPrimitive?.content)
  }

  @Test
  fun everyCardInARowIsAsTallAsTheTallest() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val owner = Owner(ConsoleApiClient("http://localhost", HttpClient(MockEngine { respond("{}") }), { "t" }))
    setContent { AglynTheme(dark = false) { SitesScreen(owner, startNew = true) } }
    val short = onNodeWithTag("option-card-business").getBoundsInRoot()
    val long = onNodeWithTag("option-card-trades").getBoundsInRoot()
    assertEquals(short.top, long.top)
    assertEquals(short.bottom, long.bottom)
  }
}
