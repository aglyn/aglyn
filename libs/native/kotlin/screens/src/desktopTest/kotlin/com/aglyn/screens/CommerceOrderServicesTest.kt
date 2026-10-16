package com.aglyn.screens

import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * One order's services: the order as a widget is handed it, pickup and delivery steps, returns, and what the plugins that
 * put widgets in the order contribute: couriers, networks, labels and the rest.
 */
class CommerceOrderServicesTest : SpecTestBase() {
  private fun order(extra: Map<String, Any?> = emptyMap()): Map<String, Any?> = mapOf(
    "status" to "paid", "number" to 1042L, "livemode" to true, "customerEmail" to "a@b.co",
    "shippingAddress" to mapOf("name" to "Ada", "line1" to "1 Main", "city" to "Austin", "country" to "US"),
    "lineItems" to listOf(
      mapOf("productId" to "p1", "name" to "Mug", "quantity" to 3L, "unitAmountCents" to 1000L),
      mapOf("productId" to "p2", "name" to "Gift", "quantity" to 1L, "unitAmountCents" to 500L, "productType" to "digital"),
      mapOf("productId" to "p3", "name" to "Tee", "quantity" to 2L, "unitAmountCents" to 2000L),
    ),
    "fulfillments" to listOf(shipment(listOf(0L to 1L))),
  ) + extra

  private fun shipment(lines: List<Pair<Long, Long>>) = mapOf(
    "id" to "f1", "atMs" to 1L, "status" to "active", "lineItemIds" to lines.map { it.first }, "lines" to lines.map { mapOf("lineItemId" to it.first, "quantity" to it.second) },
  )

  private class Orders(val docs: Map<String, Map<String, Any?>>) : FirestoreReader {
    override suspend fun get(path: String): FirestoreDoc? = docs[path]?.let { FirestoreDoc(path.substringAfterLast('/'), path, it) }
    override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
  }

  private fun zone(extra: Map<String, Any?> = emptyMap()): JsonElement =
    runBlocking { FirestoreLoads.orderZone(Orders(mapOf("hosts/h1/orders/ord1234567" to order(extra))), "h1", "ord1234567") }

  private fun value(path: String, root: JsonElement) = ScreenValues.lookup(path, root)

  @Test
  fun anOrderIsHandedToAWidgetWithItsLinesUnitsAndWhatIsLeftToShipOrBringBack() {
    val order = zone()
    val data = ScreenContext.with(json("{}"), "data", json("""{"order":$order}"""))
    assertEquals("#1042", ScreenValues.text(value("data.order.number", data)))
    assertEquals("ord1234567", ScreenValues.text(value("data.order.id", data)))
    assertEquals(listOf(0.0, 0.0, 0.0), (0..2).map { ScreenValues.number(value("data.order.lines.$it.lineItemId", data))!! - it })
    assertEquals("3 1 2".split(" "), (0..2).map { ScreenValues.text(value("data.order.lines.$it.quantity", data)) })
    assertEquals(listOf("1", "0", "0"), (0..2).map { ScreenValues.text(value("data.order.lines.$it.fulfilledQuantity", data)) })
    assertEquals(listOf("2", "1", "2"), (0..2).map { ScreenValues.text(value("data.order.lines.$it.remainingQuantity", data)) })
    assertEquals(listOf("true", "false", "true"), (0..2).map { ScreenValues.text(value("data.order.lines.$it.requiresShipping", data)) }, "a digital line does not ship")
    assertEquals(2, (value("data.order.shipLines", data) as JsonArray).size)
    assertEquals("true", ScreenValues.text(value("data.order.shippable", data)))
    assertEquals("true", ScreenValues.text(value("data.order.returnable", data)))
    assertEquals("false", ScreenValues.text(value("data.order.testMode", data)))
    assertEquals("shipping", ScreenValues.text(value("data.order.fulfillmentMethod", data)))
    assertEquals("preparing", ScreenValues.text(value("data.order.pickupStatus", data)))
    val delivered = zone(mapOf("fulfillments" to listOf(shipment(listOf(0L to 3L, 2L to 2L)))))
    val after = ScreenContext.with(json("{}"), "data", json("""{"order":$delivered}"""))
    assertEquals("false", ScreenValues.text(value("data.order.shippable", after)))
    assertEquals("true", ScreenValues.text(value("data.order.returnable", after)))
    val pickup = zone(mapOf("fulfillmentMethod" to "pickup", "pickup" to mapOf("status" to "ready", "locationName" to "Main"), "livemode" to false))
    val pickedUp = ScreenContext.with(json("{}"), "data", json("""{"order":$pickup}"""))
    assertEquals("ready", ScreenValues.text(value("data.order.pickupStatus", pickedUp)))
    assertEquals("true", ScreenValues.text(value("data.order.testMode", pickedUp)), "a payment made with test keys is a test order")
  }

