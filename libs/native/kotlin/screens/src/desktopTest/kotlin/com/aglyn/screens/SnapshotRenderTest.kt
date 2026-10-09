package com.aglyn.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.ImageComposeScene
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Density
import androidx.compose.ui.use
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.KeyValueStore
import com.aglyn.core.Live
import com.aglyn.core.TokenClaims
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynTheme
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respondError
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.jetbrains.skia.EncodedImageFormat
import java.io.File
import kotlin.test.Test

/**
 * Draws every spec screen that has a fixture (libs/native/screens/fixtures.json)
 * at phone, tablet and desktop sizes, light and dark, into -Paglyn.snapshotDir.
 * The Apple snapshot tool draws the same fixtures. Does nothing without the
 * property, so the unit test run stays fast.
 */
class SnapshotRenderTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }

  private object NoReads : FirestoreReader {
    override suspend fun get(path: String): FirestoreDoc? = null
    override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
  }

  private class Context(fixture: JsonObject) : NativePluginContext {
    override val uid = fixture.str("uid") ?: "seed-owner"
    override val orgId = fixture.str("orgId")
    override val hostId = fixture.str("hostId")
    override val orgSlug = fixture.str("orgSlug")
    override val hostSlug = fixture.str("hostSlug")
    override val firestore: FirestoreReader = NoReads
    override val api = ConsoleApiClient("http://localhost", HttpClient(MockEngine { respondError(HttpStatusCode.NotFound) }), { "t" })
    override val deviceStore = object : KeyValueStore {
      override fun get(key: String): String? = null
      override fun set(key: String, value: String?) {}
    }
    override fun navigate(screenId: String, params: NativeParams) {}
    override fun openBesigner(path: String, scope: ConsoleScope) = false
  }

  @OptIn(ExperimentalMaterial3Api::class)
  @Test
  fun renderFixtures() {
    val dir = System.getProperty("aglyn.snapshotDir")?.takeIf { it.isNotBlank() }?.let { File(it).apply { mkdirs() } } ?: return
    ScreenValues.timeZone = "America/Chicago"
    val specs = (File(root, "libs/native/screens").listFiles().orEmpty().toList() +
      File(root, "libs/plugins").listFiles().orEmpty().flatMap { File(it, "src/android/screens").listFiles().orEmpty().toList() })
      .filter { it.name.endsWith(".screens.json") }
      .flatMap { ScreenSpec.parseFile(it.readText()) }
    ScreenCatalog.add(specs)
    val fixtures = Json.parseToJsonElement(File(root, "libs/native/screens/fixtures.json").readText()) as JsonObject
    val sessionJson = fixtures["session"] as JsonObject
    val staffJson = fixtures["staffSession"] as JsonObject
    val only = System.getProperty("aglyn.snapshotOnly")?.split(',')?.toSet()
    for ((id, fixture) in fixtures["screens"] as JsonObject) {
      if (only != null && id !in only) continue
      val spec = ScreenCatalog.spec(id) ?: error("fixture for unknown screen $id")
      val staff = fixture.isTrue("staff")
      val session = ScreenSession(
        email = if (staff) staffJson.str("email") else sessionJson.str("email"),
        displayName = sessionJson.str("displayName"),
        orgName = sessionJson.str("orgName"),
        orgRole = sessionJson.str("orgRole"),
        siteName = sessionJson.str("siteName"),
        claims = if (staff) TokenClaims((staffJson["claims"] as JsonObject).toMap()) else TokenClaims(),
      )
      val params = (fixture.obj("params") as? JsonObject)?.mapValues { (it.value as JsonPrimitive).content } ?: emptyMap()
      val data = fixture.obj("data") ?: JsonObject(emptyMap())
      for ((size, w, h) in listOf(Triple("phone", 412, 892), Triple("tablet", 1180, 820), Triple("desktop", 1440, 900))) {
        for (dark in listOf(false, true)) {
          if (dark && size == "tablet") continue
          ImageComposeScene(w * 2, h * 2, Density(2f)) {
            AglynTheme(dark = dark) {
              CompositionLocalProvider(LocalScreenSession provides session) {
                Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
                  TopAppBar(
                    title = { Text(spec.label) },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                  )
                  SpecScreen(spec, Context(sessionJson), params, seed = data)
                }
              }
            }
          }.use { scene ->
            var image = scene.render(0)
            for (frame in 1..8) image = scene.render(frame * 100_000_000L)
            val name = "kotlin-$id-$size${if (dark) "-dark" else ""}.png"
            File(dir, name).writeBytes(image.encodeToData(EncodedImageFormat.PNG)!!.bytes)
          }
        }
      }
    }
  }
}
