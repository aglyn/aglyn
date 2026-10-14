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
    val steps = plugin(giftCards) + plugin(emailSteps)
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
