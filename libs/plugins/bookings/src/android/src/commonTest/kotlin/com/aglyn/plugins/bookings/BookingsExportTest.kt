package com.aglyn.plugins.bookings

import kotlin.test.Test
import kotlin.test.assertEquals

/** The Bookings list's Export opens the export dialog on the list as it stands, in the bookings transfer's filter terms. */
class BookingsExportTest {
  @Test
  fun exportsTheUpcomingBookingsOrOneBookersOnes() {
    assertEquals(BookingsExport(mapOf("upcoming" to true, "asOfMs" to 1_800_000_000_123L), "Upcoming bookings"), bookingsExport(null, 1_800_000_000_123L))
    assertEquals(BookingsExport(mapOf("email" to "ada@example.com"), "Bookings for ada@example.com"), bookingsExport("ada@example.com", 0L))
  }
}
