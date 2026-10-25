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
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
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
  fun deleteSiteConfirmIgnoresSurroundingSpacesAsTheConsoleDoes() {
    val spec = Json.parseToJsonElement(File(screensDir, "site.screens.json").readText()).arr("screens")
      .mapNotNull { ScreenSpec.parse(it) }.first { it.id == "core.site.delete" }
    val actions = spec.blocks.first { it.type == "actions" }
    val delete = actions.raw.arr("items").mapNotNull { ActionSpec.parse(it) }.first { it.id == "delete" }
    val typed = delete.prompt.first { it.key == "typed" }
    val context = Json.parseToJsonElement("""{"site":{"id":"h1","name":"Delete test Mac"}}""")
    // The console compares `confirmText.trim()`: a keyboard's prediction ending the name with a space still confirms.
    assertFalse(typed.mismatches(JsonPrimitive("Delete test Mac"), context))
    assertFalse(typed.mismatches(JsonPrimitive("Delete test Mac "), context))
    assertFalse(typed.mismatches(JsonPrimitive(" Delete test Mac\n"), context))
    assertTrue(typed.mismatches(JsonPrimitive("Delete test Ma"), context))
    assertTrue(typed.mismatches(JsonPrimitive("delete test mac"), context))
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
    for (case in file.arr("dollars")) {
      assertEquals((case.obj("cents") as? JsonPrimitive)?.takeIf { it !is JsonNull }?.intOrNull, ScreenValues.dollarsToCents(case.str("typed")!!), case.str("typed"))
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
    val known = setOf("fields", "meters", "list", "form", "actions", "links", "notice", "zone", "image", "html")
    // Screens a plugin draws by hand rather than from a spec, which a spec may still open.
    val handWritten = setOf("commerce.orders", "commerce.order", "commerce.products", "commerce.product", "commerce.sales", "marketplace.listing")
    for (spec in specs) {
      assertTrue(spec.scope in setOf("org", "site", "account", "staff"), "${spec.id}: scope ${spec.scope}")
      for (block in spec.blocks) assertTrue(block.type in known, "${spec.id}: block ${block.type}")
      for (target in targets(spec.raw)) assertTrue(target in ids || target in handWritten, "${spec.id} opens $target, which no spec declares")
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

  /** `{press}` is one key per tap: its own retry shares it, and a second tap of the very same request gets another. */
  @Test
  fun aPressKeyIsNewForEachTapAndSharedByItsRetries() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(503 to "{}", 200 to "{}", 200 to "{}", sent = sent)
    val spec = ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X"}"""))!!
    val form = Json.parseToJsonElement("""{"form":{"points":"50"}}""")
    val model = ScreenModel(spec, form, api)
    val action = ActionSpec.parse(
      Json.parseToJsonElement(
        """{"label":"Adjust","url":"/api/loyalty/member","body":{"points":"{form.points}"},
           "headers":{"Idempotency-Key":"{press}"}}""",
      ),
    )!!
    model.run(action, form)
    model.run(action, form)
    val keys = sent.map { it.headers["Idempotency-Key"] }
    assertEquals(3, keys.size)
    assertNotNull(keys[0])
    assertEquals(keys[0], keys[1])
    assertNotEquals(keys[1], keys[2])
  }

  /** An `export` action asks nothing of a route: it names the transfer resource, and its title, file name and filter are templates. */
  @Test
  fun anExportActionNamesTheResourceAndMakesNoRequestOfItsOwn() {
    val action = ActionSpec.parse(
      Json.parseToJsonElement(
        """{"label":"Export","export":{"resource":"forms.submissions","title":"Export {item.name}","fileStem":"{item.slug}","filter":{"formId":"{item.id}"}}}""",
      ),
    )!!
    val export = assertNotNull(action.export)
    assertEquals("forms.submissions", export.str("resource"))
    assertEquals(null, action.url)
    assertTrue(!action.reload, "an export has nothing to reload")
    val scope = Json.parseToJsonElement("""{"item":{"id":"f1","name":"Contact","slug":"contact"}}""")
    assertEquals("Export Contact", ScreenValues.render(export.str("title")!!, scope))
    assertEquals(mapOf("formId" to "f1"), ScreenModel.plain(ScreenValues.resolveBody(export.obj("filter")!!, scope)))
  }

  /** A route that wants its key in the body (the AI credit give-back) writes `{attempt}` there and gets one key per act. */
  @Test
  fun attemptKeyFillsABodyToo() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(200 to "{}", 200 to "{}", 200 to "{}", sent = sent)
    val spec = ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X"}"""))!!
    val model = ScreenModel(spec, Json.parseToJsonElement("{}"), api)
    val action = ActionSpec.parse(
      Json.parseToJsonElement(
        """{"label":"Give back","url":"/api/ai/admin/credits",
           "body":{"reason":"{form.reason}","idempotencyKey":"{attempt}"}}""",
      ),
    )!!
    model.run(action, Json.parseToJsonElement("""{"form":{"reason":"planner fault"}}"""))
    model.run(action, Json.parseToJsonElement("""{"form":{"reason":"second look"}}"""))
    model.run(action, Json.parseToJsonElement("""{"form":{"reason":"planner fault"}}"""))
    val keys = sent.map { (Json.parseToJsonElement((it.body as TextContent).text) as JsonObject)["idempotencyKey"]?.jsonPrimitive?.content }
    assertEquals(3, keys.size)
    assertEquals(36, keys[0]?.length)
    assertNotEquals(keys[0], keys[1])
    assertEquals(keys[0], keys[2])
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

  /** A `when` on a repeated report line is read for each row: the meters that moved credits are named, and a repeat says only that. */
  @Test
  fun reportWhenIsReadForEachRow() = runTest {
    val api = client(
      200 to """{"duplicate":false,"lines":[{"meter":"workspace","credits":40},{"meter":"account","credits":0}]}""",
      200 to """{"duplicate":true,"lines":[{"meter":"workspace","credits":40}]}""",
      sent = mutableListOf(),
    )
    val model = ScreenModel(ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X"}"""))!!, JsonObject(emptyMap()), api)
    val action = ActionSpec.parse(
      Json.parseToJsonElement(
        """{"label":"Give back","url":"/api/ai/admin/credits","body":{"action":"give"},
           "report":[{"text":"Already given back.","when":"response.duplicate"},
                     {"each":"response.lines","when":"item.credits && !response.duplicate",
                      "text":"Returned {item.credits:number} credits to the {item.meter}."}]}""",
      ),
    )!!
    val first = model.run(action, JsonObject(emptyMap()))
    assertIs<ActionOutcome.Done>(first)
    assertEquals("Returned 40 credits to the workspace.", first.message)
    val second = model.run(action, JsonObject(emptyMap()))
    assertIs<ActionOutcome.Done>(second)
    assertEquals("Already given back.", second.message)
  }

  /**
   * The console's "Actions taken in this session": a lock or lift that reached the server leaves its lines, newest first (the lines of one
   * act with the last listed on top), each verified or not, at most 25 of them.
   */
  @Test
  fun actionsKeepASessionLog() = runTest {
    val answer = """{"confirmed":true,"logLines":[{"text":"Locked org o1","confirmed":true},{"text":"Billing cancel NOT confirmed","confirmed":false}]}"""
    val api = client(*Array(14) { 200 to answer }, 500 to """{"error":"no"}""", sent = mutableListOf())
    val model = ScreenModel(ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X"}"""))!!, JsonObject(emptyMap()), api)
    assertEquals(0, (ScreenValues.lookup("session.log", model.context) as? JsonArray)?.size)
    val lock = ActionSpec.parse(
      Json.parseToJsonElement(
        """{"label":"Lock","url":"/api/admin/lockdown",
           "log":[{"each":"response.logLines","text":"{item.text}","confirmed":"item.confirmed"}]}""",
      ),
    )!!
    model.run(lock, model.context)
    val first = ScreenValues.lookup("session.log", model.context) as JsonArray
    // The last line of the act is on top, as the console prepends them.
    assertEquals(listOf("Billing cancel NOT confirmed", "Locked org o1"), first.map { it.str("text") })
    assertEquals(listOf(false, true), first.map { (it.obj("confirmed") as JsonPrimitive).booleanOrNull })
    assertNotNull((first.first().obj("at") as? JsonPrimitive)?.content?.toDoubleOrNull())
    repeat(13) { model.run(lock, model.context) }
    assertEquals(ScreenModel.JOURNAL_LIMIT, model.journal.size)
    // A refusal leaves nothing in the log: a click that did not reach the server is a line that never appears.
    model.run(lock, model.context)
    assertEquals(ScreenModel.JOURNAL_LIMIT, model.journal.size)
    assertEquals("Billing cancel NOT confirmed", model.journal.first().str("text"))
  }

  /** A guarded run waits for a preview that was read: the preview arms a key, a failed preview takes it back, and the run spends it. */
  @Test
  fun aPreviewArmsTheRunAndTheRunSpendsIt() = runTest {
    val api = client(200 to "{}", 500 to """{"error":"down"}""", 200 to "{}", 200 to "{}", sent = mutableListOf())
    val model = ScreenModel(ScreenSpec.parse(Json.parseToJsonElement("""{"id":"core.x","title":"X"}"""))!!, JsonObject(emptyMap()), api)
    val preview = ActionSpec.parse(Json.parseToJsonElement("""{"label":"Preview","method":"GET","url":"/api/admin/audit-archive","arm":"auditArchive"}"""))!!
    val run = ActionSpec.parse(Json.parseToJsonElement("""{"label":"Run","url":"/api/admin/audit-archive","disarm":"auditArchive"}"""))!!
    fun armed() = ScreenValues.condition("session.armed.auditArchive", model.context)
    assertFalse(armed())
    model.run(preview, model.context)
    assertTrue(armed())
    // The next preview fails: nothing was read, so the run is locked again.
    model.run(preview, model.context)
    assertFalse(armed())
    model.run(preview, model.context)
    assertTrue(armed())
    model.run(run, model.context)
    assertFalse(armed())
  }

  /** A country field offers the platform's own region list in the person's language, by name. */
  @Test
  fun countryFieldOffersThePlatformsRegions() {
    val choices = isoRegions()
    val codes = choices.map { it.first }
    for (known in listOf("US", "CA", "GB", "DE", "JP", "AU", "MX")) assertTrue(known in codes, known)
    assertFalse("ZZ" in codes)
    assertFalse("EU" in codes)
    assertTrue(choices.size > 200)
    assertEquals(codes.size, codes.toSet().size)
    // By name in the locale's order.
    val collator = java.text.Collator.getInstance(java.util.Locale.getDefault())
    val labels = choices.map { it.second }
    assertEquals(labels.sortedWith { a, b -> collator.compare(a, b) }, labels)
    val field = FieldSpec.parse(Json.parseToJsonElement("""{"key":"country","label":"Country","kind":"country","options":[{"value":"","label":"Choose a country"}]}"""))!!
    assertEquals("Choose a country", field.choices(JsonObject(emptyMap())).first().second)
    assertTrue(field.choices(JsonObject(emptyMap())).any { it.first == "US" })
  }

  private fun orgsListSpec(): ScreenSpec = ScreenSpec.parse(
    Json.parseToJsonElement(
      """{"id":"core.x","title":"X",
          "load":{"orgs":{"url":"/api/admin/orgs?pageSize=50","sortParam":"sort","sortDefault":"createdAt:desc"}},
          "blocks":[{"type":"list","load":"orgs","items":"data.orgs.orgs","columnsZone":"testOrgsListColumn",
            "columns":[
              {"id":"name","label":"Organization","always":true,"sort":{"route":"nameLower"}},
              {"id":"plan","label":"Plan","value":"{item.plan:title}","sort":{"page":"item.plan"}},
              {"id":"limit","label":"Site limit","value":"{item.limit}","sort":{"page":"item.rank","type":"number","first":"desc"}},
              {"id":"created","label":"Created","value":"{item.created}","sort":{"route":"createdAt","first":"desc"}},
              {"id":"owner","label":"Owner","value":"{item.owner}","show":false}]}]}""",
    ),
  )!!

  /** A list's route columns ask the route in their order over every row, and the route's own default order goes when nothing was asked. */
  @Test
  fun aRouteColumnAsksTheRouteAgainInThatOrder() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val api = client(200 to """{"orgs":[]}""", 200 to """{"orgs":[]}""", 200 to """{"orgs":[]}""", sent = sent)
    val model = ScreenModel(orgsListSpec(), JsonObject(emptyMap()), api)
    model.load()
    assertEquals("pageSize=50&sort=createdAt%3Adesc", sent.last().url.encodedQuery)
    model.ask(ListOrder("name", true), "orgs", routed = true)
    assertEquals("pageSize=50&sort=nameLower%3Adesc", sent.last().url.encodedQuery)
    // A page column asks nothing of the route.
    val before = sent.size
    model.ask(ListOrder("plan", false), "orgs", routed = false)
    assertEquals(before, sent.size)
    // The default order comes back with no choice.
    model.ask(null, "orgs", routed = true)
    assertEquals("pageSize=50&sort=createdAt%3Adesc", sent.last().url.encodedQuery)
  }

  /** A tap on a header asks for the column's first order, the second for the other, the third for the default again. */
  @Test
  fun tappingAColumnCyclesItsOrder() {
    val columns = ListColumns.columns(orgsListSpec().blocks.first())
    val created = columns.first { it.id == "created" }
    val plan = columns.first { it.id == "plan" }
    var order = ListColumns.next(null, created)
    assertEquals(ListOrder("created", true), order)
    order = ListColumns.next(order, created)
    assertEquals(ListOrder("created", false), order)
    assertNull(ListColumns.next(order, created))
    assertEquals(ListOrder("plan", false), ListColumns.next(order, plan))
    assertEquals("createdAt:desc", ListColumns.routeValue(ListOrder("created", true), columns))
    assertNull(ListColumns.routeValue(ListOrder("plan", false), columns))
  }

  /** A page column orders the rows on the screen: numbers as numbers, text without regard to case; a row without the value goes last either way, and ties keep their order. */
  @Test
  fun pageColumnsOrderRowsAndPutMissingLast() {
    val columns = ListColumns.columns(orgsListSpec().blocks.first())
    val rows = Json.parseToJsonElement(
      """[{"id":"a","plan":"pro","rank":10},{"id":"b","plan":"Free","rank":9},{"id":"c"},{"id":"d","plan":"business","rank":100},{"id":"e","plan":"pro","rank":10}]""",
    ) as JsonArray
    fun ids(column: String, descending: Boolean) =
      ListColumns.sorted(rows, columns.first { it.id == column }, descending, JsonObject(emptyMap())).map { it.str("id") }
    assertEquals(listOf("d", "b", "a", "e", "c"), ids("plan", false))
    assertEquals(listOf("a", "e", "b", "d", "c"), ids("plan", true))
    // 100 is more than 9: a number, not text.
    assertEquals(listOf("b", "a", "e", "d", "c"), ids("limit", false))
    assertEquals(listOf("d", "a", "e", "b", "c"), ids("limit", true))
  }

  /** A row shows the columns the person picked as one line, without the ones it has nothing for. */
  @Test
  fun aListLineHoldsThePickedColumnsWithValues() {
    val columns = ListColumns.columns(orgsListSpec().blocks.first())
    val model = ScreenModel(orgsListSpec(), JsonObject(emptyMap()), null)
    val defaults = model.shownColumns("orgs", columns)
    // The shared catalog may hold a plugin column from another test, so this names what must be there, not all of it.
    assertTrue(defaults.containsAll(setOf("name", "plan", "limit", "created")))
    assertFalse("owner" in defaults)
    val scope = Json.parseToJsonElement("""{"item":{"plan":"pro","limit":"5","created":"","owner":"u1"}}""")
    // The owner column is off by default, the empty Created is skipped, and the row's own name is not repeated.
    assertEquals("Plan Pro \u00b7 Site limit 5", ListColumns.line(columns, setOf("name", "plan", "limit", "created"), scope))
    model.shown["orgs"] = setOf("plan", "limit", "created", "owner")
    assertEquals("Plan Pro \u00b7 Site limit 5 \u00b7 Owner u1", ListColumns.line(columns, model.shownColumns("orgs", columns), scope))
  }

  /** A column a plugin contributes to a list is read for the rows on the screen, in batches, and its answers join under `column.<id>`. */
  @Test
  fun aPluginColumnIsReadForTheRowsOnScreenInBatches() = runTest {
    ScreenCatalog.add(
      listOf(
        ScreenSpec.parse(
          Json.parseToJsonElement(
            """{"id":"test.spendColumn","title":"Spend","scope":"staff","zones":["testOrgsListColumn"],
                "column":{"id":"spend","label":"Spend","value":"{column.spend.cells[@item.id]|'\u2014'}",
                  "sort":{"page":"column.spend.sort[@item.id]","type":"number","first":"desc"},
                  "load":{"url":"/api/x/spend?orgIds={ids}","ids":"{item.id}","max":2}}}""",
          ),
        )!!,
      ),
    )
    val sent = mutableListOf<HttpRequestData>()
    val api = client(
      200 to """{"orgs":[{"id":"o1"},{"id":"o2"},{"id":"o3"}]}""",
      200 to """{"cells":{"o1":"${'$'}1.0000","o2":"${'$'}0.5000"},"sort":{"o1":1,"o2":0.5}}""",
      200 to """{"cells":{"o3":"\u2014"},"sort":{"o3":null}}""",
      sent = sent,
    )
    val model = ScreenModel(orgsListSpec(), JsonObject(emptyMap()), api)
    model.load()
    // One read of the list, then the column's two batches of two ids and one.
    assertEquals(listOf("orgIds=o1%2Co2", "orgIds=o3"), sent.takeLast(2).map { it.url.encodedQuery })
    assertEquals(JsonPrimitive("${'$'}0.5000"), ScreenValues.lookup("column.spend.cells.o2", model.context))
    val block = model.spec.blocks.first()
    val columns = ListColumns.columns(block)
    val spend = columns.last()
    assertEquals("spend", spend.id)
    val rows = ScreenValues.rows(ScreenValues.lookup("data.orgs.orgs", model.context))
    // Dearest first, the unmeasured last in both directions.
    assertEquals(listOf("o1", "o2", "o3"), ListColumns.sorted(rows, spend, true, model.context).map { it.str("id") })
    assertEquals(listOf("o2", "o1", "o3"), ListColumns.sorted(rows, spend, false, model.context).map { it.str("id") })
    assertEquals("Spend ${'$'}1.0000", ListColumns.line(columns, setOf("spend"), ScreenContext.withItem(model.context, rows[0])))
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
           "media":{"late":true,"query":{"collection":"orgs/{data.host.orgId}/media","aggregate":{"count":true}}},
           "members":{"late":true,"query":{"collection":"orgs/{data.host.orgId}/members","where":[["role","==","owner"]],"aggregate":{"count":true}}},
           "orphan":{"late":true,"when":"!data.host.orgId","query":{"collection":"hosts/{params.hostId}/media","aggregate":{"count":true}}}}}""",
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
    val spec = Json.parseToJsonElement("""{"collection":"hosts/{site.id}/layouts","aggregate":{"count":true,"rows":1000}}""")
    assertEquals(Json.parseToJsonElement("""{"items":[],"count":7.0}"""), FirestoreLoads.query(counted, spec, context))
    val rows = Json.parseToJsonElement("""{"collection":"hosts/{site.id}/forms","aggregate":{"count":true,"rows":1000}}""")
    assertEquals(Json.parseToJsonElement("""{"items":[],"count":0.0}"""), FirestoreLoads.query(counted, rows, context))
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
    val spec = Json.parseToJsonElement("""{"collection":"hosts/h1/components","aggregate":{"count":true},"where":[["deletedAt",">",{"${'$'}date":"1970-01-01T00:00:00Z"}],["kind","==","button"]]}""")
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

  /**
   * A collection read straight from Firestore shows its first rows; one that came back full offers "Load more", which reads it again
   * with a larger limit (the load's `more`, else its own limit again) until the end, so a big site can be gone through to its last
   * page. The window stays grown across a reload, as the commerce lists' does (QueryGrowthTest).
   */
  @Test
  fun aFullFirestoreQueryOffersMoreRows() = runTest {
    val reader = RowsReader(total = 6)
    val api = client(sent = mutableListOf())
    fun spec(extra: String) = ScreenSpec.parse(
      Json.parseToJsonElement("""{"id":"core.x","title":"X","load":{"rows":{"query":{"collection":"hosts/h1/screens","limit":3}$extra}}}"""),
    )!!
    fun rows(model: ScreenModel) = (ScreenValues.lookup("data.rows.items", model.context) as JsonArray).size
    val model = ScreenModel(spec(""","more":2"""), JsonObject(emptyMap()), api, reader)
    model.load()
    assertEquals(3, rows(model))
    assertEquals("3", model.cursors["rows"])
    model.loadMore("rows")
    assertEquals(5, rows(model))
    assertEquals("5", model.cursors["rows"])
    model.loadMore("rows")
    // The last read came back short: that was everything, and the button goes.
    assertEquals(6, rows(model))
    assertNull(model.cursors["rows"])
    assertEquals(listOf(3, 5, 7), reader.limits)
    // A load without `more` grows by its own limit.
    val plainReader = RowsReader(total = 6)
    val fixed = ScreenModel(spec(""), JsonObject(emptyMap()), api, plainReader)
    fixed.load()
    assertEquals("3", fixed.cursors["rows"])
    fixed.loadMore("rows")
    assertEquals(listOf(3, 6), plainReader.limits)
    // A reload keeps the grown window.
    model.load()
    assertEquals(6, rows(model))
    assertNull(model.cursors["rows"])
  }

  /** The abuse and counter-notice pages keep the console's "Changes made in this session", in its words. */
  @Test
  fun abuseDecisionsLeaveTheConsolesSessionLines() = runTest {
    val screens = ScreenSpec.parseFile(File(screensDir, "staff.screens.json").readText())
    val api = client(
      200 to """{"confirmed":true}""",
      200 to """{"confirmed":true,"scheduling":"scheduled","counterNotice":{"restoreAtMs":1760000000000}}""",
      200 to """{"confirmed":false,"scheduling":"notSuspended"}""",
      200 to """{"confirmed":true,"scheduling":"noClock"}""",
      sent = mutableListOf(),
    )
    fun action(screen: String, id: String): ActionSpec =
      screens.first { it.id == screen }.raw.arr("blocks").flatMap { it.arr("items") }.mapNotNull { ActionSpec.parse(it) }.first { it.id == id }

    val report = ScreenModel(
      screens.first { it.id == "core.staff.abuseReport" },
      Json.parseToJsonElement("""{"params":{"reportId":"r1"},"data":{"report":{"report":{"reference":"AR-1"}}}}"""), api,
    )
    report.run(action("core.staff.abuseReport", "actioned"), report.context)
    assertEquals(listOf("AR-1 → actioned"), report.journal.map { it.str("text") })
    assertEquals(true, (report.journal.first().obj("confirmed") as JsonPrimitive).booleanOrNull)

    val notice = ScreenModel(
      screens.first { it.id == "core.staff.counterNotice" },
      Json.parseToJsonElement("""{"params":{"noticeId":"n1"},"data":{"notice":{"counterNotices":[{"id":"n1","reference":"CN-7"}]}}}"""), api,
    )
    notice.run(action("core.staff.counterNotice", "forwarded"), notice.context)
    val scheduled = notice.journal.first().str("text")!!
    val prefix = "CN-7 → forwarded — restoration scheduled for "
    assertTrue(scheduled.startsWith(prefix), scheduled)
    assertTrue(scheduled.length > prefix.length, scheduled)
    notice.run(action("core.staff.counterNotice", "withdrawn"), notice.context)
    assertEquals("CN-7 → withdrawn — the site was NOT suspended, so nothing was scheduled", notice.journal.first().str("text"))
    assertEquals(false, (notice.journal.first().obj("confirmed") as JsonPrimitive).booleanOrNull)
    // No clock to set says nothing more than the step.
    notice.run(action("core.staff.counterNotice", "rejected"), notice.context)
    assertEquals("CN-7 → rejected", notice.journal.first().str("text"))
    assertEquals(3, notice.journal.size)
  }

  /**
   * "Populate from" on a system email test: workspaces, sites and people are searched by the words typed, and picking one fills the
   * merge tokens the template takes (and the recipient, for a person with an address).
   */
  @Test
  fun thePopulateFromPickerSearchesAndFillsTheTokens() = runTest {
    val spec = ScreenSpec.parseFile(File(screensDir, "staff.screens.json").readText()).first { it.id == "core.staff.emails" }
    val test = spec.raw.arr("blocks").flatMap { it.arr("actions") }.mapNotNull { ActionSpec.parse(it) }.first { it.id == "test" }
    // A template that takes the workspace's name and the person's email, with the staff member as the default recipient.
    val scope = Json.parseToJsonElement(
      """{"user":{"email":"ops@example.test"},"item":{"key":"welcome"},
         "const":{"tokens":{"welcome":[{"name":"org.name","sample":"Acme"},{"name":"user.email","sample":"a@b.co"}]}}}""",
    )
    val inputs = test.inputs(scope)
    assertEquals(listOf("populate", "to", "token.org.name", "token.user.email"), inputs.map { it.key })
    val picker = inputs.first()
    assertEquals("lookup", picker.kind)
    assertEquals(listOf("Workspaces", "Sites", "People"), picker.groups.map { it.label })
    val keys = inputs.map { it.key }.toSet()

    val org = picker.groups.first { it.id == "org" }
    assertEquals("/api/admin/orgs?pageSize=10", org.request("  "))
    assertEquals("/api/admin/orgs?pageSize=10&search=Acme%20%26%20Sons", org.request("Acme & Sons"))
    // Only the fields the form has are filled: the template takes no org.id.
    assertEquals(
      listOf("token.org.name" to "Acme Co"),
      org.fills(Json.parseToJsonElement("""{"name":"Acme Co","${'$'}id":"o1"}"""), scope, keys),
    )

    val person = picker.groups.first { it.id == "user" }
    val row = Json.parseToJsonElement("""{"uid":"u1","email":"dana@example.test","displayName":"Dana"}""")
    assertEquals("dana@example.test", person.heading(row, scope))
    assertEquals("Dana", person.detail(row, scope))
    assertEquals(
      mapOf("token.user.email" to "dana@example.test", "to" to "dana@example.test"),
      person.fills(row, scope, keys).toMap(),
    )
    // A person with no address sets the token blank and leaves the recipient alone.
    val noAddress = Json.parseToJsonElement("""{"uid":"u2","displayName":"No Mail"}""")
    assertEquals(listOf("token.user.email" to ""), person.fills(noAddress, scope, keys))
    assertEquals("No Mail", person.heading(noAddress, scope))

    val sent = mutableListOf<HttpRequestData>()
    val api = client(200 to """{"orgs":[{"${'$'}id":"o1","name":"Acme Co"},{"${'$'}id":"o2","name":"Acme Two"}]}""", sent = sent)
    val model = ScreenModel(spec, JsonObject(emptyMap()), api)
    val rows = model.lookup(org, "acme")
    assertEquals(listOf("Acme Co", "Acme Two"), rows.map { it.str("name") })
    assertEquals("/api/admin/orgs", sent.single().url.encodedPath)
    assertEquals("pageSize=10&search=acme", sent.single().url.encodedQuery)
  }

  /** The staff routes mint a custom token for a support session; the action names where in the answer it and its pool are. */
  @Test
  fun anImpersonateActionReadsTheTokenAndPoolFromTheAnswer() {
    val action = ActionSpec.parse(
      Json.parseToJsonElement("""{"label":"Sign in as this customer","url":"/api/admin/impersonate","impersonate":{"token":"token","tenantId":"tenantId"}}"""),
    )!!
    val spec = assertNotNull(action.impersonate)
    assertEquals("custom-token" to "tenant-9", spec.resolve(Json.parseToJsonElement("""{"token":"custom-token","tenantId":"tenant-9"}""")))
    // An account in the project's own pool has no tenant.
    assertEquals("custom-token" to null, spec.resolve(Json.parseToJsonElement("""{"token":"custom-token","tenantId":null}""")))
    assertNull(spec.resolve(Json.parseToJsonElement("""{"tenantId":"tenant-9"}""")))
    assertNull(spec.resolve(Json.parseToJsonElement("""{"token":""}""")))
    assertNull(spec.resolve(null))
    assertNull(ActionSpec.parse(Json.parseToJsonElement("""{"label":"Plain","url":"/x"}"""))!!.impersonate)
  }

  /** Person and Workspace both offer the sign-in the console does, asking the reason the route insists on. */
  @Test
  fun thePersonAndWorkspaceScreensOfferASupportSession() = runTest {
    val screens = ScreenSpec.parseFile(File(screensDir, "staff.screens.json").readText())
    fun offered(id: String): ActionSpec {
      val screen = screens.first { it.id == id }
      return screen.raw.arr("blocks").flatMap { it.arr("items") }.mapNotNull { ActionSpec.parse(it) }.first { it.impersonate != null }
    }
    val person = offered("core.staff.user")
    val workspace = offered("core.staff.org")
    for ((action, uid) in listOf(person to "{params.uid}", workspace to "{data.detail.org.ownerUid}")) {
      assertEquals("/api/admin/impersonate", action.url)
      val reason = action.prompt.single { it.key == "reason" }
      assertTrue(reason.required)
      assertEquals(uid, action.body?.str("uid"))
      assertEquals("{form.reason}", action.body?.str("reason"))
      assertFalse(action.reason, "the reason is asked once, by the prompt")
    }
    // The route's own minimum is the one the prompt tells the person about.
    val min = screens.first { it.id == "core.staff.user" }.raw.obj("constants").obj("impersonation").obj("minReason")!!.jsonPrimitive.content
    assertTrue(min.toInt() > 1)

    val sent = mutableListOf<HttpRequestData>()
    val api = client(200 to """{"token":"custom-token","tenantId":null}""", sent = sent)
    val model = ScreenModel(screens.first { it.id == "core.staff.user" }, Json.parseToJsonElement("""{"params":{"uid":"u1"}}"""), api)
    assertEquals(
      "At least $min characters. Write what you are reproducing, or the ticket it serves.",
      ScreenValues.render(person.prompt.single().help!!, model.context),
    )
    val scope = Json.parseToJsonElement("""{"params":{"uid":"u1"},"form":{"reason":"ticket 481: billing page"}}""")
    val outcome = model.run(person, scope)
    assertIs<ActionOutcome.Done>(outcome)
    assertEquals("/api/admin/impersonate", sent.single().url.encodedPath)
    assertEquals(
      Json.parseToJsonElement("""{"uid":"u1","reason":"ticket 481: billing page"}"""),
      Json.parseToJsonElement((sent.single().body as TextContent).text),
    )
    assertEquals("custom-token" to null, person.impersonate!!.resolve(outcome.response))
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

  /** The Aglyn AI row is the console's tier picker (AGL-4008); Apple's ScreenSpecTests asserts the same. */
  @Test
  fun theAiTierPickerOffersTheConsoleTiersAndQuotesAMove() {
    val spec = ScreenSpec.parseFile(File(screensDir, "billing.screens.json").readText()).first { it.id == "core.billing.addons" }
    val list = spec.blocks.first { it.type == "list" }
    val actions = list.raw.arr("actions").mapNotNull { ActionSpec.parse(it) }
    val tier = actions.first { it.id == "tier" }
    val turnOn = actions.first { it.id == "on" }
    val tiers = """[{"id":"spark","label":"Spark","credits":4000,"unitUsd":9,"configured":true},""" +
      """{"id":"plus","label":"Plus","credits":19000,"unitUsd":39,"configured":true},""" +
      """{"id":"studio","label":"Studio","credits":99000,"unitUsd":199,"configured":false}]"""
    fun scope(addons: String, extra: String = "") = Json.parseToJsonElement(
      """{"org":{"id":"o1","manager":true},"data":{"addons":$addons},"item":{"kind":"aiAddon","label":"Aglyn AI","toggle":true}$extra}""",
    )
    val held = """{"hasSubscription":true,"plan":"pro","interval":"month","aiTier":"plus","aiTiers":$tiers,"quantities":{"aiAddon":1},""" +
      """"catalog":{"aiAddon":{"unitUsd":39,"configured":true,"upgradeRequired":false}}}"""
    val base = scope(held)
    assertTrue(ScreenValues.condition(tier.whenCondition, base))
    assertFalse(ScreenValues.condition(turnOn.whenCondition, base))
    assertEquals("Aglyn AI tier", ScreenValues.render(tier.label, base))
    val field = tier.prompt.first()
    assertEquals("choice", field.kind)
    val rows = field.choiceRows(base)
    assertEquals(listOf("none", "spark", "plus", "studio"), rows.map { it.value })
    assertEquals(listOf("No tier", "Spark — \$9/mo", "Plus — \$39/mo", "Studio — \$199/mo"), rows.map { it.label })
    assertEquals("Your plan's included credits only", rows[0].detail)
    assertEquals("+4,000 credits a month", rows[1].detail)
    assertEquals(FieldChoiceBadge("Current", "info"), rows[2].badge)
    assertNull(rows[0].badge)
    assertFalse(rows[3].enabled)
    assertEquals("+99,000 credits a month (not configured yet)", rows[3].detail)
    assertEquals("plus", ScreenValues.render(field.initial!!, base))
    assertTrue(field.unmet(JsonPrimitive("plus"), base))
    assertFalse(field.unmet(JsonPrimitive("spark"), base))
    assertEquals(
      Json.parseToJsonElement("""{"orgId":"o1","action":"preview","kind":"aiAddon","quantity":1,"tier":"spark"}"""),
      ScreenValues.resolveBody(tier.check!!.body!!, scope(held, ""","form":{"tier":"spark"}""")),
    )
    assertEquals(
      Json.parseToJsonElement("""{"orgId":"o1","action":"set","kind":"aiAddon","quantity":0}"""),
      ScreenValues.resolveBody(tier.body!!, scope(held, ""","form":{"tier":"none"}""")),
    )
    val later = ""","preview":{"defersToPeriodEnd":true,"effectiveAt":"2026-11-01T00:00:00Z","currency":"usd"}"""
    assertEquals(
      "Aglyn AI Spark? Nothing is charged and nothing is refunded. You keep Plus for the rest of the period you have paid for, and Spark starts on Nov 1, 2026. From then: \$9/mo, adding 4,000 AI credits a month on top of your plan's.",
      tier.confirmText(scope(held, ""","form":{"tier":"spark"}$later""")),
    )
    assertEquals(
      "Aglyn AI: 0? Nothing is charged and nothing is refunded. You keep this capacity for the rest of the period you have paid for, and it ends on Nov 1, 2026. From then: nothing, this add-on is removed.",
      tier.confirmText(scope(held, ""","form":{"tier":"none"}$later""")),
    )
    val fresh = """{"hasSubscription":true,"plan":"pro","interval":"year","aiTiers":$tiers,""" +
      """"catalog":{"aiAddon":{"unitUsd":9,"configured":true,"upgradeRequired":false}}}"""
    assertEquals(
      "Aglyn AI Plus? \$39.00 will be charged to your card now, prorated for the rest of this period. Ongoing: \$39/mo (billed yearly with your plan), adding 19,000 AI credits a month on top of your plan's.",
      tier.confirmText(scope(fresh, ""","form":{"tier":"plus"},"preview":{"chargedNowCents":3900,"currency":"usd","taxComplete":true}""")),
    )
    assertEquals(FieldChoiceBadge("Current", "neutral"), field.choiceRows(scope(fresh))[0].badge)
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
    assertTrue("Your Aglyn AI tier is not sold on Free, so it is removed" in text)
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

  @Test
  fun aRouteActionNamesAConsolePathToFollowLikeANotificationsLink() {
    val action = ActionSpec.parse(Json.parseToJsonElement("""{"label":"Update payment method","route":"{item.href}"}"""))!!
    assertEquals("{item.href}", action.route)
    assertNull(action.url)
    val scope = Json.parseToJsonElement("""{"item":{"href":"/acme/billing/settings"}}""")
    assertEquals("/acme/billing/settings", ScreenValues.render(action.route!!, scope))
    assertNull(ActionSpec.parse(Json.parseToJsonElement("""{"label":"Go","url":"/api/x"}"""))!!.route)
  }
}

/** A reader that holds a collection of numbered rows and answers each query with as many as its limit allows. */
private class RowsReader(val total: Int) : com.aglyn.core.FirestoreReader {
  val limits = mutableListOf<Int>()

  override suspend fun get(path: String): com.aglyn.core.FirestoreDoc? = null
  override suspend fun page(query: com.aglyn.core.FirestoreQuery): com.aglyn.core.FirestorePage {
    val limit = query.limit ?: total
    limits += limit
    return com.aglyn.core.FirestorePage(
      (0 until minOf(limit, total)).map { com.aglyn.core.FirestoreDoc("r$it", "${query.collectionPath}/r$it", mapOf("n" to it.toDouble())) },
      null,
    )
  }
  override fun observeDoc(path: String) = kotlinx.coroutines.flow.emptyFlow<com.aglyn.core.Live<com.aglyn.core.FirestoreDoc?>>()
  override fun observe(query: com.aglyn.core.FirestoreQuery) = kotlinx.coroutines.flow.emptyFlow<com.aglyn.core.Live<List<com.aglyn.core.FirestoreDoc>>>()
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
