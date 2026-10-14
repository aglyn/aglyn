package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/** Replays the weekly hours cases in function-cases.generated.json: the TypeScript's own answers. */
class WeeklyHoursCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> {
    val list = functions.getValue(name).jsonObject.getValue("cases").jsonArray
    assertNotNull(list.firstOrNull(), "no cases for $name")
    return list.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }
  }

  private fun week(json: JsonElement): WeeklyHours = json.jsonArray.map { day ->
    day.jsonArray.map { WeeklyHoursInterval(it.jsonObject.getValue("start").jsonPrimitive.content.toDouble().toInt(), it.jsonObject.getValue("end").jsonPrimitive.content.toDouble().toInt()) }
  }

  @Test
  fun readsHoursText() = cases("weeklyHoursFromText").forEach { (args, result) ->
    // Only a string is hours text; anything else (null, a number) reads as an empty week.
    val text = (args[0] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    val parsed = weeklyHoursFromText(text)
    assertEquals(week(result.jsonObject.getValue("hours")), parsed.hours, args.toString())
    assertEquals(result.jsonObject.getValue("unreadLines").jsonArray.map { it.jsonPrimitive.content.toInt() }, parsed.unreadLines, args.toString())
  }

  @Test
  fun writesHoursText() = cases("weeklyHoursToText").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.content, weeklyHoursToText(week(args[0])), args.toString())
  }

  @Test
  fun clockText() {
    cases("formatClockMinutes").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, formatClockMinutes(args[0].jsonPrimitive.content.toInt()), args.toString()) }
    cases("clockLabel").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, clockLabel(args[0].jsonPrimitive.content.toInt()), args.toString()) }
  }
}
