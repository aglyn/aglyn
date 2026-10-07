package com.aglyn.contracts

import kotlin.math.floor

/*
 * The bookings plugin's pure rules, ported once from its model
 * (`booking-manage.ts`, `booking-price.ts`, `booking-in-person.ts`,
 * `booking-service-form.ts`) and held to the console's own answers by the
 * function cases. A screen offers only what the route would then do, and a
 * service editor stores exactly what the console's dialog stores.
 */

private fun jsRound(value: Double): Long = floor(value + 0.5).toLong()

private fun Double?.finite(): Double = this?.takeIf { it.isFinite() } ?: 0.0

/** The booking's state as a reader should treat it: a lapsed payment hold is `expired`. */
fun bookingState(booking: ManagedBooking, nowMs: Long): BookingState = when (booking.status) {
  "canceled" -> BookingState.CANCELED
  "pendingPayment" -> if (booking.expiresAtMs.finite() < nowMs) BookingState.EXPIRED else BookingState.PENDING_PAYMENT
  else -> BookingState.CONFIRMED
}

/** The label the console shows for a state (`BOOKING_STATE_LABELS`). */
fun bookingStateLabel(state: BookingState): String = Contracts.bookingStateLabels[state.raw] ?: state.raw

/** The paid amount not yet refunded, in cents. */
fun bookingOutstandingCents(booking: ManagedBooking): Long {
  val paid = maxOf(0L, jsRound(booking.paidAmountCents.finite()))
  val refunded = maxOf(0L, jsRound(booking.refundedCents.finite()))
  return maxOf(0L, paid - refunded)
}

/** What may be done to a booking now (`bookingActions`). */
fun bookingActions(booking: ManagedBooking, nowMs: Long): BookingActions {
  val state = bookingState(booking, nowMs)
  val confirmed = state == BookingState.CONFIRMED
  val checkedIn = booking.checkedInAtMs.finite() > 0
  val ended = booking.endsAtMs.finite() <= nowMs
  return BookingActions(
    cancel = state != BookingState.CANCELED && !checkedIn,
    checkIn = confirmed && !checkedIn,
    refundCents = bookingOutstandingCents(booking),
    reschedule = confirmed && !checkedIn && !ended,
    undoCheckIn = confirmed && checkedIn,
  )
}

/** Why a check-in (or its undo) cannot be written, or null: the route's own refusal. */
fun checkInRefusal(booking: ManagedBooking, checkedIn: Boolean, nowMs: Long): String? {
  val state = bookingState(booking, nowMs)
  if (state == BookingState.CANCELED) return "This booking was canceled"
  if (state != BookingState.CONFIRMED) return "This booking is not paid yet"
  return if (checkedIn || booking.checkedInAtMs.finite() > 0) null else "This guest is not checked in"
}

/** Why a booking cannot move to [startsAtMs], or null. The slot itself is checked apart. */
fun rescheduleRefusal(booking: ManagedBooking, startsAtMs: Long, nowMs: Long): String? {
  val state = bookingState(booking, nowMs)
  if (state == BookingState.CANCELED) return "This booking was canceled"
  if (state != BookingState.CONFIRMED) return "This booking is not paid yet"
  if (booking.checkedInAtMs.finite() > 0) return "This guest is already checked in"
  if (booking.endsAtMs.finite() <= nowMs) return "This booking has already ended"
  if (startsAtMs <= nowMs) return "Pick a time that has not passed"
  return null
}

/** The booking's length, kept when it moves: what the guest booked, not what the service says today. */
fun bookingDurationMs(booking: ManagedBooking, fallbackMinutes: Double): Long {
  val stored = booking.endsAtMs.finite() - booking.startsAtMs.finite()
  if (stored > 0) return stored.toLong()
  val minutes = if (fallbackMinutes.isFinite() && fallbackMinutes != 0.0) fallbackMinutes else 30.0
  return maxOf(5L, jsRound(minutes)) * 60_000L
}

/** A stored price label as one of the four; anything unrecognized is `fixed`. */
fun bookingPriceDisplay(value: Any?): BookingPriceDisplay = when (value) {
  "varies" -> BookingPriceDisplay.VARIES
  "estimate" -> BookingPriceDisplay.ESTIMATE
  "contact" -> BookingPriceDisplay.CONTACT
  else -> BookingPriceDisplay.FIXED
}

/** A JavaScript `Number(value)`: numbers as they are, numeric text read, anything else not a number. */
private fun jsNumber(value: Any?): Double = when (value) {
  null -> 0.0
  is Number -> value.toDouble()
  is Boolean -> if (value) 1.0 else 0.0
  is String -> value.trim().let { if (it.isEmpty()) 0.0 else it.toDoubleOrNull() ?: Double.NaN }
  else -> Double.NaN
}

/** What booking the service charges, in dollars: its price when it states one, else 0. */
fun bookingChargeUsd(priceUsd: Any?, priceDisplay: Any?): Double {
  if (bookingPriceDisplay(priceDisplay) != BookingPriceDisplay.FIXED) return 0.0
  val price = jsNumber(priceUsd)
  return if (price.isFinite() && price > 0) price else 0.0
}

