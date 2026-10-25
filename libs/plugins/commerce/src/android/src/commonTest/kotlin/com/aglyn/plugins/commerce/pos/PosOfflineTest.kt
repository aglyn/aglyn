package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.OrderTotals
import com.aglyn.contracts.PosOfflineFlag
import com.aglyn.contracts.PosOfflineKit
import com.aglyn.contracts.PosOfflineKitRegister
import com.aglyn.contracts.PosOfflineOutcomeStatus
import com.aglyn.contracts.PosOfflineRefusal
import com.aglyn.contracts.PosOfflineSale
import com.aglyn.contracts.PosOfflineSaleCustomer
import com.aglyn.contracts.PosOfflineSaleLine
import com.aglyn.contracts.PosOfflineSaleOutcome
import com.aglyn.contracts.PosOfflineStockConflict
import com.aglyn.contracts.posOfflineSaleKeyIsValid
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.InMemoryKeyValueStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val KIT_JSON = """{"v":1,"hostId":"h1","orgId":"org1","issuedAtMs":1700000000000,"available":true,"tax":{"pct":8,"pricesIncludeTax":false},"maxDiscountPct":20,"requireOpenShift":false,"registers":[{"id":"r1","name":"Front","locationId":"loc1","openShiftId":"s9"}],"receipt":{"name":"Corner Cafe"}}"""

private fun makeKit(patch: (PosOfflineKit) -> PosOfflineKit = { it }): PosOfflineKit =
  patch(ContractJsonFormat.decodeFromString(PosOfflineKit.serializer(), KIT_JSON))

private fun cart(discount: Int = 0, customer: PosCustomer? = null): Cart {
  var cart = Cart.EMPTY
    .add(CartPick("p1", "v1", "Latte", "Large", emptyList(), 450), 2)
    .add(CartPick("p2", null, "Muffin", null, emptyList(), 300), 1)
  cart = cart.withDiscount(discount.toDouble())
  return cart.withCustomer(customer)
}

private fun sampleSale(key: String, soldAtMs: Double = 1_700_000_000_000.0) = PosOfflineSale(
  cashTenderedCents = 1000.0, changeCents = 100.0, discountPct = 0.0, hostId = "h1",
  lines = listOf(PosOfflineSaleLine(name = "Mug", productId = "p1", quantity = 1.0, unitAmountCents = 900.0)),
  orgId = "org1", registerId = "r1", saleKey = key, signedInUid = "u1", soldAtMs = soldAtMs, totals = OrderTotals(totalCents = 900.0), v = 1,
)

private class FakeOfflineApi : PosOfflineApi {
  val batches = mutableListOf<List<String>>()
  var kitAnswer: PosOfflineKit? = makeKit()
  var failure: ConsoleApiError? = null
  val answers = mutableMapOf<String, PosOfflineSaleOutcome>()

  override suspend fun kit(): PosOfflineKit {
    failure?.let { throw it }
    return kitAnswer!!
  }

  override suspend fun sync(sales: List<com.aglyn.contracts.PosOfflineSale>): List<PosOfflineSaleOutcome> {
    batches += sales.map { it.saleKey }
    failure?.let { throw it }
    return sales.map { answers[it.saleKey] ?: PosOfflineSaleOutcome(number = 7.0, orderId = it.saleKey, saleKey = it.saleKey, status = PosOfflineOutcomeStatus.RECORDED) }
  }
}

private fun model(
  api: FakeOfflineApi,
  device: InMemoryKeyValueStore,
  scope: kotlinx.coroutines.CoroutineScope,
  uid: String = "u1",
  shift: String? = null,
  keys: List<String> = emptyList(),
  clock: () -> Long = { 1_700_000_100_000 },
): PosOfflineModel {
  val minted = ArrayDeque(keys)
  return PosOfflineModel(
    api, PosOfflineDeviceStore(device, "$uid:h1"), uid, scope, { "r1" }, { "loc1" }, { shift }, { "cashier-1" }, clock,
    { minted.removeFirstOrNull() ?: newPosOfflineSaleKey() },
  )
}

