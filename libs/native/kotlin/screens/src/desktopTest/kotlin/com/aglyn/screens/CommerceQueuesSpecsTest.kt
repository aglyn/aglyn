package com.aglyn.screens

import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Commerce queues as the console's cards have them: recovery and alerts, the pickup and delivery queue, and
 * reservations: what each shows, the queries it asks, and the document or request each action makes.
 */
class CommerceQueuesSpecsTest : SpecTestBase() {
  private val id = "${'$'}id"
  private val later = "4102444800000"

  private class Asked : FirestoreReader {
    val queries = mutableListOf<FirestoreQuery>()
    override suspend fun get(path: String): FirestoreDoc? = null
    override suspend fun page(query: FirestoreQuery): FirestorePage { queries += query; return FirestorePage(emptyList(), null) }
    override suspend fun count(query: FirestoreQuery): Long? { queries += query; return 3 }
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
  }

  private fun asked(spec: ScreenSpec, key: String, params: Map<String, String> = emptyMap()): FirestoreQuery {
    val reader = Asked()
    val context = ScreenSession(orgName = "Acme", orgRole = "owner", siteName = "Shop", origin = "https://console.test").context(Site(), params)
    runBlocking { FirestoreLoads.query(reader, spec.loads.first { it.key == key }.query!!, context) }
    return reader.queries.single()
  }

  // ---- recovery & alerts -------------------------------------------------------------------------------------------

  private fun recovery(carried: Boolean) = screen(
    spec("commerce", "commerce.recovery"), emptyMap(),
    """{"gate":{"carried":$carried,"label":"Pro"},
       "due":{"items":[],"count":2},"waiting":{"items":[],"count":5},"reminded":{"items":[],"count":4},
       "alertsWaiting":{"items":[],"count":7},"alertsRetired":{"items":[],"count":12},"alertsSkipped":{"items":[],"count":2},
       "recent":{"items":[{"$id":"c1","email":"a@b.co","createdAtMs":1000,"remindedAtMs":2000},{"$id":"c2","email":"x@y.co","createdAtMs":$later}]}}""",
  )

  @Test
  fun recoveryShowsTheCountsTheServerMadeAndTheBackInStockHalfOnEveryPlan() {
    val open = recovery(true)
    assertEquals(listOf("abandoned", "recent", "alerts"), open.shown())
    fun values(block: String) = open.block(block).raw.jsonObject["rows"]!!.jsonArray.map { ScreenValues.render((it.jsonObject["value"] as JsonPrimitive).content, open.context) }
    assertEquals(listOf("2", "5", "4"), values("abandoned"))
    assertEquals(listOf("7", "10"), values("alerts"), "notified is every retired alert less the skipped ones")
    val locked = recovery(false)
    assertEquals(listOf("locked", "alerts"), locked.shown())
    assertTrue(ScreenValues.render(locked.block("locked").string("text")!!, locked.context).endsWith("Included from Pro."))
    val badges = open.block("recent").raw.jsonObject["badges"]!!.jsonArray.first().jsonObject
    assertTrue(ScreenValues.condition((badges["when"] as JsonPrimitive).content, open.row("data.recent.items", 0)))
    assertTrue(!ScreenValues.condition((badges["when"] as JsonPrimitive).content, open.row("data.recent.items", 1)))
    assertEquals("a@b.co", ScreenValues.render(open.block("recent").string("primary")!!, open.row("data.recent.items", 0)))
  }

