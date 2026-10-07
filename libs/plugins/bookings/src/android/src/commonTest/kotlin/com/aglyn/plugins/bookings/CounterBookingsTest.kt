package com.aglyn.plugins.bookings

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.hardware.CardCollectOutcome
import com.aglyn.hardware.CardCollectRequest
import com.aglyn.hardware.CardCollector
import com.aglyn.hardware.CardCollectorKind
import com.aglyn.hardware.CardCollectorState
import com.aglyn.hardware.CardReaderSessionSource
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private const val NOW = 1_791_385_200_000L

class BookingInPersonTest {
  @Test
  fun readsWhereABookingStandsForPayment() {
    val cases = listOf(
      mapOf("status" to "confirmed") to BookingInPersonState.PAYABLE,
      mapOf("status" to "confirmed", "paidAmountCents" to 5000L) to BookingInPersonState.PAID,
      mapOf("status" to "confirmed", "paymentIntentId" to "pi_1") to BookingInPersonState.PAID,
      mapOf("status" to "confirmed", "inPersonPayment" to mapOf("status" to "paid")) to BookingInPersonState.PAID,
      mapOf("status" to "confirmed", "inPersonPayment" to mapOf("status" to "pending")) to BookingInPersonState.COLLECTING,
      mapOf("status" to "confirmed", "inPersonPayment" to mapOf("status" to "canceled")) to BookingInPersonState.PAYABLE,
      mapOf("status" to "canceled") to BookingInPersonState.CANCELED,
      mapOf("status" to "pendingPayment", "expiresAtMs" to NOW + 1) to BookingInPersonState.AWAITING_ONLINE,
      mapOf("status" to "pendingPayment", "expiresAtMs" to NOW - 1) to BookingInPersonState.CANCELED,
      mapOf("paidAmountCents" to 5000L, "refundedCents" to 5000L, "paymentIntentId" to "pi_1") to BookingInPersonState.PAID,
    )
    for ((booking, state) in cases) assertEquals(state, bookingInPersonState(booking, NOW), booking.toString())
  }

  @Test
  fun takesWholeCentsBetweenFiftyCentsAndTenThousandDollars() {
    assertNull(bookingInPersonAmountProblem(50))
    assertNull(bookingInPersonAmountProblem(1_000_000))
    assertEquals("Card payments start at $0.50.", bookingInPersonAmountProblem(49))
    assertEquals("Charge at most $10,000 at a time.", bookingInPersonAmountProblem(1_000_001))
    assertEquals("Enter the amount to charge.", bookingInPersonAmountProblem(null))
  }

  @Test
  fun suggestsAFixedPriceAndNothingForOneThatVaries() {
    assertEquals(4500L, bookingSuggestedCents(mapOf("priceUsd" to 45L)))
    assertEquals(4500L, bookingSuggestedCents(mapOf("priceUsd" to 45L, "priceDisplay" to "fixed")))
    assertNull(bookingSuggestedCents(mapOf("priceUsd" to 45L, "priceDisplay" to "varies")))
    assertNull(bookingSuggestedCents(mapOf("priceUsd" to 0L)))
    assertNull(bookingSuggestedCents(null))
  }

  @Test
  fun spansTheLocalDayThatHoldsTheMoment() {
    // 2026-10-07 15:00 UTC, in UTC-5.
    val at = 1_791_385_200_000L
    val day = bookingDayRange(at, 300)
    assertEquals(1_791_349_200_000L, day.first)
    assertEquals(86_400_000L, day.last + 1 - day.first)
    // 02:00 UTC on the 8th is still the 7th in UTC-5.
    assertEquals(day.first, bookingDayRange(1_791_424_800_000L, 300).first)
  }

  @Test
  fun readsTodaysBookingsAsOneRangeOnStart() {
    val query = todayBookingsQuery("h1", 1_791_385_200_000L, 300)
    assertEquals("hosts/h1/bookings", query.collectionPath)
    assertEquals(listOf(FilterOp.GTE to 1_791_349_200_000L, FilterOp.LT to 1_791_435_600_000L), query.filters.map { it.op to it.value })
    assertEquals("startsAtMs", query.orderBy.single().field)
  }

