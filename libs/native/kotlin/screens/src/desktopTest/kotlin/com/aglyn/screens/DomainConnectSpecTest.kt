package com.aglyn.screens

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
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
}