class PosOfflineStoreTest {
  @Test
  fun aSaleIsHeldForTheMemberAndSiteThatRangItAndNobodyElse() {
    val device = InMemoryKeyValueStore()
    val mine = PosOfflineDeviceStore(device, "u1:h1")
    assertTrue(mine.put(PosOfflineQueued(sampleSale("off11111111111111111111"), queuedAtMs = 1)))
    assertEquals(listOf("off11111111111111111111"), mine.queue().map { it.id })
    assertTrue(PosOfflineDeviceStore(device, "u2:h1").queue().isEmpty())
    assertTrue(PosOfflineDeviceStore(device, "u1:h2").queue().isEmpty())
    mine.remove("off11111111111111111111")
    assertTrue(mine.queue().isEmpty())
  }

  @Test
  fun salesAreKeptOldestFirstAndPuttingTwiceReplacesNotDuplicates() {
    val store = PosOfflineDeviceStore(InMemoryKeyValueStore(), "u1:h1")
    val later = sampleSale("off22222222222222222222", 2_000.0)
    val earlier = sampleSale("off11111111111111111111", 1_000.0)
    store.put(PosOfflineQueued(later, queuedAtMs = 2))
    store.put(PosOfflineQueued(earlier, queuedAtMs = 1))
    store.put(PosOfflineQueued(earlier, PosOfflineQueued.State.REFUSED, queuedAtMs = 1, attempts = 3, error = "x", reason = PosOfflineRefusal.INVALID))
    assertEquals(listOf("off11111111111111111111", "off22222222222222222222"), store.queue().map { it.id })
    assertEquals(PosOfflineQueued.State.REFUSED, store.queue().first().state)
    assertEquals(PosOfflineRefusal.INVALID, store.queue().first().reason)
  }

  @Test
  fun theKitSurvivesARestart() {
    val device = InMemoryKeyValueStore()
    PosOfflineDeviceStore(device, "u1:h1").saveKit(makeKit())
    assertEquals("org1", PosOfflineDeviceStore(device, "u1:h1").loadKit()?.orgId)
    assertNull(PosOfflineDeviceStore(device, "u2:h1").loadKit())
  }

  @Test
  fun aMintedKeyIsOneTheServerTakes() {
    repeat(20) { assertTrue(posOfflineSaleKeyIsValid(newPosOfflineSaleKey())) }
  }
}

class PosOfflineModelTest {
  private suspend fun ready(api: FakeOfflineApi, device: InMemoryKeyValueStore, scope: kotlinx.coroutines.CoroutineScope, keys: List<String> = emptyList(), shift: String? = null): PosOfflineModel =
    model(api, device, scope, shift = shift, keys = keys).also { it.refreshKit() }

  @Test
  fun nothingSellsUntilTheRegisterHasHeardFromTheServerOnce() = runTest {
    val offline = model(FakeOfflineApi(), InMemoryKeyValueStore(), this)
    assertEquals("Connect once so the register can get ready to sell offline.", offline.unavailableReason)
    assertFalse(offline.ready)
    assertNull(offline.totals(cart()))
    assertNull(offline.ringCashSale(cart(), 5000))
  }

  @Test
  fun theKitIsKeptAndTheSiteMayForbidOfflineSelling() = runTest {
    val device = InMemoryKeyValueStore()
    val api = FakeOfflineApi().apply { kitAnswer = makeKit { it.copy(available = false, unavailableReason = "Set your store's tax rate first.") } }
    val offline = ready(api, device, this)
    assertEquals("Set your store's tax rate first.", offline.unavailableReason)
    // Restarted, the register still knows what it was told.
    assertEquals(false, model(FakeOfflineApi(), device, this).kit?.available)
  }

