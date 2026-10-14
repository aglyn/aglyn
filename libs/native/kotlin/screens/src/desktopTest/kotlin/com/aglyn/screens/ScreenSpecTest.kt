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
    // Screens a plugin draws by hand rather than from a spec, which a spec may still open.
    val handWritten = setOf("commerce.orders", "commerce.order", "commerce.products", "commerce.product", "commerce.sales")
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
