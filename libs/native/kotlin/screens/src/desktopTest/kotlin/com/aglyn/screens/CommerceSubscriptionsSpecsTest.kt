package com.aglyn.screens

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The store's subscriptions (AGL-4191), as the console's Subscriptions card and detail dialog read them: the recurring
 * revenue figures from the server's tallies, each row's plan, price and date line, the status filter, and one
 * subscription with its invoices.
 */
class CommerceSubscriptionsSpecsTest : SpecTestBase() {
  private val id = "${'$'}id"

  private fun sub(status: String, extra: String = "") =
    """{"$id":"s1","customerName":"Ada","customerEmail":"ada@example.com","status":"$status","interval":"month","livemode":true,
       "lineItems":[{"name":"Coffee club","quantity":1}],"totals":{"totalCents":2500,"taxCents":200},"createdAtMs":1760000000000,
       "currentPeriodEndMs":1762592000000,"paidCents":5000,"invoicesCount":2$extra}"""

  private val figures =
    """"monthly":{"count":3,"sum":7500},"monthlyTax":{"sum":600},"yearly":{"count":1,"sum":12000},"yearlyTax":{"sum":0},"trials":{"count":2},"pastDue":{"count":1}"""

  private fun list(params: Map<String, String> = emptyMap(), rows: String = sub("active"), extra: String = figures) =
    screen(spec("commerce", "commerce.subscriptions"), params, """{"store":{"currency":"usd"},$extra,"subscriptions":{"items":[$rows]}}""")

