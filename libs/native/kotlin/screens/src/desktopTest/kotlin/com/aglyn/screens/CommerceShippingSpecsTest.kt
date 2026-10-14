package com.aglyn.screens

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Shipping, local delivery, member updates and the storefront sales tax report, as the console's cards have them: what each
 * shows, the request it makes, and the document it writes.
 */
class CommerceShippingSpecsTest : SpecTestBase() {
  private val id = "${'$'}id"

  private fun model(screenId: String, data: String, writer: RecordingWriter = RecordingWriter(), params: Map<String, String> = emptyMap()) =
    withWriter(spec("commerce", screenId), params, data, writer)

  private fun ScreenModel.fire(action: ActionSpec, scope: kotlinx.serialization.json.JsonElement, form: String = "{}") =
    runBlocking { run(action, ScreenContext.with(scope, "form", json(form))) }

  private fun calls(writer: RecordingWriter) = writer.calls.map { it.replace(", ", ",") }

  private fun badges(model: ScreenModel, block: String, item: kotlinx.serialization.json.JsonElement) =
    model.block(block).raw.jsonObject["badges"]!!.jsonArray.map { it.jsonObject }
      .filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, item) }.map { ScreenValues.render((it["text"] as JsonPrimitive).content, item) }

  // ---- member updates ----------------------------------------------------------------------------------------------

  @Test
  fun memberUpdatesPublishThroughTheRouteToAllSubscribersOrOneProductsAndAreGatedOnThePlan() {
    val data = """{"gate":{"carried":true},"posts":{"items":[{"$id":"p1","title":"Hello","createdAtMs":1791590400000}]},
      "products":{"items":[{"$id":"m1","name":"Gold","subscription":{"interval":"month"}},{"$id":"m2","name":"Mug"}]}}"""
    val model = model("commerce.memberPosts", data)
    assertEquals(listOf("posts", "add"), model.shown())
    assertEquals("Oct 10, 2026", ScreenValues.render(model.block("posts").string("secondary")!!, model.row("data.posts.items")))
    val publish = model.action("add", "publish")
    assertEquals(listOf("", "m1"), publish.prompt.first { it.key == "productId" }.choices(model.context).map { it.first }, "only subscription products can be an audience")
    assertEquals("Subscribers of Gold", publish.prompt.first { it.key == "productId" }.choices(model.context)[1].second)
    assertEquals(
      json("""{"hostId":"h1","title":"Hi","body":"Text","productId":"m1","emailSubscribers":true}"""),
      model.body(publish, """{"title":"Hi","body":"Text","productId":"m1","emailSubscribers":true}"""),
    )
    val answer = ScreenContext.with(model.context, "response", json("""{"emailed":12}"""))
    assertEquals("Published — emailed 12 subscribers", ScreenValues.render(publish.insteadEntry(answer)!!.str("text")!!, answer))
    assertEquals(listOf("locked"), model("commerce.memberPosts", """{"gate":{"carried":false,"label":"Pro"},"posts":{"items":[]},"products":{"items":[]}}""").shown())
  }

  // ---- storefront sales tax ----------------------------------------------------------------------------------------

  @Test
  fun theTaxReportAsksForTheMonthPickedAndShowsOnlyTheGroupsThatHaveSales() {
    val spec = spec("commerce", "commerce.taxSummary")
    val session = ScreenSession(orgName = "Acme", orgRole = "owner", siteName = "Shop", origin = "https://console.test")
    val none = session.context(Site(), emptyMap())
    val months = ScreenValues.lookup("now.months", none) as JsonArray
    assertEquals(12, months.size)
    assertEquals((ScreenValues.lookup("now.month", none) as JsonPrimitive).content, (months[0].jsonObject["from"] as JsonPrimitive).content.take(7), "newest first")
    assertEquals((months[0].jsonObject["from"] as JsonPrimitive).content, (months[1].jsonObject["to"] as JsonPrimitive).content, "each month ends where the next begins")
    val url = spec.loads.first().url
    assertEquals(
      "/api/commerce/tax-summary?hostId=h1&from=${java.net.URLEncoder.encode((months[0].jsonObject["from"] as JsonPrimitive).content, "UTF-8").replace("%3A", "%3A")}&to=${java.net.URLEncoder.encode((months[0].jsonObject["to"] as JsonPrimitive).content, "UTF-8")}",
      ScreenValues.renderUrl(url, none),
    )
    val picked = ScreenContext.with(none, "params", json("""{"from":"2026-08-01T00:00:00.000Z","to":"2026-09-01T00:00:00.000Z"}"""))
    assertTrue(ScreenValues.renderUrl(url, picked).endsWith("from=2026-08-01T00%3A00%3A00.000Z&to=2026-09-01T00%3A00%3A00.000Z"))
    val report = """{"report":{"summary":{"transactionCount":3,"aglynLiable":{"transactionCount":0,"byJurisdiction":{}},
        "merchantManual":{"transactionCount":3,"grossCents":110000,"taxableSalesCents":100000,"taxCollectedCents":10000,"byJurisdiction":{"TX":{"totalSalesCents":60000,"taxableSalesCents":55000,"taxCollectedCents":5000},"unknown":{"totalSalesCents":50000,"taxableSalesCents":45000,"taxCollectedCents":5000}}},
        "connectedAccountLiable":{"transactionCount":0,"byJurisdiction":{}},"attention":{"rowsMissingAddress":1}},"truncated":false,"undatedRows":0}}"""
    val model = screen(spec, emptyMap(), report)
    assertEquals(listOf("period", "pick", "advice", "count", "merchantManual", "merchantManualJurisdictions", "refunds", "noAddress"), model.shown())
    assertEquals("3 sales in this period.", ScreenValues.render(model.block("count").raw.jsonObject["rows"]!!.jsonArray[0].jsonObject["value"]!!.let { (it as JsonPrimitive).content }, model.context))
    val rows = ScreenValues.rows(ScreenValues.lookup("data.report.summary.merchantManual.byJurisdiction", model.context)).map { ScreenContext.withItem(model.context, it) }
    assertEquals(listOf("Not stated", "TX").sorted(), rows.map { ScreenValues.render(model.block("merchantManualJurisdictions").string("primary")!!, it) }.sorted())
    assertEquals("Sales ${'$'}600.00 · Taxable base ${'$'}550.00 · Tax ${'$'}50.00", ScreenValues.render(model.block("merchantManualJurisdictions").string("secondary")!!, rows.first { ScreenValues.text(ScreenValues.lookup("item.key", it)) == "TX" }))
  }

  // ---- shipping ----------------------------------------------------------------------------------------------------

  private val ship = """{"store":{"shipping":{
      "zones":[{"id":"z1","name":"Domestic","countries":["US"]},{"id":"z2","countries":["CA","MX"]}],
      "rates":[{"id":"r1","zoneId":"z1","name":"Standard","kind":"flat","amountCents":500},
               {"id":"r2","zoneId":"z1","name":"Heavy","kind":"weight_tiers","tiers":[{"upTo":1000,"amountCents":500},{"upTo":5000,"amountCents":1500}]},
               {"id":"r3","zoneId":"z1","name":"Live","kind":"carrier","carrier":{"services":["ups_ground"],"markupPct":5,"fallbackRateId":"r1"}}]}},
    "carrier":{"available":true,"services":[{"serviceKey":"ups_ground","label":"UPS Ground"},{"serviceKey":"usps_priority","label":"USPS Priority"}]}}"""

  @Test
  fun zonesAreEditedAsAListAndRemovingOneTakesItsRatesWithIt() {
    val writer = RecordingWriter()
    val model = model("commerce.shipping", ship, writer)
    assertEquals(listOf("Domestic", "CA, MX"), (0..1).map { ScreenValues.render(model.block("zones").string("primary")!!, model.row("data.store.shipping.zones", it)) })
    model.fire(model.action("addZone", "add"), model.context, """{"name":"Overseas","countries":"gb, fr ,"}""")
    model.fire(model.rowActions("zones").first { it.id == "edit" }, model.row("data.store.shipping.zones"), """{"name":"Home","countries":"us, pr"}""")
    model.fire(model.rowActions("zones").first { it.id == "remove" }, model.row("data.store.shipping.zones", 0))
    val written = calls(writer)
    assertTrue(written[0].contains("name=Overseas") && written[0].contains("countries=[GB,FR]") && written[0].contains("id=zone_"), written[0])
    assertTrue(written[1].startsWith("merge hosts/h1/settings/store {shipping={zones=[{id=z1,name=Home,countries=[US,PR]},{id=z2"), written[1])
    assertTrue(written[2].contains("zones=[{id=z2,countries=[CA,MX]}]") && written[2].contains("rates=[]"), written[2] + " (every rate of the removed zone goes)")
  }

  @Test
  fun ratesKeepTheirTiersAndEachKindAsksForItsOwnFields() {
    val writer = RecordingWriter()
    val model = model("commerce.shipping", ship, writer)
    val edit = model.rowActions("rates").first { it.id == "edit" }
    val shown = { form: String -> edit.prompt.filter { ScreenValues.condition(it.whenCondition, ScreenContext.with(model.row("data.store.shipping.rates"), "form", json(form))) }.map { it.key } }
    assertEquals(listOf("name", "zoneId", "kind", "amount"), shown("""{"kind":"flat"}"""))
    assertEquals(listOf("name", "zoneId", "kind", "amount", "freeOver"), shown("""{"kind":"free_over"}"""))
    assertEquals(listOf("name", "zoneId", "kind"), shown("""{"kind":"price_tiers"}"""))
    assertEquals(listOf("z1", "z2"), edit.prompt.first { it.key == "zoneId" }.choices(model.context).map { it.first })
    assertEquals("Domestic", edit.prompt.first { it.key == "zoneId" }.choices(model.context)[0].second)
    assertEquals("CA, MX", edit.prompt.first { it.key == "zoneId" }.choices(model.context)[1].second)
    fun offered(i: Int) = model.rowActions("rates").filter { ScreenValues.condition(it.whenCondition, model.row("data.store.shipping.rates", i)) }.map { it.id }
    assertEquals(listOf("edit", "remove"), offered(0))
    assertEquals(listOf("edit", "tiers", "remove"), offered(1))
    assertEquals(listOf("editCarrier", "remove"), offered(2))
    assertEquals(listOf("Flat", "${'$'}5.00"), badges(model, "rates", model.row("data.store.shipping.rates", 0)))
    assertEquals(listOf("Weight tiers", "2 tiers"), badges(model, "rates", model.row("data.store.shipping.rates", 1)))
    model.fire(edit, model.row("data.store.shipping.rates", 1), """{"name":"Heavy","zoneId":"z1","kind":"weight_tiers"}""")
    model.fire(model.action("addRate", "add"), model.context, """{"name":"Express","zoneId":"z2","kind":"free_over","amount":"12.50","freeOver":"100"}""")
    val written = calls(writer)
    assertTrue(written[0].contains("{id=r2,zoneId=z1,name=Heavy,kind=weight_tiers,tiers=[{upTo=1000,amountCents=500},{upTo=5000,amountCents=1500}]}"), written[0])
    assertTrue(written[1].contains("name=Express") && written[1].contains("amountCents=1250") && written[1].contains("freeOverCents=10000") && written[1].contains("id=rate_"), written[1])
  }

  @Test
  fun carrierRatesListTheServicesOnOfferAndSendTheCheckedOnes() {
    val writer = RecordingWriter()
    val model = model("commerce.shipping", ship, writer)
    val edit = model.rowActions("rates").first { it.id == "editCarrier" }
    val rate = model.row("data.store.shipping.rates", 2)
    val fields = edit.inputsFor(rate)
    assertEquals(listOf("name", "zoneId", "svc_ups_ground", "svc_usps_priority", "markupPct", "handling", "fallback"), fields.map { it.key })
    assertEquals(listOf("true", "false"), fields.drop(2).take(2).mapIndexed { i, f -> ScreenValues.text(ScreenValues.resolve(f.initial!!, ScreenContext.with(rate, "item", (ScreenValues.lookup("data.carrier.services", model.context) as JsonArray)[i]))) })
    assertEquals(listOf("", "r1", "r2"), fields.last().choices(rate).map { it.first }, "the other rates of its zone, never a carrier rate")
    model.fire(edit, rate, """{"name":"Live","zoneId":"z2","svc_ups_ground":false,"svc_usps_priority":true,"markupPct":10,"handling":"2","fallback":"r1"}""")
    assertTrue(calls(writer)[0].contains("{id=r3,zoneId=z2,name=Live,kind=carrier,carrier={services=[usps_priority],markupPct=10,handlingCents=200,fallbackRateId=r1}}"), calls(writer)[0])
    assertTrue("addCarrier" in model.actionsShown("addRate"))
    assertEquals(listOf("add"), model("commerce.shipping", ship.replace("\"available\":true", "\"available\":false")).actionsShown("addRate"))
  }

  @Test
  fun tiersAreAddedEditedAndRemovedInsideTheirRateAndLocalPickupIsASwitch() {
    val writer = RecordingWriter()
    val model = model("commerce.shippingTiers", ship, writer, mapOf("rateId" to "r2"))
    assertEquals(listOf("tiers_weight_tiers", "add_weight_tiers"), model.shown())
    assertEquals("Heavy tiers", ScreenValues.render(model.spec.title, model.context))
    model.fire(model.action("add_weight_tiers", "add"), model.context, """{"upTo":10000,"price":"30"}""")
    model.fire(model.rowActions("tiers_weight_tiers").first { it.id == "remove" }, model.row("data.store.shipping.rates.1.tiers"))
    val written = calls(writer)
    assertTrue(written[0].contains("tiers=[{upTo=1000,amountCents=500},{upTo=5000,amountCents=1500},{upTo=10000,amountCents=3000}]"), written[0])
    assertTrue(written[1].contains("{id=r2,zoneId=z1,name=Heavy,kind=weight_tiers,tiers=[{upTo=5000,amountCents=1500}]}"), written[1])
    val pickup = model("commerce.shipping", ship, RecordingWriter())
    pickup.fire(pickup.form("pickup"), pickup.context, """{"localPickup":true}""")
  }

  // ---- local delivery ----------------------------------------------------------------------------------------------

  private val delivery = """{"store":{"localDelivery":{"enabled":true,"country":"US","windows":"Mo-Fr 09:00-12:00","leadTimeMinutes":0,
      "zones":[{"id":"d1","name":"Downtown","kind":"postcode","postcodes":["10001","100*"],"feeCents":500,"freeOverCents":5000},{"id":"d2","name":"Ring","kind":"radius","radiusKm":8,"feeCents":0}]}},
    "locations":{"items":[{"$id":"L1","name":"Main"}]},"radius":{"radius":true}}"""

  @Test
  fun localDeliveryExplainsWhyCheckoutWontOfferItAndSavesTheSettingsWithOnlyWhatChanged() {
    val writer = RecordingWriter()
    val model = model("commerce.localDelivery", delivery, writer)
    assertEquals(listOf("noOrigin", "settings", "zones", "addZone", "origin"), model.shown())
    val fields = model.fieldsShown("settings")
    assertEquals("0", ScreenValues.text(ScreenValues.resolve(fields.first { it.key == "leadTime" }.initial!!, model.context)), "no notice stays no notice")
    assertEquals(listOf("noZones", "noWindows", "noCountry"), model("commerce.localDelivery", """{"store":{"localDelivery":{"enabled":true}},"locations":{"items":[]},"radius":null}""").shown().filter { it.startsWith("no") && it != "noOrigin" }.sortedBy { listOf("noZones", "noWindows", "noCountry").indexOf(it) })
    assertEquals(emptyList(), model("commerce.localDelivery", """{"store":{"localDelivery":{"enabled":false}},"locations":{"items":[]},"radius":null}""").shown().filter { it.startsWith("no") })
    model.fire(model.form("settings"), model.context, """{"enabled":true,"country":"us","locationId":"","windows":"Sa 10:00-14:00","leadTime":"60","daysAhead":5,"instructions":""}""")
    assertEquals(
      "merge hosts/h1/settings/store {localDelivery={enabled=true,country=US,locationId=null,windows=Sa 10:00-14:00,leadTimeMinutes=60.0,daysAhead=5,instructions=null}}",
      calls(writer).single(),
    )
    assertTrue(fields.first { it.key == "country" }.unmet(JsonPrimitive("USA"), model.context))
  }

  @Test
  fun deliveryZonesMatchByCodeOrDistanceAndPlaceTheStoreOnAMapWhenAskedTo() {
    val writer = RecordingWriter()
    val model = model("commerce.localDelivery", delivery, writer)
    assertEquals(listOf("Postal codes", "Free over ${'$'}50.00"), badges(model, "zones", model.row("data.store.localDelivery.zones", 0)))
    assertEquals(listOf("Within 8 km"), badges(model, "zones", model.row("data.store.localDelivery.zones", 1)))
    val edit = model.rowActions("zones").first { it.id == "edit" }
    val shown = { form: String, row: Int -> edit.prompt.filter { ScreenValues.condition(it.whenCondition, ScreenContext.with(model.row("data.store.localDelivery.zones", row), "form", json(form))) }.map { it.key } }
    assertEquals(listOf("name", "kind", "postcodes", "fee", "minimum", "freeOver"), shown("""{"kind":"postcode"}""", 0))
    assertEquals(listOf("name", "kind", "radiusKm", "fee", "minimum", "freeOver"), shown("""{"kind":"radius"}""", 1))
    model.fire(edit, model.row("data.store.localDelivery.zones", 0), """{"name":"Downtown","kind":"postcode","postcodes":"10001, 100*, 10010-10020","fee":"6","minimum":"20","freeOver":""}""")
    assertTrue(calls(writer)[0].contains("{id=d1,name=Downtown,kind=postcode,postcodes=[10001,100*,10010-10020],feeCents=600,minimumCents=2000}"), calls(writer)[0])
    val noRadius = model("commerce.localDelivery", delivery.replace("\"radius\":true", "\"radius\":false"))
    assertTrue("kind" !in noRadius.rowActions("zones").first { it.id == "edit" }.prompt.filter { ScreenValues.condition(it.whenCondition, ScreenContext.with(noRadius.row("data.store.localDelivery.zones", 0), "form", json("{}"))) }.map { it.key })
    val locate = model.action("addZone", "locate")
    assertEquals(json("""{"hostId":"h1","action":"locate"}"""), model.body(locate))
    val placed = ScreenContext.with(model.context, "response", json("""{"origin":{"lat":30.27,"lng":-97.74}}"""))
    runBlocking { model.run(locate.then!!, placed) }
    assertTrue(calls(writer).last().endsWith("localDelivery={origin={lat=30.27,lng=-97.74}}}"), calls(writer).last())
  }
}
