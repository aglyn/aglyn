package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ModifierSelection
import com.aglyn.contracts.PosDeviceMode
import com.aglyn.contracts.PosKioskContext
import com.aglyn.contracts.PosKioskProduct
import com.aglyn.contracts.PosKioskSale
import com.aglyn.contracts.PosKioskSaleStatus
import com.aglyn.contracts.PosReceiptChannel
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.InMemoryKeyValueStore
import com.aglyn.hardware.CardCollectorState
import com.aglyn.hardware.CardReaderSession
import com.aglyn.hardware.SimulatedCardCollector
import com.aglyn.contracts.PosKioskCatalog
import com.aglyn.contracts.PosKioskCategory
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
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun context(
  tipping: Boolean = false,
  reader: Boolean = true,
  cardPresent: Boolean = true,
  counter: Boolean = true,
  idle: Int = 90,
  test: Boolean = false,
): PosKioskContext = ContractJsonFormat.decodeFromString(
  PosKioskContext.serializer(),
  """
  {"branding":{"name":"Corner Cafe","logoUrl":null,"logoDarkUrl":null,"message":"Order here"},"currency":"usd",
   "tipping":{"enabled":$tipping,"percentages":[15,20]},
   "payments":{"reader":$reader,"cardPresent":$cardPresent,"payAtCounter":$counter},
   "receipts":["email","print","none"],"offerMarketing":true,"idleSeconds":$idle,"testMode":$test}
  """,
)

private fun product(raw: String): PosKioskProduct = ContractJsonFormat.decodeFromString(PosKioskProduct.serializer(), raw)

private val latte = product(
  """
  {"id":"p1","name":"Latte","categoryIds":["c1"],"options":[{"name":"Size","values":["Small","Large"]}],
   "variants":[{"id":"v-s","options":{"Size":"Small"},"priceCents":400,"soldOut":false},{"id":"v-l","options":{"Size":"Large"},"priceCents":500,"soldOut":false}],
   "modifierGroups":[{"id":"milk","name":"Milk","min":1,"max":1,"options":[{"id":"oat","name":"Oat","priceCents":75},{"id":"whole","name":"Whole","priceCents":0}]}]}
  """,
)

private val muffin = product(
  """{"id":"p2","name":"Muffin","categoryIds":[],"options":[],"variants":[{"id":"default","options":{},"priceCents":300,"soldOut":false}],"modifierGroups":[]}""",
)

private val gone = product(
  """{"id":"p3","name":"Scone","categoryIds":[],"options":[],"variants":[{"id":"default","options":{},"priceCents":250,"soldOut":true}],"modifierGroups":[]}""",
)

private fun makeSale(
  status: PosKioskSaleStatus = PosKioskSaleStatus.OPEN,
  total: Long = 1296,
  due: Long? = null,
  paid: Long = 0,
  number: Int = 12,
  payment: String? = null,
  paymentStatus: String = "pending",
  failure: String? = null,
): PosKioskSale {
  val attached = if (payment == null) {
    "null"
  } else {
    val message = if (failure == null) "" else ",\"failureMessage\":\"$failure\""
    "{\"id\":\"$payment\",\"status\":\"$paymentStatus\"$message}"
  }
  return ContractJsonFormat.decodeFromString(
    PosKioskSale.serializer(),
    "{\"orderId\":\"o1\",\"number\":$number,\"status\":\"${status.raw}\"," +
      "\"lines\":[{\"name\":\"Latte\",\"quantity\":2,\"amountCents\":900}]," +
      "\"itemsCents\":1200,\"discountCents\":0,\"taxCents\":96,\"totalCents\":$total,\"tipCents\":0,\"paidCents\":$paid," +
      "\"dueCents\":${due ?: total},\"payment\":$attached}",
  )
}

private class ScriptedKiosk : PosKioskApi {
  val calls = mutableListOf<String>()
  var contextAnswer = context()
  var catalogAnswer = PosKioskCatalog(listOf(PosKioskCategory("c1", "Coffee")), "usd", listOf(latte, muffin, gone))
  var checkoutResult: Result<PosKioskSale> = Result.success(makeSale())
  var payResult: Result<PosKioskPayment> = Result.success(PosKioskPayment(makeSale(payment = "pay1"), "pay1", null, null))
  val statuses = ArrayDeque<PosKioskSale>()
  var freshSale = makeSale()
  var counterSale = makeSale(status = PosKioskSaleStatus.QUEUED)
  var failure: ConsoleApiError? = null
  val lines = mutableListOf<kotlinx.serialization.json.JsonElement>()

  override suspend fun context(token: String): PosKioskContext {
    calls += "context $token"
    failure?.let { throw it }
    return contextAnswer
  }

