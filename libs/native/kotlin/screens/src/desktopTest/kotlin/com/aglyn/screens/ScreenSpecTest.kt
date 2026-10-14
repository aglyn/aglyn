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

  @Test
  fun theTokenSaysHowTheAccountSignsIn() {
    val enc = Base64.getUrlEncoder().withoutPadding()
    fun token(claims: String) = TokenClaims.fromIdToken("h.${enc.encodeToString(claims.toByteArray())}.s")
    val both = token("""{"email_verified":true,"firebase":{"identities":{"google.com":["1"],"email":["a@b.c"]},"sign_in_provider":"password"}}""")
    assertEquals(listOf("password", "google.com"), both.signInMethods)
    assertTrue(both.emailVerified)
    assertEquals(emptyList(), token("{}").signInMethods)
    assertFalse(token("{}").emailVerified)
    val context = ScreenSession(email = "a@b.c", claims = both).context(null, emptyMap())
    assertEquals("password, google.com", ScreenValues.render("{user.providers}", context))
    assertEquals("Yes", ScreenValues.render("{user.emailVerified:yesno}", context))
  }

  @Test
  fun aDownloadActionHandsBackTheFileUnderTheNameTheRouteGives() = runTest {
    val engine = MockEngine { request ->
      val named = request.url.encodedPath.endsWith("/named")
      respond(
        """{"a":1}""", HttpStatusCode.OK,
        if (named) headersOf("Content-Disposition" to listOf("attachment; filename=\"export-2026.json\""), "Content-Type" to listOf("application/json")) else headersOf(),
      )
    }
    val api = ConsoleApiClient("http://localhost", HttpClient(engine) { expectSuccess = false }, { "t" }, sleep = {})
    val model = ScreenModel(ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X"}"""))!!, JsonObject(emptyMap()), api)
    val named = ActionSpec.parse(Json.parseToJsonElement("""{"label":"Export","method":"GET","url":"/api/x/named","download":"fallback.json","success":"Ready"}"""))!!
    val file = model.run(named, JsonObject(emptyMap()))
    assertIs<ActionOutcome.File>(file)
    assertEquals("export-2026.json", file.name)
    assertEquals("Ready", file.message)
    assertEquals("""{"a":1}""", file.bytes.decodeToString())
    val unnamed = ActionSpec.parse(Json.parseToJsonElement("""{"label":"Export","method":"GET","url":"/api/x/other","download":"fallback.json"}"""))!!
    assertEquals("fallback.json", (model.run(unnamed, JsonObject(emptyMap())) as ActionOutcome.File).name)
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
      assertEquals("2026-Q4", now.str("quarter"))
      assertEquals(1_791_385_440_000.0, ((now as JsonObject)["ms"] as JsonPrimitive).content.toDouble())
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
  fun choicesFromDataLeaveOutWhatTheFilterRefuses() {
    val field = FieldSpec.parse(
      Json.parseToJsonElement(
        """{"key":"screen","kind":"select","options":[{"value":"","label":"Built-in form"}],
           "optionsFrom":{"items":"data.screens","value":"{item.${'$'}id}","label":"{item.displayName|item.${'$'}id}","filter":"!item.deletedAt && item.kind != group"}}""",
      ),
    )!!
    val context = Json.parseToJsonElement(
      """{"data":{"screens":[{"${'$'}id":"home","displayName":"Home"},{"${'$'}id":"old","displayName":"Old","deletedAt":5},
          {"${'$'}id":"folder","displayName":"Folder","kind":"group"},{"${'$'}id":"login"}]}}""",
    )
    assertEquals(listOf("", "home", "login"), field.choices(context).map { it.first })
    assertEquals(listOf("Built-in form", "Home", "login"), field.choices(context).map { it.second })
    assertTrue(ActionSpec.parse(Json.parseToJsonElement("""{"label":"Set","siteWide":true,"write":{"doc":"hosts/h"}}"""))!!.siteWide)
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
  fun aMultiselectHoldsTheChosenIdsAndReadsThemBack() {
    val field = FieldSpec.parse(
      Json.parseToJsonElement(
        """{"key":"models","kind":"multiselect","initial":"{data.row.models}",
           "optionsFrom":{"items":"data.models","value":"{item.id}","label":"{item.label}"}}""",
      ),
    )!!
    val context = Json.parseToJsonElement("""{"data":{"row":{"models":["a","c"]},"models":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}}""")
    assertEquals(listOf("a", "b"), field.choices(context).map { it.first })
    val start = initialValue(field, context)
    assertEquals(FieldValue.Text("a\nc"), start)
    assertEquals(Json.parseToJsonElement("""["a","c"]"""), fieldJson(field, start))
    assertEquals(JsonNull, fieldJson(field, FieldValue.Text("")))
  }

  @Test
  fun aFileFieldSendsTheParsedFileAndAnActionKeepsWhatItLearnedForTheNextScreen() = runTest {
    val file = FieldSpec.parse(Json.parseToJsonElement("""{"key":"package","kind":"file","parse":"json"}"""))!!
    assertEquals(Json.parseToJsonElement("""{"manifest":{"items":[]}}"""), fieldJson(file, FieldValue.Text("""{"manifest":{"items":[]}}""")))
    assertEquals(JsonNull, fieldJson(file, FieldValue.Text("not json")))
    assertEquals(JsonNull, fieldJson(file, FieldValue.Text("")))
    val sent = mutableListOf<HttpRequestData>()
    val api = client(200 to """{"plan":{"items":[{"key":"page/a","comparison":"differs","proposed":"skip","needsChoice":true,"choices":["replace","keepBoth","merge","skip"]}]}}""", sent = sent)
    val importSpec = ScreenSpec.parseFile(File(screensDir, "site-import.screens.json").readText()).first { it.id == "core.site.import" }
    val plan = ActionSpec.parse(importSpec.blocks.first { it.id == "package" }["submit"])!!
    ScreenStash.clear()
    val model = ScreenModel(importSpec, JsonObject(emptyMap()), api)
    model.run(plan, Json.parseToJsonElement("""{"site":{"id":"h1"},"form":{"package":{"manifest":{"items":[]}}}}"""))
    assertEquals(Json.parseToJsonElement("""{"manifest":{"items":[]}}"""), ScreenStash.values["package"])
    // A changed item waits for a choice: it is not decided, and it is the one thing left to decide.
    assertEquals(Json.parseToJsonElement("{}"), ScreenStash.values["decisions"])
    assertEquals(Json.parseToJsonElement("""{"page/a":"page/a"}"""), ScreenStash.values["undecided"])
    val review = ScreenSpec.parseFile(File(screensDir, "site-import.screens.json").readText()).first { it.id == "core.site.import.review" }
    val choose = ActionSpec.parse(review.blocks.last { it.type == "list" }.raw.arr("actions").first())!!
    val row = Json.parseToJsonElement("""{"key":"page/a","choices":["replace","keepBoth","merge","skip"]}""")
    val picking = ScreenContext.with(ScreenContext.withItem(ScreenContext.with(JsonObject(emptyMap()), "stash", ScreenStash.values), row), "form", Json.parseToJsonElement("""{"decision":"skip"}"""))
    ScreenModel(review, JsonObject(emptyMap()), api).run(choose, picking)
    assertEquals(Json.parseToJsonElement("""{"page/a":"skip"}"""), ScreenStash.values["overrides"])
    assertEquals(Json.parseToJsonElement("""{"page/a":"skip"}"""), ScreenStash.values["decisions"])
    assertEquals(Json.parseToJsonElement("{}"), ScreenStash.values["undecided"])
    assertEquals(listOf("replace", "keepBoth", "merge", "skip"), choose.prompt.first().choices(picking).map { it.first })  // merge is chosen key by key on the item
    ScreenStash.clear()
  }

  @Test
  fun theProfileListsSignInMethodsAndOnlyOffersToDisconnectOneWhileAnotherRemains() = runTest {
    val unlinked = mutableListOf<String>()
    val account = AccountOperations(unlinkProvider = { unlinked += it })
    val spec = ScreenSpec.parseFile(File(screensDir, "account.screens.json").readText()).first { it.id == "core.account.profile" }
    val list = spec.blocks.first { it.title == "Sign-in methods" }
    val unlink = ActionSpec.parse(list.raw.arr("actions").first())!!
    fun scope(providers: List<String>, item: String) = ScreenContext.withItem(
      Json.parseToJsonElement("""{"user":{"providers":${providers.joinToString(",", "[", "]") { "\"$it\"" }}}}"""), JsonPrimitive(item),
    )
    assertTrue(ScreenValues.condition(unlink.whenCondition, scope(listOf("password", "google.com"), "google.com")))
    assertFalse(ScreenValues.condition(unlink.whenCondition, scope(listOf("password", "google.com"), "password")))
    assertFalse(ScreenValues.condition(unlink.whenCondition, scope(listOf("google.com"), "google.com")))
    val model = ScreenModel(spec, JsonObject(emptyMap()), null, account = account)
    // The screen's own constants (the provider names) come with the model's context.
    val shown = ScreenContext.with(ScreenContext.withItem(model.context, JsonPrimitive("google.com")), "user", Json.parseToJsonElement("""{"providers":["password","google.com"]}"""))
    val outcome = model.run(unlink, shown)
    assertIs<ActionOutcome.Done>(outcome)
    assertEquals("Google disconnected", outcome.message)
    assertEquals(listOf("google.com"), unlinked)
  }

  @Test
  fun savingTheBusinessProfileWritesFieldsSourcesAndWhoSavedIt() = runTest {
    var path = ""
    var fields: Map<String, Any?> = emptyMap()
    val writer = object : com.aglyn.core.FirestoreWriter {
      override suspend fun merge(path0: String, data: Map<String, Any?>) { path = path0; fields = data }
    }
    val spec = ScreenSpec.parseFile(File(screensDir, "workspace.screens.json").readText()).first { it.id == "core.settings.profile" }
    val form = spec.blocks.first { it.id == "businessProfile" }
    val submit = ActionSpec.parse(form["submit"])!!
    val model = ScreenModel(spec, JsonObject(emptyMap()), null, writer = writer)
    val scope = Json.parseToJsonElement(
      """{"org":{"id":"o1"},"user":{"uid":"u1"},
          "data":{"business":{"whatYouDo":"Grooming","tone":"plain","sources":{"whatYouDo":"start","tone":"ai"}}},
          "form":{"whatYouDo":"Grooming","services":["Bath","bath","Groom"],"serviceArea":"","audience":"","tone":"premium","toneNotes":""}}""",
    )
    val outcome = model.run(submit, scope)
    assertIs<ActionOutcome.Done>(outcome)
    assertEquals("orgs/o1/businessProfile/defaults", path)
    assertEquals(listOf("Bath", "Groom"), fields["services"])
    assertEquals("premium", fields["tone"])
    assertEquals("u1", fields["updatedBy"])
    @Suppress("UNCHECKED_CAST") val sources = fields["sources"] as Map<String, Any?>
    assertEquals("start", sources["whatYouDo"])
    assertEquals("owner", sources["tone"])
    assertEquals("owner", sources["services"])
    assertEquals(com.aglyn.core.FirestoreDelete, sources["audience"])
  }

  @Test
  fun aSitePluginScreenWritesOnlyTheFieldsTheSiteOverrides() {
    val spec = ScreenSpec.parseFile(File(screensDir, "plugin-settings.screens.json").readText()).first { it.id == "core.sitePluginSettings.ai" }
    assertEquals(listOf("sitePluginSettings"), spec.zones)
    assertEquals("org.manager && params.pluginId == ai", spec.requires)
    val form = spec.blocks.first { it.type == "form" }
    val submit = ActionSpec.parse(form["submit"])!!
    val scope = Json.parseToJsonElement(
      """{"user":{"uid":"u1"},"form":{"ov_provider":true,"provider":"anthropic","ov_chatModel":false,"chatModel":"platform"}}""",
    )
    val written = ScreenValues.resolveBody(submit.write.obj("fields")!!, scope)
    assertEquals(JsonPrimitive("anthropic"), written.obj("provider"))
    assertEquals(Json.parseToJsonElement("""{"${'$'}delete":true}"""), written.obj("chatModel"))
    assertEquals(JsonPrimitive("u1"), written.obj("updatedBy"))
    val start = Json.parseToJsonElement("""{"data":{"site":{"provider":"anthropic"},"org":{}}}""")
    val toggles = form.raw.arr("fields").mapNotNull { FieldSpec.parse(it) }
    assertEquals(FieldValue.Flag(true), initialValue(toggles.first { it.key == "ov_provider" }, start))
    assertEquals(FieldValue.Flag(false), initialValue(toggles.first { it.key == "ov_chatModel" }, start))
  }

  @Test
  fun theForumOffersTheRoutesCategoriesAndFiltersByThem() {
    val forum = ScreenSpec.parseFile(File(screensDir, "account.screens.json").readText()).first { it.id == "core.support.forum" }
    val list = forum.blocks.first { it.type == "list" }
    assertEquals("category", list["chips"].str("field"))
    val context = Json.parseToJsonElement("""{"data":{"forum":{"categories":["General","Building"]}}}""")
    assertEquals(listOf("General", "Building"), (ScreenValues.lookup(list["chips"].str("from").orEmpty(), context) as JsonArray).map { ScreenValues.text(it) })
    val create = ActionSpec.parse(forum.raw.arr("actions").first())!!
    assertEquals(listOf("General", "Building"), create.prompt.first().choices(context).map { it.first })
  }

  @Test
  fun theAddOnConfirmationReadsThePreviewAndBankAnswersReplaceTheSuccessMessage() {
    val spec = ScreenSpec.parseFile(File(screensDir, "billing.screens.json").readText()).first { it.id == "core.billing.addons" }
    val list = spec.blocks.first { it.type == "list" }
    val set = ActionSpec.parse(list.raw.arr("actions").first())!!
    assertNotNull(set.check)
    assertTrue(set.asksConfirmation)
    fun scope(form: String, extra: String) = Json.parseToJsonElement(
      """{"data":{"addons":{"interval":"month","catalog":{"hosts":{"unitUsd":5}}}},"item":{"kind":"hosts","label":"Extra sites"},"form":$form,$extra}""",
    )
    assertEquals(
      "Extra sites: 3? $12.50 will be charged to your card now, prorated for the rest of this period, including tax. Ongoing: 3 at $5.00/mo each.",
      set.confirmText(scope("""{"quantity":3}""", """"preview":{"chargedNowCents":1250,"currency":"usd","taxCents":100,"taxComplete":true}""")),
    )
    assertEquals(
      "Extra sites: 0? Nothing is charged and nothing is refunded. You keep this capacity for the rest of the period you have paid for, and it ends on Nov 1, 2026. From then: nothing, this add-on is removed.",
      set.confirmText(scope("""{"quantity":0}""", """"preview":{"defersToPeriodEnd":true,"effectiveAt":"2026-11-01T00:00:00Z","currency":"usd"}""")),
    )
    val bank = scope("{}", """"response":{"paymentPending":true,"requiresAction":true,"hostedInvoiceUrl":"https://invoice.test/i"}""")
    assertEquals("hostedInvoiceUrl", set.insteadEntry(bank).str("open"))
    assertEquals("Card declined", set.insteadEntry(scope("{}", """"response":{"paymentPending":true,"declined":true}""")).str("title"))
    assertNull(set.insteadEntry(scope("{}", """"response":{"ok":true,"quantities":{"hosts":3}}""")))
  }

  @Test
  fun thePlanChangeQuotesWhatTheConsoleQuotes() {
    val spec = ScreenSpec.parseFile(File(screensDir, "billing.screens.json").readText()).first { it.id == "core.billing.plans" }
    val list = spec.blocks.first { it.type == "list" }
    val switchPlan = list.raw.arr("actions").mapNotNull { ActionSpec.parse(it) }.first { it.id == "switch" }
    assertNotNull(switchPlan.check)
    val constants = spec.raw.obj("constants").toString()
    fun scope(item: String, preview: String, data: String): JsonElement = Json.parseToJsonElement(
      """{"item":$item,"const":$constants,"data":$data,"preview":$preview}""",
    )
    val data = """{"org":{"plan":"pro","subscription":{"status":"active"}},"billing":{"subscription":{}},"collab":{"sites":[{"hostId":"a"},{"hostId":"b"}]},"seats":{"managerSeats":2},"datasets":{"count":1}}"""
    val business = """{"id":"business","label":"Business"}"""
    assertEquals(
      "Switch to Business? You'll be charged $11.00 USD now for the rest of this period, and your plan changes as soon as the payment goes through. That includes $1.00 USD tax.",
      switchPlan.confirmText(scope(business, """{"downgrade":false,"chargesNow":true,"prorationCents":1000,"chargedNowCents":1100,"prorationTaxCents":100,"taxComplete":true,"currency":"usd","periodEnd":"2026-11-01T00:00:00Z"}""", data)),
    )
    assertEquals(
      "Switch to Business? Unused time credits $2.50 USD back on your next invoice on Nov 1, 2026. Tax is calculated once we have your billing address. This total does not include it yet.",
      switchPlan.confirmText(scope(business, """{"downgrade":false,"prorationCents":-250,"taxComplete":false,"currency":"usd","periodEnd":"2026-11-01T00:00:00Z"}""", data)),
    )
    assertEquals(
      "Move down to Business? Nothing is charged today, and nothing changes yet. You keep Pro — and everything you've already paid for — until Nov 1, 2026, when this organization moves to Business. You can keep your current plan any time before then.",
      switchPlan.confirmText(scope(business, """{"downgrade":true,"periodEnd":"2026-11-01T00:00:00Z"}""", data)),
    )
    val withAi = """{"org":{"plan":"pro","subscription":{"status":"active"},"seatAddons":{"aiAddon":1}},"billing":{"subscription":{}},"collab":{"sites":[{"hostId":"a"},{"hostId":"b"}]},"seats":{"managerSeats":7},"datasets":{"count":1}}"""
    val text = switchPlan.confirmText(scope("""{"id":"free","label":"Free"}""", """{"downgrade":true,"periodEnd":"2026-11-01T00:00:00Z","droppedAddons":["aiAddon"]}""", withAi))!!
    assertTrue("Your Aglyn AI add-on is not sold on Free, so it is removed" in text)
    assertTrue("over the Free plan on: 2 sites (Free includes 1)" in text)
    assertTrue("7 team members (Free includes 1)" in text)
    assertTrue("Nothing is deleted and these keep working" in text)
    val manager = Json.parseToJsonElement("""{"org":{"manager":true,"plan":"pro"},"data":{"org":{"plan":"pro","subscription":{"status":"active"}}},"item":{"id":"business"}}""")
    assertTrue(ScreenValues.condition(switchPlan.whenCondition, manager))
    val current = Json.parseToJsonElement("""{"org":{"manager":true},"data":{"org":{"plan":"pro","subscription":{"status":"active"}}},"item":{"id":"pro"}}""")
    assertFalse(ScreenValues.condition(switchPlan.whenCondition, current))
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
  fun accountActionsChangeThePasswordAndNameThroughTheSession() = runTest {
    val passwords = mutableListOf<Pair<String, String>>()
    val names = mutableListOf<String>()
    val account = AccountOperations(
      changePassword = { current, new -> passwords += current to new },
      updateDisplayName = { names += it },
    )
    val spec = ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X"}"""))!!
    val model = ScreenModel(spec, JsonObject(emptyMap()), client(sent = mutableListOf()), account = account)
    val change = ActionSpec.parse(
      Json.parseToJsonElement(
        """{"label":"Change","account":"changePassword","success":"Done",
           "body":{"current":"{form.current}","new":"{form.password}","confirm":"{form.confirm}"}}""",
      ),
    )!!
    fun form(password: String, confirm: String) = Json.parseToJsonElement("""{"form":{"current":"old","password":"$password","confirm":"$confirm"}}""")
    assertEquals(ActionOutcome.Failed("Use at least 12 characters."), model.run(change, form("short", "short")))
    assertEquals(ActionOutcome.Failed("The two new passwords do not match."), model.run(change, form("a-long-enough-one", "different-long-one")))
    assertTrue(passwords.isEmpty())
    assertEquals(ActionOutcome.Done("Done", null), model.run(change, form("a-long-enough-one", "a-long-enough-one")))
    assertEquals(listOf("old" to "a-long-enough-one"), passwords)
    val name = ActionSpec.parse(Json.parseToJsonElement("""{"label":"Name","account":"updateDisplayName","body":{"name":"{form.first} {form.last}"}}"""))!!
    model.run(name, Json.parseToJsonElement("""{"form":{"first":"Ada","last":"Lovelace"}}"""))
    assertEquals(listOf("Ada Lovelace"), names)
  }

  @Test
  fun writeTurnsSentinelObjectsIntoFirestoreSentinels() {
    val plain = ScreenModel.plain(Json.parseToJsonElement("""{"a":{"${'$'}serverTimestamp":true},"b":{"${'$'}delete":true},"c":{"d":"x"}}""")) as Map<*, *>
    assertEquals(com.aglyn.core.ServerTimestamp, plain["a"])
    assertEquals(com.aglyn.core.FirestoreDelete, plain["b"])
    assertEquals("x", (plain["c"] as Map<*, *>)["d"])
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

  private fun transfer(id: String) = ScreenSpec.parseFile(File(screensDir, "transfer.screens.json").readText()).first { it.id == id }

  @Test
  fun aPostLoadPagesByPuttingItsCursorInTheBody() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(
      200 to """{"jobs":[{"id":"a"}],"next":1791385440000}""",
      200 to """{"jobs":[{"id":"b"}],"next":null}""",
      sent = sent,
    )
    val spec = ScreenSpec.parse(
      Json.parseToJsonElement(
        """{"id":"core.x","title":"X","load":{"jobs":{"url":"/api/transfer/jobs","method":"POST","body":{"orgId":"{org.id}","limit":25},"cursor":"next","cursorParam":"after","items":"jobs"}}}""",
      ),
    )!!
    val model = ScreenModel(spec, Json.parseToJsonElement("""{"org":{"id":"o1"},"data":{}}"""), api)
    model.load()
    // A number cursor (a job's createdAt) pages as text, and goes back as the number it was.
    assertEquals("1791385440000", model.cursors["jobs"])
    model.loadMore("jobs")
    assertEquals(2, (ScreenValues.lookup("data.jobs.jobs", model.context) as JsonArray).size)
    assertFalse("jobs" in model.cursors)
    assertEquals(Json.parseToJsonElement("""{"orgId":"o1","limit":25,"after":1791385440000}"""), Json.parseToJsonElement((sent.last().body as TextContent).text))
    assertEquals("/api/transfer/jobs", sent.last().url.encodedPath)
    assertEquals("", sent.last().url.encodedQuery)
  }

  @Test
  fun aListAndAnOptionSourceCanWalkTheListsInsideTheRows() {
    val context = Json.parseToJsonElement(
      """{"params":{},"data":{"resources":[
          {"key":"outreach.sequences","label":"Sequences","items":[{"key":"outreach.sequences/a","name":"Welcome"},{"key":"outreach.sequences/b","id":"b"}]},
          {"key":"marketing.campaigns","label":"Campaigns","items":[{"key":"marketing.campaigns/c","name":"Launch"}]},
          {"key":"crm.email-templates","label":"Email templates","items":[]}]}}""",
    )
    val field = FieldSpec.parse(
      Json.parseToJsonElement(
        """{"key":"items","kind":"multiselect",
           "initial":"{data.resources[key=params.resource].items.*.key|data.resources.*.items.*.key}",
           "optionsFrom":{"items":"data.resources","within":"items","value":"{item.key}","label":"{parent.label}: {item.name|item.id}"}}""",
      ),
    )!!
    assertEquals(
      listOf("outreach.sequences/a=Sequences: Welcome", "outreach.sequences/b=Sequences: b", "marketing.campaigns/c=Campaigns: Launch"),
      field.choices(context).map { "${it.first}=${it.second}" },
    )
    // Everything is picked until a resource is named, then only its items.
    assertEquals(FieldValue.Text("outreach.sequences/a\noutreach.sequences/b\nmarketing.campaigns/c"), initialValue(field, context))
    assertEquals(
      FieldValue.Text("marketing.campaigns/c"),
      initialValue(field, ScreenContext.with(context, "params", Json.parseToJsonElement("""{"resource":"marketing.campaigns"}"""))),
    )
    val rows = ScreenValues.scopes("data.resources", "items", "item.name", context)
    assertEquals(2, rows.size)
    assertEquals("Campaigns", ScreenValues.render("{parent.label}", rows[1]))
  }

  @Test
  fun aMultiselectThatCoversAllIsUnfinishedUntilEveryChoiceIsChosen() {
    val field = FieldSpec.parse(
      Json.parseToJsonElement(
        """{"key":"ack","kind":"multiselect","coversAll":true,"optionsFrom":{"items":"data.warnings","value":"{item}","label":"{item}"}}""",
      ),
    )!!
    val context = Json.parseToJsonElement("""{"data":{"warnings":["replace","failed"]}}""")
    assertTrue(field.unmet(JsonNull, context))
    assertTrue(field.unmet(Json.parseToJsonElement("""["replace"]"""), context))
    assertFalse(field.unmet(Json.parseToJsonElement("""["failed","replace"]"""), context))
    assertFalse(field.unmet(JsonNull, Json.parseToJsonElement("""{"data":{"warnings":[]}}""")))
  }

  @Test
  fun anActionCanSaveTheValueAtAPathOfTheRoutesAnswerAsTheFile() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(200 to """{"ok":true,"fileName":"aglyn-package-2026.json","package":{"name":"a/b","manifest":{"items":[]}}}""", sent = sent)
    val spec = transfer("core.settings.data.packageExport")
    val export = ActionSpec.parse(spec.blocks.first { it.type == "actions" }.raw.arr("items").first())!!
    assertEquals("package", export.downloadAt)
    val scope = Json.parseToJsonElement("""{"org":{"id":"o1"},"form":{"items":["outreach.sequences/a"],"dependencies":true}}""")
    val file = ScreenModel(spec, JsonObject(emptyMap()), api).run(export, scope)
    assertIs<ActionOutcome.File>(file)
    assertEquals("aglyn-package-2026.json", file.name)
    // The file is the package alone, indented, with no escaped slashes, and it reads back as it was.
    val text = file.bytes.decodeToString()
    assertTrue("\n  " in text)
    assertTrue("\"a/b\"" in text)
    assertEquals(Json.parseToJsonElement("""{"name":"a/b","manifest":{"items":[]}}"""), Json.parseToJsonElement(text))
    assertEquals(
      Json.parseToJsonElement("""{"orgId":"o1","action":"export","items":["outreach.sequences/a"],"dependencies":true}"""),
      Json.parseToJsonElement((sent.last().body as TextContent).text),
    )
  }

  @Test
  fun thePackageReviewPlansAgainOnEveryChoiceAndAsksForEveryAcknowledgement() = runTest {
    val plan = """{"job":{"id":"j1"},"items":[],"references":[],"summary":{"create":1},"blocking":[],"acknowledgementsRequired":["replace","failed"],"resources":{}}"""
    val sent = mutableListOf<HttpRequestData>()
    val api = client(200 to plan, 200 to plan, sent = sent)
    val review = transfer("core.settings.data.packageReview")
    val model = ScreenModel(review, JsonObject(emptyMap()), api)
    val chooseItem = ActionSpec.parse(review.blocks.first { it.type == "list" && it.title == "Items" }.raw.arr("actions").first())!!
    ScreenStash.clear()
    ScreenStash.set(
      Json.parseToJsonElement("""{"plan":{"job":{"id":"j1"}},"decisions":{"page/x":"skip"},"dependencyChoices":{"mailbox/m":{"action":"dropReference"}}}"""),
    )
    val row = Json.parseToJsonElement("""{"key":"outreach.sequences/a","decision":"create","decisions":["create","replace","skip"]}""")
    val picking = ScreenContext.with(
      ScreenContext.withItem(Json.parseToJsonElement("""{"org":{"id":"o1"}}""").let { ScreenContext.with(it, "stash", ScreenStash.values) }, row),
      "form", Json.parseToJsonElement("""{"decision":"replace"}"""),
    )
    assertTrue(ScreenValues.condition(chooseItem.whenCondition, picking))
    assertFalse(ScreenValues.condition(chooseItem.whenCondition, ScreenContext.with(picking, "item", Json.parseToJsonElement("""{"decisions":["create"]}"""))))
    model.run(chooseItem, picking)
    // The new choice joins the earlier ones, and the other kind of choice is sent along unchanged.
    assertEquals(
      Json.parseToJsonElement(
        """{"orgId":"o1","action":"plan","jobId":"j1","decisions":{"page/x":"skip","outreach.sequences/a":"replace"},"dependencyChoices":{"mailbox/m":{"action":"dropReference"}}}""",
      ),
      Json.parseToJsonElement((sent.last().body as TextContent).text),
    )
    assertEquals(Json.parseToJsonElement("""{"page/x":"skip","outreach.sequences/a":"replace"}"""), ScreenStash.values["decisions"])

    // A reference mapped to one of yours carries that one; a leave-out carries no id.
    val chooseReference = ActionSpec.parse(
      review.blocks.first { it.type == "list" && it.title == "Things this workspace does not have" }.raw.arr("actions").first(),
    )!!
    val reference = Json.parseToJsonElement("""{"key":"mailbox/m2","choices":["import","mapTo","skipItem"],"targets":[]}""")
    val mapping = ScreenContext.with(
      ScreenContext.withItem(Json.parseToJsonElement("""{"org":{"id":"o1"}}""").let { ScreenContext.with(it, "stash", ScreenStash.values) }, reference),
      "form", Json.parseToJsonElement("""{"action":"skipItem"}"""),
    )
    assertEquals(listOf("import", "skipItem"), chooseReference.prompt.first().choices(mapping).map { it.first }) // nothing of yours to map to
    model.run(chooseReference, mapping)
    val second = Json.parseToJsonElement((sent.last().body as TextContent).text)
    assertEquals(
      Json.parseToJsonElement("""{"mailbox/m":{"action":"dropReference"},"mailbox/m2":{"action":"skipItem"}}"""),
      (second as JsonObject)["dependencyChoices"],
    )

    // Import asks for every acknowledgement the plan requires, and for none when it requires none.
    val apply = ActionSpec.parse(review.blocks.last { it.type == "actions" }.raw.arr("items").first())!!
    val ack = apply.prompt.first()
    val waiting = ScreenContext.with(JsonObject(emptyMap()), "stash", ScreenStash.values)
    assertEquals(listOf("replace", "failed"), ack.choices(waiting).map { it.first })
    assertTrue(ack.unmet(Json.parseToJsonElement("""["replace"]"""), waiting))
    assertFalse(ack.unmet(Json.parseToJsonElement("""["replace","failed"]"""), waiting))
    val applyNow = ActionSpec.parse(review.blocks.last { it.type == "actions" }.raw.arr("items").last())!!
    assertEquals("applyNow", applyNow.id)
    fun offered(plan: String) =
      listOf(apply, applyNow).filter { ScreenValues.condition(it.whenCondition, Json.parseToJsonElement("""{"stash":{"plan":$plan}}""")) }.map { it.id }
    assertEquals(listOf("apply"), offered("""{"acknowledgementsRequired":["replace"],"blocking":[]}"""))
    assertEquals(listOf("applyNow"), offered("""{"acknowledgementsRequired":[],"blocking":[]}"""))
    assertEquals(emptyList(), offered("""{"acknowledgementsRequired":["replace"],"blocking":["Choose what happens to 1 item."]}"""))
    assertEquals(emptyList(), offered("""{"acknowledgementsRequired":[],"blocking":["Choose what happens to 1 item."]}"""))
    ScreenStash.clear()
  }

  @Test
  fun theRulesListShowsOnlyTheResourcesTheFileHolds() {
    val review = transfer("core.settings.data.packageReview")
    val rules = review.blocks.first { it.type == "list" && it.title == "Rules every import keeps" }
    val context = Json.parseToJsonElement(
      """{"stash":{"plan":{
          "items":[{"kind":"outreach.sequences"},{"kind":"outreach.sequences"}],
          "resources":{
            "outreach.sequences":{"label":"Sequences","rules":[{"label":"Imported as a draft","reason":"A sequence never sends from a file."}]},
            "marketing.campaigns":{"label":"Campaigns","rules":[{"label":"Imported as a draft","reason":"x"}]},
            "crm.email-templates":{"label":"Email templates","rules":[]}}}}}""",
    )
    val found = ScreenValues.scopes("stash.plan.resources", null, rules.string("filter"), context)
    assertEquals(listOf("Sequences"), found.map { ScreenValues.render("{item.value.label}", it) })
    assertEquals("Imported as a draft", ScreenValues.render(rules.string("secondary").orEmpty(), found[0]))
  }

  @Test
  fun theHubPagesItsHistoryAndOffersTheConsolesRowActions() {
    val hub = transfer("core.settings.data")
    val jobs = hub.loads.first { it.key == "jobs" }
    assertEquals(com.aglyn.core.ApiMethod.POST, jobs.method)
    assertEquals("next", jobs.cursor)
    assertEquals("after", jobs.cursorParam)
    val history = hub.blocks.first { it.title == "History" }
    assertEquals("jobs", history.string("load"))
    val actions = history.raw.arr("actions").mapNotNull { ActionSpec.parse(it) }
    val job = Json.parseToJsonElement("""{"org":{"id":"o1"},"item":{"id":"j9","kind":"package","resultFile":true,"undo":{"available":true}}}""")
    assertEquals(listOf("results", "undo"), actions.filter { ScreenValues.condition(it.whenCondition, job) }.map { it.id })
    // A records import opens in the wizard (its results and its undo), until it is undone.
    val records = Json.parseToJsonElement("""{"item":{"id":"j9","kind":"records","status":"applied","resultFile":false,"undo":{"available":true}}}""")
    assertEquals(listOf("open"), actions.filter { ScreenValues.condition(it.whenCondition, records) }.map { it.id })
    val undone = Json.parseToJsonElement("""{"item":{"id":"j9","kind":"records","status":"undone","resultFile":true}}""")
    assertEquals(listOf("results"), actions.filter { ScreenValues.condition(it.whenCondition, undone) }.map { it.id })
    assertEquals("import-j9-results.csv", ScreenValues.render(actions.first().download!!, job))
  }

  @Test
  fun theRecordsListShowsWhatThePluginsAndThePlanAllowAndExportsThroughTheDialog() {
    val records = ScreenSpec.parseFile(File(screensDir, "transfer-resources.screens.json").readText()).first { it.id == "core.settings.data.records" }
    val consts = records.raw.obj("constants")!!
    fun context(crm: Boolean, running: List<String>) = Json.parseToJsonElement(
      """{"org":{"id":"o1","manager":true},"const":$consts,"data":{
          "sw":{"rows":[${running.joinToString(",") { """{"id":"$it","on":true}""" }}]},
          "ent":{"features":{"crm":$crm}},
          "datasets":{"items":[{"${'$'}id":"d1","name":"Pets"}]}}}""",
    )
    val crmList = records.blocks.first { it.title == "CRM" }
    val on = context(false, listOf("crm"))
    assertTrue(ScreenValues.condition(crmList.whenCondition, on))
    // On a plan without the CRM only the exports that stay free are listed.
    val free = ScreenValues.scopes(crmList.string("items").orEmpty(), null, crmList.string("filter"), on)
    assertEquals(listOf("crm.contacts", "crm.leads"), free.map { ScreenValues.render("{item.key}", it) })
    val paid = ScreenValues.scopes(crmList.string("items").orEmpty(), null, crmList.string("filter"), context(true, listOf("crm")))
    assertTrue(paid.size > free.size)
    assertFalse(ScreenValues.condition(crmList.whenCondition, context(true, emptyList())))
    val note = records.blocks.first { it.type == "notice" && it.whenCondition?.contains("!data.ent.features.crm") == true }
    assertTrue(ScreenValues.condition(note.whenCondition, on))
    assertFalse(ScreenValues.condition(note.whenCondition, context(true, listOf("crm"))))

    // A row's Export opens the platform dialog on its resource, for the whole workspace.
    val export = ActionSpec.parse(crmList.raw.arr("actions").first())!!
    val request = export.exportRequest(free[0])!!
    assertEquals("crm.contacts", request.resource)
    assertEquals("Export Contacts", request.title)
    assertNull(request.hostId)
    assertEquals("crm-contacts", request.fileStem)
    assertTrue(ScreenValues.condition(export.whenCondition, free[0]))

    // A dataset is exported on its own, under the key that names it.
    val datasets = records.blocks.first { it.title == "Dataset records" }
    val dataset = ScreenValues.scopes("data.datasets.items", null, null, on).first()
    val one = ActionSpec.parse(datasets.raw.arr("actions").first())!!.exportRequest(dataset)!!
    assertEquals("data.dataset:d1", one.resource)
    assertEquals("Export Pets", one.title)
    assertEquals("data-dataset-d1", one.fileStem)

    // A site's resources name the site.
    val site = ScreenSpec.parseFile(File(screensDir, "transfer-resources.screens.json").readText()).first { it.id == "core.site.data" }
    val redirects = site.blocks.first { it.title == "Redirects" }
    val siteContext = ScreenContext.withItem(Json.parseToJsonElement("""{"site":{"id":"h1"}}"""), Json.parseToJsonElement("""{"key":"redirects","label":"Redirects"}"""))
    val inSite = ActionSpec.parse(redirects.raw.arr("actions").first())!!.exportRequest(siteContext)!!
    assertEquals("h1", inSite.hostId)
    assertEquals("redirects", inSite.resource)
    assertNull(ActionSpec.parse(Json.parseToJsonElement("""{"label":"Go","url":"/api/x"}"""))!!.exportRequest(JsonObject(emptyMap())))
  }
}
