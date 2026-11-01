package com.aglyn.shell

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
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
import com.aglyn.ui.LocalMediaPicker
import com.aglyn.ui.MediaPicker
import com.aglyn.ui.PickSource
import com.aglyn.ui.PickedFile
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

  private class OnePicture(private val file: PickedFile) : MediaPicker {
    override val sources = listOf(PickSource.FILES)
    override suspend fun pick(source: PickSource, multiple: Boolean) = listOf(file)
  }

  private fun answers(refuseUpload: Boolean, seen: MutableList<Pair<String, String>>) = MockEngine { request ->
    val path = request.url.encodedPath
    seen += path to String((request.body as OutgoingContent.ByteArrayContent).bytes())
    val json = headersOf(HttpHeaders.ContentType, "application/json")
    when {
      path == "/api/hosts/create" -> respond("""{"hostId":"h9","subdomain":"my-shop"}""", headers = json)
      path == "/api/media/upload" && refuseUpload -> respond("""{"error":"Storage limit reached"}""", HttpStatusCode.PaymentRequired, json)
      path == "/api/media/upload" -> respond("""{"mediaId":"m1","url":"https://cdn.test/logo.png"}""", headers = json)
      else -> respond("{}", headers = json)
    }
  }

  @Test
  fun aLogoGoesInAfterTheCreateAndTheFaviconFollowsIt() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val seen = mutableListOf<Pair<String, String>>()
    val owner = Owner(ConsoleApiClient("http://localhost", HttpClient(answers(refuseUpload = false, seen)), { "t" }))
    val picture = PickedFile("logo.png", "image/png", ByteArray(8))
    setContent {
      CompositionLocalProvider(LocalMediaPicker provides OnePicture(picture)) { AglynTheme(dark = false) { SitesScreen(owner, startNew = true) } }
    }
    onNodeWithTag("site-name").performTextInput("My Shop")
    onNode(hasContentDescription("Choose Logo")).performClick()
    waitForIdle()
    onNodeWithTag("option-card-trades").performClick()
    onNodeWithTag("create-site-confirm").performClick()
    waitUntil(timeoutMillis = 5_000) { owner.opened.isNotEmpty() }
    // The site first, then its library, then the fields, before it opens.
    assertEquals(listOf("/api/hosts/create", "/api/media/upload", "/api/hosts/sync-memberships"), seen.map { it.first })
    val fields = Json.parseToJsonElement(seen.last().second).jsonObject
    assertEquals("h9", fields["hostId"]?.jsonPrimitive?.content)
    assertEquals("https://cdn.test/logo.png", fields["logoUrl"]?.jsonPrimitive?.content)
    assertEquals(fields["logoUrl"], fields["favicon"])
  }

  @Test
  fun aLogoThatDoesNotMakeItIsSaidOnceAndTheSiteStillOpens() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val seen = mutableListOf<Pair<String, String>>()
    val owner = Owner(ConsoleApiClient("http://localhost", HttpClient(answers(refuseUpload = true, seen)), { "t" }))
    val picture = PickedFile("logo.png", "image/png", ByteArray(8))
    setContent {
      CompositionLocalProvider(LocalMediaPicker provides OnePicture(picture)) { AglynTheme(dark = false) { SitesScreen(owner, startNew = true) } }
    }
    onNodeWithTag("site-name").performTextInput("My Shop")
    onNode(hasContentDescription("Choose Logo")).performClick()
    waitForIdle()
    onNodeWithTag("option-card-trades").performClick()
    onNodeWithTag("create-site-confirm").performClick()
    waitUntil(timeoutMillis = 5_000) { seen.any { it.first == "/api/media/upload" } }
    onNodeWithText("Your site is ready, but your logo didn’t upload. Add it in Site settings.").assertIsDisplayed()
    assertEquals(emptyList(), owner.opened)
    onNodeWithTag("action-dialog-confirm").performClick()
    waitUntil(timeoutMillis = 5_000) { owner.opened.isNotEmpty() }
    assertEquals(listOf("h9"), owner.opened)
    assertEquals(listOf("/api/hosts/create", "/api/media/upload"), seen.map { it.first })
  }

  @Test
  fun aFileAFieldDoesNotTakeIsSaidOnTheFieldAndNotHeld() = runDesktopComposeUiTest(width = 900, height = 1000) {
    val owner = Owner(ConsoleApiClient("http://localhost", HttpClient(MockEngine { respond("{}") }), { "t" }))
    val tiff = PickedFile("logo.tiff", "image/tiff", ByteArray(8))
    setContent {
      CompositionLocalProvider(LocalMediaPicker provides OnePicture(tiff)) { AglynTheme(dark = false) { SitesScreen(owner, startNew = true) } }
    }
    onNode(hasContentDescription("Choose Logo")).performClick()
    onNodeWithText("Use a PNG, JPEG, WebP or SVG file.").assertIsDisplayed()
    onNode(hasContentDescription("Choose Logo")).assertIsDisplayed()
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
