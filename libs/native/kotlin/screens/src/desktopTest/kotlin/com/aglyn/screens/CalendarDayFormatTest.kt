package com.aglyn.screens

import kotlin.test.Test
import kotlin.test.assertEquals

/** A day key is a calendar day, not a moment: it reads the same in every time zone (the console's `formatDayKey`). */
class CalendarDayFormatTest {
  @Test
  fun aDayKeyIsTheSameDayWhereverTheDeviceIs() {
    val before = ScreenValues.timeZone
    try {
      ScreenValues.timeZone = "America/Chicago"
      assertEquals("Nov 15, 2027", ScreenValues.render("{item.day:date}", kotlinx.serialization.json.Json.parseToJsonElement("""{"item":{"day":"2027-11-15"}}""")))
      assertEquals("Nov 15, 2027", ScreenValues.render("{item.at:date}", kotlinx.serialization.json.Json.parseToJsonElement("""{"item":{"at":1826301600000}}""")))
    } finally {
      ScreenValues.timeZone = before
    }
  }
}
