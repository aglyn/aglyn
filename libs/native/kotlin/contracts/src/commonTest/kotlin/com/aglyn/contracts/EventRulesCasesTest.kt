package com.aglyn.contracts

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays the event rule's cases in function-cases.generated.json. */
class EventRulesCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
    it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
  }

  private fun str(element: JsonElement?) = (element as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

  @Test
  fun eventWriteCases() = cases("eventWrite").forEach { (args, result) ->
    val input = ContractJsonFormat.decodeFromJsonElement(EventWriteInput.serializer(), args[0])
    val clear = args.getOrNull(1)?.jsonObject?.get("clearBlank")?.jsonPrimitive?.booleanOrNull == true
    assertEquals(ContractJsonFormat.decodeFromJsonElement(EventWrite.serializer(), result), eventWrite(input, clear), args.toString())
  }

  @Test
  fun problemCases() = cases("eventWriteProblem").forEach { (args, result) ->
    val input = args[0].jsonObject
    assertEquals(str(result), eventWriteProblem(input.getValue("title").jsonPrimitive.content, input.getValue("startsAtMs").jsonPrimitive.long), args.toString())
  }

  @Test
  fun endCases() = cases("eventEndsAtMs").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.long, eventEndsAtMs(args[0].jsonPrimitive.long, (args[1] as? JsonPrimitive)?.longOrNull), args.toString())
  }

  @Test
  fun statusCases() = cases("eventStatusOf").forEach { (args, result) ->
    val value: Any? = (args[0] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let { if (it.isString) it.content else it.longOrNull }
    assertEquals(str(result), eventStatusOf(value)?.raw, args.toString())
  }
}
