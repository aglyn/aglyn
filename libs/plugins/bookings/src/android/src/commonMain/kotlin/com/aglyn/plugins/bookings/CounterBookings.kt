package com.aglyn.plugins.bookings

import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.hardware.CardCollectOutcome
import com.aglyn.hardware.CardCollectRequest
import com.aglyn.hardware.CardCollector
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import kotlin.math.floor

/*
 * TODAY'S BOOKINGS AT THE COUNTER (`booking-in-person.ts`, AGL-3618).
 *
 * A booking whose price was not charged online (a free booking, or one whose
 * price varies, is an estimate or is "contact") is paid at the counter once
 * the work is done: staff type the amount and the customer taps or inserts a
 * card on this device's reader. Read under the console's own rules (a site
 * member reads `hosts/{hostId}/bookings`); money moves only through
 * `bookings/in-person-payment`, where the server prices, captures and
 * records it.
 */

const val IN_PERSON_ROUTE = "/api/bookings/in-person-payment"

/** A day holds at most this many bookings on the counter list. */
const val COUNTER_BOOKINGS_LIMIT = 100

/** The generated state (`booking-in-person.ts`), ported once in the shared contracts. */
typealias BookingInPersonState = com.aglyn.contracts.BookingInPersonState

/** Where a booking stands for payment at the counter (`bookingInPersonState`). */
fun bookingInPersonState(booking: Map<String, Any?>, nowMs: Long): BookingInPersonState =
  com.aglyn.contracts.bookingInPersonState(booking, nowMs)

/** Null when [serviceCents] is an amount staff may charge; otherwise why not (`bookingInPersonAmountProblem`). */
fun bookingInPersonAmountProblem(serviceCents: Long?): String? = com.aglyn.contracts.bookingInPersonAmountProblem(serviceCents)

/** The amount to suggest: the service's fixed price, when it has one (`bookingSuggestedCents`). */
fun bookingSuggestedCents(service: Map<String, Any?>?): Long? =
  service?.let { com.aglyn.contracts.bookingSuggestedCents(it["priceUsd"], it["priceDisplay"]) }

private fun Any?.number(): Double? = (this as? Number)?.toDouble()?.takeIf { it.isFinite() }

/** The device's offset from UTC in minutes, as JavaScript's `getTimezoneOffset` reports it. */
expect fun deviceUtcOffsetMinutes(atMs: Long): Int

/** "9:00 AM" on this device's clock. */
expect fun formatBookingTime(atMs: Long): String

/** The start and end of the local day that holds [atMs] (`bookingDayRange`). */
fun bookingDayRange(atMs: Long, offsetMinutes: Int = deviceUtcOffsetMinutes(atMs)): LongRange {
  val local = atMs - offsetMinutes * 60_000L
  val dayStart = local.floorDiv(86_400_000L) * 86_400_000L
  val start = dayStart + offsetMinutes * 60_000L
  return start until start + 86_400_000L
}

data class CounterBooking(
  val id: String,
  val serviceId: String,
  val serviceName: String,
  val name: String,
  val startsAtMs: Long,
  val endsAtMs: Long,
  val state: BookingInPersonState,
  /** What a paid booking took, the whole charge. */
  val paidAmountCents: Long,
  /** The service's fixed price, to suggest. */
  val suggestedCents: Long?,
)

fun counterBookingFrom(doc: FirestoreDoc, suggestedCents: Long?, nowMs: Long): CounterBooking {
  val data = doc.data
  return CounterBooking(
    id = doc.id,
    serviceId = data["serviceId"] as? String ?: "",
    serviceName = (data["serviceName"] as? String)?.ifEmpty { null } ?: "Appointment",
    name = (data["name"] as? String)?.ifEmpty { null } ?: (data["email"] as? String)?.ifEmpty { null } ?: "Guest",
    startsAtMs = data["startsAtMs"].number()?.toLong() ?: 0,
    endsAtMs = data["endsAtMs"].number()?.toLong() ?: 0,
    state = bookingInPersonState(data, nowMs),
    paidAmountCents = maxOf(0L, floor((data["paidAmountCents"].number() ?: 0.0) + 0.5).toLong()),
    suggestedCents = suggestedCents,
  )
}