  override suspend fun catalog(token: String, categoryId: String?): PosKioskCatalog {
    calls += "catalog ${categoryId ?: "-"}"
    failure?.let { throw it }
    return catalogAnswer
  }

  override suspend fun sale(token: String, orderId: String): PosKioskSale {
    calls += "sale $orderId"
    return freshSale
  }

  override suspend fun checkout(token: String, lines: kotlinx.serialization.json.JsonElement, attemptKey: String): PosKioskSale {
    calls += "checkout $attemptKey"
    this.lines += lines
    return checkoutResult.getOrThrow()
  }

  override suspend fun pay(token: String, orderId: String, method: PosKioskMethod, tip: PosKioskTip, attemptKey: String): PosKioskPayment {
    calls += "pay ${method.raw} $tip $attemptKey"
    return payResult.getOrThrow()
  }

  override suspend fun paymentStatus(token: String, orderId: String, paymentId: String): PosKioskSale {
    calls += "status $paymentId"
    return statuses.removeFirstOrNull() ?: freshSale
  }

  override suspend fun cancelPayment(token: String, orderId: String, paymentId: String): PosKioskSale {
    calls += "cancel $paymentId"
    return freshSale
  }

  override suspend fun simulate(token: String, orderId: String, paymentId: String) {
    calls += "simulate $paymentId"
  }

  override suspend fun counter(token: String, orderId: String): PosKioskSale {
    calls += "counter $orderId"
    return counterSale
  }

  override suspend fun receipt(token: String, orderId: String, channel: PosReceiptChannel, to: String?, marketingOptIn: Boolean) {
    calls += "receipt ${channel.raw} ${to ?: "-"} $marketingOptIn"
  }

  override suspend fun abandon(token: String, orderId: String) {
    calls += "abandon $orderId"
  }

  override suspend fun connectionToken(token: String): CardReaderSession = CardReaderSession("pst_x", "tml_1", "Cafe", true)

  override suspend fun unlock(token: String, pin: String): PosKioskUnlock {
    calls += "unlock $pin"
    if (pin != "4821") throw ConsoleApiError("That PIN is not right.", 403, null)
    return PosKioskUnlock("u-1", (nowMs() + 300_000).toDouble())
  }

  override suspend fun settings(token: String, unlock: String) =
    PosKioskSettingsView(listOf(PosKioskSettingsView.Reader("r1", "Counter reader", "online")), null, "Front kiosk")

  override suspend fun setReader(token: String, unlock: String, readerId: String): PosKioskSettingsView {
    calls += "set-reader $readerId"
    return PosKioskSettingsView(listOf(PosKioskSettingsView.Reader("r1", "Counter reader", "online")), readerId, "Front kiosk")
  }

  override suspend fun exit(token: String, unlock: String) {
    calls += "exit"
  }
}

private class PairingDevice : PosDeviceApi {
  val modes = mutableListOf<PosDeviceMode>()
  var result: Result<PosPaired> = Result.success(PosPaired("kiosk-tok", PosDeviceMode.KIOSK, null))

  override suspend fun pair(code: String, mode: PosDeviceMode): PosPaired {
    modes += mode
    return result.getOrThrow()
  }

  override suspend fun poll(token: String, withBranding: Boolean): PosDevicePoll = throw ConsoleApiError("unused", 0, null)
  override suspend fun respond(token: String, answer: PosDisplayAnswer) = Unit
  override suspend fun forget(token: String) = Unit
}

class PosKioskItemTest {
  @Test
  fun aKioskProductIsTheRegistersItemSoTheSameRulesPriceItsChoices() {
    val item = kioskItemOf(latte)
    assertEquals(listOf("Small", "Large"), item.variants.map { it.label })
    assertEquals(listOf<Long?>(400, 500), item.variants.map { it.unitCents })
    assertTrue(item.needsSheet())
    assertEquals(400L, item.fromCents)
    assertEquals(500L, item.toCents)
    val made = pickOf(item, item.variants[1], listOf(ModifierSelection("milk", "oat")))
    assertTrue(made is PickResult.Ok, "a Large oat latte is sellable")
    assertEquals(575L, (made as PickResult.Ok).pick.unitCents)
    assertEquals("v-l", made.pick.variantId)
    assertEquals("Large / Oat", made.pick.variantLabel)
    // A required choice is asked for before the cart takes the item.
    assertEquals(PickResult.Problem("Choose milk for Latte."), pickOf(item, item.variants[0]))
    assertFalse(kioskItemOf(muffin).needsSheet())
    assertTrue(kioskItemOf(gone).variants[0].soldOut())
  }

  @Test
  fun theTileShowsTheLowestPriceAndWhetherAnythingIsLeft() {
    assertEquals(400L, kioskFromCents(latte))
    assertFalse(kioskProductSoldOut(latte))
    assertTrue(kioskProductSoldOut(gone))
  }
}

