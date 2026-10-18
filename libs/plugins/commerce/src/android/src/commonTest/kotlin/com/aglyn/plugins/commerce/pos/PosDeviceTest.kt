package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.PosDeviceMode
import com.aglyn.contracts.PosDisplayCart
import com.aglyn.contracts.PosDisplayLine
import com.aglyn.contracts.PosDisplayMode
import com.aglyn.contracts.PosDisplayResponseTipChoice
import com.aglyn.contracts.PosDisplayState
import com.aglyn.contracts.PosDisplayStateProcessing
import com.aglyn.contracts.PosDisplayStateReceipt
import com.aglyn.contracts.PosDisplayStateTip
import com.aglyn.contracts.PosReceiptChannel
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
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun state(
  mode: PosDisplayMode,
  promptId: String? = null,
  cart: PosDisplayCart? = null,
  tip: PosDisplayStateTip? = null,
  receipt: PosDisplayStateReceipt? = null,
  processing: PosDisplayStateProcessing? = null,
  updatedAtMs: Double = 1.0,
) = PosDisplayState(cart = cart, currency = "usd", mode = mode, processing = processing, promptId = promptId, receipt = receipt, tip = tip, updatedAtMs = updatedAtMs)

private val basket = PosDisplayCart(
  discountCents = 0.0, itemsCents = 900.0, lines = listOf(PosDisplayLine(amountCents = 900.0, name = "Latte", quantity = 2.0, variantLabel = "Large")), taxCents = 0.0, totalCents = 900.0,
)

private class ScriptedDevice : PosDeviceApi {
  val calls = mutableListOf<String>()
  var pairing: Result<PosPaired> = Result.success(PosPaired("tok-1", PosDeviceMode.DISPLAY, null))
  val polls = ArrayDeque<Result<PosDevicePoll>>()
  var respondFailure: ConsoleApiError? = null
  val answers = mutableListOf<PosDisplayAnswer>()

  override suspend fun pair(code: String, mode: PosDeviceMode): PosPaired {
    calls += "pair $code ${mode.raw}"
    return pairing.getOrThrow()
  }

  override suspend fun poll(token: String, withBranding: Boolean): PosDevicePoll {
    calls += "poll $token $withBranding"
    val next = polls.removeFirstOrNull() ?: throw ConsoleApiError("lost", 0, null)
    return next.getOrThrow()
  }

  override suspend fun respond(token: String, answer: PosDisplayAnswer) {
    calls += "respond $token ${answer.promptId}"
    respondFailure?.let { throw it }
    answers += answer
  }

  override suspend fun forget(token: String) {
    calls += "forget $token"
  }
}

private fun read(state: PosDisplayState, answered: Boolean = false) = Result.success(PosDevicePoll(PosDisplayView(state, answered), null))

class PosCustomerDisplayModelTest {
  private class Clock(var ms: Long = 1_000_000)

  private fun model(api: ScriptedDevice, store: InMemoryKeyValueStore = InMemoryKeyValueStore(), clock: Clock = Clock()) =
    PosCustomerDisplayModel(api, PosDeviceTokenStore(store, PosDeviceMode.DISPLAY)) { clock.ms }

  @Test
  fun anUnpairedDisplayAsksForACodeAndAPairedOneComesBackAfterARelaunch() = runTest {
    val store = InMemoryKeyValueStore()
    val api = ScriptedDevice()
    val first = model(api, store)
    first.start()
    assertNull(first.token)
    first.pair("123 456")
    assertEquals(listOf("pair 123456 display"), api.calls)
    assertEquals("tok-1", first.token)
    val again = model(api, store)
    again.start()
    assertEquals("tok-1", again.token, "the token is the one thing the tablet keeps")
  }

  @Test
  fun aShortCodeIsNotSent() = runTest {
    val api = ScriptedDevice()
    val display = model(api)
    display.start()
    display.pair("12345")
    assertTrue(api.calls.isEmpty())
  }

  @Test
  fun aWrongCodeShowsTheRoutesWords() = runTest {
    val api = ScriptedDevice().apply { pairing = Result.failure(ConsoleApiError("That code is not valid. Show a new code on the register.", 404, null)) }
    val display = model(api)
    display.start()
    display.pair("000000")
    assertNull(display.token)
    assertEquals("That code is not valid. Show a new code on the register.", display.pairError)
  }

