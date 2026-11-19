package com.aglyn.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays the console's Customize dashboard rules (function-cases.generated.json). */
class DashboardWidgetsTest {
  private val functions = Json.parseToJsonElement(
    File(System.getProperty("aglyn.contractsDir"), "function-cases.generated.json").readText(),
  ).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
    it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
  }.also { assertTrue(it.isNotEmpty(), "no cases for $name") }

  private fun plain(element: JsonElement?): Any? = when (element) {
    null, JsonNull -> null
    is JsonObject -> element.mapValues { plain(it.value) }
    is JsonArray -> element.map(::plain)
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.doubleOrNull
  }

  private fun strings(element: JsonElement?): List<String> = (plain(element) as? List<*>)?.filterIsInstance<String>().orEmpty()

  private fun prefs(element: JsonElement) = DashboardWidgetPrefs(strings(element.jsonObject["hidden"]), strings(element.jsonObject["order"]))

  @Test
  fun readsTheWorkspacesArrangement() = cases("readDashboardWidgetPrefs").forEach { (args, result) ->
    assertEquals(prefs(result), DashboardWidgets.read(plain(args[0]), (args[1] as? JsonPrimitive)?.takeIf { it.isString }?.content), args.toString())
  }

  @Test
  fun hidesAndShows() {
    cases("isDashboardWidgetHidden").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.booleanOrNull, DashboardWidgets.isHidden(prefs(args[0]), args[1].jsonPrimitive.content), args.toString())
    }
    cases("setDashboardWidgetHidden").forEach { (args, result) ->
      assertEquals(prefs(result), DashboardWidgets.setHidden(prefs(args[0]), args[1].jsonPrimitive.content, args[2].jsonPrimitive.booleanOrNull == true), args.toString())
    }
  }

  @Test
  fun movesAndOrders() {
    cases("moveDashboardWidget").forEach { (args, result) ->
      val next = DashboardWidgets.move(prefs(args[0]), strings(args[1]), args[2].jsonPrimitive.content, args[3].jsonPrimitive.content.toDouble().toInt())
      assertEquals(prefs(result), next, args.toString())
    }
    cases("orderDashboardWidgets").forEach { (args, result) ->
      val ids = args[0].jsonArray.map { it.jsonObject.getValue("widgetId").jsonPrimitive.content }
      val want = result.jsonArray.map { it.jsonObject.getValue("widgetId").jsonPrimitive.content }
      assertEquals(want, DashboardWidgets.ordered(ids, strings(args[1])) { it }, args.toString())
    }
  }

  /** A native card is stored under the console's id when it is one of the console's cards. */
  @Test
  fun nativeCardsUseTheConsolesIds() {
    assertEquals("commerce-glance", DashboardWidgets.storedId("commerce.glance"))
    assertEquals("commerce.today", DashboardWidgets.storedId("commerce.today"))
    assertEquals("dashboardWidgets", DashboardWidgets.field)
    assertEquals("core-host-analytics", DashboardWidgets.trafficId)
  }
}
