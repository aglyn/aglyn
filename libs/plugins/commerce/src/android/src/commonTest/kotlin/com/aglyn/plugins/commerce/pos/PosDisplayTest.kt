package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.PosDeviceMode
import com.aglyn.contracts.PosDisplayMode
import com.aglyn.contracts.PosDisplayResponse
import com.aglyn.contracts.PosDisplayResponseTipChoice
import com.aglyn.contracts.PosDisplayState
import com.aglyn.contracts.PosReceiptChannel
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.InMemoryKeyValueStore
import com.aglyn.core.Live
import com.aglyn.hardware.CardReaderSessionSource
import com.aglyn.hardware.NoPeripherals
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val latte = CartPick("p1", "v1", "Latte", "Large", emptyList(), 450)
private val muffin = CartPick("p2", null, "Muffin", null, emptyList(), 300)

private fun cart(discount: Int = 0) = Cart.EMPTY.add(latte, 2).add(muffin, 1).withDiscount(discount.toDouble())

private fun sale(status: String = "pending", total: Long = 1296, paid: Long = 0, due: Long = 1296, tip: Long = 0) =
  PosSale("o1", status, total, paid, due, due, tip, emptyList())

class PosDisplayStateTest {
  @Test
  fun anEmptyBasketIsIdle() {
    assertEquals(PosDisplayMode.IDLE, posDisplayBasketState(Cart.EMPTY, null, 0, 5).mode)
  }

  @Test
  fun theBasketShowsItsLinesAndTheEstimateBeforeASaleIsOpen() {
    val state = posDisplayBasketState(cart(discount = 10), null, 0, 5)
    assertEquals(PosDisplayMode.CART, state.mode)
    assertEquals(listOf("Latte", "Muffin"), state.cart?.lines?.map { it.name })
    assertEquals(900.0, state.cart?.lines?.first()?.amountCents)
    assertEquals(2.0, state.cart?.lines?.first()?.quantity)
    assertEquals("Large", state.cart?.lines?.first()?.variantLabel)
    assertEquals(1200.0, state.cart?.itemsCents)
    assertEquals(120.0, state.cart?.discountCents)
    assertEquals(1080.0, state.cart?.totalCents)
    assertEquals(0.0, state.cart?.taxCents)
    assertNull(state.cart?.paidCents)
    assertEquals(5.0, state.updatedAtMs)
  }

  @Test
  fun anOpenSaleShowsTheServersTotalTaxPaidDueAndTip() {
    val state = posDisplayBasketState(cart(discount = 10), sale(total = 1166, paid = 500, due = 666, tip = 100), 50, 5)
    assertEquals(1166.0, state.cart?.totalCents)
    assertEquals(86.0, state.cart?.taxCents)
    assertEquals(500.0, state.cart?.paidCents)
    assertEquals(666.0, state.cart?.dueCents)
    assertEquals(150.0, state.cart?.tipCents)
  }

  @Test
  fun aPaidSaleCountsNoPendingTip() {
    assertEquals(100L, posDisplayTipCents("paid", 100, 50))
    assertEquals(100L, posDisplayTipCents("pending", 100, -5))
  }

  @Test
  fun thePromptsAskForWhatTheStoreOffers() {
    val tip = posDisplayTipPrompt(1296, listOf(15.0, 20.0), 7)
    assertEquals(PosDisplayMode.TIP, tip.mode)
    assertEquals(1296.0, tip.tip?.baseCents)
    assertEquals(listOf(15.0, 20.0), tip.tip?.percentages)
    assertTrue(tip.tip?.allowCustom == true)
    assertEquals(listOf(PosReceiptChannel.EMAIL, PosReceiptChannel.PRINT, PosReceiptChannel.NONE), posDisplayReceiptPrompt(false, true, 7).receipt?.channels)
    assertTrue(posDisplayReceiptPrompt(false, true, 7).receipt?.offerMarketing == true)
    assertEquals(listOf(PosReceiptChannel.EMAIL, PosReceiptChannel.SMS, PosReceiptChannel.PRINT, PosReceiptChannel.NONE), posDisplayReceiptPrompt(true, false, 7).receipt?.channels)
    assertEquals("Tap, insert or swipe your card on the reader.", posDisplayProcessing(7).processing?.message)
  }
}

private class ScriptedDisplay : PosDisplayApi {
  val calls = mutableListOf<String>()
  val pushes = mutableListOf<PosDisplayState>()
  var connected = true
  var state: PosDisplayState? = null
  var failure: ConsoleApiError? = null
  var devicesAnswer = mutableListOf<PosPairedDevice>()
  var onRead: ((ScriptedDisplay) -> Unit)? = null