/** The price as a visitor reads it: `$120`, `Free`, or the service's label. */
fun bookingPriceText(priceUsd: Any?, priceDisplay: Any?): String {
  val display = bookingPriceDisplay(priceDisplay)
  if (display != BookingPriceDisplay.FIXED) return Contracts.bookingPriceLabels[display.raw] ?: display.raw
  val charge = bookingChargeUsd(priceUsd, priceDisplay)
  return if (charge > 0) "$" + jsNumberText(charge) else "Free"
}

/** A number as JavaScript prints it in a template: `45`, `12.5`. */
fun jsNumberText(value: Double): String =
  if (value == floor(value) && kotlin.math.abs(value) < 1e15) value.toLong().toString() else value.toString()

/** A stored ask as one of the three; anything else is `off`. */
fun bookingFieldAsk(value: Any?): BookingFieldAsk = when (value) {
  "optional" -> BookingFieldAsk.OPTIONAL
  "required" -> BookingFieldAsk.REQUIRED
  else -> BookingFieldAsk.OFF
}

/* ---- The service dialog (`booking-service-form.ts`) ---- */

private val WINDOW = Regex("^(\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})$")

/** "09:00-12:00, 13:00-17:00" → open intervals in minutes; anything unreadable is skipped. */
fun parseBookingWindows(input: String): List<BookingWindow> = input.split(',').mapNotNull { chunk ->
  val match = WINDOW.matchEntire(chunk.trim()) ?: return@mapNotNull null
  val (h1, m1, h2, m2) = match.destructured
  val start = h1.toLong() * 60 + m1.toLong()
  val end = h2.toLong() * 60 + m2.toLong()
  if (end > start && end <= 24 * 60) BookingWindow(end = end, start = start) else null
}

/** Open intervals → "09:00-12:00, 13:00-17:00". */
fun formatBookingWindows(windows: List<BookingWindow>?): String {
  fun pad(minutes: Long) = "${(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}"
  return windows.orEmpty().joinToString(", ") { "${pad(it.start)}-${pad(it.end)}" }
}

/** A new service's dialog: thirty minutes, free, open nine to five on weekdays. */
fun newBookingServiceDraft(timeZone: String): BookingServiceDraft = BookingServiceDraft(
  askAddress = BookingFieldAsk.OFF,
  askPhone = BookingFieldAsk.OFF,
  crmFollowUpTask = false,
  crmMeetingActivity = true,
  description = "",
  durationMinutes = "30",
  name = "",
  priceDisplay = BookingPriceDisplay.FIXED,
  priceUsd = "0",
  timezone = timeZone.ifEmpty { "UTC" },
  windowText = (0..6).map { if (it in 1..5) "09:00-17:00" else "" },
)

private fun Any?.asText(): String = when (this) {
  null -> ""
  is Double -> jsNumberText(this)
  is Float -> jsNumberText(toDouble())
  else -> toString()
}

/** The dialog seeded from a stored service (its Firestore fields), so its switches show what it does. */
fun bookingServiceDraftFrom(service: Map<String, Any?>): BookingServiceDraft {
  @Suppress("UNCHECKED_CAST")
  val windows = service["windows"] as? Map<String, Any?>
  return BookingServiceDraft(
    askAddress = bookingFieldAsk(service["askAddress"]),
    askPhone = bookingFieldAsk(service["askPhone"]),
    crmFollowUpTask = service["crmFollowUpTask"] == true,
    crmMeetingActivity = service["crmMeetingActivity"] != false,
    description = service["description"] as? String ?: "",
    durationMinutes = (service["durationMinutes"] ?: 30).asText(),
    name = service["name"] as? String ?: "",
    priceDisplay = bookingPriceDisplay(service["priceDisplay"]),
    priceUsd = (service["priceUsd"] ?: 0).asText(),
    timezone = service["timezone"] as? String ?: "UTC",
    windowText = (0..6).map { day ->
      val list = windows?.get(day.toString()) as? List<*>
      formatBookingWindows(
        list?.mapNotNull { window ->
          val w = window as? Map<*, *> ?: return@mapNotNull null
          val start = (w["start"] as? Number)?.toLong() ?: return@mapNotNull null
          val end = (w["end"] as? Number)?.toLong() ?: return@mapNotNull null
          BookingWindow(end = end, start = start)
        },
      )
    },
  )
}

/** Why the dialog cannot save, or null. */
fun bookingServiceDraftProblem(name: String): String? = if (name.isBlank()) "A service needs a name." else null

