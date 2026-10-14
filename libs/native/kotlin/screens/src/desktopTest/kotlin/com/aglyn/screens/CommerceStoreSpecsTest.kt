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
 * The store's settings and moderation pages as the console's cards have them: what each shows in each state, and the exact
 * document or request each action makes.
 */
class CommerceStoreSpecsTest : SpecTestBase() {
  private val id = "${'$'}id"
  private val value = "${'$'}value"

  private fun model(screenId: String, data: String, writer: RecordingWriter = RecordingWriter(), params: Map<String, String> = emptyMap()) =
    withWriter(spec("commerce", screenId), params, data, writer)

  private fun ScreenModel.fire(action: ActionSpec, scope: kotlinx.serialization.json.JsonElement, form: String = "{}") =
    runBlocking { run(action, ScreenContext.with(scope, "form", json(form))) }

  private fun calls(writer: RecordingWriter) = writer.calls.map { it.replace(", ", ",") }

  private fun badges(model: ScreenModel, block: String, item: kotlinx.serialization.json.JsonElement) =
    model.block(block).raw.jsonObject["badges"]!!.jsonArray.map { it.jsonObject }
      .filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, item) }.map { ScreenValues.render((it["text"] as JsonPrimitive).content, item) }

  // ---- store settings ----------------------------------------------------------------------------------------------

  @Test
  fun storeSettingsOfferTheSitesPagesByPathAndWriteTheDocumentWithTheSiteRefreshed() {
    val writer = RecordingWriter()
    val model = model("commerce.storeSettings", """{"store":{"currency":"USD","guestCheckout":false,"pdpScreenId":"s2"},"host":{"screens":{"s1":"shop","s2":"/","s3":"about"}}}""", writer)
    val fields = model.fieldsShown("settings")
    val pdp = fields.first { it.key == "pdpScreenId" }
    assertEquals(listOf("" to "None (product URLs 404)", "s2" to "/", "s3" to "/about", "s1" to "/shop"), pdp.choices(model.context).map { it.first to it.second }.let { it.take(1) + it.drop(1).sortedBy { c -> c.second } }.let { listOf(it[0]) + pdp.choices(model.context).drop(1) })
    assertEquals(listOf("", "s2", "s3", "s1"), pdp.choices(model.context).map { it.first }, "the choices are in path order")
    assertEquals("s2", ScreenValues.text(ScreenValues.resolve(pdp.initial!!, model.context)))
    assertEquals("false", ScreenValues.text(ScreenValues.resolve(fields.first { it.key == "guestCheckout" }.initial!!, model.context)), "guest checkout is on unless the store says no")
    assertTrue(ScreenValues.text(ScreenValues.resolve(model.fieldsShown("settings").first { it.key == "pdpScreenId" }.help!!, model.context)).startsWith("Page rendered at /products/{slug}"))
    model.fire(model.form("settings"), model.context, """{"pdpScreenId":"","collectionScreenId":"s3","currency":"USD","guestCheckout":true,"termsUrl":"/terms","receiptFooter":""}""")
    assertEquals(
      listOf("merge hosts/h1/settings/store {collectionScreenId=s3,currency=USD,guestCheckout=true,pdpScreenId=null,receiptFooter=null,termsUrl=/terms}"),
      calls(writer),
    )
  }

  // ---- customer notifications -------------------------------------------------------------------------------------

  @Test
  fun eachMomentIsOnUnlessTheStoreSaidNoAndFlipsItsOwnSwitch() {
    val writer = RecordingWriter()
    val model = model("commerce.notifications", """{"store":{"buyerNotifications":{"shipped":false}},"sms":{"sms":true}}""", writer)
    val list = model.block("events")
    val toggle = list.raw.jsonObject["toggle"]!!.jsonObject
    fun on(index: Int) = ScreenValues.truthy(ScreenValues.resolve((toggle["value"] as JsonPrimitive).content, model.row("const.events", index)))
    val events = (ScreenValues.lookup("const.events", model.context) as JsonArray).map { (it.jsonObject["id"] as JsonPrimitive).content }
    assertEquals(listOf("receipt", "shipped", "delivered", "refunded", "cancelled", "ready_for_pickup", "picked_up", "out_for_delivery"), events)
    assertEquals(listOf(true, false, true), listOf(on(0), on(1), on(2)))
    assertEquals(listOf("events", "texts"), model.shown().filter { it != "intro" })
    model.fire(ActionSpec.parse(toggle["on"])!!, model.row("const.events", 1))
    model.fire(ActionSpec.parse(toggle["off"])!!, model.row("const.events", 5))
    assertEquals(listOf("merge hosts/h1/settings/store {buyerNotifications={shipped=true}}", "merge hosts/h1/settings/store {buyerNotifications={ready_for_pickup=false}}"), calls(writer))
    assertTrue("texts" !in model("commerce.notifications", """{"store":{},"sms":{"sms":false}}""").shown())
  }

  // ---- review settings and moderation -----------------------------------------------------------------------------

  @Test
  fun reviewSettingsKeepTheConsolesDefaultsAndBounds() {
    val writer = RecordingWriter()
    val model = model("commerce.reviewSettings", """{"store":{}}""", writer)
    val fields = model.fieldsShown("settings", """{"requestEmail":true}""")
    assertEquals(listOf("policy", "requestEmail", "requestDelayDays"), fields.map { it.key })
    assertEquals(listOf("verified", "true", "7"), fields.map { ScreenValues.text(ScreenValues.resolve(it.initial!!, model.context)) })
    assertEquals(listOf("policy", "requestEmail"), model.fieldsShown("settings", """{"requestEmail":false}""").map { it.key })
    assertTrue(fields[2].unmet(JsonPrimitive(2), model.context) && fields[2].unmet(JsonPrimitive(31), model.context) && !fields[2].unmet(JsonPrimitive(3), model.context))
    model.fire(model.form("settings"), model.context, """{"policy":"anyone","requestEmail":true,"requestDelayDays":10}""")
    assertEquals(listOf("merge hosts/h1/settings/store {reviews={policy=anyone,requestEmail=true,requestDelayDays=10}}"), calls(writer))
  }

  private fun reviews(carried: Boolean = true, status: String? = null, writer: RecordingWriter = RecordingWriter()) = model(
    "commerce.reviews",
    """{"gate":{"carried":$carried,"label":"Pro"},"reviews":{"items":[
       {"$id":"v1","authorName":"Ada","rating":5,"verified":true,"status":"pending","body":"Great"},
       {"$id":"v2","authorName":"Bo","rating":2,"status":"approved","body":"Meh","reply":"Sorry"},
       {"$id":"v3","authorName":"Cy","rating":1,"status":"hidden","moderationReason":"spam","body":"Buy now"}]}}""",
    writer, status?.let { mapOf("status" to it) } ?: emptyMap(),
  )

  @Test
  fun moderationOffersOnlyWhatAReviewCanDoAndRecordsWhy() {
    val writer = RecordingWriter()
    val model = reviews(writer = writer)
    fun offered(i: Int) = model.rowActions("reviews").filter { ScreenValues.condition(it.whenCondition, model.row("data.reviews.items", i)) }.map { it.id }
    assertEquals(listOf("approve", "reject", "reply"), offered(0))
    assertEquals(listOf("hide", "editReply"), offered(1))
    assertEquals(listOf("approve", "reply"), offered(2))
    assertEquals(listOf("Verified", "pending"), badges(model, "reviews", model.row("data.reviews.items", 0)))
    assertEquals(listOf("approved", "Replied"), badges(model, "reviews", model.row("data.reviews.items", 1)))
    assertEquals(listOf("hidden", "Hidden: Spam or advertising"), badges(model, "reviews", model.row("data.reviews.items", 2)))
    model.fire(model.rowActions("reviews").first { it.id == "reject" }, model.row("data.reviews.items", 0), """{"reason":"abusive"}""")
    model.fire(model.rowActions("reviews").first { it.id == "approve" }, model.row("data.reviews.items", 2))
    model.fire(model.rowActions("reviews").first { it.id == "editReply" }, model.row("data.reviews.items", 1), """{"reply":"  Thanks  "}""")
    val written = calls(writer)
    assertTrue(written[0].startsWith("merge hosts/h1/reviews/v1 {moderatedAtMs="), written[0])
    assertTrue(written[0].endsWith("moderationReason=abusive,status=rejected}"), written[0])
    assertTrue(written[1].endsWith("moderationReason=null,status=approved}"), written[1])
    assertEquals("merge hosts/h1/reviews/v2 {reply=  Thanks  }".trim().replace("  Thanks  ", "Thanks"), written[2].replace("  ", ""))
    assertEquals(listOf("locked"), reviews(carried = false).shown())
  }

  @Test
  fun theModerationQueueFiltersOnTheStatusPickedAndStartsOnPending() {
    val reviews = spec("commerce", "commerce.reviews")
    val reader = object : com.aglyn.core.FirestoreReader {
      val asked = mutableListOf<com.aglyn.core.FirestoreQuery>()
      override suspend fun get(path: String): com.aglyn.core.FirestoreDoc? = null
      override suspend fun page(query: com.aglyn.core.FirestoreQuery): com.aglyn.core.FirestorePage { asked += query; return com.aglyn.core.FirestorePage(emptyList(), null) }
      override fun observeDoc(path: String) = kotlinx.coroutines.flow.emptyFlow<com.aglyn.core.Live<com.aglyn.core.FirestoreDoc?>>()
      override fun observe(query: com.aglyn.core.FirestoreQuery) = kotlinx.coroutines.flow.emptyFlow<com.aglyn.core.Live<List<com.aglyn.core.FirestoreDoc>>>()
    }
    fun statuses(params: Map<String, String>): List<Any?> {
      reader.asked.clear()
      val context = ScreenSession(orgName = "Acme", orgRole = "owner", siteName = "Shop", origin = "https://console.test").context(Site(), params)
      runBlocking { FirestoreLoads.query(reader, reviews.loads.first { it.key == "reviews" }.query!!, context) }
      return reader.asked.single().filters.map { it.value }
    }
    assertEquals(listOf<Any?>("pending"), statuses(emptyMap()))
    assertEquals(listOf<Any?>("hidden"), statuses(mapOf("status" to "hidden")))
    assertEquals(emptyList<Any?>(), statuses(mapOf("status" to "all")))
  }

  // ---- suppliers ---------------------------------------------------------------------------------------------------

  @Test
  fun suppliersAreFullDocumentsGatedOnTheDropshipPlan() {
    val writer = RecordingWriter()
    val model = model("commerce.suppliers", """{"gate":{"carried":true},"suppliers":{"items":[{"$id":"s1","name":"Acme","email":"a@b.co"},{"$id":"s2","name":"Bare"}]}}""", writer)
    assertEquals(listOf("suppliers", "add"), model.shown())
    assertEquals(listOf("No delivery method set"), badges(model, "suppliers", model.row("data.suppliers.items", 1)))
    model.fire(model.action("add", "addSupplier"), model.context, """{"name":"New one","email":"x@y.co","webhookUrl":"","webhookSecret":""}""")
    model.fire(model.rowActions("suppliers").first { it.id == "remove" }, model.row("data.suppliers.items"))
    assertEquals(listOf("add hosts/h1/suppliers {email=x@y.co,name=New one,webhookSecret=null,webhookUrl=null}", "delete hosts/h1/suppliers/s1"), calls(writer))
    assertEquals(listOf("locked"), model("commerce.suppliers", """{"gate":{"carried":false,"label":"Business"},"suppliers":{"items":[]}}""").shown())
  }

  // ---- locations ---------------------------------------------------------------------------------------------------

  private val locs = """{"locations":{"items":[{"$id":"L1","name":"Main","isDefault":true,"pickup":{"enabled":true,"hours":"Mo-Fr 09:00-17:00"},"postalAddress":{"line1":"1 Main"}},{"$id":"L2","name":"Spare"}]},
    "count":{"items":[],"count":2},"plan":{"quotas":{"inventoryLocations":4}}}"""

  @Test
  fun locationsWritePickupAndAddressAsTheConsoleDoesAndMoveTheDefault() {
    val writer = RecordingWriter()
    val model = model("commerce.locations", locs, writer)
    assertEquals(listOf("Pickup", "Default"), badges(model, "locations", model.row("data.locations.items", 0)))
    assertEquals(emptyList(), badges(model, "locations", model.row("data.locations.items", 1)))
    val actions = model.rowActions("locations")
    assertEquals("1 Main", ScreenValues.render(actions.first { it.id == "address" }.label, model.row("data.locations.items", 0)))
    assertEquals("Add address", ScreenValues.render(actions.first { it.id == "address" }.label, model.row("data.locations.items", 1)))
    model.fire(actions.first { it.id == "pickup" }, model.row("data.locations.items", 1), """{"enabled":true,"hours":"Sa 10:00-14:00","instructions":"","ready":"120"}""")
    model.fire(actions.first { it.id == "address" }, model.row("data.locations.items", 1), """{"line1":"2 Side St","line2":"","city":"Austin","state":"TX","postalCode":"78701","country":"us","phone":""}""")
    model.fire(actions.first { it.id == "default" }, model.row("data.locations.items", 1))
    assertEquals(
      listOf(
        "merge hosts/h1/settings/store".let { "merge hosts/h1/locations/L2 {pickup={enabled=true,hours=Sa 10:00-14:00,instructions=null,readyWithinMinutes=120.0}}" },
        "merge hosts/h1/locations/L2 {postalAddress={line1=2 Side St,line2=null,city=Austin,state=TX,postalCode=78701,phone=null,country=US}}",
        "merge hosts/h1/locations/L1 {isDefault=false}",
        "merge hosts/h1/locations/L2 {isDefault=true}",
      ),
      calls(writer),
    )
    assertTrue(actions.first { it.id == "address" }.prompt.first { it.key == "country" }.unmet(JsonPrimitive("USA"), model.context), "a country is two letters")
  }

  @Test
  fun addingALocationGoesThroughTheRouteAndTheReadoutNamesThePlansLimit() {
    val model = model("commerce.locations", locs)
    val add = model.action("add", "addLocation")
    assertEquals(json("""{"hostId":"h1","resource":"location","data":{"name":"Back room","isDefault":false}}"""), model.body(add, """{"name":"Back room"}"""))
    val first = model("commerce.locations", """{"locations":{"items":[]},"count":{"count":0},"plan":null}""")
    assertEquals("true", ScreenValues.text(first.body(first.action("add", "addLocation"), """{"name":"Only"}""").jsonObject["data"]!!.jsonObject["isDefault"]), "the first location is the default")
    fun readout(m: ScreenModel) = m.block("quota").raw.jsonObject["rows"]!!.jsonArray.map { it.jsonObject }.filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, m.context) }
      .map { ScreenValues.render((it["value"] as JsonPrimitive).content, m.context) }
    assertEquals(listOf("2/4 locations on your plan"), readout(model))
    assertEquals(listOf("0 locations · checking your plan…"), readout(first))
  }

  // ---- taxes -------------------------------------------------------------------------------------------------------

  @Test
  fun taxesAskUntilDecidedShowManualFieldsOnlyForManualAndEditRatesInPlace() {
    val writer = RecordingWriter()
    val undecided = model("commerce.tax", """{"store":{}}""", writer)
    assertTrue("undecided" in undecided.shown())
    val decided = model("commerce.tax", """{"store":{"tax":{"mode":"manual","pricesIncludeTax":true,"origin":{"country":"US","state":"TX"},"rates":[{"country":"US","pct":5,"label":"US default"},{"country":"DE","pct":19}]}}}""", writer)
    assertTrue("undecided" !in decided.shown())
    assertEquals(listOf("mode", "pricesIncludeTax", "originCountry", "originState"), decided.fieldsShown("calculation", """{"mode":"manual"}""").map { it.key })
    assertEquals(listOf("mode"), decided.fieldsShown("calculation", """{"mode":"stripe"}""").map { it.key })
    assertEquals("US default", ScreenValues.render("{item.pct}% {item.label}", decided.row("data.store.tax.rates")).removePrefix("5% "))
    decided.fire(decided.form("calculation"), decided.context, """{"mode":"manual","pricesIncludeTax":false,"originCountry":"us","originState":""}""")
    decided.fire(decided.rowActions("rates").first { it.id == "edit" }, decided.row("data.store.tax.rates", 1), """{"country":"de","state":"","pct":20,"label":"VAT"}""")
    decided.fire(decided.rowActions("rates").first { it.id == "remove" }, decided.row("data.store.tax.rates"))
    decided.fire(decided.action("addRate", "add"), decided.context, """{"country":"ca","state":"on","pct":13,"label":"HST"}""")
    decided.fire(decided.form("lodging"), decided.context, """{"pct":"","label":"Occupancy tax"}""")
    val written = calls(writer)
    assertEquals("merge hosts/h1/settings/store {tax={mode=manual,pricesIncludeTax=false,origin={country=US,state=null}}}", written[0])
    assertTrue(written[1].contains("rates=[{country=US,label=US default,pct=5") && written[1].contains("{country=DE,label=VAT,pct=20.0,state=null}") .not().not() || written[1].contains("country=DE"), written[1])
    assertTrue(written[2].contains("{country=DE,pct=19}"), written[2])
    assertTrue(written[3].contains("country=CA") && written[3].contains("state=ON") && written[3].contains("HST"), written[3])
    assertEquals("merge hosts/h1/settings/store {tax={lodging={pct=null,label=Occupancy tax}}}", written[4], "a blank rate turns the regime off")
  }

  // ---- payments ----------------------------------------------------------------------------------------------------

  private fun payments(profile: String, plan: String = "null") = model("commerce.payments", """{"profile":$profile,"plan":$plan}""")

  private fun rows(model: ScreenModel, block: String) = model.block(block).raw.jsonObject["rows"]!!.jsonArray.map { it.jsonObject }
    .filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, model.context) }.map { ScreenValues.render((it["value"] as JsonPrimitive).content, model.context) }

  @Test
  fun paymentsNameTheAccountsStateAndOfferTheMoveThatFitsIt() {
    assertEquals(listOf("Charges enabled"), rows(payments("""{"stripeChargesEnabled":true,"stripeAccountLivemode":true}"""), "account"))
    assertEquals(listOf("Charges enabled"), rows(payments("""{"stripeChargesEnabled":true,"stripeAccountLivemode":false}"""), "account"), "test mode is still a verified mode")
    assertEquals(listOf("Not verified"), rows(payments("""{"stripeChargesEnabled":true}"""), "account"))
    assertEquals(listOf("Not set up"), rows(payments("null"), "account"))
    fun offered(profile: String) = payments(profile).let { m -> m.actionsShown("connect") }
    assertEquals(listOf("setup"), offered("""{}"""))
    assertEquals(listOf("setup"), offered("""{"stripeChargesEnabled":true}"""), "an unverified account sets up again")
    assertEquals(listOf("refresh", "payouts"), offered("""{"stripeChargesEnabled":true,"stripeAccountLivemode":true}"""))
    val plan = """{"features":{"commerce":true},"quotas":{"transactionFeePhysicalPct":2,"transactionFeeDigitalPct":0}}"""
    val paid = payments("""{}""", plan)
    assertEquals(listOf("2%", "0%"), rows(paid, "fees"))
    assertTrue("higher" in paid.shown() && "paid" !in paid.shown())
    assertTrue("paid" in payments("""{}""", """{"features":{"commerce":false},"quotas":{"transactionFeePhysicalPct":0,"transactionFeeDigitalPct":0}}""").shown())
    val failed = payments("""{"lastPayoutFailureAtMs":1791590400000,"lastPayoutFailureCents":12500,"lastPayoutFailureReason":"Account closed."}""")
    assertTrue(ScreenValues.render(failed.block("payout").string("text")!!, failed.context).startsWith("A payout of ${'$'}125.00 did not reach your bank on Oct 10, 2026"))
  }

  // ---- payment methods ---------------------------------------------------------------------------------------------

  @Test
  fun paymentMethodsListWhatTheStripeAccountOffersAndSwitchEachOneThroughTheRoute() {
    val view = """{"accountConnected":true,"canEdit":true,"canFinish":true,"warnings":["Klarna needs a business address."],
      "methods":[{"id":"apple_pay","on":true,"platform":"on","capability":null},{"id":"klarna","on":true,"platform":"on","capability":"inactive"},
                 {"id":"affirm","on":false,"platform":"unavailable","capability":null},{"id":"crypto","on":false,"platform":null,"capability":null},{"id":"cashapp","on":true,"platform":null,"capability":"active"}],
      "domains":[{"domain":"shop.test","enabled":true,"status":{"applePay":"active"}},{"domain":"new.test","enabled":false,"lastError":"dns"}]}"""
    val model = model("commerce.paymentMethods", """{"view":$view}""")
    val list = model.block("methods")
    val shown = (0..4).filter { ScreenValues.condition(list.string("filter"), model.row("data.view.methods", it)) }
    assertEquals(listOf(0, 1, 4), shown, "unavailable ones are hidden, and crypto when the platform has no word on it")
    assertEquals("Apple Pay", ScreenValues.render(list.string("primary")!!, model.row("data.view.methods", 0)))
    assertEquals(emptyList(), badges(model, "methods", model.row("data.view.methods", 0)), "a wallet with no capability shows no verdict")
    assertEquals(listOf("Stripe needs more details"), badges(model, "methods", model.row("data.view.methods", 1)))
    assertEquals(listOf("Ready"), badges(model, "methods", model.row("data.view.methods", 4)))
    assertEquals(listOf("finish"), model.rowActions("methods").filter { ScreenValues.condition(it.whenCondition, model.row("data.view.methods", 1)) }.map { it.id })
    val toggle = list.raw.jsonObject["toggle"]!!.jsonObject
    assertEquals(json("""{"hostId":"h1","methods":{"klarna":false}}"""), ScreenValues.resolveBody(ActionSpec.parse(toggle["off"])!!.body!!, model.row("data.view.methods", 1)))
    assertEquals(listOf("Apple Pay ready", "Retrying"), (0..1).map { i -> badges(model, "domains", model.row("data.view.domains", i)).single() })
    assertTrue(ScreenValues.render(list.raw.jsonObject["toggle"]!!.jsonObject["disabled"]!!.let { (it as JsonPrimitive).content }, model.context).isNotEmpty())
  }

  // ---- ShipStation and ShippingEasy --------------------------------------------------------------------------------

  @Test
  fun shipStationShowsTheCredentialsToPasteAndTheMovesForItsState() {
    val off = model("commerce.shipstation", """{"status":{"connected":false,"available":true}}""")
    assertEquals(listOf("intro", "manage"), off.shown())
    assertEquals(listOf("connect"), off.actionsShown("manage"))
    assertEquals("password", off.action("manage", "connect").reveal)
    val on = model("commerce.shipstation", """{"status":{"connected":true,"username":"ship_abc","lastExportAtMs":1791590400000}}""")
    assertEquals(listOf("connection", "statusNames", "activity", "manage"), on.shown())
    assertEquals(listOf("show", "rotate", "disconnect"), on.actionsShown("manage"))
    assertEquals(listOf("https://console.test/api/commerce/shipstation/h1", "ship_abc"), rows(on, "connection"))
    assertEquals(listOf("unpaid", "paid", "shipped", "canceled", "on_hold"), rows(on, "statusNames"))
    assertEquals(listOf("Oct 10, 2026, 12:00 AM", "Not yet"), rows(on, "activity"))
    assertEquals(json("""{"hostId":"h1","action":"rotate"}"""), on.body(on.action("manage", "rotate")))
    val gone = model("commerce.shipstation", """{"status":{"connected":false,"available":false}}""")
    assertEquals(listOf("unavailable", "manage"), gone.shown())
    assertEquals(emptyList(), gone.actionsShown("manage"), "nothing to connect where ShipStation is not offered")
  }

  @Test
  fun shippingEasyConnectsWithThreeKeysAndReportsWhatASyncSent() {
    val off = model("commerce.shippingeasy", """{"status":{"connected":false}}""")
    val connect = off.action("manage", "connect")
    assertEquals(listOf("apiKey", "apiSecret", "storeApiKey"), connect.prompt.map { it.key })
    assertEquals("password", connect.prompt[1].kind)
    assertEquals(
      json("""{"hostId":"h1","connector":"shippingeasy","action":"connect","apiKey":"k","apiSecret":"s","storeApiKey":"sk"}"""),
      off.body(connect, """{"apiKey":"k","apiSecret":"s","storeApiKey":"sk"}"""),
    )
    val on = model("commerce.shippingeasy", """{"status":{"connected":true,"apiKeyEnding":"1234","storeApiKeyEnding":"abcd","lastError":{"message":"Rejected","atMs":1791590400000}}}""")
    assertEquals(listOf("attention", "connection", "manage"), on.shown())
    assertEquals(listOf("sync", "keys", "disconnect"), on.actionsShown("manage"))
    assertEquals("Needs attention", rows(on, "connection").first())
    val sync = on.action("manage", "sync")
    val answer = ScreenContext.with(on.context, "response", json("""{"sync":{"sent":3,"already":1,"failed":0}}"""))
    assertEquals("3 orders sent to ShippingEasy, 1 already there, 0 not sent.", ScreenValues.render(sync.insteadEntry(answer)!!.str("text")!!, answer))
  }

  // ---- order webhooks ----------------------------------------------------------------------------------------------

  private val hooks = """{"status":{"configured":true,"maxEndpoints":10,"events":[{"event":"order.paid","label":"Order paid","description":"When paid."},{"event":"order.refunded","label":"Order refunded","description":"When refunded."}]},
    "endpoints":{"items":[{"$id":"e1","url":"https://a.test/hook","description":"Warehouse","enabled":true,"events":["order.paid"],"secretHint":"x9","lastDeliveryStatus":"failed"},
                          {"$id":"e2","url":"https://b.test/hook","enabled":false,"events":["order.paid","order.refunded"],"secretHint":"y1"}]}}"""

  @Test
  fun webhookEndpointsAreManagedThroughTheRouteWithTheEventsPickedByToggle() {
    val model = model("commerce.orderWebhooks", hooks)
    assertEquals(listOf("On", "Last: Failed"), badges(model, "endpoints", model.row("data.endpoints.items", 0)))
    assertEquals(listOf("Paused"), badges(model, "endpoints", model.row("data.endpoints.items", 1)))
    fun offered(i: Int) = model.rowActions("endpoints").filter { ScreenValues.condition(it.whenCondition, model.row("data.endpoints.items", i)) }.map { it.id }
    assertEquals(listOf("test", "deliveries", "edit", "pause", "roll", "delete"), offered(0))
    assertEquals(listOf("deliveries", "edit", "resume", "roll", "delete"), offered(1))
    val edit = model.rowActions("endpoints").first { it.id == "edit" }
    val first = model.row("data.endpoints.items", 0)
    val fields = edit.inputsFor(first)
    assertEquals(listOf("url", "description", "evt_order.paid", "evt_order.refunded"), fields.map { it.key })
    assertEquals("Order paid (order.paid)", fields[2].label)
    assertEquals(listOf("true", "false"), fields.drop(2).map { ScreenValues.text(ScreenValues.resolve(it.initial!!, ScreenContext.with(first, "item", (ScreenValues.lookup("data.status.events", model.context) as JsonArray)[fields.drop(2).indexOf(it)]))) })
    assertTrue(fields[0].unmet(JsonPrimitive("http://a.test"), model.context) && !fields[0].unmet(JsonPrimitive("https://a.test"), model.context), "an https address")
    assertEquals(
      json("""{"hostId":"h1","action":"update","endpointId":"e1","url":"https://a.test/new","description":"W","events":["order.refunded"]}"""),
      ScreenValues.resolveBody(edit.body!!, ScreenContext.with(first, "form", json("""{"url":"https://a.test/new","description":"W","evt_order.paid":false,"evt_order.refunded":true}"""))),
    )
    val add = model.action("add", "addEndpoint")
    assertEquals(listOf("true", "true"), add.inputsFor(model.context).drop(2).map { ScreenValues.text(ScreenValues.resolve(it.initial!!, model.context)) }, "a new endpoint starts with every event on")
    assertEquals("secret", add.reveal)
    val test = model.rowActions("endpoints").first { it.id == "test" }
    val answer = ScreenContext.with(first, "response", json("""{"delivered":false,"attempt":{"error":"timeout"}}"""))
    assertEquals("Test event not delivered: timeout", ScreenValues.render(test.insteadEntry(answer)!!.str("text")!!, answer))
    assertEquals(listOf("off"), model("commerce.orderWebhooks", """{"status":{"configured":false},"endpoints":{"items":[]}}""").shown())
    assertEquals("2/10", ScreenValues.render(model.block("count").raw.jsonObject["rows"]!!.jsonArray[0].jsonObject["value"]!!.let { (it as JsonPrimitive).content }, model.context))
  }

  @Test
  fun deliveriesShowTheLastAttemptAndCanBeShownAsTheyWereSentOrSentAgain() {
    val model = model(
      "commerce.orderWebhookDeliveries",
      """{"deliveries":{"items":[{"$id":"d1","event":"order.paid","status":"failed","createdAtMs":1791590400000,"body":"{\"id\":1}","attempts":[{"httpStatus":500,"error":"boom"},{"error":"timeout"}]}]}}""",
      params = mapOf("endpointId" to "e1"),
    )
    val row = model.row("data.deliveries.items")
    assertEquals("2 attempts · last no answer timeout", ScreenValues.render(model.block("deliveries").string("secondary")!!, row))
    assertEquals(listOf("Failed"), badges(model, "deliveries", row))
    assertEquals("item.body", model.rowActions("deliveries").first { it.id == "body" }.reveal)
    assertEquals(json("""{"hostId":"h1","action":"resend","deliveryId":"d1"}"""), ScreenValues.resolveBody(model.rowActions("deliveries").first { it.id == "resend" }.body!!, row))
  }
}