/** Today's bookings, one range on `startsAtMs` (Firestore's automatic single-field index). */
fun todayBookingsQuery(hostId: String, nowMs: Long, offsetMinutes: Int = deviceUtcOffsetMinutes(nowMs)): FirestoreQuery {
  val day = bookingDayRange(nowMs, offsetMinutes)
  return FirestoreQuery(
    collectionPath = "hosts/$hostId/bookings",
    filters = listOf(
      FirestoreFilter("startsAtMs", FilterOp.GTE, day.first),
      FirestoreFilter("startsAtMs", FilterOp.LT, day.last + 1),
    ),
    orderBy = listOf(FirestoreOrder("startsAtMs")),
    limit = COUNTER_BOOKINGS_LIMIT,
  )
}

sealed interface InPersonOutcome {
  data class Paid(val amountCents: Long) : InPersonOutcome
  data object Canceled : InPersonOutcome
  data class Failed(val message: String) : InPersonOutcome
}

data class PricedCharge(val amountCents: Long, val taxCents: Long)

private fun JsonElement?.field(name: String): JsonElement? = (this as? JsonObject)?.get(name)
private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
private fun JsonElement?.cents(): Long = (this as? JsonPrimitive)?.doubleOrNull?.let { floor(it + 0.5).toLong() } ?: 0

/**
 * One in-person booking payment, end to end: `start` (the server prices it
 * and makes the intent), this device's reader collects the card, `settle`
 * (the server reads Stripe and captures). A failed or canceled collection
 * releases the intent so the booking is payable again; a collection whose
 * answer was lost is settled anyway, because the server's read of Stripe
 * decides and an authorization is captured exactly once.
 */
suspend fun takeBookingPayment(
  api: ConsoleApiClient,
  reader: CardCollector,
  hostId: String,
  bookingId: String,
  serviceCents: Long,
  /** One per press of "Charge": a retry of the same press replays. */
  attemptKey: String,
  onPriced: (PricedCharge) -> Unit = {},
): InPersonOutcome {
  bookingInPersonAmountProblem(serviceCents)?.let { return InPersonOutcome.Failed(it) }
  val body = { action: String -> buildJsonObject { put("hostId", hostId); put("bookingId", bookingId); put("action", action) } }
  val started = try {
    api.request(
      IN_PERSON_ROUTE,
      ApiMethod.POST,
      buildJsonObject {
        put("hostId", hostId)
        put("bookingId", bookingId)
        put("action", "start")
        put("amountCents", serviceCents)
      },
      idempotencyKey = attemptKey,
    )
  } catch (error: Throwable) {
    if (error is CancellationException) throw error
    return InPersonOutcome.Failed(error.message ?: "The payment could not be started. Try again.")
  }
  val intent = started.field("paymentIntentId").text() ?: ""
  val secret = started.field("clientSecret").text() ?: ""
  val amount = started.field("amountCents").cents()
  onPriced(PricedCharge(amount, started.field("taxCents").cents()))

  val collected = try {
    reader.collect(CardCollectRequest(intent, secret, amount))
  } catch (error: Throwable) {
    if (error is CancellationException) throw error
    null
  }
  suspend fun release() {
    runCatching { api.request(IN_PERSON_ROUTE, ApiMethod.POST, body("cancel")) }.exceptionOrNull()?.let { if (it is CancellationException) throw it }
  }
  when (collected) {
    is CardCollectOutcome.Canceled -> {
      release()
      return InPersonOutcome.Canceled
    }
    is CardCollectOutcome.Failed -> {
      release()
      return InPersonOutcome.Failed(collected.message.ifEmpty { "The card was not taken." })
    }
    else -> Unit
  }
  return try {
    val settled = api.request(IN_PERSON_ROUTE, ApiMethod.POST, body("settle"))
    if (settled.field("status").text() == "paid") {
      InPersonOutcome.Paid(settled.field("amountCents").cents().takeIf { it > 0 } ?: amount)
    } else {
      release()
      InPersonOutcome.Failed("The card was not charged. Try again.")
    }
  } catch (error: Throwable) {
    if (error is CancellationException) throw error
    InPersonOutcome.Failed(error.message ?: "The payment could not be confirmed. Check the booking before charging again.")
  }
}