  private fun ScreenModel.facts(block: String): List<Pair<String, String>> =
    block(block).raw.jsonObject["rows"]!!.jsonArray.map { it.jsonObject }
      .filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, context) }
      .map { (it["label"] as JsonPrimitive).content to ScreenValues.render((it["value"] as JsonPrimitive).content, context) }

  private fun ScreenModel.line(block: String, key: String, row: JsonElement): String? = rowLine(block(block).raw.jsonObject[key]!!, row)

  @Test
  fun theFiguresAreTheConsolesMonthlyRevenueAndCounts() {
    val model = list()
    // (7500 - 600) a month + 12000 a year counted as a twelfth = 6900 + 1000.
    assertEquals(
      listOf("Monthly recurring revenue" to "$79.00", "Paying subscribers" to "4", "In a free trial" to "2", "Past due" to "1"),
      model.facts("summary"),
    )
    assertEquals(listOf("summary", "filter", "subscriptions"), model.shown())
    val failed = list(extra = """"monthly":{"count":3,"sum":7500}""")
    // A tally the reader could not ask is blank, which the fields block draws as a dash, never a zero.
    assertEquals("", failed.facts("summary")[2].second)
    assertEquals("", failed.facts("summary")[1].second)
    assertEquals(listOf("summary", "summaryFailed", "filter", "subscriptions"), failed.shown())
  }

  @Test
  fun aRowNamesThePersonThePlanThePriceAndTheNextDate() {
    val model = list()
    val row = model.row("data.subscriptions.items")
    assertEquals("Ada · Coffee club", model.line("subscriptions", "primary", row))
    assertEquals("$25.00/month · Renews Nov 8, 2025 · $50.00 paid so far", model.line("subscriptions", "secondary", row))
    val badges = model.block("subscriptions").raw.jsonObject["badges"]!!.jsonArray.map { it.jsonObject }
    assertEquals("Active", ScreenValues.render((badges[1]["text"] as JsonPrimitive).content, row))
    assertEquals(false, ScreenValues.condition((badges[0]["when"] as JsonPrimitive).content, row))

    fun secondary(status: String, extra: String = "") = list(rows = sub(status, extra)).let { it.line("subscriptions", "secondary", it.row("data.subscriptions.items")) }
    assertEquals("$25.00/month · Ends Nov 8, 2025 · $50.00 paid so far", secondary("active", ""","cancelAtPeriodEnd":true"""))
    assertEquals("$25.00/month · Trial ends Nov 8, 2025", secondary("trialing", ""","paidCents":0"""))
    assertEquals("$25.00/month · Payment failed · $50.00 paid so far", secondary("past_due"))
    assertEquals("$25.00/year · Waiting for the first payment", secondary("incomplete", ""","interval":"year","paidCents":0"""))
    assertEquals("$25.00/month · Ended Nov 8, 2025 · $50.00 paid so far", secondary("canceled"))

    val several = list(rows = sub("trialing", ""","lineItems":[{"name":"Coffee club","quantity":3}],"livemode":false,"customerName":null"""))
    val trial = several.row("data.subscriptions.items")
    assertEquals("ada@example.com · 3× Coffee club", several.line("subscriptions", "primary", trial))
    assertEquals(true, ScreenValues.condition((badges[0]["when"] as JsonPrimitive).content, trial))
    assertEquals("Trial", ScreenValues.render((badges[1]["text"] as JsonPrimitive).content, trial))
    val old = list(rows = sub("active", ""","lineItems":null,"productId":"p9"""")).let { it.line("subscriptions", "primary", it.row("data.subscriptions.items")) }
    assertEquals("Ada · p9", old)
  }

  @Test
  fun theStatusFilterIsTheQueryAndSaysWhatItShows() {
    val spec = spec("commerce", "commerce.subscriptions")
    val where = spec.loads.first { it.key == "subscriptions" }.query!!.jsonObject["where"]!!.jsonArray
    assertEquals("""[["status","==","{params.status}","params.status && params.status != all"]]""".replace(" ", ""), where.toString().replace(" ", ""))
    val pastDue = list(mapOf("status" to "past_due"), rows = "")
    assertEquals("Status: Past due", ScreenValues.render(pastDue.action("filter", "show").label, pastDue.context))
    assertEquals("No past due subscriptions.", ScreenValues.render(pastDue.block("subscriptions").string("empty")!!, pastDue.context))
    val all = list(rows = "")
    assertEquals("Status: All", ScreenValues.render(all.action("filter", "show").label, all.context))
    assertEquals(
      "No subscriptions yet. When someone subscribes to a monthly or yearly product, they appear here.",
      ScreenValues.render(all.block("subscriptions").string("empty")!!, all.context),
    )
    val denied = screen(spec, emptyMap(), """{"store":{},$figures}""")
    assertEquals(listOf("summary", "filter", "denied"), denied.shown())
  }

  @Test
  fun oneSubscriptionListsItsFactsAndInvoices() {
    val detail = spec("commerce", "commerce.subscription")
    val model = screen(
      detail, mapOf("subscriptionId" to "s1"),
      """{"sub":${sub("active")},"store":{"currency":"USD"},"invoices":{"items":[
         {"$id":"in1","number":"A-0002","paidCents":2500,"currency":"usd","paidAtMs":1760000000000,"periodStartMs":1760000000000,"periodEndMs":1762592000000,"hostedInvoiceUrl":"https://pay.example.com/i/1"},
         {"$id":"in2","paidCents":2500,"currency":"usd"}]}}""",
    )
    assertEquals("Coffee club", ScreenValues.render(detail.title, model.context))
    assertEquals(
      listOf(
        "Status" to "Active", "Customer" to "Ada", "Email" to "ada@example.com", "Price" to "$25.00/month",
        "Started" to "Oct 9, 2025", "Next" to "Renews Nov 8, 2025", "Paid so far" to "$50.00 over 2 invoices",
      ),
      model.facts("summary"),
    )
    assertEquals(listOf("summary", "invoices"), model.shown())
    val first = model.row("data.invoices.items")
    assertEquals("Oct 9, 2025 · A-0002", model.line("invoices", "primary", first))
    assertEquals("For Oct 9, 2025 to Nov 8, 2025", model.line("invoices", "secondary", first))
    assertEquals("$25.00", ScreenValues.render(model.block("invoices").string("trailing")!!, first))
    assertEquals(listOf(true), model.rowActions("invoices").map { ScreenValues.condition(it.whenCondition, first) })
    val second = model.row("data.invoices.items", 1)
    assertEquals("Date unknown", model.line("invoices", "primary", second))
    assertNull(model.line("invoices", "secondary", second))
    assertEquals(listOf(false), model.rowActions("invoices").map { ScreenValues.condition(it.whenCondition, second) })

    val test = screen(detail, mapOf("subscriptionId" to "s1"), """{"sub":${sub("trialing", ""","livemode":false,"paidCents":0,"invoicesCount":0,"lineItems":[{"name":"Coffee club","quantity":2}]""")},"invoices":{"items":[]}}""")
    assertEquals(listOf("summary", "test", "invoices"), test.shown())
    val facts = test.facts("summary").toMap()
    assertEquals("2× Coffee club", facts["Plan"])
    assertEquals("Trial ends Nov 8, 2025", facts["Next"])
    assertEquals("Nothing yet", facts["Paid so far"])
  }
}