  @Test
  fun aSiteThatRequiresAShiftNeedsOneOpenBeforeGoingOffline() = runTest {
    val api = FakeOfflineApi().apply { kitAnswer = makeKit { it.copy(requireOpenShift = true, registers = listOf(PosOfflineKitRegister(id = "r1", name = "Front"))) } }
    assertEquals("Open a shift before going offline: this site requires one for every sale.", ready(api, InMemoryKeyValueStore(), this).unavailableReason)
    assertNull(ready(api, InMemoryKeyValueStore(), this, shift = "s1").unavailableReason)
  }

  @Test
  fun theBasketIsPricedFromItsOwnPricesAndTheStoresTaxRate() = runTest {
    val offline = ready(FakeOfflineApi(), InMemoryKeyValueStore(), this)
    val totals = offline.totals(cart())
    // (2 x 450 + 300) = 1200; 8% of 1200 = 96.
    assertEquals(1200.0, totals?.itemsCents)
    assertEquals(96.0, totals?.taxCents)
    assertEquals(1296.0, totals?.totalCents)
    val discounted = offline.totals(cart(discount = 10))
    assertEquals(120.0, discounted?.discountCents)
    assertEquals(86.0, discounted?.taxCents)
    assertEquals(1166.0, discounted?.totalCents)
  }

  @Test
  fun aCashSaleIsQueuedWithTheKeyTheCashierTheShiftAndTheChange() = runTest {
    val device = InMemoryKeyValueStore()
    val offline = ready(FakeOfflineApi(), device, this, keys = listOf("off0123456789abcdef0123"))
    val customer = PosCustomer("contact", "c1", "Ana", "ana@shop.co", null)
    val rung = offline.ringCashSale(cart(customer = customer), 2000)
    assertNotNull(rung)
    val sale = rung.sale
    assertEquals("off0123456789abcdef0123", sale.saleKey)
    assertEquals("h1", sale.hostId)
    assertEquals("org1", sale.orgId)
    assertEquals("u1", sale.signedInUid)
    assertEquals("r1", sale.registerId)
    assertEquals("s9", sale.shiftId, "the kit's open shift stands in when the register has not read its own")
    assertEquals("loc1", sale.locationId)
    assertEquals("cashier-1", sale.cashierAssertion)
    assertEquals(1_700_000_100_000.0, sale.soldAtMs)
    assertEquals(2000.0, sale.cashTenderedCents)
    assertEquals(704.0, sale.changeCents)
    assertEquals(704L, rung.changeCents)
    assertEquals(listOf("p1", "p2"), sale.lines.map { it.productId })
    assertEquals(2.0, sale.lines[0].quantity)
    assertEquals(450.0, sale.lines[0].unitAmountCents)
    assertEquals("v1", sale.lines[0].variantId)
    assertEquals("Large", sale.lines[0].variantLabel)
    assertEquals("ana@shop.co", sale.customer?.email)
    assertEquals("contact", sale.customer?.kind)
    assertEquals("c1", sale.customer?.id)
    assertEquals(1296.0, sale.totals.totalCents)
    assertTrue(rung.hasCustomerEmail)
    // The device holds it, scoped to this member and site.
    assertEquals(listOf("off0123456789abcdef0123"), offline.waiting.map { it.id })
    assertEquals(1, PosOfflineDeviceStore(device, "u1:h1").queue().size)
  }

  @Test
  fun anEmailTypedForTheReceiptRidesWithoutARecordBehindIt() = runTest {
    val offline = ready(FakeOfflineApi(), InMemoryKeyValueStore(), this)
    val rung = offline.ringCashSale(cart(customer = PosCustomer.typed("buyer@shop.co")), 1296)
    assertEquals("buyer@shop.co", rung?.sale?.customer?.email)
    assertNull(rung?.sale?.customer?.kind)
    assertNull(rung?.sale?.customer?.id)
  }

