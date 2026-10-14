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
import kotlin.test.assertNotEquals
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
    val known = setOf("fields", "meters", "list", "form", "actions", "links", "notice", "zone", "image")
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

  /** An action's `headers` go out with the request, and `{attempt}` holds one key while the same request is sent again. */
  @Test
  fun headersCarryAnAttemptKeyThatFollowsTheRequest() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(503 to "{}", 200 to "{}", 200 to "{}", sent = sent)
    val spec = ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X"}"""))!!
    val first = Json.parseToJsonElement("""{"form":{"amount":"900"}}""")
    val model = ScreenModel(spec, first, api)
    val action = ActionSpec.parse(
      Json.parseToJsonElement(
        """{"label":"Provision","url":"/api/admin/enterprise-billing","body":{"amountMonthlyUsd":"{form.amount}"},
           "headers":{"Idempotency-Key":"{attempt}","X-Staff":"yes"}}""",
      ),
    )!!
    model.run(action, first)
    model.run(action, Json.parseToJsonElement("""{"form":{"amount":"1200"}}"""))
    val keys = sent.map { it.headers["Idempotency-Key"] }
    assertEquals(3, keys.size)
    assertNotNull(keys[0])
    // The 503 was retried with the very same key, because a keyed write is safe to repeat.
    assertEquals(keys[0], keys[1])
    assertNotEquals(keys[1], keys[2])
    assertEquals("yes", sent[0].headers["X-Staff"])
    model.run(action, first)
    assertEquals(keys[0], sent.last().headers["Idempotency-Key"])
  }

  /** A paged job sends the cursor back until the route is done, adds the pages up, and reports lines. */
  @Test
  fun loopAddsPagesUpAndReportsLines() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(
      200 to """{"planned":2,"drift":{"byCollection":{"a":1}},"nextCursor":"c1"}""",
      200 to """{"planned":3,"drift":{"byCollection":{"a":2,"b":1}},"nextCursor":null,"done":true}""",
      sent = sent,
    )
    val model = ScreenModel(ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X"}"""))!!, JsonObject(emptyMap()), api)
    val action = ActionSpec.parse(
      Json.parseToJsonElement(
        """{"label":"Scan","url":"/api/admin/backfill-scope","body":{"dryRun":true},"success":"Scanned",
           "loop":{"cursor":"nextCursor","until":"done"},
           "report":[{"text":"{response.planned} planned"},{"text":"none","when":"response.missing"},
                     {"each":"response.drift.byCollection","text":"{item.key}: {item.value}"}]}""",
      ),
    )!!
    val outcome = model.run(action, JsonObject(emptyMap()))
    assertIs<ActionOutcome.Done>(outcome)
    assertEquals("Scanned\n5 planned\na: 3\nb: 1", outcome.message)
    assertEquals(Json.parseToJsonElement("2"), outcome.response.obj("pages"))
    assertEquals(Json.parseToJsonElement("false"), outcome.response.obj("bounded"))
    assertEquals(Json.parseToJsonElement("""{"dryRun":true,"cursor":"c1"}"""), Json.parseToJsonElement((sent[1].body as TextContent).text))
  }

  /** A probe that answers 503 is reporting: its body is the answer. */
  @Test
  fun loadAcceptsTheStatusAProbeReportsWith() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(503 to """{"status":"degraded","checks":{"a":{"ok":false}}}""", 503 to """{"status":"degraded"}""", 503 to """{"status":"degraded"}""", sent = sent)
    val spec = ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X","load":{"probe":{"url":"/api/health/crons","accept":[503]}}}"""))!!
    val model = ScreenModel(spec, Json.parseToJsonElement("""{"data":{}}"""), api)
    model.load()
    assertEquals(ScreenModel.Phase.Ready, model.phase)
    assertEquals(JsonPrimitive("degraded"), ScreenValues.lookup("data.probe.status", model.context))
  }

  /** A staff list load names its filters; a clause with nothing to filter on is left out. */
  @Test
  fun loadFiltersGoInTheQueryOnlyWhenFilled() {
    val spec = ScreenSpec.parse(
      Json.parseToJsonElement(
        """{"id":"core.x","title":"X","load":{"rows":{"url":"/api/x?pageSize=50","filters":[
           {"field":"status","op":"equals","value":"{params.status}"},{"field":"category","value":"{params.category}"}]}}}""",
      ),
    )!!
    val load = spec.loads.first()
    val model = ScreenModel(spec, Json.parseToJsonElement("""{"params":{"status":"open","category":""}}"""), null)
    assertEquals("/api/x?pageSize=50&filters=%5B%7B%22field%22%3A%22status%22%2C%22op%22%3A%22equals%22%2C%22value%22%3A%22open%22%7D%5D", model.url(load))
    val bare = ScreenModel(spec, Json.parseToJsonElement("""{"params":{}}"""), null)
    assertEquals("/api/x?pageSize=50", bare.url(load))
  }

  /** A `late` load reads what the others found, and a query can ask for the server's count of what it matches. */
  @Test
  fun aLateLoadReadsTheAnswersOfTheOthersAndACountIsAskedOfTheServer() = runTest {
    val reader = CountingReader()
    val spec = ScreenSpec.parse(
      Json.parseToJsonElement(
        """{"id":"core.x","title":"X","load":{
           "host":{"doc":"hosts/{params.hostId}"},
           "media":{"late":true,"query":{"collection":"orgs/{data.host.orgId}/media","count":true}},
           "members":{"late":true,"query":{"collection":"orgs/{data.host.orgId}/members","where":[["role","==","owner"]],"count":true}},
           "orphan":{"late":true,"when":"!data.host.orgId","query":{"collection":"hosts/{params.hostId}/media","count":true}}}}""",
      ),
    )!!
    val model = ScreenModel(spec, Json.parseToJsonElement("""{"params":{"hostId":"h1"},"data":{}}"""), client(sent = mutableListOf()), reader)
    model.load()
    assertEquals(ScreenModel.Phase.Ready, model.phase)
    assertEquals(JsonPrimitive(42.0), ScreenValues.lookup("data.media.count", model.context))
    assertEquals(JsonPrimitive("o9"), ScreenValues.lookup("data.host.orgId", model.context))
    assertEquals(listOf("orgs/o9/media", "orgs/o9/members"), reader.counted.sorted())
    assertEquals(listOf("role"), reader.equalities)
  }

  /** A refusal says what the route says, then its `failure` lines over the route's answer. */
  @Test
  fun aRefusalIsExplainedFromTheRoutesAnswer() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(409 to """{"error":"This person owns workspaces","blockers":[{"orgName":"Acme","otherMembers":2},{"orgName":"Beta","otherMembers":0}]}""", sent = sent)
    val model = ScreenModel(ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X"}"""))!!, JsonObject(emptyMap()), api)
    val action = ActionSpec.parse(
      Json.parseToJsonElement(
        """{"label":"Erase","url":"/api/admin/users/manage","failure":[{"each":"response.blockers","text":"{item.orgName}: {item.otherMembers} other members"},{"text":"none","when":"response.shared"}]}""",
      ),
    )!!
    val outcome = model.run(action, JsonObject(emptyMap()))
    assertIs<ActionOutcome.Failed>(outcome)
    assertEquals("This person owns workspaces\nAcme: 2 other members\nBeta: 0 other members", outcome.message)
  }

  /** An action can hand text to the device as a file: the name is a template, the text a path over the context. */
  @Test
  fun anActionCanHandTextToTheDeviceAsAFile() {
    val action = ActionSpec.parse(
      Json.parseToJsonElement("""{"label":"Export","url":"/api/x","file":{"name":"{data.view.filename}","type":"text/csv","from":"response.csv"}}"""),
    )!!
    val file = action.file!!
    assertEquals("text/csv", file.type)
    val made = file.contents(Json.parseToJsonElement("""{"data":{"view":{"filename":"US-TX-2026-Q3.csv"}},"response":{"csv":"a,b\n1,2"}}"""))
    assertEquals("US-TX-2026-Q3.csv" to "a,b\n1,2", made)
    assertNull(file.contents(Json.parseToJsonElement("""{"response":{"csv":""}}""")))
    assertNull(ActionSpec.parse(Json.parseToJsonElement("""{"label":"Go","url":"/api/x"}"""))!!.file)
  }

  /** A field can fill itself with a random value from an alphabet; `pairs` prints a map's keys as they are. */
  @Test
  fun aGeneratedValueIsTheLengthAskedFromTheAlphabet() {
    val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    val first = ScreenValues.generated(20, alphabet)
    assertEquals(20, first.length)
    assertTrue(first.all { it in alphabet })
    assertNotEquals(first, ScreenValues.generated(20, alphabet))
    assertEquals("", ScreenValues.generated(5, ""))
    assertEquals("Ab1xY: editor, z9: viewer", ScreenValues.render("{h:pairs}", Json.parseToJsonElement("""{"h":{"Ab1xY":"editor","z9":"viewer"}}""")))
    // A spec names the console's own length and alphabet as constants.
    val field = FieldSpec.parse(Json.parseToJsonElement("""{"key":"password","kind":"text","generate":{"length":"{const.n}","alphabet":"{const.a}"}}"""))!!
    val made = field.generatedValue(Json.parseToJsonElement("""{"const":{"n":12,"a":"ab"}}"""))
    assertEquals(12, made?.length)
    assertTrue(made?.all { it in "ab" } == true)
    assertNull(FieldSpec.parse(Json.parseToJsonElement("""{"key":"name"}"""))!!.generatedValue(JsonObject(emptyMap())))
  }

  /** A GET action can carry the same staff list `filters` a load does, so an export covers what the list shows. */
  @Test
  fun anActionCarriesFiltersLikeALoad() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(200 to """{"csv":"a"}""", sent = sent)
    val model = ScreenModel(ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X"}"""))!!, Json.parseToJsonElement("""{"params":{"scope":"org","from":""}}"""), api)
    val action = ActionSpec.parse(
      Json.parseToJsonElement(
        """{"label":"Export","method":"GET","url":"/api/admin/audit-log?view=csv","filters":[{"field":"scope","op":"equals","value":"{params.scope}"},{"field":"at","op":"onOrAfter","value":"{params.from}"}]}""",
      ),
    )!!
    model.run(action, model.context)
    val url = sent[0].url.toString()
    assertTrue(url.contains("view=csv&filters="))
    assertTrue(url.contains("scope"))
    assertFalse(url.contains("onOrAfter"))
  }

  /** A prompt field with `each` is one field per row of a list, and `$collect` gathers what was typed. */
  @Test
  fun aPromptFieldCanRepeatForEveryRowOfAList() {
    val action = ActionSpec.parse(
      Json.parseToJsonElement(
        """{"label":"Test","url":"/api/x","prompt":[{"key":"to","kind":"email"},
           {"each":"const.tokens","key":"token.{item.name}","label":"{item.name}","help":"{item.description}","initial":"{item.sample}"}],
           "body":{"to":"{form.to}","mergeValues":{"${'$'}collect":{"prefix":"token."}}}}""",
      ),
    )!!
    val scope = Json.parseToJsonElement(
      """{"const":{"tokens":[{"name":"org.name","description":"The workspace","sample":"Acme {x}"},{"name":"link","description":"","sample":""}]}}""",
    )
    val inputs = action.inputs(scope)
    assertEquals(listOf("to", "token.org.name", "token.link"), inputs.map { it.key })
    assertEquals("org.name", inputs[1].label)
    assertEquals("The workspace", inputs[1].help)
    // A brace in a sample is text, not a template.
    assertEquals("Acme {x}", ScreenValues.render(inputs[1].initial.orEmpty(), JsonObject(emptyMap())))
    val sent = ScreenValues.resolveBody(action.body!!, Json.parseToJsonElement("""{"form":{"to":"a@b.c","token.org.name":"Acme","token.link":""}}"""))
    assertEquals(Json.parseToJsonElement("""{"to":"a@b.c","mergeValues":{"org.name":"Acme"}}"""), sent)
    assertEquals(listOf("reason"), ActionSpec.parse(Json.parseToJsonElement("""{"label":"Go","url":"/api/x","reason":true}"""))!!.inputs(JsonObject(emptyMap())).map { it.key })
  }

  /** A list can be ordered by a field of its rows: numbers as numbers, anything else as text, rows without it last. */
  @Test
  fun sortOrdersByAFieldWithNumbersAsNumbersAndKeepsTiesInOrder() {
    val rows = (Json.parseToJsonElement("""[{"key":"a","value":9},{"key":"b","value":10},{"key":"c"},{"key":"d","value":10},{"key":"E","value":2}]""") as JsonArray).toList()
    fun keys(sort: String) = ScreenValues.sorted(rows, sort).map { ScreenValues.text(it.obj("key")) }
    assertEquals(listOf("b", "d", "a", "E", "c"), keys("value desc"))
    assertEquals(listOf("E", "a", "b", "d", "c"), keys("value"))
    assertEquals(listOf("a", "b", "c", "d", "E"), keys("key"))
    assertEquals(listOf("a", "b", "c", "d", "E"), keys(""))
  }

  /** A list can walk down into the lists inside its rows; each row found knows the row it came from. */
  @Test
  fun flattenWalksDownAndKeepsTheParent() {
    val sources = (Json.parseToJsonElement(
      """[{"id":"s1","tables":[{"heading":"By plugin","rows":[{"name":"A"},{"name":"B"}]},{"heading":"By shop","rows":[{"name":"C"}]}]},
         {"id":"s2","tables":[{"heading":"Other","rows":[]}]}]""",
    ) as JsonArray).toList()
    val rows = ScreenValues.flatten(sources, "tables.rows")
    assertEquals(listOf("A", "B", "C"), rows.map { ScreenValues.text(it.obj("name")) })
    assertEquals("By shop", ScreenValues.text(ScreenValues.lookup("item.\$parent.heading", ScreenContext.withItem(JsonObject(emptyMap()), rows[2]))))
    assertEquals("s1", ScreenValues.text(ScreenValues.lookup("item.\$parent.\$parent.id", ScreenContext.withItem(JsonObject(emptyMap()), rows[0]))))
    assertEquals(3, ScreenValues.flatten(sources, "tables").size)
  }

  @Test
  fun anActionCanShowTheRoutesAnswerInsteadOfItsSuccessMessage() {
    val action = ActionSpec.parse(
      Json.parseToJsonElement(
        """{"label":"Report","url":"/api/issue-reports","success":"Filed",
           "instead":{"when":"response.deflected","title":"Already answered","text":"{response.sections.0.title}: {response.sections.0.text}"}}""",
      ),
    )!!
    val instead = assertNotNull(action.instead)
    val answered = Json.parseToJsonElement("""{"response":{"deflected":true,"sections":[{"title":"Domains","text":"Point a CNAME."}]}}""")
    assertTrue(ScreenValues.condition(instead.str("when"), answered))
    assertEquals("Domains: Point a CNAME.", ScreenValues.render(instead.str("text")!!, answered))
    assertFalse(ScreenValues.condition(instead.str("when"), Json.parseToJsonElement("""{"response":{"ok":true}}""")))
  }

  @Test
  fun theReportFormShowsOnlyTheFieldsOfItsKind() {
    val file = File(screensDir, "account.screens.json")
    val support = ScreenSpec.parseFile(file.readText()).first { it.id == "core.support" }
    val block = support.blocks.first { it.title == "Report an issue" }
    val action = ActionSpec.parse(block.raw.arr("items").first())!!
    fun asked(kind: String): List<String> {
      val form = Json.parseToJsonElement("""{"form":{"kind":"$kind"}}""")
      return action.prompt.filter { ScreenValues.condition(it.whenCondition, form) }.map { it.key }
    }
    assertEquals(listOf("kind", "summary", "steps", "expected", "actual", "frequency", "contactConsent"), asked("bug"))
    assertEquals(listOf("kind", "summary", "problem", "workaround", "proposal", "contactConsent"), asked("idea"))
    assertEquals(listOf("kind", "summary", "question", "tried", "skipDeflection", "contactConsent"), asked("question"))
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

/** A reader that holds one site document and counts whatever it is asked to. */
private class CountingReader : com.aglyn.core.FirestoreReader {
  val counted = mutableListOf<String>()
  val equalities = mutableListOf<String>()

  override suspend fun get(path: String) = com.aglyn.core.FirestoreDoc(path.substringAfterLast('/'), path, mapOf("orgId" to "o9"))
  override suspend fun page(query: com.aglyn.core.FirestoreQuery) = com.aglyn.core.FirestorePage(emptyList(), null)
  override fun observeDoc(path: String) = kotlinx.coroutines.flow.emptyFlow<com.aglyn.core.Live<com.aglyn.core.FirestoreDoc?>>()
  override fun observe(query: com.aglyn.core.FirestoreQuery) = kotlinx.coroutines.flow.emptyFlow<com.aglyn.core.Live<List<com.aglyn.core.FirestoreDoc>>>()
  override suspend fun count(query: com.aglyn.core.FirestoreQuery): Long? {
    counted += query.collectionPath
    equalities += query.filters.map { it.field }
    return 42L
  }
}
