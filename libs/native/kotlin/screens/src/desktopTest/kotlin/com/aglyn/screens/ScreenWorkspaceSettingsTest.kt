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
import kotlinx.serialization.json.JsonElement
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The workspace settings screens that decide what to show from what a route answered: the API key scopes, a hold's
 * owner actions, and the single sign-on steps. The words are held to the console's by
 * apps/console/specs/native-workspace-settings-match-the-console.spec.ts.
 */
class ScreenWorkspaceSettingsTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }
    .first { File(it, "libs/native/screens").isDirectory }
  private val specs = ScreenSpec.parseFile(File(root, "libs/native/screens/workspace.screens.json").readText())

  private fun spec(id: String): ScreenSpec = specs.first { it.id == id }

  private fun json(text: String): JsonElement = Json.parseToJsonElement(text)

  private fun actionsOf(block: BlockSpec): List<ActionSpec> = block.raw.arr("items").mapNotNull { ActionSpec.parse(it) }

  private fun shown(list: List<ActionSpec>, scope: JsonElement): List<String> =
    list.filter { ScreenValues.condition(it.whenCondition, scope) }.map { it.id }

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
  fun creatingAnApiKeySendsTheScopesThatWereTicked() = runTest {
    val sent = mutableListOf<HttpRequestData>()
    val apiKeys = spec("core.settings.apiKeys")
    val create = apiKeys.raw.arr("actions").mapNotNull { ActionSpec.parse(it) }.first { it.id == "create" }
    // Every scope the console offers is a switch, and the first is on for a new key as it is in the console.
    assertEquals(17, create.prompt.count { it.kind == "toggle" })
    assertEquals(listOf("datasetsRead"), create.prompt.filter { it.initial == "true" }.map { it.key })
    val model = ScreenModel(apiKeys, json("""{"org":{"id":"o1"}}"""), client(200 to """{"token":"k"}""", sent = sent))
    val scope = json("""{"org":{"id":"o1"},"form":{"name":"Warehouse","datasetsRead":true,"ordersWrite":true,"mediaRead":true,"crmWrite":true}}""")
    model.run(create, scope)
    val body = json((sent[0].body as TextContent).text)
    assertEquals("create", body.str("action"))
    assertEquals(json("""["crm:write","datasets:read","media:read","orders:write"]"""), body.obj("scopes"))
  }

  @Test
  fun aHoldsOwnerActionsAreTheOnesItsNoticeNames() {
    val detail = spec("core.settings.holds.notice")
    val next = actionsOf(detail.blocks.first { it.title == "Next" })
    val scope = json(
      """{"data":{"notices":{"notices":[
           {"noticeId":"n1","status":"held","reviewable":true,"reviewRequests":[{"mine":false},{"mine":true}],
            "actions":[{"id":"update-payment-method","label":"Update payment method","href":"/acme/billing/settings"},
                       {"id":"view-details","label":"View details","href":"/acme/hosts/shop/orders/o9"},
                       {"id":"request-review","label":"Request a review","href":"/acme/settings/holds?notice=n1"}]},
           {"noticeId":"n2","actions":[]}]}},
         "params":{"noticeId":"n1"}}""",
    )
    assertEquals(listOf("review", "view-details", "update-payment-method", "why"), shown(next, scope))
    val billing = next.first { it.id == "update-payment-method" }
    assertEquals("/acme/billing/settings", ScreenValues.render(billing.route!!, scope))
    // A notice that is not reviewable offers no review, and one that names no action offers none.
    val quiet = json("""{"data":{"notices":{"notices":[{"noticeId":"n1","reviewable":false,"actions":[]}]}},"params":{"noticeId":"n1"}}""")
    assertEquals(listOf("why"), shown(next, quiet))
    // The notice says a review was asked for only once someone on this workspace asked.
    val asked = detail.blocks.first { it.type == "notice" && it.whenCondition?.contains("reviewRequests") == true }
    assertTrue(ScreenValues.condition(asked.whenCondition, scope))
    assertFalse(ScreenValues.condition(asked.whenCondition, quiet))
  }

  @Test
  fun theSingleSignOnStepsFollowTheDomains() {
    val sso = spec("core.settings.sso")
    fun claim(verified: Boolean, attested: Boolean, publishable: Boolean) =
      """{"domain":"acme.com","verified":$verified,"attested":$attested,"publishable":$publishable}"""
    fun scope(status: String, vararg claims: String) =
      json("""{"data":{"ent":{"features":{"ssoEnabled":true}},"sso":{"sso":{"status":"$status","tenantId":"t1"},"claims":[${claims.joinToString(",")}]}}}""")
    fun notices(scope: JsonElement): List<String> =
      sso.blocks.filter { it.type == "notice" && ScreenValues.condition(it.whenCondition, scope) }.mapNotNull { it.string("text") }
    val turn = actionsOf(sso.blocks.last { block -> block.type == "actions" && block.raw.arr("items").any { it.str("id") == "activate" } })

    // Nothing verified yet: the step says so, and nothing can be turned on.
    val waiting = scope("configuring", claim(false, false, false))
    assertTrue(notices(waiting).any { it.startsWith("Verify at least one domain") })
    assertEquals(emptyList(), shown(turn, waiting))

    // A verified domain can be turned on, and the step says nothing more.
    val ready = scope("configuring", claim(true, false, true))
    assertFalse(notices(ready).any { it.startsWith("Verify at least one domain") || it.startsWith("Single sign-on cannot") })
    assertEquals(listOf("activate"), shown(turn, ready))

    // On, with only the proof made for the customer: turning it off cannot be undone here, and the warning says so.
    val attested = scope("active", claim(false, true, false))
    assertTrue(notices(attested).any { it.startsWith("Single sign-on is on, but none") })
    assertEquals(listOf("disable"), shown(turn, attested))
    val disable = turn.first { it.id == "disable" }
    assertTrue(disable.confirmText(attested)!!.contains("You will not be able to turn it back on"))
    assertTrue(disable.confirmText(scope("active", claim(true, false, true)))!!.contains("can turn it back on"))

    // Off, with only that proof: it cannot be turned on until DNS proves a domain.
    val off = scope("disabled", claim(false, true, false))
    assertTrue(notices(off).any { it.startsWith("Single sign-on cannot") })
    assertEquals(emptyList(), shown(turn, off))
  }

  @Test
  fun enforcingNeedsAWayInThatSurvivesTheProvider() {
    val enforcement = spec("core.settings.sso.enforcement")
    val buttons = actionsOf(enforcement.blocks.first { it.type == "actions" })
    fun scope(enforced: Boolean = false, saved: List<String> = emptyList(), outside: Boolean = false, rehearsed: Boolean = true): JsonElement {
      val uids = saved.joinToString(",") { "\"$it\"" }
      val owners = if (outside) """[{"uid":"o1","email":"o@acme.com"}]""" else "[]"
      val stash = if (rehearsed) """{"ssoPreview":{"scanned":3,"changed":2,"lockout":{"ownersOutsidePool":$owners}}}""" else "{}"
      return json(
        """{"data":{"ent":{"features":{"ssoEnabled":true}},
              "sso":{"sso":{"status":"active","enforced":$enforced,"breakGlassUids":[$uids]}},
              "rows":[{"uid":"u1","label":"a@acme.com","eligible":true,"designated":false}]},
             "stash":$stash}""",
      )
    }
    // No owner outside the pool and nobody designated: enforcing is not offered (the console disables the button).
    assertEquals(listOf("rehearse", "breakGlass"), shown(buttons, scope()))
    // Either one is enough.
    assertEquals(listOf("rehearse", "breakGlass", "enforce"), shown(buttons, scope(saved = listOf("u1"))))
    assertEquals(listOf("rehearse", "breakGlass", "enforce"), shown(buttons, scope(outside = true)))
    // Once enforced it can be stopped and not enforced again.
    assertEquals(listOf("rehearse", "breakGlass", "stop"), shown(buttons, scope(enforced = true, saved = listOf("u1"))))
    // Nothing rehearsed: the screen asks for a rehearsal first.
    val ask = enforcement.blocks.first { it.type == "notice" && it.string("text")?.startsWith("Nothing rehearsed yet") == true }
    assertTrue(ScreenValues.condition(ask.whenCondition, scope(rehearsed = false)))
    assertFalse(ScreenValues.condition(ask.whenCondition, scope()))
    // The break-glass choice offers only the accounts that hold a way in other than the provider.
    val choice = buttons.first { it.id == "breakGlass" }.prompt.first()
    val rows = json("""{"data":{"rows":[{"uid":"u1","label":"a","eligible":true},{"uid":"u2","label":"b","eligible":false}]}}""")
    assertEquals(listOf("u1"), choice.choices(rows).map { it.first })
  }
}