  @Test
  fun readsACounterRow() {
    val row = counterBookingFrom(FirestoreDoc("b1", "x", mapOf("email" to "ada@example.test", "startsAtMs" to 5L, "status" to "confirmed")), 4500, NOW)
    assertEquals("ada@example.test", row.name)
    assertEquals("Appointment", row.serviceName)
    assertEquals(BookingInPersonState.PAYABLE, row.state)
    assertEquals(4500L, row.suggestedCents)
  }
}

private class Reader(val outcome: (CardCollectRequest) -> CardCollectOutcome) : CardCollector {
  override val state = MutableStateFlow<CardCollectorState>(CardCollectorState.Connected("Simulated", CardCollectorKind.SIMULATED, true))
  val asked = mutableListOf<CardCollectRequest>()
  override suspend fun connect(hostId: String, sessions: CardReaderSessionSource) = state.value
  override suspend fun collect(request: CardCollectRequest): CardCollectOutcome = outcome(request.also { asked += it })
  override suspend fun cancel() = Unit
}

class TakeBookingPaymentTest {
  private class Route(answers: Map<String, String>) {
    val actions = mutableListOf<Pair<String, String?>>()
    val client = ConsoleApiClient(
      "http://localhost",
      HttpClient(
        MockEngine { request ->
          val body = Json.parseToJsonElement(request.body.toByteArray().decodeToString()).jsonObject
          val action = body["action"]!!.jsonPrimitive.content
          actions += action to request.headers["Idempotency-Key"]
          respond(answers[action] ?: "{}", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        },
      ),
      getIdToken = { "token" },
    )
  }

  private val started = """{"paymentIntentId":"pi_123456789","clientSecret":"pi_123456789_secret_abcdefghij","amountCents":4860,"serviceCents":4500,"taxCents":360}"""

  @Test
  fun startsCollectsTheTaxedAmountAndSettles() = runTest {
    val route = Route(mapOf("start" to started, "settle" to """{"status":"paid","amountCents":4860}"""))
    val reader = Reader { CardCollectOutcome.Collected(it.paymentIntentId, it.amountCents) }
    var priced: PricedCharge? = null
    val outcome = takeBookingPayment(route.client, reader, "h1", "b1", 4500, "press-1") { priced = it }
    assertEquals(InPersonOutcome.Paid(4860), outcome)
    assertEquals(PricedCharge(4860, 360), priced)
    assertEquals(listOf("start" to "press-1", "settle" to null), route.actions)
    assertEquals(4860L, reader.asked.single().amountCents)
  }

  @Test
  fun releasesTheIntentWhenTheCardIsNotTaken() = runTest {
    val route = Route(mapOf("start" to started))
    val outcome = takeBookingPayment(route.client, Reader { CardCollectOutcome.Canceled(it.paymentIntentId) }, "h1", "b1", 4500, "k")
    assertEquals(InPersonOutcome.Canceled, outcome)
    assertEquals(listOf("start", "cancel"), route.actions.map { it.first })
  }

  @Test
  fun settlesAnywayWhenTheReadersAnswerIsLost() = runTest {
    val route = Route(mapOf("start" to started, "settle" to """{"status":"paid","amountCents":4860}"""))
    val outcome = takeBookingPayment(route.client, Reader { throw IllegalStateException("gone") }, "h1", "b1", 4500, "k")
    assertEquals(InPersonOutcome.Paid(4860), outcome)
  }

  @Test
  fun refusesAnAmountBeforeAnyCall() = runTest {
    val route = Route(emptyMap())
    assertEquals(InPersonOutcome.Failed("Card payments start at $0.50."), takeBookingPayment(route.client, Reader { error("no") }, "h1", "b1", 10, "k"))
    assertEquals(emptyList(), route.actions)
  }
}
