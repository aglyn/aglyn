package com.aglyn.screens

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.KeyValueStore
import com.aglyn.core.Live
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respondError
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The commerce services' spec screens (the tax service, fulfillment networks,
 * post-purchase and the rest that sit in Commerce settings' zone), run against
 * the routes' answers in the console's own shapes: which blocks and actions
 * show for a site that has not connected, one that has, and one the deployment
 * does not offer; and the exact request each action makes.
 */
class CommerceServiceSpecsTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }

  private object NoReads : FirestoreReader {
    override suspend fun get(path: String): FirestoreDoc? = null
    override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
  }

  private class Site : NativePluginContext {
    override val uid = "u1"
    override val orgId = "o1"
    override val hostId = "h1"
    override val orgSlug = "acme"
    override val hostSlug = "shop"
    override val firestore: FirestoreReader = NoReads
    override val api = ConsoleApiClient("http://localhost", HttpClient(MockEngine { respondError(HttpStatusCode.NotFound) }), { "t" })
    override val deviceStore = object : KeyValueStore {
      override fun get(key: String): String? = null
      override fun set(key: String, value: String?) {}
    }
    override fun navigate(screenId: String, params: NativeParams) {}
    override fun openBesigner(path: String, scope: ConsoleScope) = false
  }

  @BeforeTest
  fun utc() {
    ScreenValues.timeZone = "UTC"
  }

  private fun spec(pluginDir: String, id: String): ScreenSpec =
    File(root, "libs/plugins/$pluginDir/src/android/screens").listFiles().orEmpty()
      .filter { it.name.endsWith(".screens.json") }
      .flatMap { ScreenSpec.parseFile(it.readText()) }
      .first { it.id == id }

  private fun screen(spec: ScreenSpec, params: Map<String, String>, data: String): ScreenModel {
    val session = ScreenSession(orgName = "Acme", orgRole = "owner", siteName = "Shop", origin = "https://console.test")
    val model = ScreenModel(spec, session.context(Site(), params), null)
    model.seed(Json.parseToJsonElement(data))
    return model
  }

  private fun ScreenModel.shown(): List<String> = spec.blocks.filter { ScreenValues.condition(it.whenCondition, context) }.map { it.id }

  private fun ScreenModel.actionsShown(block: String): List<String> {
    val items = spec.blocks.first { it.id == block }.raw.jsonObject["items"]!!.jsonArray
    return items.mapNotNull { ActionSpec.parse(it) }.filter { ScreenValues.condition(it.whenCondition, context) }.map { it.id }
  }

  private fun ScreenModel.action(block: String, id: String): ActionSpec =
    spec.blocks.first { it.id == block }.raw.jsonObject["items"]!!.jsonArray.mapNotNull { ActionSpec.parse(it) }.first { it.id == id }

  private fun ScreenModel.form(block: String): ActionSpec = ActionSpec.parse(spec.blocks.first { it.id == block }.raw.jsonObject["submit"])!!

  private fun ScreenModel.body(action: ActionSpec, form: String = "{}"): JsonElement {
    val scoped = ScreenContext.with(context, "form", Json.parseToJsonElement(form))
    return ScreenValues.resolveBody(action.body!!, scoped)
  }

  private fun json(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

  // ---- tax service -------------------------------------------------------------------------------------------------

  private val taxConnection = """
    {"provider":"avalara","providerLabel":"Avalara AvaTax","environment":"sandbox","accountId":"1100","companyCode":"DEFAULT",
     "shipFrom":{"line1":"1 Main St","city":"Austin","region":"TX","postalCode":"78701","country":"US"},"shipFromValidated":true,
     "defaultTaxCode":"P0000000","recordTransactions":true,"lastTestOk":true,"lastTestAtMs":1760000000000,"lastError":null,"updatedAtMs":1}
  """.trimIndent()

  @Test
  fun theTaxServiceAsksForCredentialsUntilOneIsConnected() {
    val spec = spec("tax-engines", "tax-engines.service")
    val bare = screen(spec, emptyMap(), """{"conn":{"available":true,"providers":[{"id":"avalara","label":"Avalara AvaTax"},{"id":"taxjar","label":"TaxJar"}],"connection":null}}""")
    assertEquals(listOf("connect"), bare.shown().filter { it != "exemptions" })
    assertEquals("/api/tax-engines/connection?hostId=h1", ScreenValues.renderUrl(spec.loads.first { it.key == "conn" }.url, bare.context))
    val connect = bare.form("connect")
    assertEquals("/api/tax-engines/connect", connect.url)
    assertEquals(
      json("""{"hostId":"h1","provider":"avalara","environment":"sandbox","accountId":"1100","companyCode":"DEFAULT","secret":"k"}"""),
      bare.body(connect, """{"provider":"avalara","environment":"sandbox","accountId":"1100","companyCode":"DEFAULT","secret":"k"}"""),
    )
    val absent = screen(spec, emptyMap(), """{"conn":{"available":false,"providers":[],"connection":null}}""")
    assertEquals(listOf("unavailable"), absent.shown())
  }

  @Test
  fun aConnectedTaxServiceShowsItsSettingsAndWhatEachSaveSends() {
    val spec = spec("tax-engines", "tax-engines.service")
    val on = screen(spec, emptyMap(), """{"conn":{"available":true,"providers":[],"connection":$taxConnection},"exemptions":{"exemptions":[{"id":"h1__a@b.co","email":"a@b.co","name":"Acme Resale","type":"wholesale","certificateNumber":"C-9","regions":[]}]}}""")
    assertEquals(
      listOf("status", "manage", "shipFrom", "taxCode", "recording", "exemptions", "exemptionAdd"),
      on.shown(),
    )
    assertEquals(listOf("test", "disconnect"), on.actionsShown("manage"))
    assertEquals("Avalara AvaTax", ScreenValues.render(spec.blocks.first { it.id == "status" }.title!!, on.context))
    assertEquals(
      json("""{"hostId":"h1","shipFrom":{"line1":"1 Main St","city":"Austin","region":"TX","postalCode":"78701","country":"US"}}"""),
      on.body(on.form("shipFrom"), """{"line1":"1 Main St","city":"Austin","region":"TX","postalCode":"78701","country":"US"}"""),
    )
    assertEquals(json("""{"hostId":"h1","defaultTaxCode":"P0000000"}"""), on.body(on.form("taxCode"), """{"defaultTaxCode":"p0000000"}"""))
    assertEquals(json("""{"hostId":"h1","recordTransactions":false}"""), on.body(on.form("recording"), """{"recordTransactions":false}"""))
    val row = spec.blocks.first { it.id == "exemptions" }
    val item = ScreenContext.with(on.context, "item", json("""{"id":"h1__a@b.co","email":"a@b.co","name":"Acme Resale","type":"wholesale","certificateNumber":"C-9"}"""))
    assertEquals("Acme Resale", ScreenValues.render(row.string("primary")!!, item))
    assertEquals("a@b.co · C-9", ScreenValues.render(row.string("secondary")!!, item))
    val failing = screen(spec, emptyMap(), """{"conn":{"available":true,"providers":[],"connection":${taxConnection.replace("\"lastTestOk\":true", "\"lastTestOk\":false").replace("\"lastError\":null", "\"lastError\":\"Bad key\"")}}}""")
    assertTrue("failing" in failing.shown() && "failingBare" !in failing.shown())
  }

  // ---- fulfillment networks ----------------------------------------------------------------------------------------

  private val offered = """[{"id":"shipbob","sandbox":false},{"id":"amazon-mcf","sandbox":true},{"id":"shipmonk","sandbox":false}]"""
  private fun connection(provider: String, status: String, extra: String = "") =
    """{"id":"h1_$provider","provider":"$provider","hostId":"h1","status":"$status","sandbox":false,"accountName":"Acme","routing":"automatic",
       "shippingMethod":"Standard","shippingSpeed":"Standard","marketplaceId":null,"marketplaces":[{"id":"ATVP","name":"Amazon.com","countryCode":"US"}],
       "storeId":null,"webhookSecretSet":false,"syncInventory":true,"inventory":{"syncedAtMs":1,"skus":3,"updated":1,"unchanged":2,"unknown":0,"untracked":0,"perLocation":0},
       "lastError":null,"connectedAtMs":1,"totals":{"sent":4,"shipped":3,"canceled":0}$extra}"""

  @Test
  fun everyOfferedNetworkIsARowThatKnowsItsStatus() {
    val spec = spec("fulfillment-networks", "fulfillment-networks.service")
    val model = screen(spec, emptyMap(), """{"nets":{"offered":$offered,"connections":[${connection("shipbob", "paused")}]}}""")
    assertEquals(listOf("networks"), model.shown())
    val row = spec.blocks.first { it.id == "networks" }
    fun at(index: Int) = ScreenContext.with(model.context, "item", model.context.jsonObject["data"]!!.jsonObject["nets"]!!.jsonObject["offered"]!!.jsonArray[index])
    assertEquals("ShipBob", ScreenValues.render(row.string("primary")!!, at(0)))
    assertEquals("Amazon Multi-Channel Fulfillment", ScreenValues.render(row.string("primary")!!, at(1)))
    assertEquals("Paused", ScreenValues.render("{data.nets.connections[provider=item.id].status:title}", at(0)))
    assertTrue(ScreenValues.condition("data.nets.connections[provider=item.id]", at(0)))
    assertFalse(ScreenValues.condition("data.nets.connections[provider=item.id]", at(2)), "ShipMonk has no connection yet")
    assertTrue(ScreenValues.condition("item.sandbox", at(1)))
  }

  @Test
  fun aNetworkOffersTheConnectItNeedsAndTheManageActionsItsStatusAllows() {
    val spec = spec("fulfillment-networks", "fulfillment-networks.network")
    fun network(provider: String, connections: String) = screen(spec, mapOf("provider" to provider), """{"nets":{"offered":$offered,"connections":$connections},"log":{"entries":[]}}""")
    assertEquals(listOf("connect"), network("shipbob", "[]").actionsShown("manage"), "a sign-in network opens its consent page")
    assertEquals(listOf("connectKey"), network("shipmonk", "[]").actionsShown("manage"), "an API-key network asks for the key")
    val active = network("shipbob", "[${connection("shipbob", "active")}]")
    assertEquals(listOf("sync", "pause", "disconnect"), active.actionsShown("manage"))
    assertTrue("status" in active.shown() && "settings" in active.shown() && "activity" in active.shown())
    assertEquals(listOf("resume", "disconnect"), network("shipbob", "[${connection("shipbob", "paused")}]").actionsShown("manage"))
    val reconnect = network("shipmonk", "[${connection("shipmonk", "reconnect", ",\"lastError\":\"x\"")}]")
    assertEquals(listOf("reconnectKey", "disconnect"), reconnect.actionsShown("manage"))
    assertEquals(listOf("webhook", "disconnect"), network("shipmonk", "[${connection("shipmonk", "active").replace("\"storeId\":null", "\"storeId\":\"s1\"")}]").actionsShown("manage").filter { it == "webhook" || it == "disconnect" })

    val connect = active.action("manage", "pause")
    assertEquals("/api/fulfillment-networks/connection", connect.url)
    assertEquals(json("""{"hostId":"h1","provider":"shipbob","paused":true}"""), active.body(connect))
    assertEquals("Connect ShipBob", ScreenValues.render(network("shipbob", "[]").action("manage", "connect").label, network("shipbob", "[]").context))
    assertEquals("url", network("shipbob", "[]").action("manage", "connect").openUrl)
    assertEquals(json("""{"hostId":"h1","provider":"shipbob","returnTo":"/"}"""), network("shipbob", "[]").body(network("shipbob", "[]").action("manage", "connect")))
    val key = network("shipmonk", "[]").action("manage", "connectKey")
    assertEquals(json("""{"hostId":"h1","provider":"shipmonk","apiKey":"k","storeId":"s1"}"""), network("shipmonk", "[]").body(key, """{"apiKey":"k","storeId":"s1"}"""))
    assertEquals("webhook.secret", key.reveal)
    assertEquals("Amazon Multi-Channel Fulfillment", ScreenValues.render(spec.title, network("amazon-mcf", "[]").context))
  }

  // ---- post-purchase -----------------------------------------------------------------------------------------------

  @Test
  fun postPurchaseShowsOnlyTheServicesTheDeploymentOffers() {
    val spec = spec("post-purchase", "post-purchase.service")
    val settings = """{"aftership":{"enabled":true,"connected":true,"trackingPageUrl":"https://shop.aftership.com"},"route":{"enabled":false,"connected":false,"defaultSelected":false},"narvar":{"enabled":false,"connected":false,"retailerMoniker":null}}"""
    val some = screen(spec, emptyMap(), """{"settings":{"settings":$settings,"vendors":["aftership","route"]}}""")
    assertEquals(listOf("aftershipStatus", "aftership", "aftershipManage", "routeStatus", "route"), some.shown())
    assertEquals(
      json("""{"hostId":"h1","change":{"vendor":"aftership","apiKey":"","webhookSecret":"","trackingPageUrl":"https://shop.aftership.com","enabled":true}}"""),
      some.body(some.form("aftership"), """{"apiKey":"","webhookSecret":"","trackingPageUrl":"https://shop.aftership.com","enabled":true}"""),
    )
    assertEquals(json("""{"hostId":"h1","change":{"vendor":"aftership","disconnect":true}}"""), some.body(some.action("aftershipManage", "aftershipDisconnect")))
    assertEquals("https://console.test/api/post-purchase/webhooks/aftership?hostId=h1", ScreenValues.render(
      spec.blocks.first { it.id == "aftershipStatus" }.raw.jsonObject["rows"]!!.jsonArray.last().jsonObject["value"]!!.let { (it as JsonPrimitive).content }, some.context))
    val none = screen(spec, emptyMap(), """{"settings":{"settings":$settings,"vendors":[]}}""")
    assertEquals(listOf("unavailable"), none.shown())
  }

  // ---- email platforms ---------------------------------------------------------------------------------------------

  private fun marketing(provider: String, status: String, extra: String = "") =
    """{"id":"h1_$provider","provider":"$provider","hostId":"h1","status":"$status","authKind":"api-key","accountName":"Acme","listId":"L1",
       "lists":[{"id":"L1","name":"Everyone"},{"id":"L2","name":"VIP"}],"tag":"aglyn","syncContacts":true,"syncEvents":false,"backfillDone":true,
       "lastRunAtMs":1,"lastSuccessAtMs":1,"nextRunAtMs":2,"lastError":null,"consecutiveFailures":0,
       "totals":{"contactsPushed":5,"consentPulled":1,"eventsSent":0},"connectedAtMs":1$extra}"""

  private fun platform(provider: String, connections: String, available: String = """[{"id":"mailchimp","apiKey":true,"oauth":true},{"id":"klaviyo","apiKey":true,"oauth":false},{"id":"attentive","apiKey":false,"oauth":true}]""") =
    screen(spec("marketing-platforms", "marketing-platforms.platform"), mapOf("provider" to provider), """{"conn":{"available":$available,"connections":$connections},"log":{"entries":[]}}""")

  @Test
  fun emailPlatformsListsWhatIsOfferedOrConnected() {
    val spec = spec("marketing-platforms", "marketing-platforms.service")
    val model = screen(spec, emptyMap(), """{"conn":{"available":[{"id":"klaviyo","apiKey":true,"oauth":false}],"connections":[${marketing("omnisend", "reconnect")}]}}""")
    assertEquals(listOf("platforms"), model.shown())
    val block = spec.blocks.first { it.id == "platforms" }
    val filter = block.string("filter")!!
    fun shown(id: String) = ScreenValues.condition(filter, ScreenContext.with(model.context, "item", json("""{"id":"$id"}""")))
    assertTrue(shown("klaviyo"), "an offered platform is a row")
    assertTrue(shown("omnisend"), "a connected platform stays a row so it can be disconnected")
    assertFalse(shown("mailchimp") || shown("attentive"), "a platform neither offered nor connected is hidden")
  }

  @Test
  fun anEmailPlatformOffersTheConnectItsDeploymentAllowsAndTheActionsItsStatusAllows() {
    assertEquals(listOf("connectKey", "connectOAuth"), platform("mailchimp", "[]").actionsShown("manage"))
    assertEquals(listOf("connectKey"), platform("klaviyo", "[]").actionsShown("manage"))
    assertEquals(listOf("connectOAuth"), platform("attentive", "[]").actionsShown("manage"), "Attentive has no key")
    val active = platform("mailchimp", "[${marketing("mailchimp", "active")}]")
    assertEquals(listOf("sync", "pause", "disconnect"), active.actionsShown("manage"))
    assertEquals(listOf("status", "list", "settings", "log"), active.shown().filter { it in setOf("status", "list", "settings", "log") })
    assertEquals(listOf("resume", "disconnect"), platform("mailchimp", "[${marketing("mailchimp", "paused")}]").actionsShown("manage"))
    assertEquals(listOf("sync", "disconnect"), platform("mailchimp", "[${marketing("mailchimp", "error")}]").actionsShown("manage").filter { it != "pause" })
    val reconnect = platform("mailchimp", "[${marketing("mailchimp", "reconnect", ",\"lastError\":\"x\"")}]")
    assertEquals(listOf("reconnectKey", "reconnectOAuth", "disconnect"), reconnect.actionsShown("manage"))
    assertTrue("list" !in reconnect.shown() && "settings" !in reconnect.shown(), "a refused credential offers no settings")

    val key = platform("mailchimp", "[]").action("manage", "connectKey")
    assertEquals("/api/marketing-platforms/connections", key.url)
    assertEquals(json("""{"hostId":"h1","provider":"mailchimp","apiKey":"k-us21"}"""), platform("mailchimp", "[]").body(key, """{"apiKey":"k-us21"}"""))
    val oauth = platform("mailchimp", "[]").action("manage", "connectOAuth")
    assertEquals("url", oauth.openUrl)
    assertEquals(json("""{"hostId":"h1","provider":"mailchimp","returnTo":"/"}"""), platform("mailchimp", "[]").body(oauth))
    assertEquals("PATCH", active.action("manage", "pause").method.name)
    assertEquals(json("""{"hostId":"h1","provider":"mailchimp","paused":true}"""), active.body(active.action("manage", "pause")))
    assertEquals("DELETE", active.action("manage", "disconnect").method.name)
  }

  @Test
  fun anEmailPlatformSavesItsListTagAndSwitches() {
    val klaviyo = platform("klaviyo", "[${marketing("klaviyo", "active")}]")
    assertEquals("Everyone", FieldSpec.parse(klaviyo.spec.blocks.first { it.id == "list" }.raw.jsonObject["fields"]!!.jsonArray[0])!!.choices(klaviyo.context).first { it.first == "L1" }.second)
    assertEquals("List contacts go into", ScreenValues.render(klaviyo.spec.blocks.first { it.id == "list" }.title!!, klaviyo.context))
    assertEquals(json("""{"hostId":"h1","provider":"klaviyo","listId":"L2"}"""), klaviyo.body(klaviyo.form("list"), """{"listId":"L2"}"""))
    assertEquals(
      json("""{"hostId":"h1","provider":"klaviyo","tag":"vip","syncContacts":true,"syncEvents":true}"""),
      klaviyo.body(klaviyo.form("settings"), """{"tag":"vip","syncContacts":true,"syncEvents":true}"""),
    )
    val settingsFields = klaviyo.spec.blocks.first { it.id == "settings" }.raw.jsonObject["fields"]!!.jsonArray.mapNotNull { FieldSpec.parse(it) }
    assertTrue(settingsFields.first { it.key == "syncEvents" }.let { ScreenValues.condition(it.whenCondition, klaviyo.context) }, "Klaviyo sends events")
    val mailchimp = platform("mailchimp", "[${marketing("mailchimp", "active")}]")
    assertFalse(mailchimp.spec.blocks.first { it.id == "settings" }.raw.jsonObject["fields"]!!.jsonArray.mapNotNull { FieldSpec.parse(it) }.first { it.key == "syncEvents" }.let { ScreenValues.condition(it.whenCondition, mailchimp.context) }, "Mailchimp has no events")
    assertTrue("list" in mailchimp.shown())
    assertTrue("list" !in platform("omnisend", "[${marketing("omnisend", "active")}]").shown(), "Omnisend has no list to pick")
  }

  // ---- sales channels ----------------------------------------------------------------------------------------------

  private fun channelState(sells: Boolean = true, google: String = "false", extra: String = "") =
    """{"state":{"sells":$sells,"store":{"name":"Acme","origin":"https://shop.test","currency":"usd","productPagesServed":true,"carrierPricedCountries":[]},
       "channels":[{"id":"google","enabled":$google,"url":${if (google == "true") "\"https://shop.test/feed/google/t.xml\"" else "null"},"createdAtMs":1,"rotatedAtMs":null,"lastFetchAtMs":${if (google == "true") "5" else "null"},"lastFetchAgent":null},
                   {"id":"meta","enabled":false,"url":null,"createdAtMs":null,"rotatedAtMs":null,"lastFetchAtMs":null,"lastFetchAgent":null}],
       "legacy":{"url":"https://shop.test/api/commerce/feed","active":${google == "true"}},
       "settings":{"defaultBrand":"","defaultCondition":"new","defaultGoogleCategory":""}$extra}}"""

  @Test
  fun salesChannelsShowTheStoreStateTheDefaultsAndAChannelSwitch() {
    val spec = spec("sales-channels", "sales-channels.service")
    val model = screen(spec, emptyMap(), channelState())
    assertEquals(listOf("check", "defaults", "channels"), model.shown())
    assertEquals(listOf("notSelling", "defaults", "channels"), screen(spec, emptyMap(), channelState(sells = false)).shown().filter { it != "check" })
    assertEquals(
      json("""{"hostId":"h1","settings":{"defaultBrand":"Acme","defaultCondition":"used","defaultGoogleCategory":"2271"}}"""),
      model.body(model.form("defaults"), """{"defaultBrand":"Acme","defaultCondition":"used","defaultGoogleCategory":"2271"}"""),
    )
    val toggle = spec.blocks.first { it.id == "channels" }.raw.jsonObject["toggle"]!!.jsonObject
    val item = ScreenContext.with(model.context, "item", json("""{"id":"meta","label":"Meta"}"""))
    assertEquals("false", ScreenValues.render(toggle["value"]!!.let { (it as JsonPrimitive).content }, item))
    val on = ActionSpec.parse(toggle["on"])!!
    assertEquals("/api/sales-channels/channel", on.url)
    assertEquals(json("""{"hostId":"h1","channel":"meta","enabled":true}"""), ScreenValues.resolveBody(on.body!!, item))
    val off = ActionSpec.parse(toggle["off"])!!
    assertEquals(json("""{"hostId":"h1","channel":"meta","enabled":false}"""), ScreenValues.resolveBody(off.body!!, item))
    val noSelling = screen(spec, emptyMap(), channelState(sells = false))
    val disabled = toggle["disabled"]!!.let { (it as JsonPrimitive).content }
    assertTrue(ScreenValues.condition(disabled, ScreenContext.with(noSelling.context, "item", json("""{"id":"meta"}"""))), "a feed cannot be turned on without commerce")
    assertFalse(ScreenValues.condition(disabled, ScreenContext.with(model.context, "item", json("""{"id":"meta"}"""))))
  }

  @Test
  fun aSalesChannelOffersItsFeedActionsAndTheConnectionWhenTheDeploymentHasOne() {
    val spec = spec("sales-channels", "sales-channels.channel")
    fun channel(id: String, state: String) = screen(spec, mapOf("channel" to id), state)
    val off = channel("google", channelState())
    assertEquals(listOf("on"), off.actionsShown("manage"))
    assertEquals(json("""{"hostId":"h1","channel":"google","enabled":true}"""), off.body(off.action("manage", "on")))
    val on = channel("google", channelState(google = "true"))
    assertEquals(listOf("copy", "rotate", "off"), on.actionsShown("manage"))
    assertEquals("https://shop.test/feed/google/t.xml", ScreenValues.render(on.action("manage", "copy").copy!!, on.context))
    assertEquals("/api/sales-channels/rotate", on.action("manage", "rotate").url)
    assertTrue("legacy" in on.shown() && "legacyOff" in on.shown(), "the earlier Merchant Center address can be turned off")
    assertTrue("legacy" !in channel("meta", channelState(google = "true")).shown(), "only Google had an earlier address")
    assertEquals(listOf("steps", "help"), off.shown().filter { it == "steps" || it == "help" })
    assertTrue("connection" !in on.shown() && "sync" !in on.shown(), "no connection block on a deployment without the channel API")

    val connected = channel(
      "google",
      channelState(google = "true", extra = ""","connect":{"providers":[{"provider":"google","connection":{"provider":"google","targetId":"t1","targetName":"Acme MC","targets":[{"id":"t1","name":"Acme MC"},{"id":"t2","name":"Other"}],"connectedAtMs":1,"lastSyncAtMs":2,"lastSyncResult":{"sent":9,"failed":1,"errors":["Bad price","No image"]}}}]}"""),
    )
    assertEquals(listOf("target", "syncNow", "reconnect", "disconnect"), connected.actionsShown("sync"))
    assertEquals("Acme MC", ScreenValues.render("{data.state.connect.providers[provider=params.channel].connection.targetName}", connected.context))
    assertEquals("Bad price, No image", ScreenValues.render("{data.state.connect.providers[provider=params.channel].connection.lastSyncResult.errors}", connected.context))
    assertEquals(json("""{"hostId":"h1","provider":"google","targetId":"t2"}"""), connected.body(connected.action("sync", "target"), """{"targetId":"t2"}"""))
    val fresh = channel("google", channelState(extra = ""","connect":{"providers":[{"provider":"google","connection":null}]}"""))
    assertEquals(listOf("connect"), fresh.actionsShown("sync"))
    assertEquals("authorizeUrl", fresh.action("sync", "connect").openUrl)
    assertEquals(json("""{"hostId":"h1","provider":"google","returnTo":"/"}"""), fresh.body(fresh.action("sync", "connect")))
    assertEquals("Google Merchant Center", ScreenValues.render("{const.channels[id=params.channel].service}", fresh.context))
    assertTrue("connection" !in channel("meta", channelState(extra = ""","connect":{"providers":[{"provider":"google","connection":null}]}""")).shown(), "Meta has no connection entry here")
  }

  @Test
  fun theCatalogCheckListsEachChannelAndItsProductsIssues() {
    val diag = """{"diag":{"offers":12,"partial":false,"store":["No address."],"channels":[
      {"channel":"google","listed":10,"excluded":2,"warned":1,"truncated":false,"products":[{"productId":"p1","productName":"Mug","offers":1,"excludedOffers":1,"issues":[{"field":"gtin","severity":"error","message":"Barcode missing"},{"field":"image","severity":"warning","message":"Image small"}]}]},
      {"channel":"meta","listed":12,"excluded":0,"warned":0,"truncated":false,"products":[]}]}}"""
    val overview = screen(spec("sales-channels", "sales-channels.diagnostics"), emptyMap(), diag)
    assertEquals(listOf("summary", "store", "channels"), overview.shown())
    val detail = screen(spec("sales-channels", "sales-channels.diagnosticsChannel"), mapOf("channel" to "google"), diag)
    assertEquals(listOf("summary", "products"), detail.shown())
    val row = ScreenContext.with(detail.context, "item", detail.context.jsonObject["data"]!!.jsonObject["diag"]!!.jsonObject["channels"]!!.jsonArray[0].jsonObject["products"]!!.jsonArray[0])
    assertEquals("Barcode missing, Image small", ScreenValues.render(detail.spec.blocks.first { it.id == "products" }.string("secondary")!!, row))
    assertEquals("Google", ScreenValues.render(detail.spec.title, detail.context))
    assertEquals("1", ScreenValues.render("{data.diag.channels[channel=params.channel].excluded:number}".replace("excluded", "warned"), detail.context))
  }

  // ---- marketplaces ------------------------------------------------------------------------------------------------

  private fun marketplaceConn(id: String, status: String, mode: String = "link", extra: String = "") =
    """{"id":"h1_$id","marketplace":"$id","hostId":"h1","status":"$status","sandbox":false,"accountName":"Acme Store",
       "settings":{"listingMode":"$mode","syncPrices":true,"priceAdjustPercent":5,"stockBuffer":2,"untrackedQuantity":10,"importOrders":true,"confirmShipments":true,"marketplaceId":"ATVPDKIKX0DER"},
       "sites":[{"id":"ATVPDKIKX0DER","name":"Amazon.com","currency":"USD"},{"id":"A2EUQ1WTGCTBG2","name":"Amazon.ca","currency":"CAD"}],
       "listings":{"syncedAtMs":1,"offers":8,"updated":3,"created":1,"unchanged":3,"notListed":1,"failed":0},
       "orders":{"imported":4,"skipped":0,"lastImportedAtMs":1},"shipments":{"confirmed":3,"failed":0},"lastError":null,"connectedAtMs":1$extra}"""

  private fun marketplace(id: String, connections: String) =
    screen(spec("marketplaces", "marketplaces.marketplace"), mapOf("marketplace" to id),
      """{"conn":{"offered":[{"id":"amazon","sandbox":true},{"id":"faire","sandbox":false}],"connections":$connections},"activity":{"entries":[{"id":"1","atMs":1,"kind":"order_imported","message":"Order 1"}],"problems":[{"offerId":"o1","sku":"MUG","title":"Mug","outcome":"failed","message":"Bad price","atMs":1}]}}""")

  @Test
  fun marketplacesListWhatIsOfferedOrConnected() {
    val spec = spec("marketplaces", "marketplaces.service")
    val model = screen(spec, emptyMap(), """{"conn":{"offered":[{"id":"amazon","sandbox":false}],"connections":[${marketplaceConn("etsy", "paused")}]}}""")
    val filter = spec.blocks.first { it.id == "marketplaces" }.string("filter")!!
    fun shown(id: String) = ScreenValues.condition(filter, ScreenContext.with(model.context, "item", json("""{"id":"$id"}""")))
    assertTrue(shown("amazon") && shown("etsy"))
    assertFalse(shown("ebay") || shown("faire"))
  }

  @Test
  fun aMarketplaceOffersTheActionsItsStatusAllowsAndTheSettingsItsListingModeNeeds() {
    assertEquals(listOf("connect"), marketplace("amazon", "[]").actionsShown("manage"))
    assertEquals(listOf("hint", "sandbox", "manage"), marketplace("amazon", "[]").shown())
    assertEquals(listOf("hint", "manage"), marketplace("faire", "[]").shown())
    val active = marketplace("amazon", "[${marketplaceConn("amazon", "active")}]")
    assertEquals(listOf("sync", "pause", "disconnect"), active.actionsShown("manage"))
    assertTrue(listOf("status", "settings", "problems", "activity").all { it in active.shown() })
    assertEquals(listOf("resume", "disconnect"), marketplace("amazon", "[${marketplaceConn("amazon", "paused")}]").actionsShown("manage"))
    val reconnect = marketplace("amazon", "[${marketplaceConn("amazon", "reconnect", extra = ",\"lastError\":\"Refused\"")}]")
    assertEquals(listOf("reconnect", "disconnect"), reconnect.actionsShown("manage"))
    assertTrue("settings" !in reconnect.shown() && "failing" in reconnect.shown())
    assertEquals(json("""{"hostId":"h1","marketplace":"amazon","paused":true}"""), active.body(active.action("manage", "pause")))
    assertEquals("PATCH", active.action("manage", "pause").method.name)
    assertEquals("DELETE", active.action("manage", "disconnect").method.name)
    assertEquals(json("""{"hostId":"h1","marketplace":"amazon","returnTo":"/"}"""), marketplace("amazon", "[]").body(marketplace("amazon", "[]").action("manage", "connect")))
    assertEquals("url", marketplace("amazon", "[]").action("manage", "connect").openUrl)

    // The settings form: Amazon picks its marketplace and may publish; Faire can do neither, and sends no prices.
    fun fieldsShown(model: ScreenModel) = model.spec.blocks.first { it.id == "settings" }.raw.jsonObject["fields"]!!.jsonArray.mapNotNull { FieldSpec.parse(it) }
      .filter { ScreenValues.condition(it.whenCondition, model.context) }.map { it.key }
    assertEquals(
      listOf("marketplaceId", "importOrders", "confirmShipments", "listingMode", "stockBuffer", "untrackedQuantity", "syncPrices", "priceAdjustPercent"),
      fieldsShown(active),
    )
    val faire = marketplace("faire", "[${marketplaceConn("faire", "active")}]")
    assertEquals(listOf("importOrders", "confirmShipments", "listingModeBasic", "stockBuffer", "untrackedQuantity"), fieldsShown(faire))
    assertTrue("faire" in faire.shown(), "Faire says only stock is sent")
    val off = marketplace("amazon", "[${marketplaceConn("amazon", "active", mode = "off")}]")
    assertEquals(listOf("marketplaceId", "importOrders", "confirmShipments", "listingMode"), fieldsShown(off))
    assertEquals(
      json("""{"hostId":"h1","marketplace":"amazon","marketplaceId":"A2EUQ1WTGCTBG2","importOrders":true,"confirmShipments":false,"listingMode":"publish","stockBuffer":3,"untrackedQuantity":10,"syncPrices":true,"priceAdjustPercent":-5}"""),
      active.body(active.form("settings"), """{"marketplaceId":"A2EUQ1WTGCTBG2","importOrders":true,"confirmShipments":false,"listingMode":"publish","stockBuffer":3,"untrackedQuantity":10,"syncPrices":true,"priceAdjustPercent":-5}"""),
    )
    assertEquals(
      json("""{"hostId":"h1","marketplace":"faire","importOrders":true,"confirmShipments":true,"listingMode":"link","stockBuffer":1}"""),
      faire.body(faire.form("settings"), """{"importOrders":true,"confirmShipments":true,"listingModeBasic":"link","stockBuffer":1}"""),
    )
    val modes = FieldSpec.parse(active.spec.blocks.first { it.id == "settings" }.raw.jsonObject["fields"]!!.jsonArray.first { it.jsonObject["key"]!!.let { k -> (k as JsonPrimitive).content } == "listingMode" })!!
    assertEquals(listOf("off", "link", "publish"), modes.choices(active.context).map { it.first })
    assertEquals(listOf("ATVPDKIKX0DER", "A2EUQ1WTGCTBG2"), FieldSpec.parse(active.spec.blocks.first { it.id == "settings" }.raw.jsonObject["fields"]!!.jsonArray[0])!!.choices(active.context).map { it.first })
  }

  // ---- print on demand ---------------------------------------------------------------------------------------------

  private val podProviders = """[{"id":"printful","label":"Printful","tokenHelp":{"label":"token","url":"https://x","steps":"Make a token."}},{"id":"printify","label":"Printify","tokenHelp":{"label":"token","url":"https://y","steps":"Make a Printify token."}}]"""
  private fun podConnection(provider: String, currency: String = "USD", extra: String = "") =
    """{"provider":"$provider","providerLabel":"${provider.replaceFirstChar { it.uppercase() }}","storeId":"1","storeName":"Acme","currency":"$currency","submitMode":"review","syncPrices":false,
       "webhooks":"polling","webhookDetail":null,"lastError":null,"connectedAtMs":1760000000000,"updatedAtMs":1$extra}"""
  private fun pod(connections: String, available: Boolean = true) =
    screen(spec("print-on-demand", "print-on-demand.service"), emptyMap(), """{"conn":{"available":$available,"storeCurrency":"USD","providers":$podProviders,"connections":$connections}}""")

  @Test
  fun printOnDemandOffersToConnectOnlyTheServicesNotYetConnected() {
    assertEquals(listOf("unavailable"), pod("[]", available = false).shown())
    val bare = pod("[]")
    assertEquals(listOf("intro", "connect"), bare.shown())
    assertEquals(listOf("connectPrintful", "connectPrintify", "storesPrintful", "storesPrintify"), bare.actionsShown("connect"))
    val connect = bare.action("connect", "connectPrintful")
    assertEquals("/api/print-on-demand/connect", connect.url)
    assertEquals(json("""{"hostId":"h1","provider":"printful","token":"tok","storeId":"7"}"""), bare.body(connect, """{"token":"tok","storeId":"7"}"""))
    assertEquals("Make a token. Kept encrypted and used only for this site; Aglyn never asks for your Printful password.", ScreenValues.render(connect.prompt.first().help!!, bare.context))
    val one = pod("[${podConnection("printful")}]")
    assertEquals(listOf("connections", "connect", "lists"), one.shown())
    assertEquals(listOf("connectPrintify", "storesPrintify"), one.actionsShown("connect"))
    val stores = bare.action("connect", "storesPrintify")
    assertEquals("Shops: Main, Spare. Ids in the same order: 1, 2.", ScreenValues.render(stores.success!!, ScreenContext.with(bare.context, "response", json("""{"stores":[{"id":"1","name":"Main"},{"id":"2","name":"Spare"}]}"""))))
  }

  @Test
  fun aPrintOnDemandConnectionSavesItsSettingsAndWarnsOnACurrencyMismatch() {
    val spec = spec("print-on-demand", "print-on-demand.connection")
    fun connection(currency: String) = screen(spec, mapOf("provider" to "printful"), """{"conn":{"available":true,"storeCurrency":"USD","providers":$podProviders,"connections":[${podConnection("printful", currency)}]}}""")
    assertEquals(listOf("status", "import", "settings", "manage"), connection("USD").shown())
    assertEquals(listOf("currency", "status", "import", "settings", "manage"), connection("EUR").shown())
    val model = connection("USD")
    assertEquals(json("""{"hostId":"h1","provider":"printful","submitMode":"automatic","syncPrices":true}"""), model.body(model.form("settings"), """{"submitMode":"automatic","syncPrices":true}"""))
    assertTrue(model.action("manage", "disconnect").back)
    assertEquals("Printful — Acme", ScreenValues.render(model.spec.blocks.first { it.id == "status" }.title!!, model.context))
  }

  @Test
  fun theCatalogImportsOneProductAtATimeAndPagesByCursor() {
    val spec = spec("print-on-demand", "print-on-demand.catalog")
    val load = spec.loads.first { it.key == "catalog" }
    assertEquals("nextCursor", load.cursor)
    assertEquals("products", load.items)
    val model = screen(spec, mapOf("provider" to "printify"), """{"catalog":{"products":[{"id":"p1","name":"Mug","thumbnailUrl":null,"variantCount":3,"importedProductId":null}],"nextCursor":"c2"},"conn":{"storeCurrency":"USD","connections":[{"provider":"printify","currency":"USD"}]}}""")
    assertEquals(listOf("intro", "products"), model.shown())
    assertEquals("/api/print-on-demand/catalog?hostId=h1&provider=printify", ScreenValues.renderUrl(load.url, model.context))
    val list = model.spec.blocks.first { it.id == "products" }
    val action = list.raw.jsonObject["actions"]!!.jsonArray.mapNotNull { ActionSpec.parse(it) }.first()
    val item = ScreenContext.with(ScreenContext.with(model.context, "item", json("""{"id":"p1","name":"Mug"}""")), "form", json("""{"status":"active","content":false}"""))
    assertEquals(json("""{"hostId":"h1","provider":"printify","productIds":["p1"],"status":"active","content":false}"""), ScreenValues.resolveBody(action.body!!, item))
    val mismatch = screen(spec, mapOf("provider" to "printify"), """{"catalog":{"products":[]},"conn":{"storeCurrency":"USD","connections":[{"provider":"printify","currency":"EUR"}]}}""")
    assertTrue("currency" in mismatch.shown())
  }

  @Test
  fun importedProductsAndSentOrdersPageByTheAfterCursor() {
    val imported = spec("print-on-demand", "print-on-demand.imported")
    val load = imported.loads.first { it.key == "links" }
    assertEquals("after", load.cursorParam)
    assertEquals("next", load.cursor)
    val model = screen(imported, emptyMap(), """{"links":{"links":[{"id":"printful__p1","provider":"printful","providerLabel":"Printful","sourceProductId":"s1","name":"Mug","variants":[{},{}],"syncedAtMs":1760000000000,"lastError":null}],"next":null}}""")
    val row = ScreenContext.with(model.context, "item", model.context.jsonObject["data"]!!.jsonObject["links"]!!.jsonObject["links"]!!.jsonArray[0])
    assertEquals("2 variants · updated Oct 9, 2025", ScreenValues.render(imported.blocks.first { it.id == "links" }.string("secondary")!!, row))
    val unlink = imported.blocks.first { it.id == "links" }.raw.jsonObject["actions"]!!.jsonArray.mapNotNull { ActionSpec.parse(it) }.first { it.id == "unlink" }
    assertEquals(json("""{"hostId":"h1","linkId":"printful__p1"}"""), ScreenValues.resolveBody(unlink.body!!, row))
    val resync = imported.blocks.first { it.id == "links" }.raw.jsonObject["actions"]!!.jsonArray.mapNotNull { ActionSpec.parse(it) }.first { it.id == "resync" }
    assertEquals(json("""{"hostId":"h1","provider":"printful","productIds":["s1"],"content":true}"""), ScreenValues.resolveBody(resync.body!!, row))

    val orders = spec("print-on-demand", "print-on-demand.orders")
    val order = screen(orders, emptyMap(), """{"parts":{"parts":[{"id":"o1","orderRef":"#1042","providerLabel":"Printify","status":"in_production","testMode":true,"lines":[{"name":"Mug","quantity":2}],"retailMinor":4000,"retailCurrency":"USD","lastError":null,"createdAtMs":1760000000000}],"next":"n"}}""")
    val part = ScreenContext.with(order.context, "item", order.context.jsonObject["data"]!!.jsonObject["parts"]!!.jsonObject["parts"]!!.jsonArray[0])
    assertEquals("Order #1042 · Printify", ScreenValues.render(orders.blocks.first { it.id == "parts" }.string("primary")!!, part))
    assertEquals("Mug", ScreenValues.render(orders.blocks.first { it.id == "parts" }.string("secondary")!!, part))
    assertEquals("In production", ScreenValues.render("{const.statuses[id=item.status].label}", part))
  }
}
