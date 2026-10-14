package com.aglyn.screens

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.TokenClaims
import com.aglyn.pluginhost.NativeLinkTarget
import com.aglyn.pluginhost.NativePluginRegistry
import com.aglyn.ui.AglynIcons
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.io.File
import java.util.Base64
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The spec grammar replayed from libs/native/screens/template-cases.json (Apple replays the same file), and every spec checked. */
class ScreenSpecTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }
    .first { File(it, "libs/native/screens").isDirectory }
  private val screensDir = File(root, "libs/native/screens")

  private fun specFiles(): List<File> {
    val core = screensDir.listFiles().orEmpty().toList()
    val plugins = File(root, "libs/plugins").listFiles().orEmpty().flatMap { File(it, "src/android/screens").listFiles().orEmpty().toList() }
    return (core + plugins).filter { it.name.endsWith(".screens.json") }
  }

  @BeforeTest
  fun utc() {
    ScreenValues.timeZone = "UTC"
  }

  @Test
  fun templateCases() {
    val file = Json.parseToJsonElement(File(screensDir, "template-cases.json").readText())
    val context = file.obj("context")!!
    for (case in file.arr("render")) {
      assertEquals(case.str("expect"), ScreenValues.render(case.str("template")!!, context), case.str("template"))
    }
    for (case in file.arr("url")) assertEquals(case.str("expect"), ScreenValues.renderUrl(case.str("template")!!, context))
    for (case in file.arr("resolve")) {
      val got = ScreenValues.resolve(case.str("template")!!, context)
      val want = case.obj("expect") ?: JsonNull
      assertEquals(normalize(want), normalize(got), case.str("template"))
    }
    for (case in file.arr("body")) assertEquals(normalize(case.obj("expect")!!), normalize(ScreenValues.resolveBody(case.obj("body")!!, context)))
    for (case in file.arr("condition")) {
      assertEquals((case.obj("expect") as JsonPrimitive).booleanOrNull, ScreenValues.condition(case.str("when"), context), case.str("when"))
    }
  }

  /** Numbers compare by value (123456 and 123456.0 are the same JSON number). */
  private fun normalize(value: JsonElement): JsonElement = when (value) {
    is JsonPrimitive -> if (value.isString || value.booleanOrNull != null || value == JsonNull) value else JsonPrimitive(value.content.toDouble())
    is JsonArray -> JsonArray(value.map { normalize(it) })
    is JsonObject -> JsonObject(value.mapValues { normalize(it.value) })
  }

  @Test
  fun everySpecParsesAndPointsAtRealScreensWithKnownIcons() {
    val files = specFiles()
    assertTrue(files.isNotEmpty())
    val specs = files.flatMap { file ->
      val json = Json.parseToJsonElement(file.readText())
      val parsed = ScreenSpec.parseFile(file.readText())
      assertEquals(json.arr("screens").size, parsed.size, "${file.name}: a screen lacks id or title")
      parsed
    }
    val ids = specs.map { it.id }
    assertEquals(ids.size, ids.toSet().size, "duplicate screen ids")
    val known = setOf("fields", "meters", "list", "form", "actions", "links", "notice", "zone")
    for (spec in specs) {
      assertTrue(spec.scope in setOf("org", "site", "account", "staff"), "${spec.id}: scope ${spec.scope}")
      for (block in spec.blocks) assertTrue(block.type in known, "${spec.id}: block ${block.type}")
      for (target in targets(spec.raw)) assertTrue(target in ids, "${spec.id} opens $target, which no spec declares")
      for (icon in icons(spec.raw)) assertTrue(AglynIcons.has(icon), "${spec.id}: Material icon \"$icon\" is not in AglynIcons")
    }
  }

  private fun targets(json: JsonElement): List<String> = when (json) {
    is JsonObject -> json.flatMap { (key, value) ->
      (if (key == "screen" && value is JsonPrimitive) listOf(value.content) else emptyList()) + targets(value)
    }
    is JsonArray -> json.flatMap { targets(it) }
    else -> emptyList()
  }

  private fun icons(json: JsonElement): List<String> = when (json) {
    is JsonObject -> json.flatMap { (key, value) ->
      (if (key == "icon" && value is JsonPrimitive && '{' !in value.content) listOfNotNull(materialIcon(value.content)) else emptyList()) + icons(value)
    }
    is JsonArray -> json.flatMap { icons(it) }
    else -> emptyList()
  }

  @Test
  fun coreRegistersAsAPluginNamedCore() {
    val registry = NativePluginRegistry()
    val result = registry.load(listOf(CoreScreens.manifestEntry))
    assertEquals(emptyList(), result.failed)
    assertNotNull(registry.screen("core.team"))
    val target = com.aglyn.pluginhost.DeepLinks.resolve("/acme/team/u9", registry.deepLinks())
    assertIs<NativeLinkTarget.Screen>(target)
    assertEquals("core.team.member", target.screen)
    assertEquals("u9", target.params["uid"])
  }

  @Test
  fun tokenClaims() {
    val enc = Base64.getUrlEncoder().withoutPadding()
    val claims = TokenClaims.fromIdToken("h.${enc.encodeToString("""{"staff":true,"staffRole":"super"}""".toByteArray())}.s")
    assertTrue(claims.isStaff)
    assertTrue(claims.isSuper)
    assertNull(TokenClaims.fromIdToken("x").staffRole)
    assertEquals("support", TokenClaims.fromIdToken("h.${enc.encodeToString("""{"staff":true}""".toByteArray())}.s").staffRole)
  }

  private fun client(vararg responses: Pair<Int, String>, sent: MutableList<HttpRequestData>): ConsoleApiClient {
    val queue = ArrayDeque(responses.toList())
    val engine = MockEngine { request ->
      sent += request
      val (status, body) = queue.removeFirstOrNull() ?: (200 to "{}")
      respond(body, HttpStatusCode.fromValue(status), headersOf("Content-Type", "application/json"))
    }
    return ConsoleApiClient("http://localhost", HttpClient(engine) { expectSuccess = false }, { "t" }, sleep = {})
  }

  @Test
  fun runPostsTheResolvedBodyAndFallsBackOn404() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(404 to """{"error":"No account"}""", 200 to """{"ok":true}""", sent = sent)
    val spec = ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X"}"""))!!
    val context = Json.parseToJsonElement("""{"org":{"id":"o1"},"form":{"email":"a@b.c"}}""")
    val model = ScreenModel(spec, context, api)
    val action = ActionSpec.parse(
      Json.parseToJsonElement(
        """{"label":"Add","url":"/api/orgs/members","body":{"orgId":"{org.id}","email":"{form.email}"},
           "else":{"label":"Invite","url":"/api/orgs/invites","body":{"orgId":"{org.id}","action":"create"}}}""",
      ),
    )!!
    val outcome = model.run(action, context)
    assertIs<ActionOutcome.Done>(outcome)
    assertEquals(listOf("/api/orgs/members", "/api/orgs/invites"), sent.map { it.url.encodedPath })
    assertEquals(
      Json.parseToJsonElement("""{"orgId":"o1","email":"a@b.c"}"""),
      Json.parseToJsonElement((sent[0].body as TextContent).text),
    )
  }

  @Test
  fun nowNamesTheMonthlyAndDailyKeysInUtc() {
    val before = ScreenValues.clock
    try {
      ScreenValues.clock = { 1_791_385_440_000L } // 2026-10-07T15:04:00Z
      val now = ScreenValues.nowObject()
      assertEquals("2026", now.str("year"))
      assertEquals("2026-10", now.str("month"))
      assertEquals("2026-10-07", now.str("day"))
      assertEquals("2026-09", now.str("prevMonth"))
      val context = Json.parseToJsonElement("""{"now":$now,"data":{"counter":{"2026-10":4,"2026-09":9}}}""")
      assertEquals("4", ScreenValues.render("{data.counter[@now.month]}", context))
    } finally {
      ScreenValues.clock = before
    }
  }

  @Test
  fun aCountLoadAnswersTheServersCountAndFallsBackToTheRows() = runTest {
    val counted = object : com.aglyn.core.FirestoreReader {
      override suspend fun get(path: String): com.aglyn.core.FirestoreDoc? = null
      override suspend fun page(query: com.aglyn.core.FirestoreQuery) = com.aglyn.core.FirestorePage(emptyList(), null)
      override fun observeDoc(path: String) = kotlinx.coroutines.flow.emptyFlow<com.aglyn.core.Live<com.aglyn.core.FirestoreDoc?>>()
      override fun observe(query: com.aglyn.core.FirestoreQuery) = kotlinx.coroutines.flow.emptyFlow<com.aglyn.core.Live<List<com.aglyn.core.FirestoreDoc>>>()
      override suspend fun count(query: com.aglyn.core.FirestoreQuery): Long? = if (query.collectionPath == "hosts/h1/layouts") 7L else null
    }
    val context = Json.parseToJsonElement("""{"site":{"id":"h1"}}""")
    val spec = Json.parseToJsonElement("""{"collection":"hosts/{site.id}/layouts","count":true}""")
    assertEquals(Json.parseToJsonElement("""{"count":7.0}"""), FirestoreLoads.query(counted, spec, context))
    val rows = Json.parseToJsonElement("""{"collection":"hosts/{site.id}/forms","count":true}""")
    assertEquals(Json.parseToJsonElement("""{"count":0.0}"""), FirestoreLoads.query(counted, rows, context))
  }

  @Test
  fun aWhereClauseCarriesItsOperatorAndADateValue() = runTest {
    val seen = mutableListOf<com.aglyn.core.FirestoreQuery>()
    val reader = object : com.aglyn.core.FirestoreReader {
      override suspend fun get(path: String): com.aglyn.core.FirestoreDoc? = null
      override suspend fun page(query: com.aglyn.core.FirestoreQuery) = com.aglyn.core.FirestorePage(emptyList(), null)
      override fun observeDoc(path: String) = kotlinx.coroutines.flow.emptyFlow<com.aglyn.core.Live<com.aglyn.core.FirestoreDoc?>>()
      override fun observe(query: com.aglyn.core.FirestoreQuery) = kotlinx.coroutines.flow.emptyFlow<com.aglyn.core.Live<List<com.aglyn.core.FirestoreDoc>>>()
      override suspend fun count(query: com.aglyn.core.FirestoreQuery): Long? { seen += query; return 3L }
    }
    val spec = Json.parseToJsonElement("""{"collection":"hosts/h1/components","count":true,"where":[["deletedAt",">",{"${'$'}date":"1970-01-01T00:00:00Z"}],["kind","==","button"]]}""")
    FirestoreLoads.query(reader, spec, JsonObject(emptyMap()))
    val filters = seen.single().filters
    assertEquals(com.aglyn.core.FilterOp.GT, filters[0].op)
    assertEquals(com.aglyn.core.FirestoreTimestamp(0, 0), filters[0].value)
    assertEquals(com.aglyn.core.FilterOp.EQ, filters[1].op)
    assertEquals(com.aglyn.core.FirestoreTimestamp(1_791_385_440, 0), FirestoreLoads.isoInstant("2026-10-07T15:04:00Z"))
  }

  @Test
  fun aPerRowLoadRunsOncePerRowAndItsListSums() = runTest {
    val routes = listOf(
      "/api/sites" to """{"sites":[{"id":"a"},{"id":"b"},{"id":"c"}]}""",
      "hostId=a" to """{"bandwidthGb":1.5}""",
      "hostId=b" to """{"bandwidthGb":2}""",
    )
    val engine = MockEngine { request ->
      val url = request.url.toString()
      respond(routes.firstOrNull { url.contains(it.first) }?.second ?: "{}", HttpStatusCode.OK, headersOf("Content-Type", "application/json"))
    }
    val api = ConsoleApiClient("http://localhost", HttpClient(engine) { expectSuccess = false }, { "t" }, sleep = {})
    val spec = ScreenSpec.parse(
      Json.parseToJsonElement(
        """{"id":"core.x","title":"X","load":{"sites":"/api/sites","traffic":{"url":"/api/usage?hostId={item.id}","each":"data.sites.sites","optional":true}}}""",
      ),
    )!!
    val model = ScreenModel(spec, JsonObject(emptyMap()), api)
    model.load()
    assertEquals(3, (model.data.obj("traffic") as JsonArray).size)
    // Site c answered nothing useful; a and b add up, and the missing one is left out, not read as zero.
    assertEquals("4.5", ScreenValues.render("{data.traffic.*.bandwidthGb + 1}", model.context))
    assertEquals(7, ScreenValues.render("{now.prevMonth}", model.context).length)
  }

  @Test
  fun reauthAnswerAsksForThePassword() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(403 to """{"error":"reauth-required","message":"Confirm it is you"}""", sent = sent)
    val model = ScreenModel(ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X"}"""))!!, JsonObject(emptyMap()), api)
    val outcome = model.run(ActionSpec.parse(Json.parseToJsonElement("""{"label":"Close","url":"/api/account/close"}"""))!!, JsonObject(emptyMap()))
    assertIs<ActionOutcome.NeedsReauth>(outcome)
    assertEquals("Confirm it is you", outcome.message)
  }

  @Test
  fun loadsPageThroughCursors() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(
      200 to """{"rows":[{"${'$'}id":"a"}],"nextCursor":"a"}""",
      200 to """{"rows":[{"${'$'}id":"b"}],"nextCursor":null}""",
      sent = sent,
    )
    val spec = ScreenSpec.parse(
      Json.parseToJsonElement("""{"id":"core.x","title":"X","load":{"list":{"url":"/api/x?orgId={org.id}","cursor":"nextCursor","items":"rows"}}}"""),
    )!!
    val model = ScreenModel(spec, Json.parseToJsonElement("""{"org":{"id":"o 1"},"data":{}}"""), api)
    model.load()
    assertEquals(ScreenModel.Phase.Ready, model.phase)
    assertEquals("a", model.cursors["list"])
    model.loadMore("list")
    assertEquals(2, (ScreenValues.lookup("data.list.rows", model.context) as JsonArray).size)
    assertFalse("list" in model.cursors)
    assertEquals("orgId=o%201&cursor=a", sent.last().url.encodedQuery)
  }
}