  override suspend fun state(registerId: String): PosDisplayRead {
    calls += "state $registerId"
    failure?.let { throw it }
    onRead?.invoke(this)
    return PosDisplayRead(state, connected)
  }

  override suspend fun push(registerId: String, state: PosDisplayState) {
    calls += "push $registerId ${state.mode.raw}"
    pushes += state
    failure?.let { throw it }
    this.state = state
  }

  override suspend fun pairingCode(registerId: String, mode: PosDeviceMode): PosPairingCode {
    calls += "code $registerId ${mode.raw}"
    failure?.let { throw it }
    return PosPairingCode("123456", 1_000_000.0)
  }

  override suspend fun devices(registerId: String): List<PosPairedDevice> {
    calls += "devices $registerId"
    failure?.let { throw it }
    return devicesAnswer.toList()
  }

  override suspend fun revoke(registerId: String, deviceId: String): Int {
    calls += "revoke $deviceId"
    devicesAnswer.removeAll { it.id == deviceId || deviceId == "*" }
    return 1
  }
}

class PosDisplayControlTest {
  private fun control(api: ScriptedDisplay, scope: CoroutineScope, timeoutMs: Long = 5_000, pollMs: Long = 1_000) =
    PosDisplayControl(api, scope, { "r1" }, { 1_000 }, { yield() }, { "prompt-1" }, timeoutMs, pollMs)

  @Test
  fun theRegisterKnowsWhetherADisplayIsConnected() = runTest {
    val api = ScriptedDisplay()
    val display = control(api, this)
    assertFalse(display.connected)
    display.check()
    assertTrue(display.connected)
    api.connected = false
    display.check()
    assertFalse(display.connected)
    api.failure = ConsoleApiError("lost", 0, null)
    api.connected = true
    display.check()
    assertFalse(display.connected, "a lost answer is not a connected display")
  }

  @Test
  fun nothingIsShownWithoutAConnectedDisplay() = runTest {
    val api = ScriptedDisplay()
    val display = control(api, this)
    display.show(PosDisplayState(mode = PosDisplayMode.IDLE, updatedAtMs = 1.0))
    assertTrue(api.pushes.isEmpty())
    display.check()
    display.show(PosDisplayState(mode = PosDisplayMode.IDLE, updatedAtMs = 1.0))
    assertEquals(listOf(PosDisplayMode.IDLE), api.pushes.map { it.mode })
  }

  @Test
  fun askPushesAPromptAndReturnsTheCustomersAnswerToThatPrompt() = runTest {
    val api = ScriptedDisplay()
    var reads = 0
    api.onRead = {
      reads += 1
      if (reads == 3) it.state = it.state?.copy(response = PosDisplayResponse(atMs = 2.0, promptId = "prompt-1", tipCents = 200.0, tipChoice = PosDisplayResponseTipChoice.PERCENT, tipPercent = 15.0))
    }
    val display = control(api, this)
    val answer = display.ask(posDisplayTipPrompt(1000, listOf(15.0), 1))
    assertEquals("prompt-1", api.pushes.first().promptId)
    assertEquals(PosDisplayMode.TIP, api.pushes.first().mode)
    assertEquals(200.0, answer?.tipCents)
    assertEquals(15.0, answer?.tipPercent)
    assertNull(display.asking, "answered, the register is no longer waiting")
  }

  @Test
  fun aStaleAnswerIsNotTheCustomersAnswer() = runTest {
    val api = ScriptedDisplay()
    api.onRead = { it.state = it.state?.copy(response = PosDisplayResponse(atMs = 2.0, promptId = "an-older-prompt", tipCents = 999.0, tipChoice = PosDisplayResponseTipChoice.CUSTOM)) }
    assertNull(control(api, this, timeoutMs = 3_000).ask(posDisplayTipPrompt(1000, listOf(15.0), 1)))
  }

  @Test
  fun aCustomerWhoNeverAnswersTimesOutAndTheRegisterMovesOn() = runTest {
    val api = ScriptedDisplay()
    val display = control(api, this, timeoutMs = 4_000)
    assertNull(display.ask(posDisplayReceiptPrompt(false, false, 1)))
    assertEquals(4, api.calls.count { it.startsWith("state") })
    assertNull(display.asking)
  }

  @Test
  fun theCashierCancelsTheWaitAndTheScreenIsFreeAgain() = runTest {
    val api = ScriptedDisplay()
    lateinit var display: PosDisplayControl
    var reads = 0
    api.onRead = {
      reads += 1
      if (reads == 2) display.cancelAsk()
    }
    display = control(api, this, timeoutMs = 60_000)
    assertNull(display.ask(posDisplayTipPrompt(1000, listOf(15.0), 1)))
    assertTrue(reads < 10, "a cancelled ask stops polling")
    assertNull(display.asking)
  }