class PosKioskModelTest {
  private class Clock(var ms: Long = 1_000_000)

  private fun model(
    api: ScriptedKiosk,
    device: PairingDevice = PairingDevice(),
    store: InMemoryKeyValueStore = InMemoryKeyValueStore(),
    collector: SimulatedCardCollector? = null,
    clock: Clock = Clock(),
  ): PosKioskModel {
    var next = 0
    return PosKioskModel(device, api, PosDeviceTokenStore(store, PosDeviceMode.KIOSK), collector, { clock.ms }, { "key-${++next}" })
  }

  private suspend fun paired(api: ScriptedKiosk, collector: SimulatedCardCollector? = null, clock: Clock = Clock()): PosKioskModel {
    val kiosk = model(api, collector = collector, clock = clock)
    kiosk.start()
    kiosk.pair("123456")
    kiosk.loadCatalog()
    return kiosk
  }

  private fun fill(kiosk: PosKioskModel) {
    kiosk.startOrder()
    val item = kioskItemOf(muffin)
    kiosk.add(item, item.variants[0], quantity = 2)
  }

  @Test
  fun aKioskPairsAsAKioskAndComesBackAfterARelaunch() = runTest {
    val store = InMemoryKeyValueStore()
    val device = PairingDevice()
    val api = ScriptedKiosk()
    val first = model(api, device, store)
    first.start()
    assertNull(first.token)
    first.pair("123 456")
    assertEquals(listOf(PosDeviceMode.KIOSK), device.modes)
    assertEquals("kiosk-tok", first.token)
    assertEquals("usd", first.context?.currency)
    val again = model(api, device, store)
    again.start()
    assertEquals("kiosk-tok", again.token)
    assertNull(PosDeviceTokenStore(store, PosDeviceMode.DISPLAY).token, "a kiosk's token is not a display's")
  }

  @Test
  fun theCartMergesSameChoicesAndStopsAtWhatOneOrderCarries() = runTest {
    val kiosk = paired(ScriptedKiosk())
    kiosk.startOrder()
    val item = kioskItemOf(muffin)
    kiosk.add(item, item.variants[0], quantity = 15)
    kiosk.add(item, item.variants[0], quantity = 15)
    val most = Contracts.posKioskMaxQuantity.toInt()
    assertEquals(1, kiosk.cart.lines.size)
    assertEquals(most, kiosk.cart.lines[0].quantity)
    assertEquals(300L * most, kiosk.cartEstimateCents)
    val soldOut = kioskItemOf(gone)
    assertFalse(kiosk.add(soldOut, soldOut.variants[0]))
    val coffee = kioskItemOf(latte)
    assertFalse(kiosk.add(coffee, coffee.variants[0]), "a required choice is missing")
    assertEquals("Choose milk for Latte.", kiosk.notice)
    assertTrue(kiosk.add(coffee, coffee.variants[1], listOf(ModifierSelection("milk", "oat"))))
    kiosk.setQuantity(kiosk.cart.lines[0].key, 0)
    assertEquals(1, kiosk.cart.lines.size)
  }

  @Test
  fun checkoutSendsOnlyPicksAndKeepsOneAttemptPerCart() = runTest {
    val api = ScriptedKiosk()
    val kiosk = paired(api)
    fill(kiosk)
    kiosk.checkout()
    assertEquals(PosKioskPhase.Review, kiosk.phase)
    assertEquals(1296L, kiosk.sale?.totalCents)
    val line = (api.lines.last() as JsonArray).first().jsonObject
    assertEquals("p2", line["productId"]!!.jsonPrimitive.content)
    assertEquals(2, line["quantity"]!!.jsonPrimitive.content.toInt())
    assertNull(line["unitCents"], "a price is never sent")
    // Going back to the menu or changing the cart makes the next checkout a new attempt.
    kiosk.backToMenu()
    kiosk.checkout()
    kiosk.setQuantity(kiosk.cart.lines[0].key, 3)
    kiosk.backToMenu()
    kiosk.checkout()
    val keys = api.calls.filter { it.startsWith("checkout") }
    assertEquals(3, keys.size)
    assertEquals(3, keys.toSet().size)
  }

  @Test
  fun aRefusedCartShowsWhyAndIsChangedBeforeItIsTriedAgain() = runTest {
    val api = ScriptedKiosk().apply { checkoutResult = Result.failure(ConsoleApiError("Latte is no longer available.", 400, null)) }
    val kiosk = paired(api)
    fill(kiosk)
    kiosk.checkout()
    assertEquals(PosKioskPhase.Menu, kiosk.phase)
    assertEquals("Latte is no longer available.", kiosk.notice)
    api.checkoutResult = Result.success(makeSale())
    kiosk.checkout()
    val keys = api.calls.filter { it.startsWith("checkout") }
    assertNotEquals(keys[0], keys[1], "a refusal starts a new attempt")
  }