  private fun services(extra: Map<String, Any?> = emptyMap(), returns: String = "[]"): ScreenModel {
    val order = zone(extra)
    return screen(spec("commerce", "commerce.orderServices"), mapOf("orderId" to "ord1234567"), """{"order":$order,"returns":{"items":$returns}}""")
  }

  private fun stepsOf(model: ScreenModel) = model.actionsShown("steps")

  @Test
  fun pickupAndDeliveryOfferTheStepsForWhereTheyStand() {
    val shipped = services()
    assertEquals(emptyList(), stepsOf(shipped), "an order that ships has no pickup or delivery steps")
    fun pickup(status: String, orderStatus: String = "paid") = stepsOf(services(mapOf("fulfillmentMethod" to "pickup", "status" to orderStatus, "pickup" to mapOf("status" to status, "locationName" to "Main"))))
    assertEquals(listOf("ready", "pickedUp"), pickup("preparing"))
    assertEquals(listOf("pickedUp", "notReady"), pickup("ready"))
    assertEquals(emptyList(), pickup("picked_up"))
    assertEquals(emptyList(), pickup("preparing", "cancelled"))
    fun delivery(status: String) = stepsOf(services(mapOf("fulfillmentMethod" to "local_delivery", "localDelivery" to mapOf("status" to status, "windowLabel" to "Today 2-4"))))
    assertEquals(listOf("out", "delivered"), delivery("scheduled"))
    assertEquals(listOf("out", "delivered"), delivery("failed"))
    assertEquals(listOf("delivered", "failed"), delivery("out_for_delivery"))
    assertEquals(emptyList(), delivery("delivered"))
    val model = services(mapOf("fulfillmentMethod" to "local_delivery", "localDelivery" to mapOf("status" to "out_for_delivery")))
    val failed = model.action("steps", "failed")
    assertEquals(json("""{"hostId":"h1","orderId":"ord1234567","action":"delivery_failed","reason":"No one home"}"""), model.body(failed, """{"reason":"No one home"}"""))
    assertEquals(json("""{"hostId":"h1","orderId":"ord1234567","action":"ready"}"""), services(mapOf("fulfillmentMethod" to "pickup", "pickup" to mapOf("status" to "preparing"))).let { it.body(it.action("steps", "ready")) })
  }

  @Test
  fun returnsOnTheOrderListThemAndAReturnCanStartOnlyWhileTheOrderIsLive() {
    val model = services(returns = """[{"${'$'}id":"r1","status":"approved","createdAtMs":1791590400000,"lines":[{"name":"Mug"},{"name":"Tee"}]}]""")
    val row = model.row("data.returns.items")
    assertEquals("Mug, Tee", ScreenValues.render(model.block("returns").string("primary")!!, row))
    assertEquals(listOf("Approved"), model.block("returns").raw.jsonObject["badges"]!!.jsonArray.map { ScreenValues.render((it.jsonObject["text"] as JsonPrimitive).content, row) })
    assertTrue("startReturn" in model.shown())
    assertEquals(mapOf("orderId" to "{params.orderId}"), model.action("startReturn", "start").navigate!!.params)
    assertTrue("startReturn" !in services(mapOf("status" to "pending")).shown())
    assertTrue("offline" !in model.shown())
    val offline = services(mapOf("offline" to mapOf("soldAtMs" to 1791590400000L, "syncedAtMs" to 1791590500000L, "flags" to listOf("late-sync", "stock-short"), "stockConflicts" to listOf(mapOf("shortUnits" to 1L, "requested" to 2L, "name" to "Mug")))))
    assertTrue("offline" in offline.shown() && "offlineStock" in offline.shown())
    assertEquals("1 of 2× Mug not in stock", ScreenValues.render(offline.block("offlineStock").string("primary")!!, offline.row("data.order.offline.stockConflicts")))
  }