  @Test
  fun theScreenFollowsTheRegistersMode() = runTest {
    val api = ScriptedDevice()
    val display = model(api)
    display.start()
    display.pair("123456")
    assertEquals(PosDisplayScreen.Idle, display.screen)
    api.polls += read(state(PosDisplayMode.CART, cart = basket))
    display.poll()
    assertEquals(PosDisplayScreen.Cart(basket), display.screen)
    assertEquals(POS_DISPLAY_ACTIVE_POLL_MS, display.pollDelayMs)
    api.polls += read(state(PosDisplayMode.IDLE))
    display.poll()
    assertEquals(POS_DISPLAY_IDLE_POLL_MS, display.pollDelayMs)

    val tip = PosDisplayStateTip(allowCustom = true, baseCents = 900.0, percentages = listOf(15.0, 20.0))
    api.polls += read(state(PosDisplayMode.TIP, promptId = "p1", tip = tip))
    display.poll()
    assertEquals(PosDisplayScreen.Tip(tip, "p1"), display.screen)

    val receipt = PosDisplayStateReceipt(listOf(PosReceiptChannel.EMAIL, PosReceiptChannel.PRINT, PosReceiptChannel.NONE), true)
    api.polls += read(state(PosDisplayMode.RECEIPT, promptId = "p2", receipt = receipt))
    display.poll()
    assertEquals(PosDisplayScreen.Receipt(receipt, "p2"), display.screen)

    api.polls += read(
      state(
        PosDisplayMode.PROCESSING,
        cart = PosDisplayCart(discountCents = 0.0, dueCents = 500.0, itemsCents = 900.0, lines = emptyList(), paidCents = 400.0, taxCents = 0.0, totalCents = 900.0),
        processing = PosDisplayStateProcessing("Tap your card."),
      ),
    )
    display.poll()
    assertEquals(PosDisplayScreen.Processing("Tap your card.", 500), display.screen)
  }

  @Test
  fun aPromptWithoutItsInputsFallsBackToTheBasketOrIdle() = runTest {
    val api = ScriptedDevice()
    val display = model(api)
    display.start()
    display.pair("123456")
    api.polls += read(state(PosDisplayMode.TIP, promptId = "p1", cart = basket))
    display.poll()
    assertEquals(PosDisplayScreen.Cart(basket), display.screen)
    api.polls += read(state(PosDisplayMode.RECEIPT))
    display.poll()
    assertEquals(PosDisplayScreen.Idle, display.screen)
  }

  @Test
  fun anAnsweredPromptWaitsForTheCashierWhetherThisScreenOrAnotherAnsweredIt() = runTest {
    val api = ScriptedDevice()
    val display = model(api)
    display.start()
    display.pair("123456")
    val tip = PosDisplayStateTip(allowCustom = false, baseCents = 900.0, percentages = listOf(15.0))
    api.polls += read(state(PosDisplayMode.TIP, promptId = "p1", tip = tip))
    display.poll()
    display.answer(PosDisplayAnswer("p1", tipChoice = PosDisplayResponseTipChoice.PERCENT, tipPercent = 15.0))
    assertEquals("respond tok-1 p1", api.calls.last())
    assertEquals(PosDisplayScreen.Answered, display.screen, "the answer shows at once, before the next poll")
    api.polls += read(state(PosDisplayMode.TIP, promptId = "p3", tip = tip), answered = true)
    display.poll()
    assertEquals(PosDisplayScreen.Answered, display.screen, "answered somewhere else")
  }

  @Test
  fun aThankYouReturnsToIdleOnItsOwn() = runTest {
    val clock = Clock()
    val api = ScriptedDevice()
    val display = model(api, clock = clock)
    display.start()
    display.pair("123456")
    api.polls += read(state(PosDisplayMode.THANKS, updatedAtMs = 5.0))
    display.poll()
    assertEquals(PosDisplayScreen.Thanks, display.screen)
    clock.ms += Contracts.posDisplayThanksMs + 1
    assertEquals(PosDisplayScreen.Idle, display.screen)
  }

  @Test
  fun anUnpairedTokenSendsTheDisplayBackToPairing() = runTest {
    val store = InMemoryKeyValueStore()
    val api = ScriptedDevice()
    val display = model(api, store)
    display.start()
    display.pair("123456")
    api.polls += Result.failure(ConsoleApiError("This display is not paired.", 401, null))
    display.poll()
    assertNull(display.token)
    assertNull(PosDeviceTokenStore(store, PosDeviceMode.DISPLAY).token)
  }