  @Test
  fun goingBackToTheMenuVoidsTheUnpaidOrder() = runTest {
    val api = ScriptedKiosk()
    val kiosk = paired(api)
    fill(kiosk)
    kiosk.checkout()
    kiosk.backToMenu()
    assertTrue("abandon o1" in api.calls)
    assertNull(kiosk.sale)
    assertEquals(PosKioskPhase.Menu, kiosk.phase)
    assertFalse(kiosk.cart.isEmpty, "the cart is kept for another go")
  }

  @Test
  fun payAtCounterSendsTheOrderToTheRegistersQueueAndShowsItsNumber() = runTest {
    val api = ScriptedKiosk()
    val kiosk = paired(api)
    fill(kiosk)
    kiosk.checkout()
    kiosk.sendToCounter()
    assertEquals(PosKioskPhase.Done, kiosk.phase)
    assertEquals(PosKioskSaleStatus.QUEUED, kiosk.sale?.status)
    assertTrue(kiosk.cart.isEmpty)
  }

  @Test
  fun withTippingOnThePaymentWaitsForTheTipAndNeverChargesWithoutOne() = runTest {
    val api = ScriptedKiosk().apply { contextAnswer = context(tipping = true) }
    val kiosk = paired(api)
    fill(kiosk)
    kiosk.checkout()
    kiosk.choosePay(PosKioskMethod.READER)
    assertEquals(PosKioskPhase.Tip(PosKioskMethod.READER), kiosk.phase)
    assertTrue(api.calls.none { it.startsWith("pay") })
    kiosk.tipChosen(PosKioskMethod.READER, PosKioskTip.Percent(20.0))
    // 20% of the 1296 due, recomputed the way the server does.
    assertEquals(PosKioskPhase.Paying(PosKioskMethod.READER, "pay1", 1296 + 259, null), kiosk.phase)
    assertEquals("pay reader ${PosKioskTip.Percent(20.0)} key-2", api.calls.last())
  }

  @Test
  fun withoutTippingThePaymentStartsAtOnceAndAFinishedCardMovesToTheReceipt() = runTest {
    val api = ScriptedKiosk()
    val kiosk = paired(api)
    fill(kiosk)
    kiosk.checkout()
    kiosk.choosePay(PosKioskMethod.READER)
    assertEquals(PosKioskPhase.Paying(PosKioskMethod.READER, "pay1", 1296, null), kiosk.phase)
    api.statuses += makeSale(payment = "pay1")
    api.statuses += makeSale(status = PosKioskSaleStatus.PAID, paid = 1296, payment = "pay1", paymentStatus = "succeeded")
    kiosk.pollPayment()
    assertEquals(PosKioskPhase.Paying(PosKioskMethod.READER, "pay1", 1296, null), kiosk.phase)
    kiosk.pollPayment()
    assertEquals(PosKioskPhase.Receipt, kiosk.phase)
    assertTrue(kiosk.cart.isEmpty)
  }

  @Test
  fun aDeclinedCardSaysSoAndALaterTryIsANewPress() = runTest {
    val api = ScriptedKiosk()
    val kiosk = paired(api)
    fill(kiosk)
    kiosk.checkout()
    kiosk.choosePay(PosKioskMethod.READER)
    api.statuses += makeSale(payment = "pay1", paymentStatus = "failed", failure = "The card was declined.")
    kiosk.pollPayment()
    assertEquals(PosKioskPhase.Paying(PosKioskMethod.READER, "pay1", 1296, "The card was declined."), kiosk.phase)
    kiosk.retryPayment()
    val presses = api.calls.filter { it.startsWith("pay ") }
    assertEquals(2, presses.size)
    assertNotEquals(presses[0], presses[1])
  }

  @Test
  fun aPaymentThatCouldNotStartReturnsToTheReviewWithItsWords() = runTest {
    val api = ScriptedKiosk().apply {
      payResult = Result.failure(ConsoleApiError("No card reader is set up for this kiosk. Please pay at the counter.", 409, null))
    }
    val kiosk = paired(api)
    fill(kiosk)
    kiosk.checkout()
    kiosk.choosePay(PosKioskMethod.READER)
    assertEquals(PosKioskPhase.Review, kiosk.phase)
    assertEquals("No card reader is set up for this kiosk. Please pay at the counter.", kiosk.notice)
  }