  @Test
  fun aPromptIsNotShownOverWhileWaiting() = runTest {
    val api = ScriptedDisplay()
    lateinit var display: PosDisplayControl
    var reads = 0
    api.onRead = {
      reads += 1
      if (reads == 1) launch {
        // While the tip prompt waits, the basket mirror asks to show the cart: it must not overwrite the prompt.
        display.show(PosDisplayState(mode = PosDisplayMode.CART, updatedAtMs = 3.0))
        display.cancelAsk()
      }
    }
    display = control(api, this, timeoutMs = 30_000)
    display.check()
    display.ask(posDisplayTipPrompt(1000, listOf(15.0), 1))
    advanceUntilIdle()
    assertEquals(listOf(PosDisplayMode.TIP), api.pushes.map { it.mode })
  }

  @Test
  fun aFailedPushIsNoAnswerAndWaitsForNothing() = runTest {
    val api = ScriptedDisplay().apply { failure = ConsoleApiError("This display is not paired.", 401, null) }
    val display = control(api, this)
    assertNull(display.ask(posDisplayTipPrompt(1000, listOf(15.0), 1)))
    assertNull(display.asking)
  }

  @Test
  fun pairingMakesACodeAndListsAndSignsOutScreens() = runTest {
    val api = ScriptedDisplay()
    api.devicesAnswer += PosPairedDevice("abcd1234abcd1234", "Front display", PosDeviceMode.DISPLAY, 1.0, 1_000.0)
    api.devicesAnswer += PosPairedDevice("ffff0000ffff0000", "Kiosk", PosDeviceMode.KIOSK, 1.0, 1_000.0)
    val display = control(api, this)
    display.newPairingCode(PosDeviceMode.KIOSK)
    advanceUntilIdle()
    assertEquals("123456", display.pairing?.code)
    assertEquals("123 456", display.pairing?.spoken)
    assertEquals(PosDeviceMode.KIOSK, display.pairingMode)
    assertEquals("code r1 kiosk", api.calls.last())
    display.closePairing()
    assertNull(display.pairing)
    display.loadDevices()
    advanceUntilIdle()
    assertEquals(listOf("Front display", "Kiosk"), display.devices.map { it.label })
    display.revoke("abcd1234abcd1234")
    advanceUntilIdle()
    assertEquals("Screen signed out", display.notice)
    assertEquals(listOf("Kiosk"), display.devices.map { it.label })
    assertTrue(display.devices[0].connected(1_000.0 + 119_000))
    assertFalse(display.devices[0].connected(1_000.0 + 121_000))
  }

  @Test
  fun aCodeThatCouldNotBeMadeSaysWhy() = runTest {
    val api = ScriptedDisplay().apply { failure = ConsoleApiError("Pairing needs the register permission.", 403, null) }
    val display = control(api, this)
    display.newPairingCode(PosDeviceMode.DISPLAY)
    advanceUntilIdle()
    assertNull(display.pairing)
    assertEquals("Pairing needs the register permission.", display.error)
  }
}

class ConsolePosDisplayApiTest {
  private val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")

  private class Seen(val method: HttpMethod, val path: String, val query: String, val body: JsonObject?)

  private fun api(seen: MutableList<Seen>, answer: String): ConsolePosDisplayApi {
    val engine = MockEngine { request ->
      val raw = request.body.toByteArray().decodeToString()
      seen += Seen(request.method, request.url.encodedPath, request.url.encodedQuery, raw.takeIf { it.isNotBlank() }?.let { Json.parseToJsonElement(it).jsonObject })
      respond(answer, HttpStatusCode.OK, jsonHeaders)
    }
    return ConsolePosDisplayApi(ConsoleApiClient("https://console.test", HttpClient(engine), { "token" }, maxAttempts = 1), "h1")
  }

  @Test
  fun theStateIsReadWithTheSiteAndRegisterAndAnswersConnected() = runTest {
    val seen = mutableListOf<Seen>()
    val read = api(
      seen,
      """{"connected":true,"state":{"mode":"tip","updatedAtMs":5,"promptId":"p","tip":{"baseCents":1000,"percentages":[15],"allowCustom":true},"response":{"promptId":"p","atMs":6,"tipChoice":"none","tipCents":0}}}""",
    ).state("r1")
    assertEquals(HttpMethod.Get, seen.single().method)
    assertEquals("/api/commerce/pos-display", seen.single().path)
    assertTrue("action=state" in seen.single().query && "hostId=h1" in seen.single().query && "registerId=r1" in seen.single().query)
    assertTrue(read.connected)
    assertEquals(PosDisplayMode.TIP, read.state?.mode)
    assertEquals(PosDisplayResponseTipChoice.NONE, read.state?.response?.tipChoice)
  }

