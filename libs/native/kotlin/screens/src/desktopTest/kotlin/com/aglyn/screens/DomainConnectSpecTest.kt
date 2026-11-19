package com.aglyn.screens

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * A domain's page on the workspace Domains page connects the name to a site, moves it to another, or disconnects it, as the
 * console's bought-domain panel does (gap sweep Domains row 3): `/api/registrar/connect` with the picked site and
 * `/api/registrar/disconnect`, only while the name is active.
 */
class DomainConnectSpecTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }
  private val spec = ScreenSpec.parseFile(File(root, "libs/plugins/domains/src/ios/Sources/AglynDomainsPlugin/Resources/domains.screens.json").readText())
    .first { it.id == "domains.domain" }
  private val block = spec.blocks.first { it.id == "connect" }
  private val actions = block.raw.arr("items").mapNotNull { ActionSpec.parse(it) }

  private fun json(text: String): JsonElement = Json.parseToJsonElement(text)

  private fun context(connected: Boolean, status: String = "active"): JsonElement = json(
    """{"org":{"id":"o1"},"params":{"domain":"bakery.example"},"form":{"siteId":"h2"},
        "data":{"ws":{"rows":[{"domain":"bakery.example","status":"$status","connected":$connected,"hostId":"h1"}]},
                "sites":{"items":[{"${'$'}id":"h1","displayName":"Bakery"},{"${'$'}id":"h2","displayName":"Catering"}]}}}""",
  )

  private fun shown(id: String, context: JsonElement): Boolean {
    val action = actions.first { it.id == id }
    return ScreenValues.condition(block.whenCondition, context) && ScreenValues.condition(action.whenCondition, context)
  }

  @Test
  fun aNameOnNoSiteOffersConnectToEverySite() {
    val ctx = context(connected = false)
    assertTrue(shown("connect", ctx))
    assertFalse(shown("move", ctx))
    assertFalse(shown("disconnect", ctx))
    val connect = actions.first { it.id == "connect" }
    assertEquals(listOf("h1" to "Bakery", "h2" to "Catering"), connect.prompt.single().choices(ctx))
    assertEquals("/api/registrar/connect", connect.url)
    assertEquals(
      json("""{"orgId":"o1","domain":"bakery.example","siteId":"h2"}"""),
      ScreenValues.resolveBody(connect.body!!, ctx),
    )
    assertEquals("bakery.example is connecting to Catering", ScreenValues.render(connect.success!!, ctx))
  }

  @Test
  fun aConnectedNameMovesToAnotherSiteOrDisconnects() {
    val ctx = context(connected = true)
    assertFalse(shown("connect", ctx))
    assertTrue(shown("move", ctx))
    assertTrue(shown("disconnect", ctx))
    // The site it serves now is not offered.
    assertEquals(listOf("h2" to "Catering"), actions.first { it.id == "move" }.prompt.single().choices(ctx))
    val disconnect = actions.first { it.id == "disconnect" }
    assertTrue(disconnect.destructive)
    assertEquals("/api/registrar/disconnect", disconnect.url)
    assertEquals(
      "Bakery goes back to its free address. bakery.example stays in your workspace, registered to you, and can be connected again at any time.",
      ScreenValues.render(disconnect.confirmMessage!!, ctx),
    )
    assertEquals(json("""{"orgId":"o1","domain":"bakery.example"}"""), ScreenValues.resolveBody(disconnect.body!!, ctx))
  }

  @Test
  fun nothingIsOfferedForANameThatIsNotActive() {
    for (status in listOf("registering", "expired", "transferred-out")) {
      val ctx = context(connected = false, status = status)
      assertFalse(shown("connect", ctx), status)
      assertFalse(shown("move", ctx), status)
    }
  }
  /** Who the name is registered to (Domains row 2): shown for an active or expired name, edited only while it is active. */
  @Test
  fun theRegistrantContactIsShownAndEditedForTheNextRenewal() {
    val contact = json(
      """{"org":{"id":"o1"},"params":{"domain":"bakery.example"},
          "form":{"firstName":"Avery","lastName":"Lane","companyName":"","email":"owner@bakery.example","phone":"+15125550123",
                  "address1":"1 Main St","address2":"","city":"Austin","state":"TX","zip":"78701","country":"US"},
          "data":{"ws":{"rows":[{"domain":"bakery.example","status":"active"}]},
                  "contact":{"contact":{"firstName":"Avery","lastName":"Lane","email":"owner@bakery.example"},
                             "pendingSinceMs":1763337600000,"takesEffectAtMs":1792281600000,"autoRenew":true,
                             "verification":{"verified":false,"verifyByMs":1764547200000,"email":null}}}}""",
    )
    val view = spec.blocks.first { it.id == "contact" }
    assertTrue(ScreenValues.condition(view.whenCondition, contact))
    assertTrue(ScreenValues.condition(spec.blocks.first { it.id == "contactPendingDated" }.whenCondition, contact))
    assertFalse(ScreenValues.condition(spec.blocks.first { it.id == "contactPending" }.whenCondition, contact))
    assertTrue(ScreenValues.condition(spec.blocks.first { it.id == "contactVerify" }.whenCondition, contact))
    val editBlock = spec.blocks.first { it.id == "contactEdit" }
    assertTrue(ScreenValues.condition(editBlock.whenCondition, contact))
    val edit = editBlock.raw.arr("items").mapNotNull { ActionSpec.parse(it) }.single()
    assertEquals(
      listOf("firstName", "lastName", "companyName", "email", "phone", "address1", "address2", "city", "state", "zip", "country"),
      edit.prompt.map { it.key },
    )
    assertEquals("/api/registrar/contact", edit.url)
    val body = ScreenValues.resolveBody(edit.body!!, contact)
    assertEquals(json("\"Avery\""), body.jsonObject["contact"]!!.jsonObject["firstName"])
    assertEquals(json("\"US\""), body.jsonObject["contact"]!!.jsonObject["country"])
    // An expired name shows its contact but cannot be edited.
    val expired = json(contact.toString().replace("\"status\":\"active\"", "\"status\":\"expired\""))
    assertTrue(ScreenValues.condition(view.whenCondition, expired))
    assertFalse(ScreenValues.condition(editBlock.whenCondition, expired))
  }
  /** Part of Domains row 7: the Auto-renew switch, for an active name, and only for someone the route lets manage billing. */
  @Test
  fun autoRenewSwitchesThroughItsRoute() {
    val ctx = json(
      """{"org":{"id":"o1"},"params":{"domain":"bakery.example"},
          "data":{"ws":{"billingPermission":false,"rows":[{"domain":"bakery.example","status":"active","autoRenew":true}]}}}""",
    )
    val block = spec.blocks.first { it.id == "autoRenew" }
    assertTrue(ScreenValues.condition(block.whenCondition, ctx))
    val toggle = block.raw.obj("toggle")!!
    assertEquals("true", ScreenValues.render(toggle.str("value")!!, ctx))
    assertTrue(ScreenValues.condition(toggle.str("disabled"), ctx))
    val off = ActionSpec.parse(toggle.obj("off")!!)!!
    assertEquals("/api/registrar/auto-renew", off.url)
    assertEquals(json("""{"orgId":"o1","domain":"bakery.example","autoRenew":false}"""), ScreenValues.resolveBody(off.body!!, ctx))
    assertEquals("Auto-renew is off", off.success)
    assertFalse(ScreenValues.condition(spec.blocks.first { it.id == "expired" }.whenCondition, ctx))
  }
}