  @Test
  fun cancellingTheCardStopsItAndGoesBackUnlessItAlreadyPaid() = runTest {
    val api = ScriptedKiosk()
    val kiosk = paired(api)
    fill(kiosk)
    kiosk.checkout()
    kiosk.choosePay(PosKioskMethod.READER)
    kiosk.cancelPayment()
    assertTrue("cancel pay1" in api.calls)
    assertEquals(PosKioskPhase.Review, kiosk.phase)
    kiosk.choosePay(PosKioskMethod.READER)
    api.freshSale = makeSale(status = PosKioskSaleStatus.PAID, paid = 1296)
    kiosk.cancelPayment()
    assertEquals(PosKioskPhase.Receipt, kiosk.phase, "a card that settled between the taps is paid")
  }

  @Test
  fun tapToPayCollectsTheServersIntentOnThisDevice() = runTest {
    val api = ScriptedKiosk().apply {
      payResult = Result.success(PosKioskPayment(makeSale(payment = "pay1"), "pay1", "pi_12345678_secret_abcdefgh", "pi_12345678"))
    }
    val collector = SimulatedCardCollector(delayMs = 1)
    val kiosk = paired(api, collector)
    assertTrue(kiosk.canPayByTap)
    assertTrue(collector.state.value is CardCollectorState.Connected)
    fill(kiosk)
    kiosk.checkout()
    kiosk.choosePay(PosKioskMethod.TAP)
    assertEquals(PosKioskPhase.Paying(PosKioskMethod.TAP, "pay1", 1296, null), kiosk.phase, "collected: the server settles it by status")
  }

  @Test
  fun tapToPayWithoutAReaderSaysSo() = runTest {
    val api = ScriptedKiosk()
    val kiosk = paired(api)
    assertFalse(kiosk.canPayByTap)
    fill(kiosk)
    kiosk.checkout()
    kiosk.choosePay(PosKioskMethod.TAP)
    assertEquals(PosKioskPhase.Paying(PosKioskMethod.TAP, "pay1", 1296, "Tap to Pay is not available on this device."), kiosk.phase)
  }

  @Test
  fun theReceiptGoesWhereTheCustomerSaidThenTheOrderNumberShows() = runTest {
    val api = ScriptedKiosk()
    val kiosk = paired(api)
    fill(kiosk)
    kiosk.checkout()
    kiosk.choosePay(PosKioskMethod.READER)
    api.statuses += makeSale(status = PosKioskSaleStatus.PAID, paid = 1296)
    kiosk.pollPayment()
    kiosk.answerReceipt(PosReceiptChannel.EMAIL, "a@b.co", true)
    assertEquals("receipt email a@b.co true", api.calls.last())
    assertEquals(PosKioskPhase.Done, kiosk.phase)
  }

  @Test
  fun theOrderNumberScreenReturnsToTheStartOnItsOwn() = runTest {
    val clock = Clock()
    val api = ScriptedKiosk()
    val kiosk = paired(api, clock = clock)
    fill(kiosk)
    kiosk.checkout()
    kiosk.sendToCounter()
    kiosk.tickDone()
    assertEquals(PosKioskPhase.Done, kiosk.phase)
    clock.ms += Contracts.posKioskDoneSeconds * 1000
    kiosk.tickDone()
    assertEquals(PosKioskPhase.Start, kiosk.phase)
    assertTrue(kiosk.cart.isEmpty)
    assertNull(kiosk.sale)
  }

  @Test
  fun anIdleKioskAsksStillThereThenClearsTheOrderAndVoidsItsSale() = runTest {
    val clock = Clock()
    val api = ScriptedKiosk().apply { contextAnswer = context(idle = 30) }
    val kiosk = paired(api, clock = clock)
    fill(kiosk)
    kiosk.checkout()
    clock.ms += 29_000
    kiosk.tick()
    assertNull(kiosk.idleWarning)
    clock.ms += 2_000
    kiosk.tick()
    assertEquals(Contracts.posKioskIdleWarningSeconds.toInt() - 1, kiosk.idleWarning)
    kiosk.touch()
    assertNull(kiosk.idleWarning, "a touch during the countdown cancels it")
    clock.ms += 31_000 + Contracts.posKioskIdleWarningSeconds * 1000
    kiosk.tick()
    assertEquals(PosKioskPhase.Start, kiosk.phase)
    assertTrue("abandon o1" in api.calls)
    assertTrue(kiosk.cart.isEmpty)
    assertEquals(1, kiosk.turn, "every screen is remounted so nothing typed carries over")
  }

  @Test
  fun theKioskNeverTimesOutOnTheStartScreenOrWhileACardIsBeingCollected() = runTest {
    val clock = Clock()
    val api = ScriptedKiosk()
    val kiosk = paired(api, clock = clock)
    clock.ms += 10 * 60_000
    kiosk.tick()
    assertNull(kiosk.idleWarning)
    fill(kiosk)
    kiosk.checkout()
    kiosk.choosePay(PosKioskMethod.READER)
    clock.ms += 10 * 60_000
    kiosk.tick()
    assertNull(kiosk.idleWarning)
    assertTrue(kiosk.phase is PosKioskPhase.Paying, "still paying")
  }

