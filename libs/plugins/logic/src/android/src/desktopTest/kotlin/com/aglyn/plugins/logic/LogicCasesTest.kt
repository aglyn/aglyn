package com.aglyn.plugins.logic

import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.HostFunction
import com.aglyn.contracts.HostFunctionParameterOption
import com.aglyn.contracts.HostVariableType
import com.aglyn.contracts.WhereUsedResult
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import com.aglyn.core.plainJson
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

  /** A JSON value as plain Kotlin with every number a Double, so `3` and `3.0` compare equal. */
  private fun plain(element: JsonElement?): Any? = when (val value = plainJson(element)) {
    is Number -> value.toDouble()
    else -> value.normalized()
  }

  private fun Any?.normalized(): Any? = when (this) {
    is Number -> toDouble()
    is Map<*, *> -> mapValues { it.value.normalized() }
    is List<*> -> map { it.normalized() }
    else -> this
  }

  private fun string(element: JsonElement) = (element as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

  private fun rowOf(element: JsonElement): StructuredRow {
    val row = element.jsonObject
    return StructuredRow(
      row.getValue("key").jsonPrimitive.content,
      StructuredKind.entries.first { it.raw == row.getValue("kind").jsonPrimitive.content },
      row.getValue("value").jsonPrimitive.content,
      row["kept"],
    )
  }

  private fun shapeOf(element: JsonElement) = if (element.jsonPrimitive.content == "collection") StructuredShape.COLLECTION else StructuredShape.DICTIONARY

  @Test
  fun structuredValueCases() {
    cases("parseStructuredValue").forEach { (args, result) ->
      val parsed = parseStructuredValue(string(args[0]), shapeOf(args[1]))
      val expected = result.jsonObject
      assertEquals(expected.getValue("unreadable").jsonPrimitive.content.toBoolean(), parsed.unreadable, args.toString())
      val rows = expected.getValue("rows").jsonArray.map(::rowOf)
      assertEquals(rows.map { it.key to it.kind }, parsed.rows.map { it.key to it.kind }, args.toString())
      assertEquals(rows.map { it.value }, parsed.rows.map { it.value }, args.toString())
      assertEquals(rows.map { plain(it.kept) }, parsed.rows.map { plain(it.kept) }, args.toString())
    }
    cases("serializeStructuredValue").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, serializeStructuredValue(args[0].jsonArray.map(::rowOf), shapeOf(args[1])), args.toString())
    }
  }

  private fun operandOf(element: JsonElement): FormulaOperand {
    val operand = element.jsonObject
    return when (operand.getValue("source").jsonPrimitive.content) {
      "name" -> FormulaOperand.Name(operand.getValue("name").jsonPrimitive.content)
      "number" -> FormulaOperand.Number(operand.getValue("value").jsonPrimitive.content)
      "text" -> FormulaOperand.Text(operand.getValue("value").jsonPrimitive.content)
      else -> FormulaOperand.Current
    }
  }

  private fun operationOf(raw: String) = FormulaOperation.entries.first { it.raw == raw }

  private fun draftOf(element: JsonElement): FormulaDraft? {
    if (element is JsonNull) return null
    val draft = element.jsonObject
    return FormulaDraft(
      operationOf(draft.getValue("operation").jsonPrimitive.content),
      draft.getValue("operands").jsonArray.map(::operandOf),
      draft["places"]?.jsonPrimitive?.content?.toDouble()?.toInt(),
      draft["symbol"]?.jsonPrimitive?.content,
      draft["separator"]?.jsonPrimitive?.content,
    )
  }

  private fun FormulaOperand.json(): JsonObject = JsonObject(
    when (this) {
      is FormulaOperand.Name -> mapOf("source" to JsonPrimitive("name"), "name" to JsonPrimitive(name))
      is FormulaOperand.Number -> mapOf("source" to JsonPrimitive("number"), "value" to JsonPrimitive(value))
      is FormulaOperand.Text -> mapOf("source" to JsonPrimitive("text"), "value" to JsonPrimitive(value))
      FormulaOperand.Current -> mapOf("source" to JsonPrimitive("current"))
    },
  )

  @Test
  fun formulaCases() {
    cases("buildFormula").forEach { (args, result) ->
      assertEquals(string(result), buildFormula(draftOf(args[0])!!, args[1].jsonPrimitive.content), args.toString())
    }
    cases("formulaDraftFor").forEach { (args, result) ->
      val draft = formulaDraftFor(operationOf(args[0].jsonPrimitive.content), draftOf(args[1]), args[2].jsonPrimitive.content)
      val expected = result.jsonObject
      assertEquals(expected.getValue("operation").jsonPrimitive.content, draft.operation.raw, args.toString())
      assertEquals(expected.getValue("operands").jsonArray.toList(), draft.operands.map { it.json() }, args.toString())
      assertEquals(expected["places"]?.jsonPrimitive?.content?.toDouble()?.toInt(), draft.places, args.toString())
      assertEquals(expected["symbol"]?.jsonPrimitive?.content, draft.symbol, args.toString())
      assertEquals(expected["separator"]?.jsonPrimitive?.content, draft.separator, args.toString())
    }
    cases("formulaOperandLabel").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, formulaOperandLabel(operationOf(args[0].jsonPrimitive.content), args[1].jsonPrimitive.content.toInt()), args.toString())
    }
  }

  private fun siteVariablesOf(element: JsonElement?): List<SiteVariableName> = (element as? JsonArray).orEmpty().map {
    SiteVariableName(string(it.jsonObject["name"] ?: JsonNull), string(it.jsonObject["type"] ?: JsonNull), string(it.jsonObject["value"] ?: JsonNull))
  }

  @Test
  fun formulaNameCases() = cases("formulaNames").forEach { (args, result) ->
    val input = args[0].jsonObject
    val names = formulaNames(
      input.getValue("parameters").jsonArray.map { it.jsonObject.getValue("name").jsonPrimitive.content },
      input.getValue("locals").jsonArray.map { it.jsonObject.getValue("name").jsonPrimitive.content },
      siteVariablesOf(input["siteVariables"]),
    )
    val expected = result.jsonArray.map { it.jsonObject.let { n -> Triple(n.getValue("value").jsonPrimitive.content, n.getValue("label").jsonPrimitive.content, n.getValue("group").jsonPrimitive.content) } }
    assertEquals(expected, names.map { Triple(it.value, it.label, it.group) }, args.toString())
  }

  @Test
  fun choiceRowCases() {
    cases("choiceRowsFromOptions").forEach { (args, result) ->
      val list = (args[0] as? JsonArray)?.let { ContractJsonFormat.decodeFromJsonElement(options, it) }
      assertEquals(result.jsonArray.map { it.jsonObject.getValue("value").jsonPrimitive.content to it.jsonObject.getValue("label").jsonPrimitive.content }, choiceRowsFromOptions(list).map { it.value to it.label }, args.toString())
    }
    cases("optionsFromChoiceRows").forEach { (args, result) ->
      val rows = args[0].jsonArray.map { ParameterChoiceRow(it.jsonObject.getValue("value").jsonPrimitive.content, it.jsonObject.getValue("label").jsonPrimitive.content) }
      assertEquals(ContractJsonFormat.decodeFromJsonElement(options, result), optionsFromChoiceRows(rows), args.toString())
    }
  }

  @Test
  fun testRunScopeCases() {
    cases("functionReferencedNames").forEach { (args, result) ->
      val definition = ContractJsonFormat.decodeFromJsonElement(HostFunction.serializer(), args[0])
      assertEquals(result.jsonArray.map { it.jsonPrimitive.content }, functionReferencedNames(definition), args.toString())
    }
    cases("functionGlobals").forEach { (args, result) ->
      val definition = ContractJsonFormat.decodeFromJsonElement(HostFunction.serializer(), args[0])
      val variables = siteVariablesOf(JsonArray(args[1].jsonObject.values.toList()))
      assertEquals(plain(result), plain(JsonObject(functionGlobals(definition, variables).mapValues { (_, v) -> if (v is Number) JsonPrimitive(v) else if (v is Boolean) JsonPrimitive(v) else JsonPrimitive(v.toString()) })), args.toString())
    }
  }
}
