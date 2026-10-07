package com.aglyn.contracts

import kotlin.test.Test
import kotlin.test.assertEquals

class LocalDaysTest {
  @Test
  fun stepsByCalendarDayAcrossADaylightSavingChange() {
    // 2026-03-09 12:00 in New York, the day after clocks went forward.
    val now = 1_773_072_000_000L
    val starts = localDayStarts(now, 3, "America/New_York")
    assertEquals(listOf(1_772_859_600_000L, 1_772_946_000_000L, 1_773_028_800_000L), starts)
    assertEquals(23 * 3_600_000L, starts[2] - starts[1])
    assertEquals(starts[2], startOfLocalDay(now, "America/New_York"))
  }
}
