package com.aglyn.contracts

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays the Analytics page's figures in function-cases.generated.json. */
class AnalyticsRulesCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
    it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
  }

  private fun plain(element: JsonElement?): Any? = when (element) {
    null, is JsonNull -> null
    is JsonObject -> element.mapValues { plain(it.value) }
    is JsonArray -> element.map { plain(it) }
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.doubleOrNull
  }

  private fun counts(element: JsonElement) = element.jsonObject.mapValues { it.value.jsonPrimitive.double }

  @Test
  fun windowAndSplit() {
    cases("trafficDeltaPct").forEach { (args, result) ->
      assertEquals((result as? JsonPrimitive)?.doubleOrNull, trafficDeltaPct(args[0].jsonPrimitive.double, args[1].jsonPrimitive.double), args.toString())
    }
    cases("deviceSplit").forEach { (args, result) ->
      assertEquals(ContractJsonFormat.decodeFromJsonElement(ListSerializer(DeviceSplitEntry.serializer()), result), deviceSplit(counts(args[0])), args.toString())
    }
    cases("deviceSplitLabel").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, deviceSplitLabel(ContractJsonFormat.decodeFromJsonElement(ListSerializer(DeviceSplitEntry.serializer()), args[0])))
    }
    cases("deviceSplitValue").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, deviceSplitValue(ContractJsonFormat.decodeFromJsonElement(ListSerializer(DeviceSplitEntry.serializer()), args[0])))
    }
    cases("rollUp").forEach { (args, result) ->
      val field = args[1].jsonPrimitive.content
      val days = args[0].jsonArray.map { day -> day.jsonObject[field]?.let(::counts).orEmpty() }
      assertEquals(result.jsonArray.map { it.jsonArray[0].jsonPrimitive.content to it.jsonArray[1].jsonPrimitive.double }, rollUp(days), args.toString())
    }
    cases("formatDwell").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, formatDwell(args[0].jsonPrimitive.double)) }
  }

  @Test
  fun pagesTable() {
    cases("aggregateScreenDays").forEach { (args, result) ->
      @Suppress("UNCHECKED_CAST")
      val docs = (plain(args[0]) as List<Map<String, Any?>>)
      assertEquals(ContractJsonFormat.decodeFromJsonElement(ListSerializer(ScreenTrafficRow.serializer()), result), aggregateScreenDays(docs), args.toString())
    }
    cases("topDevice").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, topDevice(ContractJsonFormat.decodeFromJsonElement(ScreenTrafficRow.serializer(), args[0])))
    }
    cases("topReferrer").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, topReferrer(ContractJsonFormat.decodeFromJsonElement(ScreenTrafficRow.serializer(), args[0])))
    }
  }
}
