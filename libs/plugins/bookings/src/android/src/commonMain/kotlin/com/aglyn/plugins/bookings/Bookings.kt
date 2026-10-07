package com.aglyn.plugins.bookings

import com.aglyn.contracts.BookingActions
import com.aglyn.contracts.BookingInPersonState
import com.aglyn.contracts.BookingServiceDraft
import com.aglyn.contracts.BookingState
import com.aglyn.contracts.ManagedBooking
import com.aglyn.contracts.bookingActions
import com.aglyn.contracts.bookingInPersonState
import com.aglyn.contracts.bookingPriceText
import com.aglyn.contracts.bookingServiceFields
import com.aglyn.contracts.bookingServiceFirestoreFields
import com.aglyn.contracts.bookingState
import com.aglyn.contracts.managedBookingOf
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.firestoreNow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/*
 * A SITE'S BOOKINGS AND SERVICES, as the console's Bookings page reads and
 * writes them: `hosts/{hostId}/bookings` and `hosts/{hostId}/services`, read
 * by a site member under the same rules. A booking is checked in, moved,
 * refunded or canceled only through the routes the console and the routes'
 * own rules use (`bookings/check-in`, `bookings/reschedule`,
 * `bookings/refund`); a booking with nothing to refund is canceled with the
 * console's own write. A service is created through `/api/hosts/resources`
 * (the quota gate) and edited, offered, withdrawn and deleted with the
 * console's own writes, through the shared form rules.
 */

const val CHECK_IN_ROUTE = "/api/bookings/check-in"
const val RESCHEDULE_ROUTE = "/api/bookings/reschedule"
const val REFUND_ROUTE = "/api/bookings/refund"
const val SLOTS_ROUTE = "/api/bookings/slots"
const val HOST_RESOURCES_ROUTE = "/api/hosts/resources"

/** A calendar range reads at most this many bookings; the console's page reads 100. */
const val BOOKINGS_RANGE_LIMIT = 500

/** The services window the console's page holds whole. */
const val SERVICES_WINDOW = 100

fun bookingsPath(hostId: String) = "hosts/$hostId/bookings"
fun servicesPath(hostId: String) = "hosts/$hostId/services"

data class BookingRow(
  val id: String,
  val serviceId: String,
  val serviceName: String,
  val name: String,
  val email: String?,
  val phone: String?,
  val address: String?,
  val startsAtMs: Long,
  val endsAtMs: Long,
  /** The zone the guest booked in, when the booking carries one. */
  val timeZone: String?,
  val managed: ManagedBooking,
  val checkedInAtMs: Long?,
  val paidAmountCents: Long,
  val refundedCents: Long,
  val paidInPerson: Boolean,
  val crmRef: String?,
  val rescheduledFromMs: Long?,
  val reminderSent: Boolean,
  val raw: Map<String, Any?>,
) {
  fun state(nowMs: Long): BookingState = bookingState(managed, nowMs)
  fun actions(nowMs: Long): BookingActions = bookingActions(managed, nowMs)
  fun payment(nowMs: Long): BookingInPersonState = bookingInPersonState(raw, nowMs)
}

private fun Any?.long(): Long? = (this as? Number)?.toDouble()?.takeIf { it.isFinite() }?.let { kotlin.math.floor(it + 0.5).toLong() }

fun bookingRowOf(doc: FirestoreDoc): BookingRow {
  val data = doc.data
  return BookingRow(
    id = doc.id,
    serviceId = data["serviceId"] as? String ?: "",
    serviceName = (data["serviceName"] as? String)?.ifEmpty { null } ?: "Appointment",
    name = (data["name"] as? String)?.ifEmpty { null } ?: (data["email"] as? String)?.ifEmpty { null } ?: "Guest",
    email = (data["email"] as? String)?.ifEmpty { null },
    phone = (data["phone"] as? String)?.ifEmpty { null },
    address = (data["address"] as? String)?.ifEmpty { null },
    startsAtMs = data["startsAtMs"].long() ?: 0,
    endsAtMs = data["endsAtMs"].long() ?: 0,
    timeZone = (data["timezone"] as? String)?.ifEmpty { null },
    managed = managedBookingOf(data),
    checkedInAtMs = data["checkedInAtMs"].long()?.takeIf { it > 0 },
    paidAmountCents = maxOf(0L, data["paidAmountCents"].long() ?: 0),
    refundedCents = maxOf(0L, data["refundedCents"].long() ?: 0),
    paidInPerson = data["paidInPerson"] == true,
    crmRef = (data["crmRef"] as? String)?.ifEmpty { null },
    rescheduledFromMs = data["rescheduledFromMs"].long(),
    reminderSent = data["reminderSentAt"] != null,
    raw = data,
  )
}