  @Test
  fun noCashIsTakenForASaleTheDeviceCannotKeepOrTheTillMayNotRing() = runTest {
    val offline = ready(FakeOfflineApi(), InMemoryKeyValueStore(), this)
    assertNull(offline.ringCashSale(cart(), 1295), "offline takes the whole total in cash")
    assertNull(offline.ringCashSale(cart(discount = 25), 5000), "above the site's discount ceiling")
    assertTrue(offline.discountOverLimit(cart(discount = 25)))
    assertNull(offline.ringCashSale(Cart.EMPTY, 5000))
    assertTrue(offline.waiting.isEmpty())
  }

  @Test
  fun aSaleLeavesTheDeviceOnlyWhenTheServerHasAnsweredForIt() = runTest {
    val api = FakeOfflineApi()
    val offline = ready(api, InMemoryKeyValueStore(), this, keys = listOf("off0123456789abcdef0001", "off0123456789abcdef0002"))
    offline.ringCashSale(cart(), 1296)
    offline.ringCashSale(cart(), 1296)
    api.answers["off0123456789abcdef0002"] = PosOfflineSaleOutcome(
      flags = listOf(PosOfflineFlag.PRICE_CHANGED, PosOfflineFlag.STOCK_SHORT), number = 41.0, orderId = "off0123456789abcdef0002",
      saleKey = "off0123456789abcdef0002", status = PosOfflineOutcomeStatus.REPLAYED,
      stockConflicts = listOf(PosOfflineStockConflict(applied = 1.0, name = "Latte — Large", productId = "p1", requested = 2.0, shortUnits = 1.0)),
    )
    offline.sync()
    assertEquals(listOf(listOf("off0123456789abcdef0001", "off0123456789abcdef0002")), api.batches)
    assertTrue(offline.queue.isEmpty())
    assertEquals(1, offline.notices.size)
    assertEquals(41L, offline.notices[0].number)
    assertEquals("1 of 2× Latte — Large not in stock", offline.notices[0].lines.first())
    assertTrue(Contracts.posOfflineFlagLabels["price-changed"]!! in offline.notices[0].lines)
    offline.dismissNotices()
    assertTrue(offline.notices.isEmpty())
  }

  @Test
  fun aTransientFailureStaysQueuedAndEveryOtherRefusalWaitsForTheCashier() = runTest {
    val api = FakeOfflineApi()
    val offline = ready(api, InMemoryKeyValueStore(), this, keys = listOf("off0123456789abcdef0001", "off0123456789abcdef0002", "off0123456789abcdef0003"))
    repeat(3) { offline.ringCashSale(cart(), 1296) }
    api.answers["off0123456789abcdef0001"] = PosOfflineSaleOutcome(error = "Try again", reason = PosOfflineRefusal.FAILED, retry = true, saleKey = "off0123456789abcdef0001", status = PosOfflineOutcomeStatus.REFUSED)
    api.answers["off0123456789abcdef0002"] = PosOfflineSaleOutcome(error = "A line of the sale cannot be read", reason = PosOfflineRefusal.INVALID, retry = false, saleKey = "off0123456789abcdef0002", status = PosOfflineOutcomeStatus.REFUSED)
    api.answers["off0123456789abcdef0003"] = PosOfflineSaleOutcome(error = "Signed for another member", reason = PosOfflineRefusal.WRONG_STAFF, saleKey = "off0123456789abcdef0003", status = PosOfflineOutcomeStatus.REFUSED)
    offline.sync()
    assertEquals(3, offline.queue.size)
    assertEquals(listOf("off0123456789abcdef0001", "off0123456789abcdef0003"), offline.waiting.map { it.id })
    assertEquals(listOf("off0123456789abcdef0002"), offline.refused.map { it.id })
    assertEquals("A line of the sale cannot be read", offline.refused[0].error)
    assertEquals(listOf(1, 1, 1), offline.queue.map { it.attempts })
    offline.discard("off0123456789abcdef0002")
    assertTrue(offline.refused.isEmpty())
  }

