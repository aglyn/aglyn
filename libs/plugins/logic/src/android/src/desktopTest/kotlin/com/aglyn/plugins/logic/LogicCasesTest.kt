package com.aglyn.plugins.logic

import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.HostFunctionParameterOption
import com.aglyn.contracts.HostVariableType
import com.aglyn.contracts.WhereUsedResult
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Replays the console's own answers (function-cases.generated.json) for the Logic page's helpers. */
class LogicCasesTest {
  private val functions = Json.parseToJsonElement(File(System.getProperty("aglyn.contractsDir"), "function-cases.generated.json").readText())
    .jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonObject.getValue("cases").jsonArray.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }

  private val options = ListSerializer(HostFunctionParameterOption.serializer())

  @Test
  fun formatVariableValueCases() = cases("formatVariableValue").forEach { (args, result) ->
    val variable = args[0].jsonObject
    val type = HostVariableType.entries.first { it.raw == variable.getValue("type").jsonPrimitive.content }
    val value = (variable["value"] as? JsonPrimitive)?.content.orEmpty()
    assertEquals(result.jsonPrimitive.content, formatVariableValue(type, value), args.toString())
  }

  @Test
  fun isVariableNameCases() = cases("isVariableName").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.content.toBoolean(), isVariableName(args[0].jsonPrimitive.content), args.toString())
  }

  @Test
  fun parameterOptionCases() {
    cases("parseFunctionParameterOptions").forEach { (args, result) ->
      val text = (args[0] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
      assertEquals(ContractJsonFormat.decodeFromJsonElement(options, result), parseFunctionParameterOptions(text), args.toString())
    }
    cases("formatFunctionParameterOptions").forEach { (args, result) ->
      val list = (args[0] as? JsonArray)?.let { ContractJsonFormat.decodeFromJsonElement(options, it) }
      assertEquals(result.jsonPrimitive.content, formatFunctionParameterOptions(list), args.toString())
    }
  }

  @Test
  fun summarizeDependentsCases() = cases("summarizeDependents").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.content, summarizeDependents(ContractJsonFormat.decodeFromJsonElement(WhereUsedResult.serializer(), args[0])), args.toString())
  }
}
