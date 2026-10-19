package com.aglyn.contracts

import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Replays navcore's cases (AGL-3950) for the native themes' arithmetic and the org role grants. */
class ThemeRulesCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> {
    val list = functions.getValue(name).jsonObject.getValue("cases").jsonArray
    assertNotNull(list.firstOrNull(), "no cases for $name")
    return list.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }
  }

  private fun withoutNulls(value: Any?): Any? = when (value) {
    is Map<*, *> -> value.filterValues { it != null }.mapValues { withoutNulls(it.value) }
    is List<*> -> value.map(::withoutNulls)
    else -> value
  }

  private fun <T> same(expected: JsonElement, actual: T, serializer: KSerializer<T>, label: String) =
    assertEquals(withoutNulls(expected(expected)), withoutNulls(expected(ContractJsonFormat.encodeToJsonElement(serializer, actual))), label)

  private fun text(json: JsonElement): String? = (json as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

  @Test
  fun colorArithmetic() {
    cases("isThemeColor").forEach { (args, result) ->
      val value: Any? = (args[0] as? JsonPrimitive)?.let { if (it.isString) it.content else null }
      assertEquals(result.jsonPrimitive.booleanOrNull, isThemeColor(value), args.toString())
    }
    cases("themeContrast").forEach { (args, result) ->
      assertTrue(abs(result.jsonPrimitive.doubleOrNull!! - themeContrast(text(args[0])!!, text(args[1])!!)) < 1e-9, args.toString())
    }
    cases("themeLerp").forEach { (args, result) ->
      assertEquals(text(result), themeLerp(text(args[0])!!, text(args[1])!!, args[2].jsonPrimitive.doubleOrNull!!), args.toString())
    }
  }

  @Test
  fun palettesAndPreviews() {
    cases("themePalette").forEach { (args, result) -> same(result, themePalette(text(args[0])), ThemePalette.serializer(), args.toString()) }
    cases("deriveThemeFromPreview").forEach { (args, result) ->
      val preview = ContractJsonFormat.decodeFromJsonElement(ThemePreview.serializer(), args[0])
      same(result, deriveThemeFromPreview(preview, text(args[1])!!), ThemeColorsPair.serializer(), args.toString())
    }
    // Ocean and Warm in the generated palettes are the same derivation.
    for (id in listOf("ocean", "warm")) {
      val pair = deriveThemeFromPreview(Contracts.themePreviews.getValue(id), Contracts.themeDarkRailSeeds.getValue(id))
      assertEquals(themePalette(id).light, pair.light, id)
      assertEquals(themePalette(id).dark, pair.dark, id)
    }
  }

  @Test
  fun accents() = cases("deriveAccent").forEach { (args, result) ->
    val actual = deriveAccent(text(args[0]))
    if (result is JsonNull) assertNull(actual, args.toString()) else same(result, actual!!, ThemeAccent.serializer(), args.toString())
  }

  @Test
  fun roleGrants() = cases("rolePermissions").forEach { (args, result) ->
    fun layer(json: JsonElement) = if (json is JsonNull) null else ContractJsonFormat.decodeFromJsonElement(OrgPermissionLayer.serializer(), json)
    val actual = rolePermissions(Contracts.orgRoleGrants, text(args[0]), layer(args[1]), layer(args[2]))
    assertEquals(expected(result), expected(JsonObject(actual.mapValues { JsonPrimitive(it.value) })), args.toString())
  }
}