  // ---- the widgets other plugins put in the order's services ------------------------------------------------------------

  private fun widget(plugin: String, id: String, params: Map<String, String> = mapOf("orderId" to "ord1234567"), data: String): ScreenModel = screen(spec(plugin, id), params, data)

  @Test
  fun everyServiceScreenIsInTheOrderZoneAndOnlyCouriersAskForALocalDelivery() {
    val ids = mapOf("couriers" to "couriers.order", "fulfillment-networks" to "fulfillment-networks.order", "inventory-sync" to "inventory-sync.order", "marketplaces" to "marketplaces.order",
      "review-platforms" to "review-platforms.order", "post-purchase" to "post-purchase.order", "print-on-demand" to "print-on-demand.order", "shipping" to "shipping.order")
    for ((plugin, id) in ids) assertEquals(listOf("orderDetail"), spec(plugin, id).zones, id)
    assertEquals(listOf("returnDetail"), spec("shipping", "shipping.returnLabel").zones)
    assertEquals("data.order.fulfillmentMethod == local_delivery", spec("couriers", "couriers.order").requires)
  }

  private val connection = """{"available":true,"connection":{"provider":"doordash","providerLabel":"DoorDash","live":{"configured":true},"test":{"configured":false}}}"""

  private fun courier(order: String, view: String) = widget("couriers", "couriers.order", data = """{"order":$order,"conn":$connection,"view":$view}""")

  @Test
  fun aCourierIsQuotedSentAndCalledOffAndNeverBookedTwice() {
    val delivery = zone(mapOf("fulfillmentMethod" to "local_delivery", "localDelivery" to mapOf("status" to "scheduled")))
    val soon = "4102444800000"
    val quoted = courier(delivery.toString(), """{"quote":{"provider":"doordash","providerLabel":"DoorDash","feeCents":950,"currency":"USD","expiresAtMs":$soon,"dropoffEtaMs":$soon},"run":null}""")
    assertEquals(listOf("quote", "book"), quoted.shown().filter { it == "quote" || it == "book" })
    assertEquals(listOf("send", "requote"), quoted.actionsShown("book"))
    assertEquals(json("""{"hostId":"h1","orderId":"ord1234567","idempotencyKey":"ord1234567-$soon"}"""), quoted.body(quoted.action("book", "send")), "a retry of the same quote cannot book a second courier")
    val none = courier(delivery.toString(), """{"quote":null,"run":null}""")
    assertEquals(listOf("quote"), none.actionsShown("book"))
    assertEquals(json("""{"hostId":"h1","orderId":"ord1234567","provider":"doordash"}"""), none.body(none.action("book", "quote")))
    val running = courier(delivery.toString(), """{"quote":null,"run":{"state":"assigned","stateLabel":"Courier assigned","providerLabel":"DoorDash","trackingUrl":"https://t.test/1","etaMs":$soon,"feeCents":900,"currency":"USD","pending":false}}""")
    assertTrue("current" in running.shown() && "book" !in running.shown().filter { running.actionsShown("book").isNotEmpty() })
    assertEquals(listOf("track", "refresh", "cancel"), running.actionsShown("running"))
    assertEquals(emptyList(), running.actionsShown("book"), "no second courier while one is out")
    assertTrue(ScreenValues.render(running.action("running", "cancel").confirm!!, running.context).startsWith("Cancel the courier? DoorDash is asked"))
    val over = courier(delivery.toString(), """{"quote":null,"run":{"state":"delivered","stateLabel":"Delivered","providerLabel":"DoorDash","reason":null}}""")
    assertTrue("last" in over.shown() && over.actionsShown("book").isNotEmpty(), "after a courier is done, another can be quoted")
    val test = courier(zone(mapOf("fulfillmentMethod" to "local_delivery", "livemode" to false, "localDelivery" to mapOf("status" to "scheduled"))).toString(), """{"quote":null,"run":null}""")
    assertTrue("test" in test.shown() && "keysTest" in test.shown() && test.actionsShown("book").isEmpty(), "a test order needs the test keys")
  }

