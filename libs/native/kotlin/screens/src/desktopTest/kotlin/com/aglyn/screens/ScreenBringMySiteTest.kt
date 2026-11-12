package com.aglyn.screens

import com.aglyn.core.ConsoleApiClient
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
import java.io.File
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Bring my site (AGL-4152) in the apps, as the console's: the start (the address, the proof that it is yours, Keep my site
 * or Improve it, then the read) and the import job's page, where the next wave is started with the choice. Apple replays
 * the same cases (ScreenBringMySiteTests).
 */
class ScreenBringMySiteTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }

  @BeforeTest
  fun reset() = ScreenStash.clear()

  @AfterTest
  fun clear() = ScreenStash.clear()

  private fun json(text: String): JsonElement = Json.parseToJsonElement(text)

  private fun screen(id: String) =
    ScreenSpec.parseFile(File(root, "libs/plugins/ai/src/android/screens/ai.screens.json").readText()).first { it.id == id }

  private fun client(vararg responses: Pair<Int, String>, sent: MutableList<HttpRequestData>): ConsoleApiClient {
    val queue = ArrayDeque(responses.toList())
    val engine = MockEngine { request ->
      sent += request
      val (status, body) = queue.removeFirstOrNull() ?: (200 to "{}")
      respond(body, HttpStatusCode.fromValue(status), headersOf("Content-Type", "application/json"))
    }
    return ConsoleApiClient("http://localhost", HttpClient(engine) { expectSuccess = false }, { "t" }, sleep = {})
  }

  /** Answers by what the whole URL contains, so loads that run in parallel get the right body. */
  private fun routed(vararg routes: Pair<String, String>): ConsoleApiClient {
    val engine = MockEngine { request ->
      val body = routes.firstOrNull { request.url.toString().contains(it.first) }?.second ?: "{}"
      respond(body, HttpStatusCode.OK, headersOf("Content-Type", "application/json"))
    }
    return ConsoleApiClient("http://localhost", HttpClient(engine) { expectSuccess = false }, { "t" }, sleep = {})
  }

  private fun body(sent: List<HttpRequestData>, at: Int) = json((sent[at].body as TextContent).text) as JsonObject

  private fun action(screen: ScreenSpec, id: String): ActionSpec {
    for (block in screen.blocks) {
      if (block.raw.str("id") == id) block["submit"]?.let { return ActionSpec.parse(it)!! }
      val list = (block.raw as? JsonObject)?.get("items") as? JsonArray ?: continue
      for (raw in list) if (raw.str("id") == id) return ActionSpec.parse(raw)!!
    }
    for (raw in (screen.raw as JsonObject)["actions"] as? JsonArray ?: JsonArray(emptyList())) if (raw.str("id") == id) return ActionSpec.parse(raw)!!
    error("no action $id on ${screen.id}")
  }

  private fun shown(spec: ScreenSpec, model: ScreenModel): List<String> =
    spec.blocks.filter { ScreenValues.condition(it.whenCondition, model.context) }.map {
      ScreenValues.render(it.title ?: it.raw.str("text") ?: it.raw.str("id") ?: it.type, model.context)
    }

  private fun waves(statuses: List<String>): String = statuses.mapIndexed { index, status ->
    val started = status != "waiting"
    val slots = if (index == 0) """["p1","p2","p3"]""" else """["p${index + 3}"]"""
    """{"index":$index,"label":"${if (index == 0) "Main pages" else "Blog $index"}","group":"${if (index == 0) "main" else "blog"}","slots":$slots,"frame":${index == 0},"status":"$status","startedAt":${if (started) "\"2026-11-11T20:00:00Z\"" else "null"},"finish":${if (started) "\"keep\"" else "null"},"wording":false}"""
  }.joinToString(",", "[", "]")

  private fun job(statuses: List<String>, status: String = "needs_review", reason: String = "wave", extra: String = ""): String =
    """{"jobs":[{"id":"j1","kind":"import","status":"$status","brief":"Bring in example.com","review":{"reason":"$reason","message":"Main pages is in. Review it, then start the next wave."},"siteImport":{"domain":"example.com","finish":"keep","wording":false,"waves":${waves(statuses)}$extra},"steps":[],"outputs":[]}]}"""

  private suspend fun loaded(body: String): Pair<ScreenSpec, ScreenModel> {
    val spec = screen("ai.job")
    val model = ScreenModel(spec, json("""{"org":{"id":"o1"},"site":{"id":"h1"},"params":{"jobId":"j1"}}"""), routed("/api/ai/jobs" to body))
    model.load()
    return spec to model
  }

  private fun looks(spec: ScreenSpec, context: JsonElement): List<String> {
    val fields = spec.blocks.first { it.type == "fields" }
    val job = ScreenValues.lookup("data.jobs.jobs.0", context)!!
    return (fields["rows"] as JsonArray)
      .filter { ScreenValues.condition(it.str("when"), ScreenContext.withItem(context, job)) }
      .filter { ScreenValues.render(it.str("label").orEmpty(), context) == "How your new site looks" }
      .map { ScreenValues.render(it.str("value").orEmpty(), context) }
  }

  @Test
  fun theJobsListOffersBringMySiteWhereTheRouteSaysItIsReady() = runTest {
    val spec = screen("ai.jobs")
    val jobsLoad = spec.loads.first { it.key == "jobs" }
    assertEquals("/api/ai/jobs?orgId=o1&hostId=h1&limit=50&siteImport=1", ScreenValues.render(jobsLoad.url, json("""{"org":{"id":"o1"},"site":{"id":"h1"}}""")))
    val bring = action(spec, "import")
    assertEquals("ai.import.start", bring.navigate?.screen)
    for ((offer, offered) in listOf("ready" to true, "role" to false, "plan" to false)) {
      val model = ScreenModel(spec, json("""{"org":{"id":"o1"},"site":{"id":"h1"}}"""), routed("siteImport=1" to """{"jobs":[],"siteImport":"$offer"}"""))
      model.load()
      assertEquals(offered, ScreenValues.condition(bring.whenCondition, model.context), offer)
    }
  }

  @Test
  fun anImportWaitingForItsNextWaveShowsTheChoiceAndStartsTheWaveWithIt() = runTest {
    val (spec, model) = loaded(job(listOf("review", "waiting", "waiting")))
    val context = model.context
    assertEquals(JsonPrimitive(true), ScreenValues.lookup("is.waveWaits", context))
    assertEquals(JsonPrimitive(true), ScreenValues.lookup("is.manyWait", context))
    assertEquals(listOf("Keep my site"), looks(spec, context))
    val titles = shown(spec, model)
    assertTrue("Every wave (3)" in titles, titles.toString())
    assertTrue("Main pages is in. Review it, then start the next wave." in titles)
    assertTrue("Start every remaining wave runs the 2 waves left one after another, with no review between them. You review the last one." in titles)
    assertTrue(titles.any { it.startsWith("Next: Blog 1. A wave is paid from your AI credits.") })

    val start = action(spec, "startWave")
    assertEquals("Start Blog 1", ScreenValues.render(start.label, context))
    // The prompt opens on the import's own choice, Keep my site, with the switch on for a move to Improve it.
    val asked = start.inputs(context)
    assertEquals(listOf("finish", "wording"), asked.map { it.key })
    assertEquals(FieldValue.Text("keep"), initialValue(asked[0], context))
    assertEquals(FieldValue.Flag(true), initialValue(asked[1], context))
    assertEquals(listOf("Keep my site", "Improve it"), asked[0].choiceRows(context).map { it.label })
    assertEquals(
      "Aglyn AI redesigns each page with your pictures, menus and forms, in a theme built around your brand.",
      asked[0].choiceRows(context).last().detail,
    )
    assertEquals("Also improve my wording", ScreenValues.render(asked[1].label, context))
    assertTrue(ScreenValues.render(asked[1].help.orEmpty(), context).endsWith("About 25 more AI credits for each main page."))
    assertFalse(ScreenValues.condition(asked[1].whenCondition, ScreenContext.with(context, "form", json("""{"finish":"keep"}"""))))
    assertTrue(ScreenValues.condition(asked[1].whenCondition, ScreenContext.with(context, "form", json("""{"finish":"improve"}"""))))

    // The wave starts on the resume door with the choice, the wording a boolean and only under Improve it.
    val sent = mutableListOf<HttpRequestData>()
    val runner = ScreenModel(spec, context, client(200 to """{"job":{"id":"j1"}}""", 200 to """{"job":{"id":"j1"}}""", 200 to """{"job":{"id":"j1"}}""", sent = sent))
    val improve = runner.run(start, ScreenContext.with(context, "form", json("""{"finish":"improve","wording":true}""")))
    assertEquals(ActionOutcome.Done("Bringing in Blog 1", json("""{"job":{"id":"j1"}}""")), improve)
    assertEquals("/api/ai/jobs/j1/resume", sent[0].url.encodedPath)
    assertEquals(json("""{"orgId":"o1","hostId":"h1","finish":"improve","wording":true}"""), body(sent, 0))
    runner.run(start, ScreenContext.with(context, "form", json("""{"finish":"keep"}""")))
    assertEquals(json("""{"orgId":"o1","hostId":"h1","finish":"keep","wording":false}"""), body(sent, 1))
    runner.run(action(spec, "startAll"), ScreenContext.with(context, "form", json("""{"finish":"improve","wording":false}""")))
    assertEquals(json("""{"orgId":"o1","hostId":"h1","finish":"improve","wording":false,"startAll":true}"""), body(sent, 2))
  }

  @Test
  fun theChoiceSpeaksOfNewCopyUnderAGenerativeImproveIt() = runTest {
    val (spec, model) = loaded(job(listOf("review", "waiting"), extra = ""","finish":"improve","wording":true,"generative":true"""))
    val context = model.context
    assertEquals(JsonPrimitive(false), ScreenValues.lookup("is.manyWait", context))
    assertFalse(shown(spec, model).any { it.startsWith("Start every remaining wave runs") })
    val asked = action(spec, "startWave").inputs(context)
    assertEquals(FieldValue.Text("improve"), initialValue(asked[0], context))
    assertEquals(FieldValue.Flag(true), initialValue(asked[1], context))
    assertEquals("Also write new copy", ScreenValues.render(asked[1].label, context))
    assertTrue(ScreenValues.render(asked[1].help.orEmpty(), context).endsWith("About 32 more AI credits for each main page."))
    assertTrue(asked[0].choiceRows(context).last().detail.orEmpty().endsWith("It shows you the plan before anything is built."))
    assertEquals(listOf("Improve it, with new copy"), looks(spec, context))
  }

  @Test
  fun noWaveIsOfferedWhileOneRunsThePlanWaitsOrTheReadStopped() = runTest {
    for (body in listOf(
      job(listOf("review", "running", "waiting")),
      job(listOf("review", "waiting"), extra = ""","plan":{"nav":{}}"""),
      job(listOf("waiting", "waiting"), reason = "blocked", extra = ""","verdict":{"kind":"home-blocked"}"""),
      job(listOf("done", "done"), status = "done"),
    )) {
      val (_, model) = loaded(body)
      assertEquals(JsonPrimitive(false), ScreenValues.lookup("is.waveWaits", model.context), body)
    }
    val (_, accepted) = loaded(job(listOf("review", "waiting"), extra = ""","plan":{"nav":{}},"planAccepted":true"""))
    assertEquals(JsonPrimitive(true), ScreenValues.lookup("is.waveWaits", accepted.context))
  }

  @Test
  fun theStartAsksTheAddressThenTheProofThenTheChoiceAndStartsTheRead() = runTest {
    val spec = screen("ai.import.start")
    assertEquals("site", spec.scope)
    assertTrue(ScreenValues.condition(spec.requires, json("""{"org":{"can":{"ai.import":true}}}""")))
    assertFalse(ScreenValues.condition(spec.requires, json("""{"org":{"can":{"ai.import":false}}}""")))
    val pending = """{"domain":"example.com","status":"pending","current":false,"provenMethod":null,"provenAt":null,"dns":{"host":"_aglyn-challenge.example.com","type":"TXT","value":"aglyn-domain-verification=abc"},"meta":{"name":"aglyn-domain-verification","content":"abc","tag":"<meta name=\"aglyn-domain-verification\" content=\"abc\">"},"email":{"domain":"example.com","pendingAddress":null,"expiresAt":null,"attemptsLeft":null}}"""
    val proven = pending.replace(""""status":"pending","current":false,"provenMethod":null,"provenAt":null""", """"status":"proven","current":true,"provenMethod":"dns","provenAt":1762891200000""")
    val offer = """{"jobs":[],"siteImport":"ready"}"""
    suspend fun phase(claims: String): ScreenModel {
      val model = ScreenModel(spec, json("""{"org":{"id":"o1"},"site":{"id":"h1"}}"""), routed("siteImport=1" to offer, "ownership?orgId=o1" to """{"claims":[$claims]}"""))
      model.load()
      return model
    }
    val start = phase("")
    assertEquals(listOf("Your current website"), shown(spec, start))

    // 1. The address is claimed, and the claim's own domain is kept for this site.
    val sent = mutableListOf<HttpRequestData>()
    val runner = ScreenModel(
      spec,
      start.context,
      client(200 to """{"claim":$pending}""", 200 to """{"result":{"status":"not-yet","message":"No record yet."}}""", 200 to """{"job":{"id":"j9"}}""", sent = sent),
    )
    runner.run(action(spec, "address"), ScreenContext.with(start.context, "form", json("""{"address":"https://www.Example.com/"}""")))
    assertEquals("/api/ai/site-import/ownership", sent[0].url.encodedPath)
    assertEquals(json("""{"orgId":"o1","action":"claim","domain":"https://www.Example.com/"}"""), body(sent, 0))
    assertEquals(JsonPrimitive("example.com"), ScreenStash.values["aiImportDomain"])
    assertEquals(JsonPrimitive("h1"), ScreenStash.values["aiImportSite"])

    // 2. Not proved yet: the three ways, each with its check.
    val proving = phase(pending)
    assertEquals(
      listOf(
        "Prove it is yours",
        "Prove the site is yours, any one way below. Nothing is read from your site until you do, so only a site you own can be brought in.",
        "Add a DNS record", "actions", "Add a tag to your home page", "actions", "Get a code by email", "actions",
      ),
      shown(spec, proving),
    )
    assertEquals("_aglyn-challenge", ScreenValues.render(action(spec, "copyName").copy.orEmpty(), proving.context))
    assertEquals("aglyn-domain-verification=abc", ScreenValues.render(action(spec, "copyValue").copy.orEmpty(), proving.context))
    assertTrue(ScreenValues.condition(action(spec, "sendCode").whenCondition, proving.context))
    assertFalse(ScreenValues.condition(action(spec, "sendNewCode").whenCondition, proving.context))
    assertFalse(ScreenValues.condition(action(spec, "confirmCode").whenCondition, proving.context))
    val check = runner.run(action(spec, "checkDns"), proving.context)
    // "Not there yet" is information, as the console shows it: no green success, a notice under the check that was run.
    assertEquals(null, (check as ActionOutcome.Done).message)
    assertEquals(JsonPrimitive("No record yet."), ScreenStash.values["aiImportCheck"])
    val checked = phase(pending)
    assertEquals(
      listOf(
        "Prove it is yours",
        "Prove the site is yours, any one way below. Nothing is read from your site until you do, so only a site you own can be brought in.",
        "Add a DNS record", "actions", "No record yet.", "Add a tag to your home page", "actions", "Get a code by email", "actions",
      ),
      shown(spec, checked),
    )
    assertEquals("info", spec.blocks.first { it.type == "notice" && it.raw.str("text") == "{stash.aiImportCheck}" }.raw.str("tone"))
    assertEquals(json("""{"orgId":"o1","domain":"example.com","action":"check","method":"dns"}"""), body(sent, 1))

    // 3. Proved: what happens next, the choice (Improve it, wording on, as the console starts it), and the read.
    val proved = phase(proven)
    assertEquals("Bring in example.com", shown(spec, proved).first())
    val read = spec.blocks.first { it.id == "read" }
    val fields = (read["fields"] as JsonArray).mapNotNull { FieldSpec.parse(it) }
    assertEquals(listOf(FieldValue.Text("improve"), FieldValue.Flag(true)), fields.map { initialValue(it, proved.context) })
    val submit = action(spec, "read")
    assertEquals("ai.job", submit.navigate?.screen)
    val started = runner.run(submit, ScreenContext.with(proved.context, "form", json("""{"finish":"improve","wording":false}""")))
    assertEquals(json("""{"job":{"id":"j9"}}"""), (started as ActionOutcome.Done).response)
    assertEquals("/api/ai/jobs", sent[2].url.encodedPath)
    assertEquals(
      json("""{"orgId":"o1","hostId":"h1","kind":"import","brief":"Bring in example.com","inputs":{"domain":"example.com","finish":"improve","wording":false}}"""),
      body(sent, 2),
    )
    assertEquals(JsonNull, ScreenStash.values["aiImportDomain"] ?: JsonNull)
  }

  @Test
  fun theStartSaysWhyWhenTheWorkspaceCannotBringASiteIn() = runTest {
    val spec = screen("ai.import.start")
    val model = ScreenModel(spec, json("""{"org":{"id":"o1"},"site":{"id":"h1"}}"""), routed("siteImport=1" to """{"jobs":[],"siteImport":"plan"}"""))
    model.load()
    assertEquals(listOf("Bring your current website in, every page and photo, on any paid plan. Upgrade to bring yours in."), shown(spec, model))
  }
}
