package com.aglyn.screens

import com.aglyn.core.ApiMethod
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Help desks card (AGL-3824) natively: the help desks a site can connect, one help desk's state, its actions by
 * status, the credential form from the console's own table, its settings and the sync log, each through the
 * console card's routes.
 */
class HelpDesksSpecsTest : SpecTestBase() {
  private fun conn(status: String, extra: String = "") =
    """{"id":"c1","provider":"reamaze","status":"$status","accountName":"acme","targetId":"ch1","targets":[{"id":"ch1","name":"Support"},{"id":"ch2","name":"Sales"}],
       "syncCustomers":true,"sendTickets":false,"backfillDone":true,"lastSuccessAtMs":1760000000000,"lastError":null,
       "totals":{"customersPushed":12,"ordersPushed":30,"ticketsCreated":2}$extra}"""

  private fun provider(provider: String, connections: String) = screen(
    spec("help-desks", "help-desks.provider"), mapOf("provider" to provider),
    """{"conn":{"available":["gorgias","reamaze"],"connections":$connections},"log":{"entries":[{"id":"l1","kind":"item-failed","message":"Order #1042 was not sent","atMs":1760000000000}]}}""",
  )

  @Test
  fun theCardListsTheHelpDesksThisSiteCanConnect() {
    val model = screen(spec("help-desks", "help-desks.service"), mapOf("pluginId" to "help-desks"), """{"conn":{"available":["gorgias","reamaze"],"connections":[${conn("active")}]}}""")
    assertEquals(listOf("providers"), model.shown())
    val list = model.block("providers")
    val rows = (ScreenValues.lookup("const.providers", model.context) as kotlinx.serialization.json.JsonArray)
      .map { ScreenContext.with(model.context, "item", it) }
      .filter { ScreenValues.condition(list.string("filter"), it) }
    assertEquals(listOf("Gorgias", "Re:amaze"), rows.map { ScreenValues.render(list.string("primary")!!, it) })
  }

  @Test
  fun aHelpDeskIsConnectedWithItsOwnCredentialsAndManagedByStatus() {
    val none = provider("gorgias", "[]")
    assertEquals(listOf("notConnected", "manage"), none.shown())
    assertEquals(listOf("connect"), none.actionsShown("manage"))
    val connect = none.action("manage", "connect")
    val fields = connect.inputs(none.context)
    assertEquals(listOf("account", "login", "token"), fields.map { it.key })
    assertEquals(listOf("text", "email", "password"), fields.map { it.kind })
    assertEquals(
      json("""{"hostId":"h1","provider":"gorgias","account":"acme","login":"a@example.com","token":"t"}"""),
      none.body(connect, """{"account":"acme","login":"a@example.com","token":"t"}"""),
    )

    val active = provider("reamaze", "[${conn("active")}]")
    assertEquals(listOf("syncNow", "pause", "disconnect"), active.actionsShown("manage"))
    assertEquals(json("""{"hostId":"h1","provider":"reamaze","paused":true}"""), active.body(active.action("manage", "pause")))
    assertEquals(ApiMethod.PATCH, active.action("manage", "pause").method)
    val facts = active.block("status").raw.jsonObject["rows"]!!
    assertTrue(ScreenValues.render(((facts as kotlinx.serialization.json.JsonArray).last().jsonObject["value"] as JsonPrimitive).content, active.context)
      .startsWith("12 customers sent · 30 orders sent · 2 conversations opened"))
    assertEquals(
      json("""{"hostId":"h1","provider":"reamaze","targetId":"ch2","syncCustomers":true,"sendTickets":true}"""),
      active.body(active.form("settings"), """{"targetId":"ch2","syncCustomers":true,"sendTickets":true}"""),
    )
    assertEquals(listOf("syncNow", "disconnect"), provider("reamaze", "[${conn("error", ""","lastError":"Re:amaze refused the token.""")}]").actionsShown("manage"))
    assertEquals(listOf("resume", "disconnect"), provider("reamaze", "[${conn("paused")}]").actionsShown("manage"))
    assertEquals(listOf("reconnect", "disconnect"), provider("reamaze", "[${conn("reconnect")}]").actionsShown("manage"))
  }
}