  @Test
  fun aLostConnectionKeepsTheScreenAndSaysItIsReconnecting() = runTest {
    val api = ScriptedDevice()
    val display = model(api)
    display.start()
    display.pair("123456")
    api.polls += read(state(PosDisplayMode.CART, cart = basket))
    display.poll()
    display.poll()
    assertTrue(display.offline)
    assertEquals(PosDisplayScreen.Cart(basket), display.screen)
    api.polls += read(state(PosDisplayMode.CART, cart = basket))
    display.poll()
    assertFalse(display.offline)
  }

  @Test
  fun aScreenThatMovedOnSaysSoAndAnUnpairedOneLeaves() = runTest {
    val api = ScriptedDevice()
    val display = model(api)
    display.start()
    display.pair("123456")
    api.respondFailure = ConsoleApiError("x", 409, null)
    display.answer(PosDisplayAnswer("old", tipChoice = PosDisplayResponseTipChoice.NONE))
    assertEquals("That screen has moved on. Check the display.", display.notice)
    api.respondFailure = ConsoleApiError("x", 401, null)
    display.answer(PosDisplayAnswer("old", tipChoice = PosDisplayResponseTipChoice.NONE))
    assertNull(display.token)
  }

  @Test
  fun unpairingForgetsTheTokenOnTheServerToo() = runTest {
    val api = ScriptedDevice()
    val display = model(api)
    display.start()
    display.pair("123456")
    display.unpair()
    assertEquals("forget tok-1", api.calls.last())
    assertNull(display.token)
  }

  @Test
  fun brandingIsReReadWhenItIsStale() = runTest {
    val clock = Clock()
    val api = ScriptedDevice()
    val display = model(api, clock = clock)
    display.start()
    display.pair("123456")
    api.polls += read(state(PosDisplayMode.IDLE))
    api.polls += read(state(PosDisplayMode.IDLE))
    display.poll()
    clock.ms += POS_DEVICE_BRANDING_REFRESH_MS + 1
    display.poll()
    assertEquals(listOf("poll tok-1 false", "poll tok-1 true"), api.calls.filter { it.startsWith("poll") })
  }
}

class PosDisplayAnswerTest {
  @Test
  fun theAnswerCarriesOnlyWhatTheCustomerChose() {
    val percent = PosDisplayAnswer("p", tipChoice = PosDisplayResponseTipChoice.PERCENT, tipPercent = 20.0).toJson()
    assertEquals(setOf("promptId", "tipChoice", "tipPercent"), percent.keys)
    assertEquals("percent", percent["tipChoice"]!!.jsonPrimitive.content)
    assertEquals(setOf("promptId", "tipChoice", "tipCents"), PosDisplayAnswer("p", tipChoice = PosDisplayResponseTipChoice.CUSTOM, tipCents = 350).toJson().keys)
    val email = PosDisplayAnswer("p", receiptChannel = PosReceiptChannel.EMAIL, email = "a@b.co", marketingOptIn = true).toJson()
    assertEquals("a@b.co", email["email"]!!.jsonPrimitive.content)
    assertEquals(JsonPrimitive(true), email["marketingOptIn"])
    assertEquals("+15550100199", PosDisplayAnswer("p", receiptChannel = PosReceiptChannel.SMS, phone = "+15550100199").toJson()["phone"]!!.jsonPrimitive.content)
  }
}

class ConsolePosDeviceApiTest {
  private val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")

  private class Seen(val method: HttpMethod, val path: String, val query: String, val body: JsonObject?, val token: String?, val authorization: String?)

  private fun api(seen: MutableList<Seen>, answer: String): ConsolePosDeviceApi {
    val engine = MockEngine { request ->
      val raw = request.body.toByteArray().decodeToString()
      seen += Seen(
        request.method, request.url.encodedPath, request.url.encodedQuery, raw.takeIf { it.isNotBlank() }?.let { Json.parseToJsonElement(it).jsonObject },
        request.headers["X-Pos-Display-Token"], request.headers["Authorization"],
      )
      respond(answer, HttpStatusCode.OK, jsonHeaders)
    }
    // No token source answers: a paired screen is anonymous, so a call that asked for one would fail.
    return ConsolePosDeviceApi(ConsoleApiClient("https://console.test", HttpClient(engine), { null }, maxAttempts = 1))
  }