  @Test
  fun aLostConnectionLeavesTheQueueAsItWasAndTellsTheRegister() = runTest {
    val api = FakeOfflineApi()
    val offline = ready(api, InMemoryKeyValueStore(), this)
    offline.ringCashSale(cart(), 1296)
    val calls = mutableListOf<Boolean>()
    offline.networkSink = { calls += it }
    api.failure = ConsoleApiError("could not be reached", 0, null)
    offline.sync()
    assertEquals(1, offline.waiting.size)
    assertEquals(listOf(true), calls)
    assertNull(offline.syncError)
  }

  @Test
  fun aServerRefusalOfTheWholeSyncIsShownAndTheSalesStayPut() = runTest {
    val api = FakeOfflineApi()
    val offline = ready(api, InMemoryKeyValueStore(), this)
    offline.ringCashSale(cart(), 1296)
    api.failure = ConsoleApiError("Your plan does not include the register.", 403, null)
    offline.sync()
    assertEquals("Your plan does not include the register.", offline.syncError)
    assertEquals(1, offline.waiting.size)
  }

  @Test
  fun onlyTheSalesTheSignedInMemberRangAreSent() = runTest {
    val device = InMemoryKeyValueStore()
    val api = FakeOfflineApi()
    ready(api, device, this, keys = listOf("off0123456789abcdef0009")).ringCashSale(cart(), 1296)
    // Another member on the same device shares the device store but not the scope.
    model(api, device, this, uid = "u2").sync()
    assertTrue(api.batches.isEmpty())
  }

  @Test
  fun aLongQueueGoesInBatchesOfTheRoutesMaximum() = runTest {
    val api = FakeOfflineApi()
    val offline = ready(api, InMemoryKeyValueStore(), this, keys = (0 until 30).map { "off0123456789abcdef${it.toString().padStart(4, '0')}" })
    repeat(30) { offline.ringCashSale(cart(), 1296) }
    offline.sync()
    val max = Contracts.posOfflineSyncBatchMax.toInt()
    assertEquals(listOf(max, 30 - max), api.batches.map { it.size })
    assertTrue(offline.queue.isEmpty())
  }

  @Test
  fun theKitIsRefreshedWhenStaleAndNotBefore() = runTest {
    var ms = 1_700_000_000_000L
    val offline = model(FakeOfflineApi(), InMemoryKeyValueStore(), this, clock = { ms })
    assertTrue(offline.kitIsStale)
    offline.refreshKit()
    assertFalse(offline.kitIsStale)
    ms += POS_OFFLINE_KIT_REFRESH_MS + 1
    assertTrue(offline.kitIsStale)
  }

  @Test
  fun anOfflineReceiptCarriesTheStoreTheLinesTheCashAndTheChange() = runTest {
    val offline = ready(FakeOfflineApi(), InMemoryKeyValueStore(), this)
    val rung = offline.ringCashSale(cart(), 2000)!!
    val receipt = offlineReceipt(rung, offline.kit, "Front", "Ana", "usd", "UTC")
    assertEquals("Corner Cafe", receipt.storeName)
    assertEquals(rung.sale.saleKey, receipt.barcode)
    assertEquals(listOf("Latte", "Muffin"), receipt.lines.map { it.name })
    assertEquals(900.0, receipt.lines[0].totalCents)
    assertEquals(1296.0, receipt.totalCents)
    assertEquals(2000.0, receipt.tenders?.single()?.amountCents)
    assertEquals(704.0, receipt.changeCents)
    assertEquals(listOf(1296L, 1500L, 2000L), offlineQuickAmounts(1296).take(3), "exact, then the next round amounts")
  }
}

class ConsolePosOfflineApiTest {
  private val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")

  private class Seen(val method: HttpMethod, val path: String, val query: String, val body: JsonObject?)

  private fun api(seen: MutableList<Seen>, answer: String): ConsolePosOfflineApi {
    val engine = MockEngine { request ->
      val raw = request.body.toByteArray().decodeToString()
      seen += Seen(request.method, request.url.encodedPath, request.url.encodedQuery, raw.takeIf { it.isNotBlank() }?.let { Json.parseToJsonElement(it).jsonObject })
      respond(answer, HttpStatusCode.OK, jsonHeaders)
    }
    return ConsolePosOfflineApi(ConsoleApiClient("https://console.test", HttpClient(engine), { "token" }, maxAttempts = 1), "h1")
  }

