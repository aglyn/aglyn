package com.aglyn.plugins.bookings

import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.contracts.localParts
import com.aglyn.contracts.shiftLocalDays
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BookingsTest {
  private val now = 1_800_000_000_000L
  private fun row(data: Map<String, Any?>) = bookingRowOf(FirestoreDoc("b1", "hosts/h1/bookings/b1", data))

  @Test
  fun aRowReadsTheConsoleFields() {
    val booking = row(mapOf("serviceName" to "Haircut", "name" to "", "email" to "ada@example.test", "startsAtMs" to now + 3_600_000, "endsAtMs" to now + 7_200_000, "status" to "confirmed", "paidAmountCents" to 4500L, "refundedCents" to 500L))
    assertEquals("ada@example.test", booking.name)
    assertEquals(4000L, booking.actions(now).refundCents)
    assertTrue(booking.actions(now).checkIn)
    assertEquals("Confirmed", bookingChip(booking, now).first)
  }

  @Test
  fun chipsNameTheState() {
    assertEquals("Canceled", bookingChip(row(mapOf("status" to "canceled")), now).first)
    assertEquals("Payment not finished", bookingChip(row(mapOf("status" to "pendingPayment", "expiresAtMs" to now - 1)), now).first)
    assertEquals("Checked in", bookingChip(row(mapOf("status" to "confirmed", "checkedInAtMs" to now)), now).first)
  }

  @Test
  fun queriesUseTheConsoleIndexes() {
    val range = bookingsRangeQuery("h1", 10, 20, "s1")
    assertEquals("hosts/h1/bookings", range.collectionPath)
    assertEquals(listOf("serviceId", "startsAtMs", "startsAtMs"), range.filters.map { it.field })
    assertEquals(listOf(FilterOp.EQ, FilterOp.GTE, FilterOp.LT), range.filters.map { it.op })
    val booker = bookerBookingsQuery("h1", " Ada@Example.test ", 25)
    assertEquals("ada@example.test", booker.filters.single().value)
    assertEquals(26, booker.limit)
    assertTrue(booker.orderBy.single().descending)
  }

  @Test
  fun calendarRangesCoverTheirPeriod() {
    val week = calendarRange(CalendarMode.WEEK, now)
    assertEquals(0, localParts(week.first).weekday)
    assertEquals(shiftLocalDays(week.first, 7), week.last + 1)
    val month = calendarRange(CalendarMode.MONTH, now)
    assertEquals(1, localParts(month.first).day)
    assertEquals(shiftLocalDays(now, -7).let { localParts(it).dayKey }, localParts(stepAnchor(CalendarMode.WEEK, now, -1)).dayKey)
  }

  @Test
  fun servicesHideDeletedAndSortByName() {
    val rows = visibleServices(
      listOf(
        FirestoreDoc("b", "p/b", mapOf("name" to "beta", "durationMinutes" to 45L)),
        FirestoreDoc("a", "p/a", mapOf("name" to "Alpha", "status" to "draft", "priceUsd" to 30L)),
        FirestoreDoc("c", "p/c", mapOf("name" to "Gone", "deletedAt" to FirestoreTimestamp(1))),
      ),
    )
    assertEquals(listOf("a", "b"), rows.map { it.id })
    assertTrue(rows[0].draft)
    assertEquals("$30", rows[0].priceText)
    assertEquals(45L, rows[1].durationMinutes)
  }
}