  @Test
  fun anUnpairedTokenLeavesTheKioskForPairing() = runTest {
    val store = InMemoryKeyValueStore()
    val api = ScriptedKiosk()
    val kiosk = model(api, store = store)
    kiosk.start()
    kiosk.pair("123456")
    api.failure = ConsoleApiError("This kiosk is not paired.", 401, null)
    kiosk.loadCatalog()
    assertNull(kiosk.token)
    assertNull(PosDeviceTokenStore(store, PosDeviceMode.KIOSK).token)
  }

  @Test
  fun whatPaymentsAreOfferedFollowsTheStoresSettingsAndTheDevice() = runTest {
    val api = ScriptedKiosk().apply { contextAnswer = context(reader = false, cardPresent = true, counter = false) }
    val kiosk = paired(api)
    assertFalse(kiosk.canPayByReader)
    assertFalse(kiosk.canPayAtCounter)
    api.contextAnswer = context(reader = true, cardPresent = false, counter = true)
    kiosk.refresh()
    assertFalse(kiosk.canPayByReader, "card payments are off for the platform")
    assertTrue(kiosk.canPayAtCounter)
  }

  @Test
  fun staffUnlockOpensTheReaderChoiceAndLeavesKioskMode() = runTest {
    val api = ScriptedKiosk()
    val kiosk = paired(api)
    val staff = PosKioskStaffModel()
    staff.open()
    staff.pin = "0000"
    var left = staff.submit(kiosk)
    assertFalse(left)
    assertEquals("That PIN is not right.", staff.error)
    assertEquals("", staff.pin, "the PIN is never kept")
    staff.pin = "4821"
    left = staff.submit(kiosk)
    assertFalse(left)
    assertEquals(PosKioskStaffModel.Stage.SETTINGS, staff.stage)
    assertEquals("Front kiosk", staff.view?.label)
    assertTrue(staff.lapsesInMs() > 0)
    staff.chooseReader(kiosk, "r1")
    assertEquals("r1", staff.view?.readerId)
    left = staff.exit(kiosk)
    assertTrue(left)
    assertEquals("exit", api.calls.last())
    staff.close()
    assertEquals(PosKioskStaffModel.Stage.CLOSED, staff.stage)
    assertNull(staff.unlock)
  }
}

class ConsolePosKioskApiTest {
  private val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")

  private class Seen(val method: HttpMethod, val path: String, val query: String, val body: JsonObject?, val token: String?, val authorization: String?, val key: String?)

  private fun client(seen: MutableList<Seen>, answer: String, signedIn: Boolean = false): ConsoleApiClient {
    val engine = MockEngine { request ->
      val raw = request.body.toByteArray().decodeToString()
      seen += Seen(
        request.method, request.url.encodedPath, request.url.encodedQuery, raw.takeIf { it.isNotBlank() }?.let { Json.parseToJsonElement(it).jsonObject },
        request.headers["X-Pos-Display-Token"], request.headers["Authorization"], request.headers["Idempotency-Key"],
      )
      respond(answer, HttpStatusCode.OK, jsonHeaders)
    }
    // No token source answers for a kiosk: a paired screen is anonymous, so a call that asked for one would fail.
    return ConsoleApiClient("https://console.test", HttpClient(engine), { if (signedIn) "id-token" else null }, maxAttempts = 1)
  }

  @Test
  fun everyCallCarriesTheDeviceTokenAndNoSession() = runTest {
    val seen = mutableListOf<Seen>()
    val read = ConsolePosKioskApi(
      client(
        seen,
        """{"branding":{"name":"Cafe","logoUrl":null,"logoDarkUrl":null,"message":"Hi"},"currency":"usd","tipping":{"enabled":false,"percentages":[]},"payments":{"reader":true,"cardPresent":true,"payAtCounter":true},"receipts":["none"],"offerMarketing":false,"idleSeconds":90,"testMode":false}""",
      ),
    ).context("tok")
    val request = seen.single()
    assertEquals("/api/commerce/pos-kiosk", request.path)
    assertEquals("tok", request.token)
    assertNull(request.authorization)
    assertTrue("action=context" in request.query)
    assertEquals(90L, read.idleSeconds)
  }