  @Test
  fun fulfillmentNetworksSendOnlyWhatIsOpenAndUnshippedAndNotAlreadyThere() {
    val view = """{"connections":[{"provider":"shipbob","status":"connected"},{"provider":"shipmonk","status":"reconnect"}],
      "routings":[{"provider":"amazon-mcf","status":"accepted","reference":"R1","lines":[{"name":"Mug"}],"shipments":[{"trackingNumber":"1Z"}]}]}"""
    val model = widget("fulfillment-networks", "fulfillment-networks.order", data = """{"order":${zone()},"view":$view}""")
    val send = model.block("send").raw.jsonObject["actions"]!!.jsonArray.mapNotNull { ActionSpec.parse(it) }.first()
    fun can(index: Int, m: ScreenModel = model) = ScreenValues.condition(send.whenCondition, m.row("data.view.connections", index))
    assertTrue(can(0) && !can(1), "a connection that needs signing in again is not offered")
    assertEquals(json("""{"hostId":"h1","recordId":"ord1234567","provider":"shipbob"}"""), ScreenValues.resolveBody(send.body!!, model.row("data.view.connections", 0)))
    assertEquals("Send to ShipBob", ScreenValues.render(send.label, model.row("data.view.connections", 0)))
    val shipped = widget("fulfillment-networks", "fulfillment-networks.order", data = """{"order":${zone(mapOf("status" to "fulfilled"))},"view":$view}""")
    assertTrue(!can(0, shipped), "a fulfilled order has nothing to send")
    val failed = widget("fulfillment-networks", "fulfillment-networks.order", data = """{"order":${zone()},"view":{"connections":[{"provider":"shipbob","status":"connected"}],"routings":[{"provider":"shipbob","status":"failed"}]}}""")
    assertTrue(can(0, failed), "a failed send can go again")
    val sent = widget("fulfillment-networks", "fulfillment-networks.order", data = """{"order":${zone()},"view":{"connections":[{"provider":"shipbob","status":"connected"}],"routings":[{"provider":"shipbob","status":"accepted"}]}}""")
    assertTrue(!can(0, sent))
    val cancel = model.block("routings").raw.jsonObject["actions"]!!.jsonArray.mapNotNull { ActionSpec.parse(it) }.first()
    assertTrue(ScreenValues.condition(cancel.whenCondition, model.row("data.view.routings")))
    assertEquals("Amazon", ScreenValues.render("{const.providers[id=item.provider].short}", model.row("data.view.routings")))
    assertEquals("Amazon Multi-Channel Fulfillment R1", ScreenValues.render(model.block("routings").string("primary")!!, model.row("data.view.routings")))
  }