/** Bookings starting in [fromMs, toMs), one range on `startsAtMs`; with a service, the `(serviceId, startsAtMs)` index. */
fun bookingsRangeQuery(hostId: String, fromMs: Long, toMs: Long, serviceId: String? = null): FirestoreQuery = FirestoreQuery(
  collectionPath = bookingsPath(hostId),
  filters = listOfNotNull(
    serviceId?.let { FirestoreFilter("serviceId", FilterOp.EQ, it) },
    FirestoreFilter("startsAtMs", FilterOp.GTE, fromMs),
    FirestoreFilter("startsAtMs", FilterOp.LT, toMs),
  ),
  orderBy = listOf(FirestoreOrder("startsAtMs")),
  limit = BOOKINGS_RANGE_LIMIT,
)

/** One booker's bookings, newest first: the `(email, startsAtMs)` index the console's `?email=` view reads. */
fun bookerBookingsQuery(hostId: String, email: String, limit: Int): FirestoreQuery = FirestoreQuery(
  collectionPath = bookingsPath(hostId),
  filters = listOf(FirestoreFilter("email", FilterOp.EQ, email.trim().lowercase())),
  orderBy = listOf(FirestoreOrder("startsAtMs", descending = true)),
  limit = limit + 1,
)

/** Upcoming bookings from [fromMs], soonest first, [limit] plus a probe row. */
fun upcomingBookingsQuery(hostId: String, fromMs: Long, limit: Int): FirestoreQuery = FirestoreQuery(
  collectionPath = bookingsPath(hostId),
  filters = listOf(FirestoreFilter("startsAtMs", FilterOp.GTE, fromMs)),
  orderBy = listOf(FirestoreOrder("startsAtMs")),
  limit = limit + 1,
)

fun servicesQuery(hostId: String): FirestoreQuery = FirestoreQuery(servicesPath(hostId), limit = SERVICES_WINDOW)

/** The console's reminder line: due in the next pass, and already sent. */
fun reminderCounts(rows: List<BookingRow>, nowMs: Long): Pair<Int, Int> =
  rows.count { com.aglyn.contracts.isBookingReminderDue(it.raw, nowMs) } to rows.count { it.reminderSent }

data class ServiceRow(
  val id: String,
  val name: String,
  val durationMinutes: Long,
  val priceText: String,
  val timeZone: String,
  val draft: Boolean,
  val deleted: Boolean,
  val raw: Map<String, Any?>,
)

fun serviceRowOf(doc: FirestoreDoc): ServiceRow = ServiceRow(
  id = doc.id,
  name = (doc.data["name"] as? String)?.ifEmpty { null } ?: "Untitled service",
  durationMinutes = (doc.data["durationMinutes"] as? Number)?.toLong() ?: 30,
  priceText = bookingPriceText(doc.data["priceUsd"], doc.data["priceDisplay"]),
  timeZone = (doc.data["timezone"] as? String)?.ifEmpty { null } ?: "UTC",
  // `bookingServiceStatus`: absent is active.
  draft = doc.data["status"] == "draft",
  deleted = doc.data["deletedAt"] != null,
  raw = doc.data,
)

/** The console's services list: not deleted, by name. */
fun visibleServices(docs: List<FirestoreDoc>): List<ServiceRow> =
  docs.map(::serviceRowOf).filterNot { it.deleted }.sortedBy { it.name.lowercase() }

/** An open time the slots route answered. */
data class OpenSlots(val slots: List<Long>, val nextFromMs: Long?, val timeZone: String, val horizonDays: Long?)

private fun JsonElement?.field(name: String): JsonElement? = (this as? JsonObject)?.get(name)
private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