  @Test
  fun theKitIsReadForTheSite() = runTest {
    val seen = mutableListOf<Seen>()
    val read = api(seen, """{"kit":$KIT_JSON}""").kit()
    assertEquals("/api/commerce/pos-offline-sync", seen.single().path)
    assertEquals("hostId=h1", seen.single().query)
    assertEquals(HttpMethod.Get, seen.single().method)
    assertEquals(8.0, read.tax.pct)
    assertEquals(20.0, read.maxDiscountPct)
    assertEquals("s9", read.registers.first().openShiftId)
  }

  @Test
  fun aSyncSendsTheSitesSalesAsTheRegisterQueuedThemAndReadsEachAnswer() = runTest {
    val seen = mutableListOf<Seen>()
    val sale = sampleSale("off0123456789abcdef0001").copy(customer = PosOfflineSaleCustomer(email = "a@b.co"), shiftId = "s1")
    val results = api(
      seen,
      """{"results":[{"saleKey":"off0123456789abcdef0001","status":"recorded","orderId":"off0123456789abcdef0001","number":12,"flags":["late-sync"]}]}""",
    ).sync(listOf(sale))
    assertEquals(HttpMethod.Post, seen.single().method)
    val body = seen.single().body!!
    assertEquals("h1", body["hostId"]!!.jsonPrimitive.content)
    val sent = body["sales"]!!.jsonArray.first().jsonObject
    assertEquals("off0123456789abcdef0001", sent["saleKey"]!!.jsonPrimitive.content)
    assertEquals("u1", sent["signedInUid"]!!.jsonPrimitive.content)
    assertEquals(1_700_000_000_000.0, sent["soldAtMs"]!!.jsonPrimitive.content.toDouble())
    assertEquals("p1", sent["lines"]!!.jsonArray.first().jsonObject["productId"]!!.jsonPrimitive.content)
    assertEquals("a@b.co", sent["customer"]!!.jsonObject["email"]!!.jsonPrimitive.content)
    assertEquals(PosOfflineOutcomeStatus.RECORDED, results.first().status)
    assertEquals(12.0, results.first().number)
    assertEquals(listOf(PosOfflineFlag.LATE_SYNC), results.first().flags)
  }

  @Test
  fun anEmptyBatchOnlyAsksWhetherTheRouteAnswers() = runTest {
    val seen = mutableListOf<Seen>()
    val results = api(seen, """{"results":[]}""").sync(emptyList())
    assertTrue(results.isEmpty())
    assertEquals(0, seen.single().body!!["sales"]!!.jsonArray.size)
  }
}

/** A card taken offline on this device's reader (AGL-4039): the Apple app's `PosOfflineCardTests`, case for case. */
class PosOfflineCardTest {
  private val key = "offcard0000000000000000001"

  private fun cardKit(available: Boolean = true, maxSale: Double = 10_000.0, maxDaily: Double = 500_000.0) = makeKit {
    it.copy(
      card = com.aglyn.contracts.PosOfflineKitCard(
        available = available, currency = "usd", destination = "acct_merchant", maxSaleCents = maxSale, maxDeviceDailyCents = maxDaily,
        unavailableReason = if (available) null else "Card sales offline are not turned on.",
      ),
    )
  }

  @Test
  fun aCardIsTakenWithinTheStoreCeilingsAndRefusedPastThem() = runTest {
    val api = FakeOfflineApi().apply { kitAnswer = cardKit() }
    val offline = model(api, InMemoryKeyValueStore(), this, keys = listOf(key))
    offline.refreshKit()
    assertNull(offline.cardRefusal(cart()))
    api.kitAnswer = cardKit(maxSale = 500.0)
    offline.refreshKit()
    assertEquals("Offline, a card sale can be up to $5.00. Take cash, or charge it when you are back online.", offline.cardRefusal(cart()))
    api.kitAnswer = makeKit()
    offline.refreshKit()
    assertEquals("Card sales offline need the register to connect once first.", offline.cardRefusal(cart()))
  }

