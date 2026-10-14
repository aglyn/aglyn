package com.aglyn.screens

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** The weekly hours text replayed from libs/native/screens/weekly-hours-cases.json, which the console's own conversion produced (Apple replays the same file). */
class WeeklyHoursTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }
  private val cases = Json.parseToJsonElement(File(root, "libs/native/screens/weekly-hours-cases.json").readText()).jsonObject

  private fun week(json: JsonArray) = json.map { day -> day.jsonArray.map { HoursInterval((it.jsonArray[0] as JsonPrimitive).int, (it.jsonArray[1] as JsonPrimitive).int) } }

  @Test
  fun everyTextReadsAsTheConsolesWeekAndWritesBackTheConsolesLines() {
    for (case in cases["cases"]!!.jsonArray.map { it.jsonObject }) {
      val text = (case["text"] as JsonPrimitive).content
      val (read, unread) = WeeklyHours.fromText(text)
      assertEquals(week(case["week"]!!.jsonArray), read, "week of: $text")
      assertEquals(case["unread"]!!.jsonArray.map { (it as JsonPrimitive).int }, unread, "unread lines of: $text")
      assertEquals((case["canonical"] as JsonPrimitive).content, WeeklyHours.toText(read), "lines of: $text")
    }
  }

  @Test
  fun aClockReadsAs24HoursAndForAMenu() {
    for (clock in cases["clocks"]!!.jsonArray.map { it.jsonObject }) {
      val minutes = (clock["minutes"] as JsonPrimitive).int
      assertEquals((clock["clock"] as JsonPrimitive).content, WeeklyHours.clock(minutes))
      assertEquals((clock["label"] as JsonPrimitive).content, WeeklyHours.label(minutes))
    }
    assertEquals(97, WeeklyHours.times.size)
    assertEquals(WeeklyHours.LAST_MINUTE, WeeklyHours.times.last())
  }
}
