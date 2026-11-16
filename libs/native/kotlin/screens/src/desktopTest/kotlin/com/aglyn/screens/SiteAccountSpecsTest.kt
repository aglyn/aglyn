package com.aglyn.screens

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A site account, as the console's Site users card and member drawer show it: the list searched and filtered by its
 * query, one account suspended or reactivated under the rules, its password help through the console's route, its
 * addresses, and the commerce plugin's Purchases in the account's siteMember zone.
 */
class SiteAccountSpecsTest : SpecTestBase() {
  private val id = "${'$'}id"

  private fun core(id: String) = ScreenSpec.parseFile(File(root, "libs/native/screens/site.screens.json").readText()).first { it.id == id }

  private fun member(extra: String = "") =
    """{"$id":"sm-1","displayName":"Jordan Lee","email":"jordan@example.com","suspended":false,"createdAt":"2025-10-09T08:53:20Z"$extra}"""

  private fun account(extra: String = "", writer: RecordingWriter = RecordingWriter()) =
    withWriter(core("core.site.account"), mapOf("memberId" to "sm-1"), """{"member":${member(extra)}}""", writer)

  private fun ScreenModel.fire(action: ActionSpec, form: String = "{}") = runBlocking { run(action, ScreenContext.with(context, "form", json(form))) }

