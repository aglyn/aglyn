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
 * The steps a plugin adds to the import wizard (the gift card total, the email list's permission), drawn in the review's
 * `transferStep` zone and answered by asking the plan again with the answer added under `extras`, as the console's wizard
 * sends it. Apple replays the same cases (ScreenImportStepsTests).
 */
class ScreenImportStepsTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }

  @BeforeTest
  fun reset() = ScreenStash.clear()

  @AfterTest
  fun clear() = ScreenStash.clear()

  private fun json(text: String): JsonElement = Json.parseToJsonElement(text)

  private fun plugin(path: String) = ScreenSpec.parseFile(File(root, "libs/plugins/$path").readText())

  private fun core(id: String) = ScreenSpec.parseFile(File(root, "libs/native/screens/transfer-import.screens.json").readText()).first { it.id == id }

  private fun client(vararg responses: Pair<Int, String>, sent: MutableList<HttpRequestData>): ConsoleApiClient {
    val queue = ArrayDeque(responses.toList())
    val engine = MockEngine { request ->
      sent += request
      val (status, body) = queue.removeFirstOrNull() ?: (200 to "{}")
      respond(body, HttpStatusCode.fromValue(status), headersOf("Content-Type", "application/json"))
    }
    return ConsoleApiClient("http://localhost", HttpClient(engine) { expectSuccess = false }, { "t" }, sleep = {})
  }

  private fun body(sent: List<HttpRequestData>, at: Int) = json((sent[at].body as TextContent).text) as JsonObject

  private fun action(screen: ScreenSpec, id: String): ActionSpec {
    for (block in screen.blocks) {
      for (key in listOf("items", "actions")) {
        val list = (block.raw as? JsonObject)?.get(key) as? JsonArray ?: continue
        for (raw in list) if (raw.str("id") == id) return ActionSpec.parse(raw)!!
      }
    }
    error("no action $id on ${screen.id}")
  }

  /** The plan the review asked for, as the rules step keeps it for a plugin's step to ask again. */
  private val planBody = json("""{"orgId":"o1","jobId":"j1","mapping":{"0":"email"},"policy":{"record":{"onMatch":"update"},"fieldDefault":{"mode":"fillBlanks"}}}""")

  private val giftCards = "commerce/src/ios/Sources/AglynCommercePlugin/Resources/commerce-import.screens.json"
  private val emailSteps = "email/src/ios/Sources/AglynEmailPlugin/Resources/email-import.screens.json"

  @Test
  fun theReviewDrawsTheStepsOfThePluginThisImportBelongsTo() {
    val steps = (plugin(giftCards) + plugin(emailSteps)).filter { it.zones.isNotEmpty() }
    assertEquals(listOf(listOf("transferStep"), listOf("transferStep"), listOf("transferStep")), steps.map { it.zones })
    val zone = core("core.settings.data.import.review").blocks.first { it.type == "zone" }
    assertEquals("transferStep", zone.string("name"))
    // The zone hands each step the resource, the site and the job; each shows for its own resource only.
    assertEquals(setOf("resource", "hostId", "jobId"), (zone["params"] as JsonObject).keys)
    fun offered(resource: String) = steps.filter { ScreenValues.condition(it.requires, json("""{"stash":{"importResource":"$resource"}}""")) }.map { it.id }
    assertEquals(listOf("commerce.import.giftCards"), offered("commerce.gift-cards"))
    assertEquals(listOf("email.import.existing", "email.import.consent"), offered("email.list-members:abc123"))
    assertEquals(emptyList(), offered("data.dataset:xyz"))
    assertEquals(emptyList(), offered("crm.contacts"))
  }

  @Test
  fun aProductImportCanAskForAiCopyOfTheProductsItCreatesAndTheJobStartsOnceTheyLand() = runTest {
    val step = plugin("ai/src/ios/Sources/AglynAiPlugin/Resources/ai.screens.json").first { it.id == "ai.import.productCopy" }
    // The step belongs to a products import, in the zone the review draws; only a manager sees it.
    assertEquals(listOf("transferStep"), step.zones)
    fun offered(resource: String, manager: Boolean = true) =
      ScreenValues.condition(step.requires, json("""{"stash":{"importResource":"$resource"},"org":{"manager":$manager}}"""))
    assertTrue(offered("commerce.products"))
    assertFalse(offered("commerce.gift-cards"))
    assertFalse(offered("commerce.products", manager = false))
    // The option is offered only where the AI feature is the workspace's (the jobs route answers), as the console's is.
    val seen = mutableListOf<HttpRequestData>()
    ScreenStash.set(json("""{"importPlan":{"summary":{"create":80}}}"""))
    val create = """{"org":{"id":"o1"}}"""
    val model = ScreenModel(step, json(create), client(200 to """{"jobs":[]}""", 404 to """{"error":"Not found"}""", sent = seen))
    model.load()
    assertEquals("/api/ai/jobs", seen[0].url.encodedPath)
    assertEquals("orgId=o1&limit=20", seen[0].url.encodedQuery)
    val shown = step.blocks.filter { ScreenValues.condition(it.whenCondition, model.context) }
    assertEquals(listOf("notice", "form", "notice"), shown.map { it.type })
    assertEquals("Copy is written for the first 50 of the 80 products.", ScreenValues.render(shown.last().string("text").orEmpty(), model.context))
    val hidden = ScreenModel(step, json(create), client(404 to """{"error":"Not found"}""", sent = mutableListOf()))
    hidden.load()
    assertEquals(listOf("notice"), step.blocks.filter { ScreenValues.condition(it.whenCondition, hidden.context) }.map { it.type })

    // Saving the choice keeps it for this import only.
    ScreenStash.clear()
    val save = ActionSpec.parse(step.blocks.first { it.id == "copy" }["submit"])!!
    ScreenStash.set(json("""{"importJob":"j1"}"""))
    model.run(save, ScreenContext.with(ScreenContext.with(model.context, "stash", ScreenStash.values), "form", json("""{"write":true}""")))
    assertEquals(JsonPrimitive(true), ScreenStash.values["importAiCopy"])
    assertEquals(JsonPrimitive("j1"), ScreenStash.values["importAiCopyFor"])

    // Applying the import runs the hook once it is done: the created ids are read from its results and the console's
    // copy job is started for them (the first 50, one brief, the ids as `inputs`).
    ScreenCatalog.add(listOf(step))
    val review = core("core.settings.data.import.review")
    val apply = action(review, "applyNow")
    assertEquals("transferStep", apply.afterZone.str("zone"))
    val results = """{"rows":[{"outcome":"created","recordId":"p1"},{"outcome":"updated","recordId":"p9"},{"outcome":"created","recordId":"p2"},{"outcome":"created","recordId":"p1"}]}"""
    val sent = mutableListOf<HttpRequestData>()
    val applying = ScreenModel(review, json("""{"org":{"id":"o1"}}"""), client(200 to """{"done":true,"progress":{"done":4}}""", 200 to results, 200 to """{"job":{"id":"a1"}}""", sent = sent))
    ScreenStash.set(json("""{"importResource":"commerce.products","importHost":"h1"}"""))
    val outcome = applying.run(apply, ScreenContext.with(json("""{"org":{"id":"o1","manager":true}}"""), "stash", ScreenStash.values))
    assertEquals(ActionOutcome.Done(null, json("""{"done":true,"progress":{"done":4}}""")), outcome)
    assertEquals(listOf("/api/transfer/apply", "/api/transfer/status", "/api/ai/jobs"), sent.map { it.url.encodedPath })
    assertEquals(json("""{"orgId":"o1","jobId":"j1","include":"results"}"""), body(sent, 1))
    assertEquals(
      json("""{"orgId":"o1","hostId":"h1","kind":"products","brief":"Write storefront copy for 2 products","inputs":{"target":"bulk","productIds":"p1,p2"}}"""),
      body(sent, 2),
    )
    assertEquals(
      JsonPrimitive("AI is writing descriptions, search listings and tags for the new products. You review them on the products page before any is saved."),
      ScreenStash.values["importAfter"],
    )

    // An import that did not ask, or asked for another import, starts nothing.
    ScreenStash.set(json("""{"importAiCopy":null,"importAfter":null}"""))
    val quiet = mutableListOf<HttpRequestData>()
    ScreenModel(review, JsonObject(emptyMap()), client(200 to """{"done":true}""", sent = quiet))
      .run(apply, ScreenContext.with(json("""{"org":{"id":"o1","manager":true}}"""), "stash", ScreenStash.values))
    assertEquals(1, quiet.size)
    assertEquals(null, ScreenStash.values["importAfter"])
    // The done screen says what the hooks said.
    assertTrue(core("core.settings.data.import.done").blocks.any { it.whenCondition == "stash.importAfter" })
  }

  @Test
  fun anAudienceImportsAndExportsItsMembersAndResumesAnImportItLeft() = runTest {
    val transfer = plugin(emailSteps).first { it.id == "email.list.transfer" }
    val jobs = """
      {"unfinished":[
        {"jobId":"j1","resource":"email.list-members:abc","fileName":"spring.csv","label":"Members","status":"analyzed","updatedAt":1791385440000},
        {"jobId":"j2","resource":"email.list-members:other","fileName":"other.csv","label":"Members","status":"draft","updatedAt":1791385440000}]}
    """.trimIndent()
    val sent = mutableListOf<HttpRequestData>()
    val model = ScreenModel(
      transfer,
      json("""{"org":{"id":"o1","manager":true},"site":{"id":"h1"},"params":{"list":"abc","name":"Spring sale","resource":"email.list-members:abc"}}"""),
      client(200 to jobs, sent = sent),
    )
    model.load()
    assertEquals(json("""{"orgId":"o1","unfinished":true}"""), (sent[0].body as TextContent).text.let { json(it) })
    // Import runs the records wizard on this list, titled as the console titles it.
    val scope = model.context
    fun action(id: String) = transfer.blocks.flatMap { block -> (block.raw.obj("items") as? JsonArray).orEmpty() }.mapNotNull { ActionSpec.parse(it) }.first { it.id == id }
    val navigate = action("import").navigate!!
    assertEquals("core.settings.data.import", navigate.screen)
    assertEquals(
      mapOf("resource" to "email.list-members:abc", "hostId" to "h1", "title" to "Import into Spring sale"),
      navigate.params.mapValues { ScreenValues.render(it.value, scope) },
    )
    // Export opens the shared export dialog on the same list.
    val export = action("export").exportRequest(scope)!!
    assertEquals(listOf("email.list-members:abc", "Export Spring sale", "h1"), listOf(export.resource, export.title, export.hostId))
    // Only this list's unfinished imports are offered to resume.
    val list = transfer.blocks.first { it.title == "Resume import" }
    val rows = ScreenValues.scopes(list.string("items").orEmpty(), null, list.string("filter"), scope)
    assertEquals(listOf("spring.csv"), rows.map { ScreenValues.render(list.string("primary").orEmpty(), it) })
    // The audience's own menu opens this screen; the wizard's title is a parameter.
    val wizard = core("core.settings.data.import")
    assertEquals("Import into Spring sale", ScreenValues.render(wizard.title, json("""{"params":{"title":"Import into Spring sale"}}""")))
    assertEquals("Import records", ScreenValues.render(wizard.title, json("""{"params":{}}""")))
  }

  @Test
  fun theRulesStepKeepsThePlanItAskedForSoAStepCanAskAgain() = runTest {
    val rules = core("core.settings.data.import.rules")
    val submit = ActionSpec.parse(rules.blocks.first { it.id == "policy" }["submit"])!!
    val sent = mutableListOf<HttpRequestData>()
    val model = ScreenModel(rules, JsonObject(emptyMap()), client(200 to """{"summary":{"create":2}}""", sent = sent))
    ScreenStash.set(json("""{"importJob":"j1","importMapping":{"0":"email"},"importExtras":{"email-existing":{"updateContacts":false}}}"""))
    val scope = ScreenContext.with(
      ScreenContext.with(json("""{"org":{"id":"o1"},"form":{"onMatch":"update","onNew":"create","onAmbiguous":"ask","mode":"fillBlanks","blank":"leave"}}"""), "stash", ScreenStash.values),
      "org", json("""{"id":"o1"}"""),
    )
    model.run(submit, scope)
    val planned = body(sent, 0)
    // What a plugin's earlier answers were is part of the plan, and the same body is what the step asks again with.
    assertEquals(json("""{"email-existing":{"updateContacts":false}}"""), planned["extras"])
    assertEquals(planned, ScreenStash.values["importPlanBody"])
    assertEquals(json("2"), (ScreenStash.values["importPlan"] as JsonObject).let { ScreenValues.lookup("summary.create", it) })
  }

  @Test
  fun theGiftCardTotalIsTypedBackAndSentWithThePlanAgain() = runTest {
    val step = plugin(giftCards).first()
    ScreenStash.set(JsonObject(mapOf("importPlanBody" to planBody, "importPlan" to json("""{"summary":{"create":2}}"""))))
    val rows = """{"rows":{"rows":[{"giftCard":{"code":"AAA","amountCents":2500,"totalCents":6000,"recipientEmail":"a@example.test"}},{"giftCard":{"code":"BBB","amountCents":3500,"totalCents":6000}}],"next":null}}"""
    val sent = mutableListOf<HttpRequestData>()
    val model = ScreenModel(
      step,
      ScreenContext.with(json("""{"org":{"id":"o1"},"params":{"jobId":"j1"}}"""), "stash", ScreenStash.values),
      client(200 to rows, 200 to """{"summary":{"create":2},"acknowledgementsRequired":[]}""", sent = sent),
    )
    model.load()
    assertEquals(json("""{"orgId":"o1","jobId":"j1","action":"rows","limit":200,"verdicts":["create"]}"""), body(sent, 0))
    assertEquals("/api/transfer/plan", sent[0].url.encodedPath)
    // The form is offered once every card is loaded, and only the exact total passes.
    val confirm = step.blocks.first { it.id == "confirm" }
    assertTrue(ScreenValues.condition(confirm.whenCondition, model.context))
    val typed = (confirm.raw.obj("fields") as JsonArray).mapNotNull { FieldSpec.parse(it) }.first { it.key == "typed" }
    assertFalse(typed.unmet(json("\"${'$'}60.00\""), model.context))
    assertTrue(typed.unmet(json("\"${'$'}59.00\""), model.context))
    assertTrue(typed.unmet(json("\"\""), model.context))
    // A total is read as dollars, as the console reads it: the sign and the cents are optional.
    for (accepted in listOf("60", "${'$'}60", "60.00", "${'$'}60.00", " 60 ", "60 USD", "usd 60")) {
      assertFalse(typed.unmet(JsonPrimitive(accepted), model.context), accepted)
    }
    for (refused in listOf("59.99", "sixty", "${'$'}60.001", "-60")) assertTrue(typed.unmet(JsonPrimitive(refused), model.context), refused)
    assertTrue(typed.mismatches(JsonPrimitive("59"), model.context))
    assertFalse(typed.mismatches(JsonPrimitive("60"), model.context))
    assertEquals("That is not the total. These cards add up to ${'$'}60.00.", ScreenValues.render(typed.mismatch!!, model.context))
    // Confirming asks the same plan again with the answer under the step's id, and keeps it for the steps after.
    val submit = ActionSpec.parse(confirm["submit"])!!
    val scope = ScreenContext.with(ScreenContext.with(model.context, "form", json("""{"typed":"${'$'}60.00","email":true}""")), "stash", ScreenStash.values)
    val outcome = model.run(submit, scope)
    assertEquals(ActionOutcome.Done("Confirmed", json("""{"summary":{"create":2},"acknowledgementsRequired":[]}""")), outcome)
    val asked = body(sent, 1)
    assertEquals(json("\"j1\""), asked["jobId"])
    assertEquals(json("""{"0":"email"}"""), asked["mapping"])
    assertEquals(json("""{"gift-card-total":{"typed":"${'$'}60.00","totalCents":6000,"email":true}}"""), asked["extras"])
    assertEquals(asked["extras"], ScreenStash.values["importExtras"])
    assertEquals(asked, ScreenStash.values["importPlanBody"])
  }

  @Test
  fun theListImportSendsItsAnswersUnderTheConsolesKeysAndKeepsEachOther() = runTest {
    val steps = plugin(emailSteps)
    val existing = steps.first { it.id == "email.import.existing" }
    val consent = steps.first { it.id == "email.import.consent" }
    ScreenStash.set(JsonObject(mapOf("importPlanBody" to planBody)))
    val sent = mutableListOf<HttpRequestData>()
    val screening = """{"listName":"News","screening":{"roleAccounts":2,"roleAccountSamples":["info@x.test","sales@x.test"],"purchaseTellColumns":[],"declaresBasis":false,"sample":{"size":3,"of":3,"optedIn":1,"needAttestation":2,"refused":0}}}"""
    val api = client(200 to """{"summary":{"create":1}}""", 200 to """{"summary":{"create":1}}""", 200 to screening, 200 to """{"summary":{"create":1}}""", sent = sent)
    // The people already held: the toggle says whether the file may change their details.
    val model = ScreenModel(existing, JsonObject(emptyMap()), api)
    val form = existing.blocks.first { it.id == "existing" }
    model.run(ActionSpec.parse(form["submit"])!!, ScreenContext.with(json("""{"form":{"update":true}}"""), "stash", ScreenStash.values))
    assertEquals(json("""{"email-existing":{"updateContacts":true}}"""), body(sent, 0)["extras"])
    // The statement of permission, both ways; the earlier answer rides along.
    val asking = ScreenModel(consent, JsonObject(emptyMap()), api)
    asking.run(action(consent, "only"), ScreenContext.with(JsonObject(emptyMap()), "stash", ScreenStash.values))
    assertEquals(json("""{"email-existing":{"updateContacts":true},"email-consent":{"attest":false}}"""), body(sent, 1)["extras"])
    val attest = action(consent, "attest")
    assertTrue(attest.asksConfirmation)
    assertEquals(
      "I have these people’s permission to send them marketing email, and I can produce the record of it if asked. This statement is stored against my account, with today’s date, on every address it admits.",
      attest.confirmText(JsonObject(emptyMap())),
    )
    // What the file holds is read for this list and job, from the resource key's instance.
    val reading = ScreenModel(
      consent,
      ScreenContext.with(json("""{"params":{"resource":"email.list-members:abc123","hostId":"h1","jobId":"j1"}}"""), "stash", ScreenStash.values),
      api,
    )
    reading.load()
    assertEquals("/api/email/list-import-screening", sent[2].url.encodedPath)
    assertEquals(json("""{"hostId":"h1","listId":"abc123","jobId":"j1"}"""), body(sent, 2))
    val warned = consent.blocks.filter { it.type == "notice" && ScreenValues.condition(it.whenCondition, reading.context) }
      .mapNotNull { it.string("text")?.let { text -> ScreenValues.render(text, reading.context) } }
    assertTrue(warned.any { it.startsWith("2 shared mailboxes. Addresses like info@x.test, sales@x.test") })
    assertTrue(warned.any { "1 already have an opt-in on record, 2 have no opt-in on record" in it })
    asking.run(attest, ScreenContext.with(JsonObject(emptyMap()), "stash", ScreenStash.values))
    assertEquals(json("""{"attest":true}"""), (body(sent, 3)["extras"] as JsonObject)["email-consent"])
  }
}