  @Test
  fun noStateYetIsNoStateNotAnError() = runTest {
    val read = api(mutableListOf(), """{"state":null,"connected":false}""").state("r1")
    assertNull(read.state)
    assertFalse(read.connected)
  }

  @Test
  fun pushSendsTheStateTheRegisterMeans() = runTest {
    val seen = mutableListOf<Seen>()
    api(seen, """{"ok":true,"promptId":"p"}""").push("r1", posDisplayTipPrompt(1000, listOf(15.0, 20.0), 5).copy(promptId = "p"))
    val body = seen.single().body!!
    assertEquals("push", body["action"]!!.jsonPrimitive.content)
    assertEquals("r1", body["registerId"]!!.jsonPrimitive.content)
    val sent = body["state"]!!.jsonObject
    assertEquals("tip", sent["mode"]!!.jsonPrimitive.content)
    assertEquals("p", sent["promptId"]!!.jsonPrimitive.content)
    assertEquals(2, sent["tip"]!!.jsonObject["percentages"]!!.jsonArray.size)
  }

  @Test
  fun pairingDevicesAndRevokeSpeakTheRoutesWords() = runTest {
    val code = mutableListOf<Seen>()
    val made = api(code, """{"code":"654321","expiresAtMs":1700000600000}""").pairingCode("r1", PosDeviceMode.KIOSK)
    assertEquals("pairing-code", code.single().body!!["action"]!!.jsonPrimitive.content)
    assertEquals("kiosk", code.single().body!!["mode"]!!.jsonPrimitive.content)
    assertEquals("654321", made.code)
    assertEquals(1_700_000_600_000.0, made.expiresAtMs)

    val devices = mutableListOf<Seen>()
    val listed = api(
      devices,
      """{"displays":[{"id":"abcd1234abcd1234","label":"Front","mode":"kiosk","createdAtMs":1,"lastSeenAtMs":2},{"id":"0000111122223333","label":"Old","createdAtMs":1,"lastSeenAtMs":2}]}""",
    ).devices("r1")
    assertEquals("displays", devices.single().body!!["action"]!!.jsonPrimitive.content)
    assertEquals(listOf(PosDeviceMode.KIOSK, PosDeviceMode.DISPLAY), listed.map { it.mode })

    val revoke = mutableListOf<Seen>()
    val count = api(revoke, """{"revoked":2}""").revoke("r1", "*")
    assertEquals("revoke", revoke.single().body!!["action"]!!.jsonPrimitive.content)
    assertEquals("*", revoke.single().body!!["displayId"]!!.jsonPrimitive.content)
    assertEquals(2, count)
  }
}

private object DisplayTestReader : FirestoreReader {
  override suspend fun get(path: String): FirestoreDoc? = null
  override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
}

class RegisterDisplayMirrorTest {
  private fun register(display: ScriptedDisplay, scope: CoroutineScope) = RegisterModel(
    hostId = "h1",
    firestore = DisplayTestReader,
    api = ScriptedSaleApi(),
    terminal = CardReaderSessionSource { error("no card reader in this test") },
    deviceStore = InMemoryKeyValueStore(),
    peripherals = NoPeripherals,
    scope = scope,
    displayApi = display,
  ).also { it.selectRegister(PosRegister("r1", "Front", null)) }

  private val item = PosItem("p1", "Latte", null, listOf(PosVariant("default", null, 450, null, null, 5)), emptyList(), emptyList(), false, 450, 450)

  @Test
  fun theBasketFollowsTheDisplayAndAnEmptiedBasketSendsItIdle() = runTest {
    val api = ScriptedDisplay()
    val model = register(api, this)
    model.display.check()
    model.mirrorToDisplay()
    assertTrue(api.pushes.isEmpty(), "nothing to show and nothing shown")
    model.tap(item)
    model.mirrorToDisplay()
    assertEquals(listOf(PosDisplayMode.CART), api.pushes.map { it.mode })
    assertEquals(450.0, api.pushes.last().cart?.totalCents)
    model.clearCart()
    model.mirrorToDisplay()
    assertEquals(listOf(PosDisplayMode.CART, PosDisplayMode.IDLE), api.pushes.map { it.mode })
    model.mirrorToDisplay()
    assertEquals(2, api.pushes.size, "idle once, not on every beat")
  }

  @Test
  fun nothingIsMirroredToADisplayThatIsNotConnected() = runTest {
    val api = ScriptedDisplay().apply { connected = false }
    val model = register(api, this)
    model.display.check()
    model.tap(item)
    model.mirrorToDisplay()
    assertTrue(api.pushes.isEmpty())
  }
}