  private fun ScreenModel.facts(block: String): List<Pair<String, String>> =
    block(block).raw.jsonObject["rows"]!!.jsonArray.map { it.jsonObject }
      .filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, context) }
      .map { (it["label"] as JsonPrimitive).content to ScreenValues.render((it["value"] as JsonPrimitive).content, context) }

  private fun ScreenModel.line(block: String, key: String, row: JsonElement): String? = rowLine(block(block).raw.jsonObject[key]!!, row)

  @Test
  fun theListIsSearchedAndFilteredByItsQueryAndOpensAnAccount() {
    val list = core("core.site.accounts")
    val where = list.loads.first { it.key == "accounts" }.query!!.jsonObject["where"]!!.jsonArray.toString().replace(" ", "")
    assertEquals(
      """[["searchTokens","array-contains","{params.q:token}","params.q"],["suspended","==",true,"params.status==suspended"],["suspended","==",false,"params.status==active"]]""",
      where,
    )
    assertEquals("ada", ScreenValues.render("{params.q:token}", ScreenContext.with(json("{}"), "params", json("""{"q":"  Ada Lovelace"}"""))))
    val suspended = screen(list, mapOf("status" to "suspended", "q" to "jor"), """{"accounts":{"items":[${member(""","suspended":true""")}]}}""")
    assertEquals("Status: Suspended", ScreenValues.render(suspended.action("accountsFilter", "status").label, suspended.context))
    assertEquals("jor", ScreenValues.render(suspended.action("accountsFilter", "search").label, suspended.context))
    assertEquals("Suspended site users", ScreenValues.render(suspended.block("accounts").string("title")!!, suspended.context))
    val open = suspended.block("accounts").raw.jsonObject["open"]!!.jsonObject
    assertEquals("core.site.account", (open["screen"] as JsonPrimitive).content)

    val users = screen(core("core.site.users"), emptyMap(), """{"members":{"items":[]},"accounts":{"items":[${member()}]}}""")
    assertEquals("Search site users", ScreenValues.render(users.action("accountsFilter", "search").label, users.context))
    assertEquals("Status: All", ScreenValues.render(users.action("accountsFilter", "status").label, users.context))
    assertEquals("core.site.account", (users.block("accounts").raw.jsonObject["open"]!!.jsonObject["screen"] as JsonPrimitive).content)
  }

  @Test
  fun anAccountIsSuspendedAndReactivatedUnderTheRules() {
    val writer = RecordingWriter()
    val model = account(writer = writer)
    assertEquals("Jordan Lee", ScreenValues.render(model.spec.title, model.context))
    assertEquals(listOf("Email" to "jordan@example.com", "Joined" to "Oct 9, 2025"), model.facts("account"))
    assertEquals(listOf("suspend"), model.actionsShown("access"))
    model.fire(model.action("access", "suspend"))
    assertEquals(listOf("merge hosts/h1/siteMembers/sm-1 {suspended=true}"), writer.calls)
    val held = account(""","suspended":true""", writer)
    assertEquals(listOf("reactivate"), held.actionsShown("access"))
    assertEquals("Suspended", held.facts("account").first().second)
    held.fire(held.action("access", "reactivate"))
    assertEquals("merge hosts/h1/siteMembers/sm-1 {suspended=false}", writer.calls.last())
  }

  @Test
  fun passwordHelpGoesThroughTheConsolesRouteAndAddressesAreListed() {
    val model = account(""","addresses":[{"name":"Jordan Lee","line1":"1 Main St","city":"Springfield","state":"IL","postalCode":"62701","country":"US"}]""")
    assertTrue(listOf("account", "access", "password", "addresses").all { it in model.shown() } && "noEmail" !in model.shown())
    val reset = model.action("password", "sendReset")
    assertEquals("/api/membership/admin-password", reset.url)
    assertEquals(json("""{"hostId":"h1","memberId":"sm-1","action":"sendPasswordReset"}"""), model.body(reset))
    val set = model.action("password", "setPassword")
    assertEquals(json("""{"hostId":"h1","memberId":"sm-1","action":"setPassword","password":"pw-123456789012"}"""), model.body(set, """{"password":"pw-123456789012"}"""))
    val address = model.row("data.member.addresses")
    assertEquals("Jordan Lee · 1 Main St · Springfield IL 62701 · US", model.line("addresses", "primary", address))
    val noEmail = account(""","email":null,"displayName":"Walk-in""")
    assertTrue("noEmail" in noEmail.shown() && "password" !in noEmail.shown() && "addresses" !in noEmail.shown())
  }

  // ---- the commerce plugin's Purchases --------------------------------------------------------------------------

  private fun purchases(data: String, email: String = "jordan@example.com") =
    screen(spec("commerce", "commerce.siteMemberPurchases"), mapOf("memberId" to "sm-1", "email" to email), data)

  @Test
  fun purchasesSumTheChargedOrdersAndListOrdersAndSubscriptions() {
    val orders = """{"items":[
      {"$id":"o1","number":1042,"status":"paid","totals":{"totalCents":2500},"refundedCents":700,"dispute":{"reversedCents":200},"createdAtMs":1760000000000,"paymentIntentId":"pi_1"},
      {"$id":"o2","number":1043,"status":"partially_fulfilled","totals":{"totalCents":1000},"createdAtMs":1762592000000},
      {"$id":"o3","number":1044,"status":"pending","totals":{"totalCents":9900},"createdAtMs":1761000000000}]}"""
    val subs = """{"items":[{"$id":"s1","productId":"p1","status":"active","interval":"month","totals":{"totalCents":2700},"currentPeriodEndMs":1762592000000,"paidCents":5400,"invoicesCount":2}]}"""
    val lifetime = ScreenFunctions.call("computeLifetimePurchaseCents", listOf(json(orders)["items"]))
    val model = purchases("""{"orders":$orders,"subs":$subs,"products":{"items":[{"$id":"p1","name":"Coffee club"}]},"lifetime":$lifetime}""")
    assertEquals(listOf("Lifetime purchases" to "$28.00"), model.facts("lifetime"))
    assertEquals(listOf("lifetime", "orders", "subscriptions"), model.shown())
    val first = model.row("data.orders.items")
    assertEquals("#1042 · $25.00", ScreenValues.render(model.block("orders").string("primary")!!, first))
    assertEquals("Oct 9, 2025 · refunded $5.00 · charged back $2.00", model.line("orders", "secondary", first))
    assertEquals("partially fulfilled", ScreenValues.render(model.block("orders").raw.jsonObject["badges"]!!.jsonArray[0].jsonObject["text"]!!.let { (it as JsonPrimitive).content }, model.row("data.orders.items", 1)))
    assertNull(model.line("orders", "secondary", model.row("data.orders.items", 1))?.takeIf { "refunded" in it })
    val sub = model.row("data.subs.items")
    assertEquals("Coffee club · $27.00/month", model.line("subscriptions", "primary", sub))
    assertEquals("Renews Nov 8, 2025 · $54.00 paid over 2 invoices", model.line("subscriptions", "secondary", sub))

    val unreadable = purchases("""{"lifetime":0}""")
    assertEquals(listOf("Lifetime purchases" to "—"), unreadable.facts("lifetime"))
    assertEquals(listOf("lifetime", "ordersUnreadable"), unreadable.shown())
    val none = purchases("""{"lifetime":0}""", email = "")
    assertEquals(listOf("Lifetime purchases" to "$0.00"), none.facts("lifetime"))
  }
}
