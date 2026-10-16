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
 * on Backup & restore, the agreement the publish needs accepted, and the two routes it calls. Apple replays the same cases
 * (MarketplacePublishTests).
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
    for (entry in screen.raw.obj("derive") as JsonArray) {
      val seen = ScreenContext.with(context, "is", JsonObject(flags.toMap()))
      flags[entry.str("name")!!] = JsonPrimitive(ScreenValues.condition(entry.str("when"), seen))
    }
    context = ScreenContext.with(context, "is", JsonObject(flags))
    return context to screen.blocks.filter { ScreenValues.condition(it.whenCondition, context) }
  }

  private fun texts(blocks: List<BlockSpec>, context: JsonElement) =
    blocks.filter { it.type == "notice" }.mapNotNull { it.string("text")?.let { text -> ScreenValues.render(text, context) } }

  private fun constants(screen: ScreenSpec) = ScreenContext.with(json("""{"x":1}"""), "const", screen.raw.obj("constants")!!)

  @Test
  fun theSiteTemplateIsAContributionToTheBackupScreensZone() {
    val contribution = spec("marketplace.publishTemplate")
    assertEquals(listOf("siteTemplate"), contribution.zones)
    assertEquals("Publish as template", contribution.label)
    val backup = ScreenSpec.parseFile(File(root, "libs/native/screens/site.screens.json").readText()).first { it.id == "core.site.backup" }
    assertEquals(listOf("siteTemplate"), backup.blocks.filter { it.type == "zone" }.mapNotNull { it.string("name") })
  }

  @Test
  fun theAgreementIsOfferedUntilTheOrganizationHasAcceptedTheCurrentVersion() {
    val publish = spec("marketplace.publishTemplate")
    val version = (ScreenValues.lookup("const.agreement.version", constants(publish)) as JsonPrimitive).content
    val review = "Review the Marketplace Publisher Agreement"
    fun offered(profile: String?): Pair<List<String>, Boolean> {
      val (context, blocks) = shown(publish, profile)
      val links = blocks.filter { it.type == "links" }.flatMap { (it.raw.obj("items") as JsonArray).mapNotNull { link -> link.str("title") } }
      return texts(blocks, context).filter { "terms" in it } to (review in links)
    }
    // No publisher profile yet: the publish is refused for the profile first, so the agreement is not asked for.
    assertEquals(emptyList(), offered(null).first)
    assertFalse(offered(null).second)
    // A profile that never accepted.
    val never = offered("""{"handle":"studio"}""")
    assertEquals(listOf("Your organization has not accepted these terms. They must be accepted before anything is published."), never.first)
    assertTrue(never.second)
    // One that accepted an earlier version.
    val old = offered("""{"handle":"studio","publisherAgreement":{"version":"2026-08-18.1"}}""")
    assertEquals(
      listOf("These terms have changed since your organization accepted version 2026-08-18.1. Publishing is paused until the current version is accepted."),
      old.first,
    )
    assertTrue(old.second)
    // The current version needs nothing.
    val current = offered("""{"handle":"studio","publisherAgreement":{"version":"$version"}}""")
    assertEquals(emptyList(), current.first)
    assertFalse(current.second)
  }

  @Test
  fun theAgreementShowsWhatChangedSinceTheVersionAcceptedAndWhoMayAccept() {
    val agreement = spec("marketplace.publisherAgreement")
    val changes = agreement.blocks.first { it.title?.startsWith("What changed") == true }
    fun changed(since: String): List<String> {
      val (context, _) = shown(agreement, """{"handle":"s","publisherAgreement":{"version":"$since"}}""")
      return ScreenValues.scopes(changes.string("items").orEmpty(), changes.string("within"), changes.string("filter"), context)
        .map { ScreenValues.render(changes.string("secondary").orEmpty(), it) }
    }
    // Only the versions after the one accepted, each change under the version that made it.
    assertEquals(listOf("Version 2026-08-24.1"), changed("2026-08-18.1"))
    assertEquals(5, changed("2026-01-01.1").size)
    assertEquals(emptyList(), changed("2026-08-24.1"))

    // An owner or admin is offered the accept, per what the standing is; anyone else is told who to ask.
    val stale = """{"handle":"s","publisherAgreement":{"version":"2026-08-18.1"}}"""
    val accept = agreement.blocks.first { it.type == "actions" && it.whenCondition == "is.canAccept" }
    val actions = (accept.raw.obj("items") as JsonArray).mapNotNull { ActionSpec.parse(it) }
    val (manager, managerBlocks) = shown(agreement, stale)
    assertEquals(listOf("Accept the current version"), actions.filter { ScreenValues.condition(it.whenCondition, manager) }.map { it.label })
    assertTrue(managerBlocks.any { it.type == "actions" && it.whenCondition == "is.canAccept" })
    val (first, _) = shown(agreement, """{"handle":"s"}""")
    assertEquals(listOf("Accept on behalf of this organization"), actions.filter { ScreenValues.condition(it.whenCondition, first) }.map { it.label })
    val members = """{"members":[{"${'$'}id":"u1","role":"owner","displayName":"Dana","email":"dana@example.test"},{"${'$'}id":"u2","role":"viewer"}]}"""
    val (member, memberBlocks) = shown(agreement, stale, manager = false, members = members)
    assertFalse(memberBlocks.any { it.whenCondition == "is.canAccept" })
    assertEquals(
      "Only an owner or admin of your organization can accept on its behalf. Ask one of them to accept it, then try again.",
      texts(memberBlocks, member).last(),
    )
    val who = memberBlocks.first { it.title == "Who can accept" }
    assertEquals(
      listOf("Dana"),
      ScreenValues.scopes(who.string("items").orEmpty(), null, who.string("filter"), member).map { ScreenValues.render(who.string("primary").orEmpty(), it) },
    )
  }

  @Test
  fun publishingSendsTheListingTheRouteTakesAndAcceptingSendsTheVersionInForce() = runTest {
    val publish = spec("marketplace.publishTemplate")
    val form = publish.blocks.first { it.type == "form" }
    val submit = ActionSpec.parse(form["submit"])!!
    val sent = mutableListOf<HttpRequestData>()
    val model = ScreenModel(publish, JsonObject(emptyMap()), client(200 to """{"ok":true,"version":3}""", 200 to """{"ok":true,"version":1}""", sent = sent))
    val outcome = model.run(submit, json("""{"site":{"id":"h1"},"form":{"name":"Studio","description":"A portfolio","category":"Portfolio","price":5}}"""))
    assertEquals(ActionOutcome.Done("Published v3 to the marketplace", json("""{"ok":true,"version":3}""")), outcome)
    assertEquals("/api/marketplace/publish-template", sent[0].url.encodedPath)
    assertEquals(json("""{"hostId":"h1","displayName":"Studio","description":"A portfolio","category":"Portfolio","priceUsd":5}"""), body(sent, 0))
    // A price left blank is not sent as a number: the route reads it as free.
    model.run(submit, json("""{"site":{"id":"h1"},"form":{"name":"Free one"}}"""))
    val free = body(sent, 1)
    assertEquals(JsonPrimitive("Free one"), free["displayName"])
    assertTrue(free["priceUsd"] == null || free["priceUsd"] == JsonNull)
    // The name is required; the price field states the floor.
    val fields = (form.raw.obj("fields") as JsonArray).mapNotNull { FieldSpec.parse(it) }
    assertTrue(fields.first { it.key == "name" }.required)
    assertTrue(fields.first { it.key == "price" }.help.orEmpty().startsWith("0 for free, or $"))

    val agreement = spec("marketplace.publisherAgreement")
    val block = agreement.blocks.first { it.whenCondition == "is.canAccept" }
    val accept = ActionSpec.parse((block.raw.obj("items") as JsonArray).first())!!
    val acceptingSent = mutableListOf<HttpRequestData>()
    val session = ScreenModel(agreement, JsonObject(emptyMap()), client(200 to """{"ok":true}""", sent = acceptingSent))
    val version = (ScreenValues.lookup("const.agreement.version", constants(agreement)) as JsonPrimitive).content
    session.run(accept, ScreenContext.with(json("""{"org":{"id":"o1"}}"""), "const", agreement.raw.obj("constants")!!))
    assertEquals("/api/marketplace/publisher-profile", acceptingSent[0].url.encodedPath)
    assertEquals(json("""{"action":"accept-agreement","orgId":"o1","version":"$version"}"""), body(acceptingSent, 0))
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
      val context = json("""{"org":{"id":"o1"},"site":{"id":"h1"},"params":{"id":"x1"},"form":{"name":"Hero","description":"A hero","category":"Hero","price":0}}""")
      val outcome = model.run(submit, context)
      assertEquals(ActionOutcome.Done("Published v2 to the marketplace", json("""{"ok":true,"version":2}""")), outcome, id)
      // Refused for the agreement, it opens the agreement and sends the same publish once it is accepted.
      assertEquals("marketplace.publisherAgreement", submit.gate.str("screen"), id)
      assertEquals(route, sent[0].url.encodedPath, id)
      assertEquals(JsonObject(json(identity).let { it as JsonObject } + mapOf("displayName" to JsonPrimitive("Hero"), "description" to JsonPrimitive("A hero"), "category" to JsonPrimitive("Hero"), "priceUsd" to JsonPrimitive(0))), body(sent, 0), id)
      // The form opens with the name and description the thing already has, handed over as the screen's parameters.
      val fields = (form.raw.obj("fields") as JsonArray).mapNotNull { FieldSpec.parse(it) }
      val params = json("""{"params":{"name":"Hero band","description":"The top of the page"}}""")
      assertEquals(listOf("Hero band", "The top of the page"), listOf("name", "description").map { key -> ScreenValues.render(fields.first { it.key == key }.initial.orEmpty(), params) }, id)
      assertTrue(fields.first { it.key == "name" }.required, id)
      // The agreement is asked for exactly as the site template asks.
      val (offeredContext, blocks) = shown(publish, """{"handle":"studio"}""")
      assertEquals(listOf("Your organization has not accepted these terms. They must be accepted before anything is published."), texts(blocks, offeredContext).filter { "terms" in it }, id)
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
        "components":[{"${'$'}id":"c1","displayName":"Hero","description":"Top band"},{"${'$'}id":"c2","displayName":"Gone","deletedAt":1}],
        "layouts":[{"${'$'}id":"l1","displayName":"Main"}],
        "emails":[{"${'$'}id":"e1","displayName":"Receipt","versionId":"v1"},{"${'$'}id":"e2","displayName":"Never saved"}],
        "emailScreens":[{"${'$'}id":"s1","displayName":"Welcome","versionId":"v1","deletedAt":null}],
        "datasets":[{"${'$'}id":"d1","name":"Menu items"},{"${'$'}id":"d2","displayName":"Staff"}]}}""",
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
  fun aPublishRefusedForTheAgreementOpensItAndAcceptingIsWhatSendsThePublishAgain() = runTest {
    val publish = spec("marketplace.publishTemplate")
    val submit = ActionSpec.parse(publish.blocks.first { it.type == "form" }["submit"])!!
    val refusal = """{"error":"Accept the Marketplace Publisher Agreement before publishing.","agreement":{"required":"2026-08-24.1","accepted":null,"state":"none","orgId":"o1"}}"""
    val sent = mutableListOf<HttpRequestData>()
    val model = ScreenModel(
      publish, JsonObject(emptyMap()),
      client(412 to refusal, 412 to """{"error":"Set up your publisher profile first."}""", 200 to """{"ok":true,"version":2}""", sent = sent),
    )
    val scope = json("""{"site":{"id":"h1"},"form":{"name":"Studio"}}""")
    // The route's structured refusal (not its prose) names the screen that settles it.
    assertEquals(
      ActionOutcome.Gated("marketplace.publisherAgreement", "Accept the Marketplace Publisher Agreement before publishing."),
      model.run(submit, scope),
    )
    // Any other refusal is a failure, as it was.
    assertEquals(ActionOutcome.Failed("Set up your publisher profile first."), model.run(submit, scope))
    // Sent again after the agreement is accepted, it is the same request.
    model.run(submit, scope)
    assertEquals(body(sent, 0), body(sent, 2))

    val agreement = spec("marketplace.publisherAgreement")
    val block = agreement.blocks.first { it.whenCondition == "is.canAccept" }
    val accepts = (block.raw.obj("items") as JsonArray).mapNotNull { ActionSpec.parse(it) }
    assertEquals(listOf("accept", "acceptCurrent"), accepts.map { it.id })
    assertTrue(accepts.all { it.resume && it.back })
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
      "price" to JsonPrimitive(5), "attested" to attested,
    )
    fun scope(form: Map<String, JsonElement>) = JsonObject(mapOf("org" to json("""{"id":"o1"}"""), "params" to JsonObject(emptyMap()), "form" to JsonObject(form)))
    assertEquals(ActionOutcome.Done("Published v1.0.0 — it is queued for review", json(answer)), model.run(submit, scope(base)))
    assertEquals("/api/marketplace/publish-plugin", sent[0].url.encodedPath)
    // The listing name falls back to the manifest's; an empty README and category are left out, as the console leaves them.
    assertEquals(
      json(
        """{"orgId":"o1","bundle":"Y29uc3QA/w==","manifest":{"id":"acme-widget","name":"Widget"},"displayName":"Widget","description":"Counts down",
        "changelog":"First","priceUsd":5,"visibility":"public","attestation":$attested,"license":"MIT","repositoryUrl":"https://github.com/acme/widget"}""",
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
  fun aPluginRefusedByTheVerifierSaysWhatItFoundAndTheAgreementGatesItLikeEveryPublish() = runTest {
    val publish = spec("marketplace.publishPlugin")
    val submit = ActionSpec.parse(publish.blocks.first { it.type == "form" }["submit"])!!
    val refusal = """{"error":"Accept the Marketplace Publisher Agreement before publishing.","agreement":{"required":"2026-08-24.1","accepted":null,"state":"none","orgId":"o1"}}"""
    val problems = """{"error":"Bundle rejected","problems":[{"level":"error","check":"network","message":"Calls an undeclared host"},{"level":"error","message":"Too large"}]}"""
    val sent = mutableListOf<HttpRequestData>()
    val model = ScreenModel(publish, JsonObject(emptyMap()), client(412 to refusal, 422 to problems, sent = sent))
    val scope = json("""{"org":{"id":"o1"},"params":{},"form":{"bundle":"eA==","manifest":{"id":"w"},"name":"W"}}""")
    assertEquals(ActionOutcome.Gated("marketplace.publisherAgreement", "Accept the Marketplace Publisher Agreement before publishing."), model.run(submit, scope))
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
}