  @Test
  fun recoveryAsksTheSameQueriesTheConsoleDoesWithTimeWindowsFromNow() {
    val recovery = spec("commerce", "commerce.recovery")
    val due = asked(recovery, "due")
    assertEquals(listOf("status", "recoveryState", "createdAtMs", "createdAtMs"), due.filters.map { it.field })
    assertEquals(listOf(FilterOp.EQ, FilterOp.EQ, FilterOp.GTE, FilterOp.LTE), due.filters.map { it.op })
    val (from, until) = due.filters.drop(2).map { (it.value as Double) }
    assertEquals(7 * 24 * 3_600_000.0 - 3_600_000.0, until - from, 1000.0, "from seven days ago to an hour ago")
    assertEquals(listOf(FilterOp.EQ), asked(recovery, "alertsWaiting").filters.map { it.op })
    assertEquals(null, asked(recovery, "alertsWaiting").filters.single().value, "waiting alerts have a null notified time")
    assertEquals(listOf(FilterOp.NE), asked(recovery, "alertsRetired").filters.map { it.op })
    val recent = asked(recovery, "recent")
    assertEquals(5, recent.limit)
    assertEquals(listOf("pending", "reminded"), recent.filters.last().value)
  }

  // ---- pickup & delivery -------------------------------------------------------------------------------------------