/** What one save stores: every editable key, all seven weekdays, written explicitly. */
fun bookingServiceFields(draft: BookingServiceDraft): BookingServiceFields {
  val duration = jsNumber(draft.durationMinutes).let { if (it.isNaN() || it == 0.0) 30.0 else it }
  val price = jsNumber(draft.priceUsd).let { if (it.isNaN()) 0.0 else it }
  return BookingServiceFields(
    askAddress = draft.askAddress,
    askPhone = draft.askPhone,
    crmFollowUpTask = draft.crmFollowUpTask,
    crmMeetingActivity = draft.crmMeetingActivity,
    description = draft.description.trim().take(Contracts.bookingServiceDescriptionMax.toInt()),
    durationMinutes = maxOf(5L, minOf(480L, jsRound(duration))),
    name = draft.name.trim().take(Contracts.bookingServiceNameMax.toInt()),
    priceDisplay = draft.priceDisplay,
    priceUsd = maxOf(0L, jsRound(price)),
    timezone = draft.timezone.trim().ifEmpty { "UTC" },
    windows = (0..6).associate { it.toString() to parseBookingWindows(draft.windowText.getOrElse(it) { "" }) },
  )
}

/* ---- Payment at the counter (`booking-in-person.ts`) ---- */

/** Null when [serviceCents] is an amount staff may charge; otherwise why not. */
fun bookingInPersonAmountProblem(serviceCents: Long?): String? = when {
  serviceCents == null -> "Enter the amount to charge."
  serviceCents < Contracts.bookingInPersonMinCents -> "Card payments start at $0.50."
  serviceCents > Contracts.bookingInPersonMaxCents -> "Charge at most $10,000 at a time."
  else -> null
}

/** The amount to suggest: the service's fixed price, when it has one. */
fun bookingSuggestedCents(priceUsd: Any?, priceDisplay: Any?): Long? {
  val display = priceDisplay as? String
  if (!display.isNullOrEmpty() && display != "fixed") return null
  val cents = jsNumber(priceUsd) * 100
  if (!cents.isFinite()) return null
  return jsRound(cents).takeIf { it >= Contracts.bookingInPersonMinCents }
}

/** Where a booking stands for payment at the counter (`bookingInPersonState`). */
fun bookingInPersonState(booking: Map<String, Any?>, nowMs: Long): BookingInPersonState {
  val inPerson = booking["inPersonPayment"] as? Map<*, *>
  val paid = jsRound(jsNumber(booking["paidAmountCents"]).let { if (it.isNaN()) 0.0 else it }) > 0 ||
    !(booking["paymentIntentId"] as? String).isNullOrEmpty() ||
    inPerson?.get("status") == "paid"
  if (paid) return BookingInPersonState.PAID
  if (booking["status"] == "canceled") return BookingInPersonState.CANCELED
  if (booking["status"] == "pendingPayment") {
    val expires = jsNumber(booking["expiresAtMs"]).let { if (it.isNaN()) 0.0 else it }
    return if (expires < nowMs) BookingInPersonState.CANCELED else BookingInPersonState.AWAITING_ONLINE
  }
  if (inPerson?.get("status") == "pending") return BookingInPersonState.COLLECTING
  return BookingInPersonState.PAYABLE
}

/** The fields the manage rules read, from a booking document. */
fun managedBookingOf(data: Map<String, Any?>): ManagedBooking {
  fun num(key: String) = (data[key] as? Number)?.toDouble()
  return ManagedBooking(
    checkedInAtMs = num("checkedInAtMs"),
    endsAtMs = num("endsAtMs"),
    expiresAtMs = num("expiresAtMs"),
    paidAmountCents = num("paidAmountCents"),
    refundedCents = num("refundedCents"),
    startsAtMs = num("startsAtMs"),
    status = data["status"] as? String,
  )
}

/** The Firestore fields a save writes, from the dialog's answer. */
fun bookingServiceFirestoreFields(fields: BookingServiceFields): Map<String, Any?> = mapOf(
  "name" to fields.name,
  "durationMinutes" to fields.durationMinutes,
  "priceUsd" to fields.priceUsd,
  "timezone" to fields.timezone,
  "description" to fields.description,
  "windows" to fields.windows.mapValues { (_, list) -> list.map { mapOf("start" to it.start, "end" to it.end) } },
  "crmMeetingActivity" to fields.crmMeetingActivity,
  "crmFollowUpTask" to fields.crmFollowUpTask,
  "askPhone" to fields.askPhone.raw,
  "askAddress" to fields.askAddress.raw,
  "priceDisplay" to fields.priceDisplay.raw,
)

/** Whether this reminder pass would mail [booking] (its Firestore fields): the console card's count (`isBookingReminderDue`). */
fun isBookingReminderDue(booking: Map<String, Any?>, nowMs: Long): Boolean {
  val starts = jsNumber(booking["startsAtMs"]).let { if (it.isNaN()) 0.0 else it }
  val hour = 3_600_000.0
  val sent = booking["reminderSentAt"].let { it != null && it != false && it != "" && it != 0 && it != 0.0 }
  return booking["status"] != "canceled" && !sent && !(booking["email"] as? String).isNullOrEmpty() &&
    starts >= nowMs + Contracts.reminderWindowStartHours * hour && starts <= nowMs + Contracts.reminderWindowEndHours * hour
}
