package com.aglyn.plugins.data

import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.DatasetFieldDefinition
import com.aglyn.contracts.DatasetModel
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryPlan
import com.aglyn.core.plainJson
import com.aglyn.pluginhost.describeScope
import com.aglyn.pluginhost.listFilterOperatorLabel
import com.aglyn.pluginhost.narrowsScope
import com.aglyn.pluginhost.scopeToStore
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Replays the console's own answers (function-cases.generated.json) for the
 * dataset model's ports, the records query plan, the scope wording and the
 * filter chips' operator words.
 */
class DataCasesTest {
  private val functions = Json.parseToJsonElement(File(System.getProperty("aglyn.contractsDir"), "function-cases.generated.json").readText())
    .jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonObject.getValue("cases").jsonArray.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }

  private fun field(json: JsonElement) = ContractJsonFormat.decodeFromJsonElement(DatasetFieldDefinition.serializer(), json)
  private fun model(json: JsonElement) = ContractJsonFormat.decodeFromJsonElement(DatasetModel.serializer(), json)
  private fun strings(json: JsonElement): List<String>? = (json as? JsonArray)?.map { it.jsonPrimitive.content }
  private fun str(json: JsonElement): String? = (json as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

  @Test
  fun formatDatasetValueCases() = cases("formatDatasetValue").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.content, formatDatasetValue(field(args[0]), plainJson(args[1])), args.toString())
  }

  @Test
  fun datasetValueToInputCases() = cases("datasetValueToInput").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.content, datasetValueToInput(field(args[0]), plainJson(args[1])), args.toString())
  }

  @Test
  fun parseDatasetFieldEntriesCases() = cases("parseDatasetFieldEntries").forEach { (args, result) ->
    val expected = result.jsonArray.map { it.jsonObject.getValue("id").jsonPrimitive.content to it.jsonObject.getValue("name").jsonPrimitive.content }
    assertEquals(expected, parseDatasetFieldEntries(args[0].jsonPrimitive.content).map { it.id to it.name }, args.toString())
  }

  @Test
  fun fieldIdCases() {
    cases("slugifyDatasetFieldId").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, slugifyDatasetFieldId(args[0].jsonPrimitive.content), args.toString()) }
    cases("validateDatasetFieldId").forEach { (args, result) -> assertEquals(str(result), validateDatasetFieldId(args[0].jsonPrimitive.content, strings(args[1])!!), args.toString()) }
    cases("defaultDatasetFieldId").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, defaultDatasetFieldId(args[0].jsonPrimitive.content, strings(args[1])!!), args.toString()) }
  }

  @Test
  fun datasetDisplayNameCases() = cases("datasetDisplayName").forEach { (args, result) ->
    @Suppress("UNCHECKED_CAST")
    assertEquals(result.jsonPrimitive.content, datasetDisplayName(plainJson(args[0]) as Map<String, Any?>?), args.toString())
  }

  @Test
  fun effectiveDatasetModelCases() = cases("effectiveDatasetModel").forEach { (args, result) ->
    @Suppress("UNCHECKED_CAST")
    assertEquals(model(result), effectiveDatasetModel(plainJson(args[0]) as Map<String, Any?>), args.toString())
  }

  @Test
  fun planDatasetRecordQueryCases() = cases("planDatasetRecordQuery").forEach { (args, result) ->
    val clauses = args[1].jsonArray.map { ContractJsonFormat.decodeFromJsonElement(ListFilterRequest.serializer(), it) }
    val actual = planDatasetRecordQuery(model(args[0]), clauses, strings(args[2])!!)
    val expected = result.jsonObject
    val plan = ContractJsonFormat.decodeFromJsonElement(ListQueryPlan.serializer(), expected.getValue("plan"))
    assertEquals(plan.filters, actual.plan.filters, "filters $args")
    assertEquals(plan.orderBy, actual.plan.orderBy, "order $args")
    assertEquals(plan.searched, actual.plan.searched, "searched $args")
    assertEquals(plan.notices, actual.plan.notices, "plan notices $args")
    assertEquals(expected.getValue("notices").jsonArray.map { it.jsonPrimitive.content }, actual.notices, "notices $args")
    val refused = expected.getValue("refused").jsonArray.map { entry ->
      val clause = entry.jsonObject.getValue("clause")
      (if (clause is JsonObject) ContractJsonFormat.decodeFromJsonElement(ListFilterRequest.serializer(), clause) else null) to entry.jsonObject.getValue("reason").jsonPrimitive.content
    }
    assertEquals(refused, actual.refused.map { it.clause to it.reason }, "refused $args")
    val filter = expected.getValue("filter").jsonObject
    assertEquals(
      ContractJsonFormat.decodeFromJsonElement(com.aglyn.contracts.ListQueryDeclaration.serializer(), filter.getValue("declaration")),
      actual.filter.declaration,
      "declaration $args",
    )
    assertEquals(filter.getValue("headers").jsonObject.mapValues { it.value.jsonPrimitive.content }, actual.filter.headers, "headers $args")
    assertEquals(strings(filter.getValue("selectFields")), actual.filter.selectFields, "selectFields $args")
    assertEquals(
      filter.getValue("options").jsonObject.mapValues { (_, list) -> list.jsonArray.map { it.jsonObject.getValue("value").jsonPrimitive.content to it.jsonObject.getValue("label").jsonPrimitive.content } },
      actual.filter.options.mapValues { (_, list) -> list.map { it.value to it.label } },
      "options $args",
    )
  }

  @Test
  fun scopeCases() {
    cases("describeScope").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, describeScope(strings(args[0]), args[1].jsonObject.mapValues { it.value.jsonPrimitive.content }), args.toString())
    }
    @Suppress("UNCHECKED_CAST")
    fun doc(json: JsonElement) = plainJson(json) as? Map<String, Any?>
    cases("scopeSharingOf").forEach { (args, result) ->
      val want = result.jsonObject
      val expected = when (str(want.getValue("mode"))) {
        "all" -> com.aglyn.pluginhost.ScopeSharing.All
        "selected" -> com.aglyn.pluginhost.ScopeSharing.Selected(strings(want.getValue("hostIds")).orEmpty())
        "allExcept" -> com.aglyn.pluginhost.ScopeSharing.AllExcept(strings(want.getValue("exceptHostIds")).orEmpty(), strings(want.getValue("includedHostIds")).orEmpty())
        else -> com.aglyn.pluginhost.ScopeSharing.None
      }
      assertEquals(expected, com.aglyn.pluginhost.scopeSharingOf(doc(args[0])), args.toString())
    }
    cases("describeSharing").forEach { (args, result) ->
      val names = (args.getOrNull(1) as? JsonObject)?.mapValues { it.value.jsonPrimitive.content }.orEmpty()
      assertEquals(result.jsonPrimitive.content, com.aglyn.pluginhost.describeSharing(doc(args[0]), names), args.toString())
    }
    cases("sharingFromChoice").forEach { (args, result) ->
      val choice = args[0].jsonObject
      val picked = when (str(choice.getValue("mode"))) {
        "all" -> com.aglyn.pluginhost.ScopeSharingChoice.All
        "selected" -> com.aglyn.pluginhost.ScopeSharingChoice.Selected(strings(choice.getValue("hostIds")).orEmpty())
        else -> com.aglyn.pluginhost.ScopeSharingChoice.AllExcept(strings(choice.getValue("exceptHostIds")).orEmpty())
      }
      val options = args.getOrNull(2) as? JsonObject
      val (fields, problem) = com.aglyn.pluginhost.sharingFromChoice(
        picked, strings(args[1]).orEmpty(), (options?.get("maxIncluded") as? JsonPrimitive)?.content?.toDoubleOrNull()?.toInt(),
        (options?.get("keepHostIds"))?.let(::strings).orEmpty(),
      )
      val want = result.jsonObject
      assertEquals(str(want.getValue("problem")), problem, args.toString())
      val wantFields = want.getValue("fields") as? JsonObject
      assertEquals(
        wantFields?.let { com.aglyn.pluginhost.ScopeSharingFields(strings(it.getValue("visibleTo")).orEmpty(), str(it.getValue("scopeMode")), strings(it.getValue("scopeExcept"))) },
        fields, args.toString(),
      )
    }
    cases("scopeToStore").forEach { (args, result) ->
      val (scope, problem) = scopeToStore(strings(args[0]))
      assertEquals(strings(result.jsonObject.getValue("scope")), scope, args.toString())
      assertEquals(str(result.jsonObject.getValue("problem")), problem, args.toString())
    }
    cases("narrowsScope").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content.toBoolean(), narrowsScope(strings(args[0]), strings(args[1])), args.toString())
    }
  }

  @Test
  fun operatorLabelCases() = cases("listFilterOperatorLabel").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.content, listFilterOperatorLabel(args[0].jsonPrimitive.content), args.toString())
  }
}