  @Test
  fun theQueueOffersOnlyTheTabsForWhatTheStoreHasSwitchedOn() {
    val hub = spec("commerce", "commerce.fulfillmentQueue")
    fun tabs(data: String): List<String> {
      val model = screen(hub, emptyMap(), data)
      return model.block("tabs").raw.jsonObject["items"]!!.jsonArray.map { it.jsonObject }
        .filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, model.context) }.map { (it["title"] as JsonPrimitive).content }
    }
    assertEquals(listOf("To prepare", "Ready for pickup"), tabs("""{"pickup":{"items":[{"$id":"L1"}]},"settings":{}}"""))
    assertEquals(listOf("To deliver", "Out for delivery", "Delivery failed"), tabs("""{"pickup":{"items":[]},"settings":{"localDelivery":{"enabled":true}}}"""))
    assertEquals(5, tabs("""{"pickup":{"items":[{"$id":"L1"}]},"settings":{"localDelivery":{"enabled":true}}}""").size)
    assertEquals(listOf("off"), screen(hub, emptyMap(), """{"pickup":{"items":[]},"settings":null}""").shown().filter { it == "off" })
    assertTrue("off" !in screen(hub, emptyMap(), """{"pickup":{"items":[{"$id":"L1"}]},"settings":null}""").shown())
  }

  @Test
  fun eachTabIsOneQueryOnTheFieldsEveryWriterStampsAndTheLocationOnlyWhenPicked() {
    val pickup = spec("commerce", "commerce.fulfillmentPickup")
    val all = asked(pickup, "orders", mapOf("tab" to "pickup_preparing"))
    assertEquals(listOf("fulfillmentKey", "status"), all.filters.map { it.field })
    assertEquals(listOf("pickup_preparing"), listOf(all.filters[0].value))
    assertEquals(listOf("paid", "partially_fulfilled", "fulfilled"), all.filters[1].value)
    assertEquals(50, all.limit)
    assertEquals(listOf("fulfillmentDueMs"), all.orderBy.map { it.field })
    val here = asked(pickup, "orders", mapOf("tab" to "pickup_preparing", "locationId" to "L2"))
    assertEquals(listOf("fulfillmentLocationId", "fulfillmentKey", "status"), here.filters.map { it.field })
    assertEquals("L2", here.filters[0].value)
  }

  private fun queued(screenId: String, tab: String, order: String) = screen(
    spec("commerce", screenId), mapOf("tab" to tab),
    """{"orders":{"items":[$order]},"locations":{"items":[{"$id":"L1","name":"Main"},{"$id":"L2","name":"Spare"}]}}""",
  )

  @Test
  fun aPickupRowNamesTheOrderTheBuyerAndTheNextStepForItsTab() {
    val order = """{"$id":"abcdef123456","number":1042,"customerName":"Ada","lineItems":[{"quantity":2},{"quantity":1}],"createdAtMs":$later,"pickup":{"locationName":"Main St"}}"""
    val model = queued("commerce.fulfillmentPickup", "pickup_preparing", order)
    val row = model.row("data.orders.items")
    assertEquals("#1042 · Ada · 3 items", ScreenValues.render(model.block("orders").string("primary")!!, row))
    assertEquals("Main St", ScreenValues.render(model.block("orders").string("tertiary")!!, row))
    assertEquals("Ready for pickup", ScreenValues.render("{const.tabs[id=params.tab].label}", ScreenContext.with(model.context, "params", json("""{"tab":"pickup_ready"}"""))))
    fun steps(tab: String, screenId: String = "commerce.fulfillmentPickup") = queued(screenId, tab, order).let { m ->
      m.rowActions("orders").filter { ScreenValues.condition(it.whenCondition, m.row("data.orders.items")) }.map { it.id }
    }
    assertEquals(listOf("ready", "open"), steps("pickup_preparing"))
    assertEquals(listOf("pickedUp", "open"), steps("pickup_ready"))
    assertEquals(listOf("out", "open"), steps("delivery_scheduled", "commerce.fulfillmentDelivery"))
    assertEquals(listOf("out", "open"), steps("delivery_failed", "commerce.fulfillmentDelivery"))
    assertEquals(listOf("delivered", "open"), steps("delivery_out_for_delivery", "commerce.fulfillmentDelivery"))
    val ready = model.rowActions("orders").first { it.id == "ready" }
    assertEquals(json("""{"hostId":"h1","orderId":"abcdef123456","action":"ready"}"""), ScreenValues.resolveBody(ready.body!!, row))
    assertEquals("/api/commerce/local-fulfillment", ready.url)
    assertEquals(mapOf("orderId" to "{item.$id}"), model.rowActions("orders").first { it.id == "open" }.navigate!!.params)
  }

  @Test
  fun aDeliveryRowShowsTheWindowAndWhereToDriveAndTheLocationFilterOnlyWithSeveralLocations() {
    val order = """{"$id":"zzzzzz","customerEmail":"a@b.co","lineItems":[{"quantity":1}],"localDelivery":{"windowLabel":"Today 2-4 PM","postalCode":"78701"},"shippingAddress":{"line1":"1 Main St"}}"""
    val model = queued("commerce.fulfillmentDelivery", "delivery_scheduled", order)
    val row = model.row("data.orders.items")
    assertEquals("#ZZZZZZ · a@b.co · 1 item", ScreenValues.render(model.block("orders").string("primary")!!, row))
    assertEquals("Today 2-4 PM", ScreenValues.render(model.block("orders").string("secondary")!!, row))
    assertEquals("1 Main St", ScreenValues.render(model.block("orders").string("tertiary")!!, row))
    assertEquals(listOf("filter", "orders"), model.shown())
    val single = screen(spec("commerce", "commerce.fulfillmentDelivery"), mapOf("tab" to "delivery_scheduled"), """{"orders":{"items":[]},"locations":{"items":[{"$id":"L1","name":"Main"}]}}""")
    assertEquals(listOf("orders"), single.shown())
  }

  // ---- reservations ------------------------------------------------------------------------------------------------

  private val resources = """"resources":{"items":[{"$id":"r1","name":"Cabin","nightlyRateUsd":120,"minNights":2}]}"""

  private fun stays(writer: RecordingWriter, vararg stay: String) =
    withWriter(spec("commerce", "commerce.reservations"), emptyMap(), """{$resources,"stays":{"items":[${stay.joinToString(",")}]}}""", writer)

  private fun stay(status: String, extra: String = "") =
    """{"$id":"s1","resourceId":"r1","status":"$status","checkInDayMs":1791590400000,"checkOutDayMs":1791763200000,"guestName":"Ada","totalCents":24000,"paidCents":7200$extra}"""

  @Test
  fun aResourceIsWrittenAsTheConsoleWritesItAndAStayShowsItsDatesGuestAndBalance() {
    val writer = RecordingWriter()
    val model = stays(writer, stay("confirmed"))
    val list = model.block("stays")
    val row = model.row("data.stays.items")
    assertEquals("Cabin · 2026-10-10 → 2026-10-12", ScreenValues.render(list.string("primary")!!, row))
    assertEquals("Ada · \$72.00 / \$240.00 paid", ScreenValues.render(list.string("secondary")!!, row))
    // A one-unit resource's row says nothing of units (the look-ahead holds none for it).
    assertEquals("Cabin · \$120/night", rowLine(model.block("resources")["primary"], model.row("data.resources.items")))
    val add = model.action("add", "addResource")
    assertEquals(listOf("name", "units", "capacity", "nightlyRateUsd", "weekendMultiplier", "minNights", "depositPct", "cancellationHours"), add.prompt.map { it.key })
    assertEquals(listOf("100", "1", "30"), listOf("nightlyRateUsd", "minNights", "depositPct").map { key -> add.prompt.first { it.key == key }.initial })
    runBlocking { model.run(add, ScreenContext.with(model.context, "form", json("""{"name":"Lakeside cabin","nightlyRateUsd":150,"minNights":2,"depositPct":30}"""))) }
    assertEquals("add hosts/h1/resources {depositPct=30,minNights=2,name=Lakeside cabin,nightlyRateUsd=150}", writer.calls.single().replace(", ", ","))
    writer.calls.clear()
    val edit = model.rowActions("resources").first { it.id == "edit" }
    runBlocking { model.run(edit, ScreenContext.with(model.row("data.resources.items"), "form", json("""{"name":"Cabin 2","nightlyRateUsd":130}"""))) }
    // An edit with the units field left empty writes one unit, as the console does.
    assertEquals("merge hosts/h1/resources/r1 {name=Cabin 2,nightlyRateUsd=130,units=1.0}", writer.calls.single().replace(", ", ","))
    writer.calls.clear()
    runBlocking { model.run(model.rowActions("resources").first { it.id == "remove" }, model.row("data.resources.items")) }
    assertEquals(listOf("delete hosts/h1/resources/r1"), writer.calls)
  }

  private fun offered(vararg stay: String): List<String> {
    val model = stays(RecordingWriter(), *stay)
    return model.rowActions("stays").filter { ScreenValues.condition(it.whenCondition, model.row("data.stays.items")) }.map { it.id }
  }

  @Test
  fun eachStatusOffersItsMovesAndCheckingOutAsksOnlyWhenSomethingIsOwed() {
    assertEquals(listOf("checkIn", "noShow", "cancel"), offered(stay("confirmed")))
    assertEquals(listOf("cancel"), offered(stay("pending")))
    assertEquals(emptyList(), offered(stay("checked_out")))
    assertEquals(listOf("checkOutOwing"), offered(stay("checked_in")))
    assertEquals(listOf("checkOut"), offered(stay("checked_in").replace("\"paidCents\":7200", "\"paidCents\":24000")))
    assertEquals(listOf("checkOutBoth"), offered(stay("checked_in", ""","folio":[{"orderId":"o1","amountCents":1500,"atMs":1}]""")))
    assertEquals(listOf("checkOutFolio"), offered(stay("checked_in", ""","folio":[{"orderId":"o1","amountCents":1500,"atMs":1}]""").replace("\"paidCents\":7200", "\"paidCents\":24000")))
    assertEquals(listOf("checkOutOwing"), offered(stay("checked_in").replace(",\"paidCents\":7200", "")), "a stay with no payments recorded still owes its total")
    val model = stays(RecordingWriter(), stay("checked_in", ""","folio":[{"orderId":"o1","amountCents":1500,"atMs":1}]"""))
    val both = model.rowActions("stays").first { it.id == "checkOutBoth" }
    assertEquals(
      "Check out with open balance? Room charges: \$15.00 (already recorded as paid POS orders). Stay balance due: \$168.00 — collect at the register.",
      ScreenValues.render(both.confirm!!, model.row("data.stays.items")),
    )
    val writer = RecordingWriter()
    val moves = stays(writer, stay("confirmed"))
    runBlocking { moves.run(moves.rowActions("stays").first { it.id == "checkIn" }, moves.row("data.stays.items")) }
    assertEquals(listOf("merge hosts/h1/reservations/s1 {status=checked_in}"), writer.calls)
  }
}