  @Test
  fun aSaleOverTheLimitPerSaleIsRefusedBeforeTheCardIsAskedFor() = runTest {
    val api = FakeOfflineApi().apply { kitAnswer = cardKit(maxSale = 1000.0) }
    val offline = model(api, InMemoryKeyValueStore(), this, keys = listOf(key))
    offline.refreshKit()
    assertNull(offline.cardRequest(cart()), "no card request reaches the reader")
    assertEquals("Offline, a card sale can be up to $10.00. Take cash, or charge it when you are back online.", offline.cardRefusal(cart()))
  }

  @Test
  fun theRequestCarriesTheStoreLimitsForTheSdk() = runTest {
    val api = FakeOfflineApi().apply { kitAnswer = cardKit() }
    val offline = model(api, InMemoryKeyValueStore(), this, keys = listOf(key))
    offline.refreshKit()
    val request = assertNotNull(offline.cardRequest(cart()))
    assertEquals(10_000L, request.maxSaleCents)
    assertEquals(500_000L, request.maxDeviceDailyCents)
    assertEquals(0L, request.takenTodayCents)
  }

  @Test
  fun withNoLimitsSetTheRequestRunsToStripesCeilingWithNoDailyLimit() = runTest {
    val api = FakeOfflineApi().apply { kitAnswer = cardKit(maxSale = 1_000_000.0, maxDaily = 0.0) }
    val offline = model(api, InMemoryKeyValueStore(), this, keys = listOf(key))
    offline.refreshKit()
    val request = assertNotNull(offline.cardRequest(cart()))
    assertEquals(1_000_000L, request.maxSaleCents)
    assertEquals(Long.MAX_VALUE, request.maxDeviceDailyCents)
  }

  @Test
  fun theBannerNamesTheDailyLimitOnlyWhenTheStoreSetOne() {
    val money = { cents: Long -> "$" + (cents / 100) }
    assertEquals(
      "The card is saved on this register and charged when the connection returns. Offline, a card sale can be up to $10000.",
      offlineCardLimitsNote(1_000_000, 0, money),
    )
    assertEquals(
      "The card is saved on this register and charged when the connection returns. Offline, a card sale can be up to $100, and this device can take up to $5000 in cards a day.",
      offlineCardLimitsNote(10_000, 500_000, money),
    )
  }

  @Test
  fun theRequestNamesItsSaleAndTheStoreDestination() = runTest {
    val api = FakeOfflineApi().apply { kitAnswer = cardKit() }
    val offline = model(api, InMemoryKeyValueStore(), this, keys = listOf(key))
    offline.refreshKit()
    val request = assertNotNull(offline.cardRequest(cart()))
    assertEquals(key, request.saleKey)
    assertEquals("acct_merchant", request.destination)
    assertEquals(1296L, request.amountCents)
    assertEquals("pos-offline", request.metadata["kind"])
    assertNull(request.problem)
  }

  @Test
  fun aCardOnTheDeviceWaitsForItsForwardBeforeItSyncs() = runTest {
    val api = FakeOfflineApi().apply { kitAnswer = cardKit() }
    val offline = model(api, InMemoryKeyValueStore(), this)
    offline.refreshKit()
    val rung = assertNotNull(offline.ringCardSale(cart(), com.aglyn.hardware.OfflineCardTaken(key, null, "visa", "4242")))
    assertEquals(com.aglyn.contracts.PosOfflineCardForward.STORED, rung.card?.forward)
    assertEquals(1296L, offline.cardsTakenTodayCents)
    assertNotNull(offline.oldestCardOnDeviceMs)
    offline.sync()
    assertTrue(api.batches.isEmpty(), "Stripe has not got the card yet")
    val applied = offline.applyForwards(
      listOf(
        com.aglyn.hardware.OfflineCardForward(key, "pi_3Q0abcdEFGH12345", com.aglyn.hardware.OfflineCardForward.Status.AUTHORIZED),
        com.aglyn.hardware.OfflineCardForward("someone-elses-sale-0000", "pi_x", com.aglyn.hardware.OfflineCardForward.Status.AUTHORIZED),
      ),
    )
    assertEquals(setOf(key), applied)
    assertNull(offline.oldestCardOnDeviceMs, "Stripe has the card now")
    assertEquals(1296L, offline.cardsTakenTodayCents, "the daily limit still counts it")
    offline.sync()
    assertEquals(listOf(listOf(key)), api.batches)
    assertTrue(offline.queue.isEmpty())
  }