  @Test
  fun checkoutAndPayCarryTheirAttemptKeysAndTheTipChoice() = runTest {
    val sale = """{"orderId":"o1","number":3,"status":"open","lines":[],"itemsCents":100,"discountCents":0,"taxCents":0,"totalCents":100,"tipCents":0,"paidCents":0,"dueCents":100,"payment":null}"""
    val checkout = mutableListOf<Seen>()
    val lines = buildJsonArray { add(buildJsonObject { put("productId", "p1"); put("quantity", 1) }) }
    ConsolePosKioskApi(client(checkout, """{"sale":$sale}""")).checkout("tok", lines, "k-1")
    assertEquals("k-1", checkout.single().key)
    assertEquals("checkout", checkout.single().body!!["action"]!!.jsonPrimitive.content)
    assertEquals("p1", checkout.single().body!!["lines"]!!.jsonArray.first().jsonObject["productId"]!!.jsonPrimitive.content)

    val pay = mutableListOf<Seen>()
    val started = ConsolePosKioskApi(client(pay, """{"sale":$sale,"paymentId":"pay1","clientSecret":"pi_12345678_secret_abcdefgh","paymentIntentId":"pi_12345678"}"""))
      .pay("tok", "o1", PosKioskMethod.TAP, PosKioskTip.Custom(250), "k-2")
    val body = pay.single().body!!
    assertEquals("k-2", pay.single().key)
    assertEquals("tap", body["method"]!!.jsonPrimitive.content)
    assertEquals("custom", body["tipChoice"]!!.jsonPrimitive.content)
    assertEquals(250, body["tipCents"]!!.jsonPrimitive.content.toInt())
    assertEquals("pay1", started.paymentId)
    assertEquals("pi_12345678", started.paymentIntentId)
    assertEquals(3L, started.sale.number)
  }

  @Test
  fun theReceiptTheUnlockAndTheSettingsSpeakTheRoutesWords() = runTest {
    val receipt = mutableListOf<Seen>()
    ConsolePosKioskApi(client(receipt, """{"ok":true}""")).receipt("tok", "o1", PosReceiptChannel.EMAIL, "a@b.co", true)
    val body = receipt.single().body!!
    assertEquals("email", body["channel"]!!.jsonPrimitive.content)
    assertEquals("a@b.co", body["to"]!!.jsonPrimitive.content)
    assertEquals("true", body["marketingOptIn"]!!.jsonPrimitive.content)

    val unlock = mutableListOf<Seen>()
    val opened = ConsolePosKioskApi(client(unlock, """{"unlock":"u-9","expiresAtMs":1700000300000}""")).unlock("tok", "4821")
    assertEquals("4821", unlock.single().body!!["pin"]!!.jsonPrimitive.content)
    assertEquals(PosKioskUnlock("u-9", 1_700_000_300_000.0), opened)

    val settings = mutableListOf<Seen>()
    val view = ConsolePosKioskApi(client(settings, """{"readers":[{"id":"r1","label":"Counter","status":"online"}],"readerId":"r1","label":"Front kiosk"}""")).settings("tok", "u-9")
    assertEquals("r1", view.readerId)
    assertEquals("Counter", view.readers.first().label)
  }

  @Test
  fun theQueueApiReadsEntriesAndTheTakenSale() = runTest {
    val seen = mutableListOf<Seen>()
    val answer = ConsolePosKioskQueueApi(
      client(seen, """{"entries":[{"orderId":"o1","number":12,"queuedAtMs":5,"totalCents":1240,"itemCount":3}],"currency":"eur"}""", signedIn = true),
      "h1",
    ).queue("r1")
    assertTrue("action=queue" in seen.single().query)
    assertEquals(3, answer.entries.first().itemCount)
    assertEquals("eur", answer.currency)

    val take = mutableListOf<Seen>()
    val taken = ConsolePosKioskQueueApi(
      client(take, """{"sale":{"orderId":"o1","status":"pending","totalCents":1240,"paidCents":0,"dueCents":1240,"tenderableCents":1240,"tipCents":0,"payments":[]},"number":12,"lines":[]}""", signedIn = true),
      "h1",
    ).take("r1", "o1")
    assertEquals("take", take.single().body!!["action"]!!.jsonPrimitive.content)
    assertEquals(12, taken.number)
    assertEquals("o1", taken.sale.orderId)
    assertEquals(1240L, taken.sale.tenderableCents)
  }
}

class PosKioskQueueModelTest {
  private class ScriptedQueue : PosKioskQueueApi {
    var entries = listOf(PosKioskQueueEntry("o1", 12, 5.0, 1240, 3))
    var takeFailure: ConsoleApiError? = null
    val taken = mutableListOf<String>()

    override suspend fun queue(registerId: String) = PosKioskQueueRead(entries, "usd")

    override suspend fun take(registerId: String, orderId: String): PosKioskTaken {
      takeFailure?.let { throw it }
      taken += orderId
      return PosKioskTaken(PosSale(orderId, "pending", 1240, 0, 1240, 1240, 0, emptyList()), 12)
    }
  }

