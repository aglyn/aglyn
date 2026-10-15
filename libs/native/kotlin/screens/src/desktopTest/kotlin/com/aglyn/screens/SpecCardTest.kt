package com.aglyn.screens

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
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
import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.ui.AglynTheme
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respondError
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** A spec's `cardSlot`: the one-row card a core page's zone draws for a plugin whose settings are a whole screen. */
@OptIn(ExperimentalTestApi::class)
class SpecCardTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }

  private fun specsOf(plugin: String) =
    File(root, "libs/plugins/$plugin/src/android/screens").listFiles().orEmpty()
      .filter { it.name.endsWith(".screens.json") }
      .flatMap { ScreenSpec.parseFile(it.readText()) }

  private object NoReads : FirestoreReader {
    override suspend fun get(path: String): FirestoreDoc? = null
    override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
  }

  private class Context : NativePluginContext {
    val opened = mutableListOf<Pair<String, NativeParams>>()
    override val uid = "u1"
    override val orgId = "o1"
    override val hostId = "h1"
    override val orgSlug = "acme"
    override val hostSlug = "shop"
    override val firestore: FirestoreReader = NoReads
    override val api = ConsoleApiClient("http://localhost", HttpClient(MockEngine { respondError(HttpStatusCode.NotFound) }), { "t" })
    override val deviceStore = object : KeyValueStore {
      override fun get(key: String): String? = null
      override fun set(key: String, value: String?) {}
    }
    override fun navigate(screenId: String, params: NativeParams) { opened += screenId to params }
    override fun openBesigner(path: String, scope: ConsoleScope) = false
  }

  private val integrations = mapOf(
    "live-chat" to "live-chat.settings",
    "zapier" to "zapier.connections",
    "marketing-platforms" to "marketing-platforms.service",
    "ad-conversions" to "ad-conversions.service",
  )

  private fun registryOfIntegrations(): NativePluginRegistry {
    val registry = NativePluginRegistry()
    val entries = integrations.keys.map { plugin ->
      val specs = specsOf(plugin)
      NativePluginManifestEntry(plugin, SpecScreens.declaration(specs)) { SpecScreens.register(specs, it) }
    }
    assertEquals(emptyList(), registry.load(entries).failed)
    return registry
  }

  @Test
  fun aCardSlotIsDeclaredAndRegisteredAsAWidgetInThatSlot() {
    val specs = specsOf("zapier")
    assertEquals(mapOf("screens" to listOf("zapier.connections"), "deepLinks" to emptyList(), "widgets" to listOf("zapier.connections.card")), SpecScreens.declaration(specs))
    // A spec without a card slot declares no widgets, so a plugin's manifest is unchanged.
    val plain = specsOf("tax-engines")
    assertNull(SpecScreens.declaration(plain)["widgets"])
  }

  @Test
  fun everyIntegrationPutsOneCardInTheHostSettingsZoneInOrder() {
    val widgets = registryOfIntegrations().widgets(NativeApp.AGLYN, "hostSettings")
    assertEquals(
      listOf("live-chat.settings.card", "marketing-platforms.service.card", "zapier.connections.card", "ad-conversions.service.card"),
      widgets.map { it.id },
    )
    assertEquals(listOf("live-chat", "marketing-platforms", "zapier", "ad-conversions"), widgets.map { it.pluginId })
    assertEquals(listOf("Live chat", "Email platforms", "Zapier", "Ad conversions"), widgets.map { it.title })
  }

  @Test
  fun aCardOpensItsScreenAsThePluginsOwnSettingsPageDoes() = runComposeUiTest {
    val context = Context()
    val zapier = registryOfIntegrations().widgets(NativeApp.AGLYN, "hostSettings").first { it.pluginId == "zapier" }
    setContent { AglynTheme(dark = false) { zapier.content(context) } }
    onNodeWithTag("spec-card-zapier.connections").performClick()
    assertEquals(listOf("zapier.connections" to mapOf("pluginId" to "zapier")), context.opened)
    // The screen's own `requires` holds from that door, as it does from the plugin's settings page.
    val spec = specsOf("zapier").first()
    val session = ScreenSession(orgName = "Acme", orgRole = "owner", siteName = "Shop", origin = "https://console.test")
    assertEquals(true, ScreenValues.condition(spec.requires, session.context(context, context.opened.single().second)))
  }
}
