package com.aglyn.screens

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
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respondError
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.BeforeTest

/**
 * What a plugin spec test needs: the real spec file from a plugin's screens folder, a screen built over data in the
 * route's own shapes, and the blocks and requests it shows. One place, so each audit area's test reads its spec.
 */
abstract class SpecTestBase {
  protected val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }

  private object NoReads : FirestoreReader {
    override suspend fun get(path: String): FirestoreDoc? = null
    override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
  }

  protected class Site : NativePluginContext {
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
    override fun navigate(screenId: String, params: NativeParams) {}
    override fun openBesigner(path: String, scope: ConsoleScope) = false
  }

  @BeforeTest
  fun utc() {
    ScreenValues.timeZone = "UTC"
  }

  protected fun spec(pluginDir: String, id: String): ScreenSpec =
    File(root, "libs/plugins/$pluginDir/src/android/screens").listFiles().orEmpty()
      .filter { it.name.endsWith(".screens.json") }
      .flatMap { ScreenSpec.parseFile(it.readText()) }
      .first { it.id == id }

  protected fun screen(spec: ScreenSpec, params: Map<String, String>, data: String): ScreenModel {
    val session = ScreenSession(orgName = "Acme", orgRole = "owner", siteName = "Shop", origin = "https://console.test")
    val model = ScreenModel(spec, session.context(Site(), params), null)
    model.seed(Json.parseToJsonElement(data))
    return model
  }

  protected fun ScreenModel.shown(): List<String> = spec.blocks.filter { ScreenValues.condition(it.whenCondition, context) }.map { it.id }

  protected fun ScreenModel.block(id: String): BlockSpec = spec.blocks.first { it.id == id }

  protected fun ScreenModel.actionsShown(block: String): List<String> =
    block(block).raw.jsonObject["items"]!!.jsonArray.mapNotNull { ActionSpec.parse(it) }.filter { ScreenValues.condition(it.whenCondition, context) }.map { it.id }

  protected fun ScreenModel.action(block: String, id: String): ActionSpec =
    block(block).raw.jsonObject["items"]!!.jsonArray.mapNotNull { ActionSpec.parse(it) }.first { it.id == id }

  protected fun ScreenModel.rowActions(block: String): List<ActionSpec> =
    block(block).raw.jsonObject["actions"]!!.jsonArray.mapNotNull { ActionSpec.parse(it) }

  protected fun ScreenModel.form(block: String): ActionSpec = ActionSpec.parse(block(block).raw.jsonObject["submit"])!!

  /** The fields a form block draws, given what the person has typed so far. */
  protected fun ScreenModel.fieldsShown(block: String, form: String = "{}"): List<FieldSpec> =
    FieldSpec.parseAll(block(block).raw.jsonObject["fields"]!!.jsonArray, context)
      .filter { ScreenValues.condition(it.whenCondition, ScreenContext.with(context, "form", json(form))) }

  protected fun ScreenModel.body(action: ActionSpec, form: String = "{}"): JsonElement =
    ScreenValues.resolveBody(action.body!!, ScreenContext.with(context, "form", json(form)))

  protected fun ScreenModel.row(path: String, index: Int = 0): JsonElement =
    ScreenContext.with(context, "item", (ScreenValues.lookup(path, context) as kotlinx.serialization.json.JsonArray)[index])

  protected fun json(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject
}