  @Test
  fun aDeclineAfterTheSaleIsToldOnItsOwnWithTheCard() = runTest {
    val api = FakeOfflineApi().apply {
      kitAnswer = cardKit()
      answers[key] = PosOfflineSaleOutcome(flags = listOf(PosOfflineFlag.CARD_DECLINED), number = 1042.0, orderId = key, saleKey = key, status = PosOfflineOutcomeStatus.RECORDED)
    }
    val offline = model(api, InMemoryKeyValueStore(), this)
    offline.refreshKit()
    offline.ringCardSale(cart(), com.aglyn.hardware.OfflineCardTaken(key, null, "visa", "4242"))
    offline.applyForwards(listOf(com.aglyn.hardware.OfflineCardForward(key, "pi_3Q0abcdEFGH12345", com.aglyn.hardware.OfflineCardForward.Status.DECLINED, "Your card was declined.")))
    offline.sync()
    val notice = offline.notices.single()
    assertTrue(notice.cardUnpaid)
    assertEquals("4242", notice.card?.last4)
    assertEquals(1296L, notice.totalCents)
    assertEquals(emptyList(), notice.lines)
    offline.dismissNotice(key)
    assertTrue(offline.notices.isEmpty())
  }

  @Test
  fun theDailyLimitPerDeviceCountsEveryCardTakenTodayAndResetsTomorrow() = runTest {
    val api = FakeOfflineApi().apply { kitAnswer = cardKit(maxDaily = 2000.0) }
    val device = InMemoryKeyValueStore()
    var day = "2026-10-25"
    val offline = PosOfflineModel(
      api, PosOfflineDeviceStore(device, "u1:h1"), "u1", this, { "r1" }, { "loc1" }, { null }, { null }, { 1_700_000_100_000 },
      ::newPosOfflineSaleKey, { day },
    )
    offline.refreshKit()
    offline.ringCardSale(cart(), com.aglyn.hardware.OfflineCardTaken(key, null))
    assertEquals(
      "This device has taken $12.96 in cards offline today, and its daily limit is $20.00. Take cash, or wait for the connection.",
      offline.cardRefusal(cart()),
    )
    // Another member on the same device counts too: the limit is the device's.
    assertEquals(1296L, PosOfflineDeviceStore(device, "u2:h1").cardsTaken(day))
    day = "2026-10-26"
    assertNull(offline.cardRefusal(cart()))
  }

  @Test
  fun cardsWaitingADayAskToReconnectNow() = runTest {
    val api = FakeOfflineApi().apply { kitAnswer = cardKit() }
    var clock = 1_700_000_100_000L
    val offline = PosOfflineModel(
      api, PosOfflineDeviceStore(InMemoryKeyValueStore(), "u1:h1"), "u1", this, { "r1" }, { "loc1" }, { null }, { null }, { clock },
      ::newPosOfflineSaleKey, { "2026-10-25" },
    )
    offline.refreshKit()
    offline.ringCardSale(cart(), com.aglyn.hardware.OfflineCardTaken(key, null))
    assertFalse(offline.cardsWaitedTooLong)
    clock += 25L * 60 * 60 * 1000
    assertTrue(offline.cardsWaitedTooLong)
  }
}