  @Test
  fun theQueueListsOrdersAndNothingWithoutARegister() = runTest {
    val api = ScriptedQueue()
    var register: String? = null
    val queue = PosKioskQueueModel(api) { register }
    queue.load()
    assertTrue(queue.entries.isEmpty())
    register = "r1"
    queue.load()
    assertEquals(listOf(12), queue.entries.map { it.number })
  }

  @Test
  fun takingAnOrderReturnsItsSaleAndAFailureReloadsTheQueue() = runTest {
    val api = ScriptedQueue()
    val queue = PosKioskQueueModel(api) { "r1" }
    queue.load()
    val first = queue.take(queue.entries[0])
    assertTrue(first is PosKioskTake.Taken)
    assertEquals(1240L, (first as PosKioskTake.Taken).taken.sale.dueCents)
    api.takeFailure = ConsoleApiError("This order is no longer waiting for payment.", 409, null)
    api.entries = emptyList()
    val second = queue.take(PosKioskQueueEntry("o1", 12, 5.0, 1, 1))
    assertEquals(PosKioskTake.Refused("This order is no longer waiting for payment."), second)
    assertTrue(queue.entries.isEmpty(), "the queue is re-read after a refusal")
  }
}

private object KioskTestReader : com.aglyn.core.FirestoreReader {
  override suspend fun get(path: String): com.aglyn.core.FirestoreDoc? = null
  override suspend fun page(query: com.aglyn.core.FirestoreQuery) = com.aglyn.core.FirestorePage(emptyList(), null)
  override fun observeDoc(path: String): kotlinx.coroutines.flow.Flow<com.aglyn.core.Live<com.aglyn.core.FirestoreDoc?>> = kotlinx.coroutines.flow.emptyFlow()
  override fun observe(query: com.aglyn.core.FirestoreQuery): kotlinx.coroutines.flow.Flow<com.aglyn.core.Live<List<com.aglyn.core.FirestoreDoc>>> = kotlinx.coroutines.flow.emptyFlow()
}

class RegisterKioskOrderTest {
  private class Queue : PosKioskQueueApi {
    var entries = listOf(PosKioskQueueEntry("o1", 12, 5.0, 1240, 3))
    var takeFailure: ConsoleApiError? = null
    val taken = mutableListOf<String>()

    override suspend fun queue(registerId: String) = PosKioskQueueRead(entries, "usd")

    override suspend fun take(registerId: String, orderId: String): PosKioskTaken {
      takeFailure?.let { throw it }
      taken += orderId
      return PosKioskTaken(PosSale(orderId, "pending", 1240, 0, 1240, 1240, 0, emptyList()), 12)
    }
  }

  private fun register(queue: Queue, scope: kotlinx.coroutines.CoroutineScope) = RegisterModel(
    hostId = "h1",
    firestore = KioskTestReader,
    api = ScriptedSaleApi(),
    terminal = com.aglyn.hardware.CardReaderSessionSource { error("no card reader in this test") },
    deviceStore = InMemoryKeyValueStore(),
    peripherals = com.aglyn.hardware.NoPeripherals,
    scope = scope,
    kioskQueueApi = queue,
  ).also { it.selectRegister(PosRegister("r1", "Front", null)) }

  @Test
  fun takingAKioskOrderOpensItForPaymentWhereTheCashierTakesIt() = runTest {
    val queue = Queue()
    val model = register(queue, this)
    model.kioskQueue.load()
    model.takeKioskOrder(model.kioskQueue.entries[0])
    val open = model.checkout!!.state.value
    assertEquals("o1", open.opened.orderId)
    assertEquals(1240L, open.opened.dueCents)
    assertEquals(listOf("o1"), queue.taken)
  }

  @Test
  fun anOpenSaleBlocksTakingAnotherAndSaysWhy() = runTest {
    val queue = Queue()
    val model = register(queue, this)
    model.kioskQueue.load()
    model.takeKioskOrder(model.kioskQueue.entries[0])
    model.takeKioskOrder(model.kioskQueue.entries[0])
    assertEquals(Notice(NoticeTone.WARNING, "Finish or cancel the open sale first."), model.toast)
    assertEquals(listOf("o1"), queue.taken, "the second take never reached the route")
  }

  @Test
  fun aRefusedTakeSaysWhyAndLeavesTheRegisterFree() = runTest {
    val queue = Queue().apply { takeFailure = ConsoleApiError("This order is no longer waiting for payment.", 409, null) }
    val model = register(queue, this)
    model.kioskQueue.load()
    model.takeKioskOrder(model.kioskQueue.entries[0])
    assertEquals(Notice(NoticeTone.ERROR, "This order is no longer waiting for payment."), model.toast)
    assertNull(model.checkout)
  }
}