  @Test
  fun pairingSendsTheCodeAndTheKindOfScreenWithoutASession() = runTest {
    val seen = mutableListOf<Seen>()
    val paired = api(
      seen,
      """{"token":"abc","mode":"display","branding":{"name":"Corner Cafe","logoUrl":"https://x.test/l.png","logoDarkUrl":null,"message":"Welcome in"}}""",
    ).pair("123456", PosDeviceMode.DISPLAY)
    val request = seen.single()
    assertEquals("/api/commerce/pos-display", request.path)
    assertNull(request.authorization)
    assertEquals("pair", request.body!!["action"]!!.jsonPrimitive.content)
    assertEquals("123456", request.body["code"]!!.jsonPrimitive.content)
    assertEquals("display", request.body["mode"]!!.jsonPrimitive.content)
    assertEquals("Customer display", request.body["label"]!!.jsonPrimitive.content)
    assertEquals("abc", paired.token)
    assertEquals("Corner Cafe", paired.branding?.name)
    assertEquals("https://x.test/l.png", paired.branding?.logoUrl)
    assertNull(paired.branding?.logoDarkUrl)
  }

  @Test
  fun aLogoFromTheSitesLibraryIsServedFromTheConsoleTheScreenIsPairedWith() = runTest {
    // The route resolves a library logo to a path on the console's media CDN; a path is not an address on its own.
    val paired = api(
      mutableListOf(),
      """{"token":"abc","mode":"kiosk","branding":{"name":"Corner Cafe","logoUrl":"/api/media/cdn/h1/logo","logoDarkUrl":"media:h1/dark","message":"Hi"}}""",
    ).pair("123456", PosDeviceMode.KIOSK)
    assertEquals("https://console.test/api/media/cdn/h1/logo?w=640", paired.branding?.logoUrl)
    assertEquals("https://console.test/api/media/cdn/h1/dark?w=640", paired.branding?.logoDarkUrl)
  }

  @Test
  fun aPollCarriesTheTokenInItsHeaderAndReadsTheScreen() = runTest {
    val seen = mutableListOf<Seen>()
    val answer = api(
      seen,
      """{"state":{"mode":"cart","updatedAtMs":5,"currency":"usd","answered":false,"cart":{"lines":[{"name":"Latte","quantity":2,"amountCents":900}],"itemsCents":900,"discountCents":0,"taxCents":0,"totalCents":900}},"branding":{"name":"Cafe","logoUrl":null,"logoDarkUrl":null,"message":"Hi"}}""",
    ).poll("tok", true)
    val request = seen.single()
    assertEquals(HttpMethod.Get, request.method)
    assertEquals("tok", request.token)
    assertNull(request.authorization)
    assertTrue("action=poll" in request.query && "branding=true" in request.query)
    assertEquals(PosDisplayMode.CART, answer.view.state.mode)
    assertFalse(answer.view.answered)
    assertEquals("Latte", answer.view.state.cart?.lines?.first()?.name)
    assertEquals("Hi", answer.branding?.message)
    val plain = mutableListOf<Seen>()
    val idle = api(plain, """{"state":{"mode":"idle","updatedAtMs":5,"answered":true}}""").poll("tok", false)
    assertFalse("branding" in plain.single().query)
    assertTrue(idle.view.answered)
  }

  @Test
  fun respondAndForgetNameTheTokenAndTheAnswer() = runTest {
    val respond = mutableListOf<Seen>()
    api(respond, """{"ok":true}""").respond("tok", PosDisplayAnswer("p", tipChoice = PosDisplayResponseTipChoice.PERCENT, tipPercent = 15.0))
    assertEquals("tok", respond.single().token)
    assertEquals("respond", respond.single().body!!["action"]!!.jsonPrimitive.content)
    assertEquals("p", respond.single().body!!["response"]!!.jsonObject["promptId"]!!.jsonPrimitive.content)
    val forget = mutableListOf<Seen>()
    api(forget, """{"ok":true}""").forget("tok")
    assertEquals("forget", forget.single().body!!["action"]!!.jsonPrimitive.content)
    assertEquals("tok", forget.single().token)
  }
}
