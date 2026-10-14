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
}
