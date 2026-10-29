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
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Publishing the site as a template (`libs/plugins/marketplace/src/android/screens/marketplace.screens.json`): the zone it fills
 * on Backup & restore, the publisher agreement every publish agrees to with its own box (AGL-4105), and the routes it calls.
 * Apple replays the same cases (MarketplacePublishTests).
 */
class MarketplacePublishTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }

  private fun spec(id: String) =
    ScreenSpec.parseFile(File(root, "libs/plugins/marketplace/src/android/screens/marketplace.screens.json").readText()).first { it.id == id }

  private fun json(text: String): JsonElement = Json.parseToJsonElement(text)

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

  /** The screen's context as the loaded page has it: its constants, the profile document, the role, and what its `derive` list works out. */
  private fun shown(screen: ScreenSpec, profile: String?, manager: Boolean = true, members: String? = null): Pair<JsonElement, List<BlockSpec>> {
    var context = json("""{"org":{"id":"o1","manager":$manager},"site":{"id":"h1"},"data":{"profile":${profile ?: "null"},"members":${members ?: "null"}}}""")
    context = ScreenContext.with(context, "const", screen.raw.obj("constants")!!)
    val flags = linkedMapOf<String, JsonElement>()
    for (entry in (screen.raw.obj("derive") as? JsonArray).orEmpty()) {
      val seen = ScreenContext.with(context, "is", JsonObject(flags.toMap()))
      flags[entry.str("name")!!] = JsonPrimitive(ScreenValues.condition(entry.str("when"), seen))
    }
    context = ScreenContext.with(context, "is", JsonObject(flags))
    return context to screen.blocks.filter { ScreenValues.condition(it.whenCondition, context) }
  }

  private fun texts(blocks: List<BlockSpec>, context: JsonElement) =
    blocks.filter { it.type == "notice" }.mapNotNull { it.string("text")?.let { text -> ScreenValues.render(text, context) } }

  private fun constants(screen: ScreenSpec) = ScreenContext.with(json("""{"x":1}"""), "const", screen.raw.obj("constants")!!)

  /** [scope] with the screen's constants under `const`, as the model's own context carries them. */
  private fun withConstants(scope: JsonElement, screen: ScreenSpec) = ScreenContext.with(scope, "const", screen.raw.obj("constants")!!)

  /** The version in force, as the screens' constants carry it. */
  private fun agreementVersion(screen: ScreenSpec) = (ScreenValues.lookup("const.agreement.version", constants(screen)) as JsonPrimitive).content

  @Test
  fun theSiteTemplateIsAContributionToTheBackupScreensZone() {
    val contribution = spec("marketplace.publishTemplate")
    assertEquals(listOf("siteTemplate"), contribution.zones)
    assertEquals("Publish as template", contribution.label)
    val backup = ScreenSpec.parseFile(File(root, "libs/native/screens/site.screens.json").readText()).first { it.id == "core.site.backup" }
    assertEquals(listOf("siteTemplate"), backup.blocks.filter { it.type == "zone" }.mapNotNull { it.string("name") })
  }

  @Test
  fun everyPublishAsksForTheAgreementInABoxAboveItsButton() {
    for (
      id in listOf(
        "marketplace.publishTemplate", "marketplace.publishLayout", "marketplace.publishComponent", "marketplace.publishTheme",
        "marketplace.publishDatasetSchema", "marketplace.publishEmailTemplate", "marketplace.publishEmailStarter", "marketplace.publishPlugin",
      )
    ) {
      val publish = spec(id)
      val form = publish.blocks.first { it.type == "form" }
      val fields = (form.raw.obj("fields") as JsonArray).mapNotNull { FieldSpec.parse(it) }
      // The last field, nearest the button: one choice, which must be chosen before the form can send.
      val box = fields.last()
      assertEquals("agreement", box.key, id)
      assertEquals(listOf("I agree to the Marketplace Publisher Agreement"), box.options.map { it.second }, id)
      assertTrue(box.unmet(JsonArray(emptyList()), JsonObject(emptyMap())), id)
      assertFalse(box.unmet(JsonArray(listOf(JsonPrimitive("agreed"))), JsonObject(emptyMap())), id)
      // Whatever the organization agreed to before, every publish asks: no notice about its standing, and the agreement is
      // always a link away.
      for (profile in listOf(null, """{"handle":"studio"}""", """{"handle":"studio","publisherAgreement":{"version":"${agreementVersion(publish)}"}}""")) {
        val (context, blocks) = shown(publish, profile)
        assertEquals(emptyList(), texts(blocks, context).filter { "terms" in it }, id)
        val links = blocks.filter { it.type == "links" }.flatMap { (it.raw.obj("items") as JsonArray).mapNotNull { link -> link.str("title") } }
        assertTrue("Read the Marketplace Publisher Agreement" in links, id)
      }
    }
  }

  @Test
  fun theAgreementShowsWhatChangedSinceTheVersionLastAgreedToAndAsksForNothingItself() {
    val agreement = spec("marketplace.publisherAgreement")
    val changes = agreement.blocks.first { it.title?.startsWith("What changed") == true }
    fun changed(since: String): List<String> {
      val (context, _) = shown(agreement, """{"handle":"s","publisherAgreement":{"version":"$since"}}""")
      return ScreenValues.scopes(changes.string("items").orEmpty(), changes.string("within"), changes.string("filter"), context)
        .map { ScreenValues.render(changes.string("secondary").orEmpty(), it) }
    }
    // Only the versions after the one last agreed to, each change under the version that made it.
    assertEquals(listOf("Version 2026-08-24.1"), changed("2026-08-18.1"))
    assertEquals(5, changed("2026-01-01.1").size)
    assertEquals(emptyList(), changed("2026-08-24.1"))

    // It says every save asks, and when the organization last agreed; there is nothing to accept here.
    val everySave =
      "Every save in the marketplace — your profile, a listing, its price or visibility, a new version, a component, template or layout — asks you to tick “I agree to the Marketplace Publisher Agreement” first. We record who agreed, to which version, and when."
    val (stale, staleBlocks) = shown(agreement, """{"handle":"s","publisherAgreement":{"version":"2026-08-18.1"}}""")
    assertEquals(listOf(everySave, "Your organization last agreed to version 2026-08-18.1. Your next save agrees to version 2026-08-24.1."), texts(staleBlocks, stale))
    val (never, neverBlocks) = shown(agreement, """{"handle":"s"}""")
    assertEquals(listOf(everySave), texts(neverBlocks, never))
    assertFalse(agreement.blocks.any { block -> (block.raw.obj("items") as? JsonArray).orEmpty().any { it.str("url") != null } })
  }

  @Test
  fun publishingSendsTheListingTheRouteTakesAndTheAgreementItWasTickedFor() = runTest {
    val publish = spec("marketplace.publishTemplate")
    val form = publish.blocks.first { it.type == "form" }
    val submit = ActionSpec.parse(form["submit"])!!
    val sent = mutableListOf<HttpRequestData>()
    val model = ScreenModel(publish, JsonObject(emptyMap()), client(200 to """{"ok":true,"version":3}""", 200 to """{"ok":true,"version":1}""", sent = sent))
    val version = agreementVersion(publish)
    val outcome = model.run(
      submit,
      withConstants(json("""{"site":{"id":"h1"},"form":{"name":"Studio","description":"A portfolio","category":"Portfolio","price":5,"agreement":["agreed"]}}"""), publish),
    )
    assertEquals(ActionOutcome.Done("Published v3 to the marketplace", json("""{"ok":true,"version":3}""")), outcome)
    assertEquals("/api/marketplace/publish-template", sent[0].url.encodedPath)
    assertEquals(
      json("""{"hostId":"h1","displayName":"Studio","description":"A portfolio","category":"Portfolio","priceUsd":5,"agreement":{"version":"$version","accepted":true}}"""),
      body(sent, 0),
    )
    // A price left blank is not sent as a number: the route reads it as free. Unticked, the agreement says only its version,
    // which the route refuses.
    model.run(submit, withConstants(json("""{"site":{"id":"h1"},"form":{"name":"Free one"}}"""), publish))
    val free = body(sent, 1)
    assertEquals(JsonPrimitive("Free one"), free["displayName"])
    assertTrue(free["priceUsd"] == null || free["priceUsd"] == JsonNull)
    assertEquals(json("""{"version":"$version"}"""), free["agreement"])
    // The name is required; the price field states the floor.
    val fields = (form.raw.obj("fields") as JsonArray).mapNotNull { FieldSpec.parse(it) }
    assertTrue(fields.first { it.key == "name" }.required)
    assertTrue(fields.first { it.key == "price" }.help.orEmpty().startsWith("0 for free, or $"))
  }

  @Test
  fun everyOtherKindPublishesWithWhatItIsAndTheListingTheRouteTakes() = runTest {
    // Each kind: the screen, the route, and the fields that say which one it is.
    val kinds = listOf(
      Triple("marketplace.publishLayout", "/api/marketplace/publish-layout", """{"hostId":"h1","layoutId":"x1"}"""),
      Triple("marketplace.publishComponent", "/api/marketplace/publish", """{"hostId":"h1","componentId":"x1"}"""),
      Triple("marketplace.publishTheme", "/api/marketplace/publish-theme", """{"hostId":"h1"}"""),
      Triple("marketplace.publishDatasetSchema", "/api/marketplace/publish-dataset-schema", """{"orgId":"o1","datasetId":"x1"}"""),
      Triple("marketplace.publishEmailTemplate", "/api/marketplace/publish-email-template", """{"hostId":"h1","templateKey":"x1"}"""),
      Triple("marketplace.publishEmailStarter", "/api/marketplace/publish-email-starter", """{"hostId":"h1","screenId":"x1"}"""),
    )
    for ((id, route, identity) in kinds) {
      val publish = spec(id)
      val form = publish.blocks.first { it.type == "form" }
      val submit = ActionSpec.parse(form["submit"])!!
      val sent = mutableListOf<HttpRequestData>()
      val model = ScreenModel(publish, JsonObject(emptyMap()), client(200 to """{"ok":true,"version":2}""", sent = sent))
      val context = withConstants(
        json("""{"org":{"id":"o1"},"site":{"id":"h1"},"params":{"id":"x1"},"form":{"name":"Hero","description":"A hero","category":"Hero","price":0,"agreement":["agreed"]}}"""),
        publish,
      )
      val outcome = model.run(submit, context)
      assertEquals(ActionOutcome.Done("Published v2 to the marketplace", json("""{"ok":true,"version":2}""")), outcome, id)
      // A route refusal opens nothing any more: the agreement is the box in the form.
      assertEquals(null, submit.gate.str("screen"), id)
      assertEquals(route, sent[0].url.encodedPath, id)
      val agreed = json("""{"version":"${agreementVersion(publish)}","accepted":true}""")
      assertEquals(
        JsonObject(
          json(identity).let { it as JsonObject } +
            mapOf("displayName" to JsonPrimitive("Hero"), "description" to JsonPrimitive("A hero"), "category" to JsonPrimitive("Hero"), "priceUsd" to JsonPrimitive(0), "agreement" to agreed),
        ),
        body(sent, 0),
        id,
      )
      // The form opens with the name and description the thing already has, handed over as the screen's parameters.
      val fields = (form.raw.obj("fields") as JsonArray).mapNotNull { FieldSpec.parse(it) }
      val params = json("""{"params":{"name":"Hero band","description":"The top of the page"}}""")
      assertEquals(listOf("Hero band", "The top of the page"), listOf("name", "description").map { key -> ScreenValues.render(fields.first { it.key == key }.initial.orEmpty(), params) }, id)
      assertTrue(fields.first { it.key == "name" }.required, id)
    }
    assertEquals("org", spec("marketplace.publishDatasetSchema").scope)
    assertEquals("site", spec("marketplace.publishLayout").scope)
    assertEquals(null, spec("marketplace.publishLayout").zones.firstOrNull())
  }

  @Test
  fun thePublishHubListsWhatThisSiteAndTheWorkspaceCanPublishAndOpensTheRightForm() {
    val hub = spec("marketplace.publish")
    val context = json(
      """{"site":{"id":"h1"},"org":{"id":"o1"},"data":{
        "components":{"items":[{"${'$'}id":"c1","displayName":"Hero","description":"Top band"},{"${'$'}id":"c2","displayName":"Gone","deletedAt":1}]},
        "layouts":{"items":[{"${'$'}id":"l1","displayName":"Main"}]},
        "emails":{"items":[{"${'$'}id":"e1","displayName":"Receipt","versionId":"v1"},{"${'$'}id":"e2","displayName":"Never saved"}]},
        "emailScreens":{"items":[{"${'$'}id":"s1","displayName":"Welcome","versionId":"v1","deletedAt":null}]},
        "datasets":{"items":[{"${'$'}id":"d1","name":"Menu items"},{"${'$'}id":"d2","displayName":"Staff"}]}}}""",
    )
    fun rows(title: String): List<Triple<String, String, Map<String, String>>> {
      val block = hub.blocks.first { it.title == title }
      return ScreenValues.scopes(block.string("items").orEmpty(), null, block.string("filter"), context).map { scope ->
        val open = block["open"] as JsonObject
        Triple(ScreenValues.render(block.string("primary").orEmpty(), scope), open.str("screen").orEmpty(), renderParams(open["params"], scope))
      }
    }
    assertEquals(listOf(Triple("Hero", "marketplace.publishComponent", mapOf("id" to "c1", "name" to "Hero", "description" to "Top band"))), rows("Components"))
    assertEquals(listOf("Main"), rows("Layouts").map { it.first })
    // Only an email with a saved design can be published: a design that was opened and never saved has nothing to publish.
    assertEquals(listOf("Receipt"), rows("Email templates").map { it.first })
    assertEquals(listOf("Welcome"), rows("Emails").map { it.first })
    assertEquals("marketplace.publishEmailStarter", rows("Emails").single().second)
    // A dataset is named as the Data page names it.
    assertEquals(listOf("Menu items", "Staff"), rows("Dataset schemas").map { it.first })
    assertEquals(listOf("marketplace.publishTemplate", "marketplace.publishTheme", "marketplace.publishPlugin"), hub.blocks.first { it.type == "links" && it.whenCondition == null }.raw.arr("items").mapNotNull { it.str("screen") })
    // What it reads: this site's collections, and the workspace's datasets.
    val paths = (hub.raw.obj("load") as JsonObject).filterValues { (it as JsonObject).obj("query") != null }.mapValues { (_, load) -> ((load as JsonObject).obj("query") as JsonObject).str("collection") }
    assertEquals(
      mapOf("components" to "hosts/{site.id}/components", "layouts" to "hosts/{site.id}/layouts", "emails" to "hosts/{site.id}/emailTemplates", "emailScreens" to "hosts/{site.id}/screens", "datasets" to "orgs/{org.id}/datasets"),
      paths,
    )
  }

  @Test
  fun aPublishRefusedForTheAgreementSaysWhyInTheRoutesWords() = runTest {
    val publish = spec("marketplace.publishTemplate")
    val submit = ActionSpec.parse(publish.blocks.first { it.type == "form" }["submit"])!!
    val refusal = """{"error":"Tick 'I agree to the Marketplace Publisher Agreement' to save","agreement":{"required":"2026-08-24.1","state":"missing"}}"""
    val sent = mutableListOf<HttpRequestData>()
    val model = ScreenModel(publish, JsonObject(emptyMap()), client(428 to refusal, sent = sent))
    assertEquals(
      ActionOutcome.Failed("Tick 'I agree to the Marketplace Publisher Agreement' to save"),
      model.run(submit, withConstants(json("""{"site":{"id":"h1"},"form":{"name":"Studio"}}"""), publish)),
    )
  }

  @Test
  fun aPluginPublishesItsBundleBytesManifestListingAndEveryStatementThroughThePublishRoute() = runTest {
    val publish = spec("marketplace.publishPlugin")
    assertEquals("org", publish.scope)
    val form = publish.blocks.first { it.type == "form" }
    val fields = (form.raw.obj("fields") as JsonArray).mapNotNull { FieldSpec.parse(it) }
    fun field(key: String) = fields.first { it.key == key }
    // The bundle travels as its bytes, base64, the way the console's `fileToBase64` sends it; the manifest is read as JSON.
    val bytes = byteArrayOf(0x63, 0x6F, 0x6E, 0x73, 0x74, 0x00, 0xFF.toByte())
    assertEquals("Y29uc3QA/w==", ScreenValues.base64(bytes))
    assertEquals(JsonPrimitive("Y29uc3QA/w=="), fieldJson(field("bundle"), FieldValue.File("w.js", ScreenValues.base64(bytes))))
    assertEquals(
      json("""{"id":"acme-widget","name":"Widget","version":"1.0.0","entry":"index.js"}"""),
      fieldJson(field("manifest"), FieldValue.File("m.json", """{"id":"acme-widget","name":"Widget","version":"1.0.0","entry":"index.js"}""")),
    )
    // Every statement must be confirmed; each says what it means under its label.
    val first = field("attested")
    assertTrue(first.unmet(JsonArray(first.options.dropLast(1).map { JsonPrimitive(it.first) }), JsonObject(emptyMap())))
    assertFalse(first.unmet(JsonArray(first.options.map { JsonPrimitive(it.first) }), JsonObject(emptyMap())))
    assertFalse(first.options.any { it.first == "changelog" }, "the changelog statement is an update's")
    assertEquals("changelog", field("attestedUpdate").options.last().first)
    assertTrue(first.detail("repository", JsonObject(emptyMap())) != null)

    val attested = JsonArray(first.options.map { JsonPrimitive(it.first) })
    val submit = ActionSpec.parse(form["submit"])!!
    val sent = mutableListOf<HttpRequestData>()
    val answer = """{"ok":true,"version":"1.0.0","listingId":"l9"}"""
    val model = ScreenModel(publish, JsonObject(emptyMap()), client(200 to answer, 200 to answer, sent = sent))
    val base = mapOf(
      "bundle" to JsonPrimitive("Y29uc3QA/w=="), "manifest" to json("""{"id":"acme-widget","name":"Widget"}"""), "name" to JsonPrimitive(""),
      "description" to JsonPrimitive("Counts down"), "category" to JsonPrimitive(""), "readme" to JsonPrimitive(""), "changelog" to JsonPrimitive("First"),
      "repositoryUrl" to JsonPrimitive("https://github.com/acme/widget"), "license" to JsonPrimitive("MIT"), "visibility" to JsonPrimitive("public"),
      "price" to JsonPrimitive(5), "attested" to attested, "agreement" to JsonArray(listOf(JsonPrimitive("agreed"))),
    )
    fun scope(form: Map<String, JsonElement>) =
      withConstants(JsonObject(mapOf("org" to json("""{"id":"o1"}"""), "params" to JsonObject(emptyMap()), "form" to JsonObject(form))), publish)
    assertEquals(ActionOutcome.Done("Published v1.0.0 — it is queued for review", json(answer)), model.run(submit, scope(base)))
    assertEquals("/api/marketplace/publish-plugin", sent[0].url.encodedPath)
    // The listing name falls back to the manifest's; an empty README and category are left out, as the console leaves them.
    assertEquals(
      json(
        """{"orgId":"o1","bundle":"Y29uc3QA/w==","manifest":{"id":"acme-widget","name":"Widget"},"displayName":"Widget","description":"Counts down",
        "changelog":"First","priceUsd":5,"visibility":"public","attestation":$attested,"license":"MIT","repositoryUrl":"https://github.com/acme/widget",
        "agreement":{"version":"${agreementVersion(publish)}","accepted":true}}""",
      ),
      body(sent, 0),
    )
    // A private plugin is free whatever the price field held.
    model.run(submit, scope(base + ("visibility" to JsonPrimitive("private"))))
    assertEquals(0.0, (body(sent, 1)["priceUsd"] as JsonPrimitive).content.toDouble())
    // Opens the listing it published.
    assertEquals("marketplace.listing", submit.navigate?.screen)
    assertEquals(mapOf("listing" to "{response.listingId}"), submit.navigate?.params)
  }

  @Test
  fun aPluginRefusedByTheVerifierSaysWhatItFoundAndTheAgreementLikeEveryPublish() = runTest {
    val publish = spec("marketplace.publishPlugin")
    val submit = ActionSpec.parse(publish.blocks.first { it.type == "form" }["submit"])!!
    val refusal = """{"error":"Tick 'I agree to the Marketplace Publisher Agreement' to save","agreement":{"required":"2026-08-24.1","state":"missing"}}"""
    val problems = """{"error":"Bundle rejected","problems":[{"level":"error","check":"network","message":"Calls an undeclared host"},{"level":"error","message":"Too large"}]}"""
    val sent = mutableListOf<HttpRequestData>()
    val model = ScreenModel(publish, JsonObject(emptyMap()), client(428 to refusal, 422 to problems, sent = sent))
    val scope = withConstants(json("""{"org":{"id":"o1"},"params":{},"form":{"bundle":"eA==","manifest":{"id":"w"},"name":"W"}}"""), publish)
    assertEquals(ActionOutcome.Failed("Tick 'I agree to the Marketplace Publisher Agreement' to save"), model.run(submit, scope))
    assertEquals(ActionOutcome.Failed("Bundle rejected\nBundle failed verification\nnetwork: Calls an undeclared host\nToo large"), model.run(submit, scope))
  }

  @Test
  fun aNewVersionStartsFromTheListingAndSaysWhatInstallsToday() {
    val publish = spec("marketplace.publishPlugin")
    val version = (publish.raw.obj("constants")!!.obj("agreement")!!.obj("version") as JsonPrimitive).content
    fun notices(listing: String, revocation: String = "null"): List<String> {
      var (context, _) = shown(publish, """{"handle":"studio","publisherAgreement":{"version":"$version"}}""")
      context = ScreenContext.with(context, "params", json("""{"listing":"l1"}"""))
      context = ScreenContext.with(context, "data", json("""{"listing":$listing,"revocation":$revocation}"""))
      val flags = linkedMapOf<String, JsonElement>()
      for (entry in publish.raw.obj("derive") as JsonArray) {
        flags[entry.str("name")!!] = JsonPrimitive(ScreenValues.condition(entry.str("when"), ScreenContext.with(context, "is", JsonObject(flags.toMap()))))
      }
      context = ScreenContext.with(context, "is", JsonObject(flags))
      return texts(publish.blocks.filter { ScreenValues.condition(it.whenCondition, context) }, context)
    }
    assertEquals(
      listOf("v2 is what installs today. It keeps installing until a reviewer approves this one — nobody is upgraded onto unreviewed code, and nothing you publish here can change a version already installed."),
      notices("""{"latestApprovedVersion":"2"}"""),
    )
    // A stopped version installs nowhere, and neither does a listing whose every version is stopped.
    val enters = listOf("This version enters review. Nothing installs until a reviewer approves it.")
    assertEquals(enters, notices("""{"latestApprovedVersion":"2"}""", """{"versions":["2"]}"""))
    assertEquals(enters, notices("""{"latestApprovedVersion":"2"}""", """{"versions":"all"}"""))
    assertEquals(enters, notices("""{"latestVersion":"1"}"""))
    // Who can install it is the listing's, so a new version does not ask.
    val fields = (publish.blocks.first { it.type == "form" }.raw.obj("fields") as JsonArray).mapNotNull { FieldSpec.parse(it) }
    assertEquals("!params.listing", fields.first { it.key == "visibility" }.whenCondition)
    assertEquals("{data.listing.displayName}", fields.first { it.key == "name" }.initial)
  }

  @Test
  fun thePublishHubStatesWhatAglynKeepsOnThisPlan() {
    val hub = spec("marketplace.publish")
    assertEquals("marketplace", (hub.raw.obj("load")!!.obj("fee")!!.obj("takeRate") as JsonPrimitive).content)
    fun shownFee(fee: String): List<String> {
      val context = json("""{"site":{"id":"h1"},"org":{"id":"o1"},"data":{$fee}}""")
      return texts(hub.blocks.filter { ScreenValues.condition(it.whenCondition, context) }, context).filter { "keeps" in it }
    }
    assertEquals(listOf("Aglyn keeps 30% of each sale on your current plan. On a paid plan it is 20%."), shownFee(""""fee":{"pct":30,"paid":20}"""))
    assertEquals(listOf("Aglyn keeps 20% of each sale. Payment processing fees are charged separately by Stripe."), shownFee(""""fee":{"pct":20.0,"paid":20.0}"""))
    assertEquals(listOf("Aglyn keeps 12% of each sale. Payment processing fees are charged separately by Stripe."), shownFee(""""fee":{"pct":12,"paid":20}"""))
    // Nothing is said before the workspace has been read: the free rate would accuse a paying publisher of the higher cut.
    assertEquals(emptyList(), shownFee(""))
  }

  @Test
  fun everyBlockOfEveryMarketplaceScreenHasItsOwnIdentity() {
    for (screen in ScreenSpec.parseFile(File(root, "libs/plugins/marketplace/src/android/screens/marketplace.screens.json").readText())) {
      // Two untitled notices shown at once must be two lazy-list items; a key used twice is refused.
      assertEquals(screen.blocks.size, screen.blocks.map { it.id }.toSet().size, screen.id)
    }
  }
}