/** The writes and route calls the console makes for one site's bookings. */
class BookingsApi(private val api: ConsoleApiClient, private val writer: FirestoreWriter, private val hostId: String) {
  suspend fun checkIn(bookingId: String, checkedIn: Boolean) {
    api.request(CHECK_IN_ROUTE, ApiMethod.POST, buildJsonObject { put("hostId", hostId); put("bookingId", bookingId); put("checkedIn", checkedIn) })
  }

  suspend fun reschedule(bookingId: String, startsAtMs: Long) {
    api.request(RESCHEDULE_ROUTE, ApiMethod.POST, buildJsonObject { put("hostId", hostId); put("bookingId", bookingId); put("startsAtMs", startsAtMs) })
  }

  /**
   * Cancels as the console does: what was paid and not refunded goes back
   * through the refund route, which cancels a fully refunded booking itself;
   * a booking with nothing to refund is canceled with the console's write.
   */
  @OptIn(ExperimentalUuidApi::class)
  suspend fun cancel(row: BookingRow, nowMs: Long, key: String = Uuid.random().toString()) {
    if (row.actions(nowMs).refundCents > 0) {
      api.request(REFUND_ROUTE, ApiMethod.POST, buildJsonObject { put("hostId", hostId); put("bookingId", row.id) }, idempotencyKey = key)
    } else {
      writer.merge("${bookingsPath(hostId)}/${row.id}", mapOf("status" to "canceled"))
    }
  }

  /** Open times for [serviceId] from [fromMs], a page of whole days. */
  suspend fun slots(serviceId: String, fromMs: Long?): OpenSlots {
    val body = api.request(SLOTS_ROUTE, query = mapOf("hostId" to hostId, "serviceId" to serviceId, "from" to fromMs))
    val slots = (body.field("slots") as? JsonArray).orEmpty().mapNotNull { (it.field("startsAtMs") as? JsonPrimitive)?.doubleOrNull?.toLong() }
    return OpenSlots(
      slots = slots,
      nextFromMs = (body.field("nextFromMs") as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull?.toLong(),
      timeZone = body.field("service").field("timezone").text() ?: "UTC",
      horizonDays = (body.field("horizonDays") as? JsonPrimitive)?.longOrNull,
    )
  }

  /** A new service through the quota-checked resources route; returns its id. */
  suspend fun createService(draft: BookingServiceDraft): String? {
    val fields = bookingServiceFirestoreFields(bookingServiceFields(draft))
    val body = api.request(HOST_RESOURCES_ROUTE, ApiMethod.POST, buildJsonObject {
      put("hostId", hostId)
      put("resource", "service")
      put("data", toJson(fields))
    })
    return body.field("id").text()
  }

  /** An edit: every editable key, written as a merge, as the console's dialog does. */
  suspend fun saveService(serviceId: String, draft: BookingServiceDraft) {
    writer.merge("${servicesPath(hostId)}/$serviceId", bookingServiceFirestoreFields(bookingServiceFields(draft)) + ("updatedAt" to firestoreNow()))
  }

  /** Offers a draft or withdraws a live service (`status`), as the console's button does. */
  suspend fun setServiceActive(serviceId: String, active: Boolean) {
    writer.merge("${servicesPath(hostId)}/$serviceId", mapOf("status" to if (active) "active" else "draft", "updatedAt" to firestoreNow()))
  }

  /** The console's soft delete. */
  suspend fun deleteService(serviceId: String) {
    writer.merge("${servicesPath(hostId)}/$serviceId", mapOf("deletedAt" to firestoreNow()))
  }
}

/** Plain values as JSON for a route body. */
fun toJson(value: Any?): JsonElement = when (value) {
  null -> JsonNull
  is JsonElement -> value
  is String -> JsonPrimitive(value)
  is Boolean -> JsonPrimitive(value)
  is Number -> JsonPrimitive(value)
  is FirestoreTimestamp -> JsonPrimitive(value.epochMillis)
  is Map<*, *> -> JsonObject(value.entries.associate { (k, v) -> k.toString() to toJson(v) })
  is List<*> -> JsonArray(value.map { toJson(it) })
  else -> JsonPrimitive(value.toString())
}