  @Test
  fun inventoryMarketplaceReviewAndTrackingServicesReadTheirRoutesAndOfferOnlyTheirRetries() {
    val inventory = widget("inventory-sync", "inventory-sync.order", data = """{"view":{"connection":{"provider":"cin7-core","status":"connected"},"order":{"provider":"cin7-core","status":"failed","reference":"AG-1","lines":[{"name":"Mug","sku":"M1","quantity":2}],"note":"Timed out"}}}""")
    assertEquals(listOf("again"), inventory.actionsShown("send"))
    assertEquals(json("""{"hostId":"h1","recordId":"ord1234567"}"""), inventory.body(inventory.action("send", "again")))
    assertEquals("Cin7 Core", ScreenValues.render(inventory.block("state").string("title")!!, inventory.context))
    assertEquals(emptyList(), widget("inventory-sync", "inventory-sync.order", data = """{"view":{"connection":{"provider":"cin7-core","status":"reconnect"},"order":{"provider":"cin7-core","status":"failed","reference":"x","lines":[]}}}""").actionsShown("send"))
    assertEquals(listOf("none", "send"), widget("inventory-sync", "inventory-sync.order", data = """{"view":{"order":null}}""").shown())
    assertEquals(emptyList(), widget("inventory-sync", "inventory-sync.order", data = """{"view":{"order":null}}""").actionsShown("send"))

    val market = widget("marketplaces", "marketplaces.order", data = """{"view":{"order":{"marketplace":"etsy","displayRef":"E-77","currency":"USD","fees":[{"label":"Listing","amountMinor":20},{"label":"Transaction","amountMinor":130}],"feesTotalMinor":150,
      "shipments":[{"state":"failed","carrier":"UPS","trackingNumber":"1Z","message":"Rejected"},{"state":"confirmed","carrier":"USPS","trackingNumber":"94"}]}}}""")
    assertEquals(listOf("retry"), market.actionsShown("retry"))
    assertEquals("Sold on Etsy", ScreenValues.render(market.block("sold").string("title")!!, market.context))
    assertEquals("\$1.50", ScreenValues.render(market.block("sold").raw.jsonObject["rows"]!!.jsonArray[2].jsonObject["value"]!!.let { (it as JsonPrimitive).content }, market.context))
    assertTrue("fees" in market.shown())

    val reviews = widget("review-platforms", "review-platforms.order", data = """{"view":{"order":{"trustpilot":{"status":"skipped","reason":"no_consent"},"yotpo":{"status":"sent","via":"api","atMs":1791590400000}}}}""")
    fun rows(model: ScreenModel, block: String) = model.block(block).raw.jsonObject["rows"]!!.jsonArray.map { it.jsonObject }.filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, model.context) }
      .map { ScreenValues.render((it["value"] as JsonPrimitive).content, model.context) }
    assertEquals(listOf("Not invited", "The customer has not agreed to marketing email from this store"), rows(reviews, "trustpilot"))
    assertEquals(listOf("Invited", "Through the API", "Oct 10, 2026, 12:00 AM"), rows(reviews, "yotpo"))
    assertTrue("none" !in reviews.shown())

    val track = widget("post-purchase", "post-purchase.order", data = """{"avail":{"available":true},"view":{"order":{"protection":{"status":"registered","premiumCents":250,"policyId":"P1"},"trackedParcels":[{"trackingNumber":"1Z","vendor":"aftership"}],"narvar":{"error":"Down"}}}}""")
    assertEquals(listOf("Covered", "\$2.50", "P1"), rows(track, "protection"))
    assertEquals("Followed by AfterShip", ScreenValues.render(track.block("parcels").string("secondary")!!, track.row("data.view.order.trackedParcels")))
    assertTrue("narvarError" in track.shown() && "narvar" !in track.shown())
    assertEquals(listOf("off"), widget("post-purchase", "post-purchase.order", data = """{"avail":{"available":false},"view":{"order":{}}}""").shown())
  }

  @Test
  fun printOnDemandPartsOfferWhatTheServiceSaysCanBeDoneNext() {
    val model = widget("print-on-demand", "print-on-demand.order", data = """{"view":{"parts":[
      {"id":"x1","provider":"printful","providerLabel":"Printful","status":"submitted","lines":[{"name":"Shirt"}],"actions":["refresh","cancel"],"costs":{"totalMinor":1800,"currency":"USD"},"retailMinor":3000,"retailCurrency":"USD","dashboardUrl":"https://p.test/x"},
      {"id":"x2","provider":"printify","providerLabel":"Printify","status":"failed","lines":[],"actions":["retry"],"lastError":"Rejected"}]}}""")
    fun offered(i: Int) = model.rowActions("parts").filter { ScreenValues.condition(it.whenCondition, model.row("data.view.parts", i)) }.map { it.id }
    assertEquals(listOf("open", "refresh", "cancel"), offered(0))
    assertEquals(listOf("retry"), offered(1))
    val retry = model.rowActions("parts").first { it.id == "retry" }
    assertEquals(json("""{"hostId":"h1","orderId":"ord1234567","provider":"printify","action":"retry"}"""), ScreenValues.resolveBody(retry.body!!, model.row("data.view.parts", 1)))
    assertEquals("Printful charged ${'$'}18.00", ScreenValues.render("{item.providerLabel} charged {item.costs.totalMinor:cents/item.costs.currency}", model.row("data.view.parts", 0)))
  }

  // ---- shipping labels ----------------------------------------------------------------------------------------------

  private val settings = """{"settings":{"defaultPackageId":"box1","packages":[{"id":"box1","name":"Small box","lengthCm":20,"widthCm":15,"heightCm":10},{"id":"box2","name":"Big box","lengthCm":40,"widthCm":30,"heightCm":20}]}}"""

  private fun labels(order: JsonElement = zone(), list: String = """{"labels":[],"addressCheck":null}""") =
    widget("shipping", "shipping.order", data = """{"order":$order,"avail":{"available":true},"labels":$list,"settings":$settings}""")

  @Test
  fun aLabelIsBoughtFromARateInTwoSteps() {
    val model = labels()
    assertEquals(listOf("buy", "buyReturn", "check"), model.actionsShown("buy"))
    val buy = model.action("buy", "buy")
    val fields = buy.inputs(model.context)
    assertEquals(listOf("qty_0", "qty_2", "presetId", "lengthCm", "widthCm", "heightCm", "weight"), fields.map { it.key }, "only the lines that ship, then the box and weight")
    assertEquals("Mug (of 2)", fields[0].label)
    assertEquals(listOf("2", "2"), fields.take(2).mapIndexed { i, f -> ScreenValues.text(ScreenValues.resolve(f.initial!!, ScreenContext.withItem(model.context, (ScreenValues.lookup("data.order.shipLines", model.context) as JsonArray)[i]))) })
    assertEquals(listOf("box1", "box2", "custom"), fields[2].choices(model.context).map { it.first }.sortedBy { listOf("box1", "box2", "custom").indexOf(it) })
    assertEquals("box1", ScreenValues.text(ScreenValues.resolve(fields[2].initial!!, model.context)))
    val form = """{"qty_0":2,"qty_2":0,"presetId":"box2","weight":850}"""
    assertEquals(
      json("""{"hostId":"h1","recordId":"ord1234567","kind":"outbound","lines":[{"lineIndex":0,"quantity":2}],"package":{"presetId":"box2","weightGrams":850}}"""),
      model.body(buy, form),
      "an empty line is left out, the box dimensions only go with another size",
    )
    assertEquals(listOf("presetId", "lengthCm", "widthCm", "heightCm"), fields.filter { ScreenValues.condition(it.whenCondition, ScreenContext.with(model.context, "form", json("""{"presetId":"custom"}"""))) }.map { it.key }.filter { it != "qty_0" && it != "qty_2" && it != "weight" })
    val buyStep = buy.then!!
    val answer = """{"shipmentId":"shp_9","messages":["Weight is over the limit"],"rates":[{"rateId":"r1","label":"Ground","amountCents":850,"currency":"USD","estimatedDays":4,"badges":["cheapest"]},{"rateId":"r2","label":"Air","amountCents":2100,"currency":"USD","estimatedDays":null,"badges":[]}]}"""
    val previous = ScreenContext.with(ScreenContext.with(model.context, "response", json(answer)), "previous", json(form))
    val rateField = buyStep.inputs(previous).single()
    assertEquals(listOf("r1", "r2"), rateField.choices(previous).map { it.first })
    assertEquals("Ground · ${'$'}8.50 4 days cheapest", rateField.choices(previous)[0].second)
    assertEquals("Air · ${'$'}21.00", rateField.choices(previous)[1].second)
    assertEquals("r1", ScreenValues.text(ScreenValues.resolve(rateField.initial!!, previous)), "the cheapest is chosen")
    assertEquals("Weight is over the limit", ScreenValues.render(rateField.help!!, previous))
    assertEquals(
      json("""{"hostId":"h1","recordId":"ord1234567","shipmentId":"shp_9","rateId":"r2","attemptKey":"shp_9-r2"}"""),
      ScreenValues.resolveBody(buyStep.body!!, ScreenContext.with(previous, "form", json("""{"rateId":"r2"}"""))),
      "buying the same quote twice is the same attempt",
    )
    assertEquals("label.labelUrl", buyStep.openUrl)
  }

  @Test
  fun labelsAreListedPrintedAndVoidedAndTheCarriersAddressAdviceIsHeard() {
    val list = """{"labels":[
      {"labelId":"l1","kind":"outbound","status":"purchased","serviceLabel":"UPS Ground","trackingNumber":"1Z","trackingStatus":"in_transit","chargeCents":850,"costCents":800,"currency":"USD","labelUrl":"https://l.test/1"},
      {"labelId":"l2","kind":"return","status":"voided","serviceLabel":"USPS","trackingNumber":"94","costCents":600,"currency":"USD","recordShipmentRefusal":"quantity"}],
      "addressCheck":{"verdict":"corrected","suggested":{"line1":"1 Main St","city":"Austin","state":"TX","postalCode":"78701"}}}"""
    val model = labels(list = list)
    fun badges(i: Int) = model.block("labels").raw.jsonObject["badges"]!!.jsonArray.map { it.jsonObject }.filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, model.row("data.labels.labels", i)) }
      .map { ScreenValues.render((it["text"] as JsonPrimitive).content, model.row("data.labels.labels", i)) }
    assertEquals(listOf("Label bought", "In transit"), badges(0))
    assertEquals(listOf("Voided", "Return", "Bought, but the order was not updated"), badges(1).sorted().let { badges(1) })
    assertEquals("\$8.50", ScreenValues.render(model.block("labels").string("secondary")!!, model.row("data.labels.labels", 0)), "what was charged, else what it cost")
    assertEquals("\$6.00", ScreenValues.render(model.block("labels").string("secondary")!!, model.row("data.labels.labels", 1)))
    fun offered(i: Int) = model.rowActions("labels").filter { ScreenValues.condition(it.whenCondition, model.row("data.labels.labels", i)) }.map { it.id }
    assertEquals(listOf("print", "void"), offered(0))
    assertEquals(emptyList(), offered(1))
    assertEquals(json("""{"hostId":"h1","labelId":"l1"}"""), ScreenValues.resolveBody(model.rowActions("labels").first { it.id == "void" }.body!!, model.row("data.labels.labels", 0)))
    assertTrue("corrected" in model.shown())
    assertEquals(listOf("buyCorrected", "buyAsIs", "buyReturn", "check"), model.actionsShown("buy"))
    assertEquals("{\"line1\":\"1 Main St\",\"city\":\"Austin\",\"state\":\"TX\",\"postalCode\":\"78701\"}", model.body(model.action("buy", "buyCorrected"), """{"qty_0":1,"presetId":"box1"}""").jsonObject["shipTo"].toString())
    val check = model.action("buy", "check")
    val invalid = ScreenContext.with(model.context, "response", json("""{"check":{"verdict":"invalid","messages":["Street not found"]}}"""))
    assertEquals("The carrier cannot deliver to this address. Street not found", ScreenValues.render(check.insteadEntry(invalid)!!.str("text")!!, invalid))
    assertTrue("off" !in labels(zone(mapOf("fulfillments" to emptyList<Any?>()))).shown())
  }

  @Test
  fun aReturnLabelIsBoughtThenAttachedToTheReturn() {
    val ret = """{"status":"approved","lines":[{"lineItemId":0,"name":"Mug","quantity":2}]}"""
    val model = widget("shipping", "shipping.returnLabel", mapOf("returnId" to "r1", "orderId" to "ord1234567"), """{"ret":$ret,"order":${zone()},"avail":{"available":true},"settings":$settings}""")
    assertEquals(listOf("hint", "buy"), model.shown().filter { it == "hint" || it == "buy" })
    val buy = model.action("buy", "buy")
    assertEquals(listOf("qty_0", "presetId", "lengthCm", "widthCm", "heightCm", "weight"), buy.inputs(model.context).map { it.key })
    assertEquals("Mug (of 2)", buy.inputs(model.context)[0].label)
    assertEquals("return", ScreenValues.text(model.body(buy, """{"qty_0":2,"presetId":"box1"}""").jsonObject["kind"]))
    val attach = buy.then!!.then!!
    val bought = ScreenContext.with(model.context, "response", json("""{"label":{"carrier":"UPS","trackingNumber":"1Z","labelUrl":"https://l.test/1"}}"""))
    assertEquals(
      json("""{"hostId":"h1","returnId":"r1","action":"attach-label","label":{"carrier":"UPS","trackingNumber":"1Z","labelUrl":"https://l.test/1"}}"""),
      ScreenValues.resolveBody(attach.body!!, bought),
    )
    val done = widget("shipping", "shipping.returnLabel", mapOf("returnId" to "r1", "orderId" to "ord1234567"), """{"ret":{"status":"approved","returnLabel":{"carrier":"UPS","trackingNumber":"1Z"},"lines":[]},"order":${zone()},"avail":{"available":true},"settings":$settings}""")
    assertTrue("done" in done.shown() && "buy" !in done.shown())
  }
}
