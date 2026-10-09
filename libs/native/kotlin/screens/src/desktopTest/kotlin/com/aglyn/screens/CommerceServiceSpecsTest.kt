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
}
