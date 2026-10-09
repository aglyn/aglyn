package com.aglyn.plugins.marketing

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
import kotlinx.serialization.json.longOrNull
import java.io.File
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays the console's own answers (function-cases.generated.json) through the Marketing plugin's ports. */
class MarketingCasesTest {
  private val functions = Json.parseToJsonElement(
    File("../../../../native/contracts/function-cases.generated.json").readText(),
  ).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
    it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
  }

  private fun plain(element: JsonElement?): Any? = when (element) {
    null, JsonNull -> null
    is JsonObject -> element.mapValues { plain(it.value) }
    is JsonArray -> element.map(::plain)
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.longOrNull ?: element.doubleOrNull
  }

  @Suppress("UNCHECKED_CAST")
  private fun map(element: JsonElement?) = plain(element) as? Map<String, Any?>

  @Suppress("UNCHECKED_CAST")
  private fun variants(raw: Any?) = (raw as? List<Map<String, Any?>>).orEmpty().map { VariantRow(it["id"] as String, it["name"] as? String, (it["weight"] as? Number)?.toDouble()) }

  private fun close(a: Double?, b: Double?) = (a == null && b == null) || (a != null && b != null && abs(a - b) < 1e-9)

  @Test
  fun validationCases() = cases("validateExperiment").forEach { (args, result) ->
    val e = map(args[0])!!
    @Suppress("UNCHECKED_CAST") val auto = e["autoWinner"] as? Map<String, Any?>
    val got = validateExperiment(
      e["name"] as? String ?: "", e["target"] as? String ?: "", e["screenId"] as? String, e["nodeId"] as? String,
      variants(e["variants"]).map { it.id },
      auto?.let { (it["minExposures"] as Number).toDouble() to (it["confidence"] as Number).toDouble() },
    )
    assertEquals((result as? JsonPrimitive)?.takeIf { it.isString }?.content, got, args.toString())
  }

  @Test
  fun resultRowCases() = cases("experimentResultRows").forEach { (args, result) ->
    val e = map(args[0])!!
    @Suppress("UNCHECKED_CAST") val stats = (map(args[1]) ?: emptyMap()) as Map<String, Map<String, Any?>>
    val got = experimentResultRows(variants(e["variants"]), e["winnerVariantId"] as? String, stats)
    val want = result.jsonArray.map { map(it)!! }
    assertEquals(want.size, got.size)
    got.zip(want).forEach { (row, w) ->
      assertEquals(w["leader"], row.leader, args.toString())
      assertEquals(w["winner"], row.winner, args.toString())
      @Suppress("UNCHECKED_CAST") val c = w["comparison"] as? Map<String, Any?>
      assertEquals(c == null, row.comparison == null, args.toString())
      if (c != null) {
        assertTrue(close((c["lift"] as? Number)?.toDouble(), row.comparison!!.lift), args.toString())
        assertTrue(close((c["confidence"] as? Number)?.toDouble(), row.comparison.confidence), args.toString())
      }
    }
  }

  @Test
  fun comparisonWordCases() = cases("describeVariantComparison").forEach { (args, result) ->
    val raw = map(args[0])
    val comparison = raw?.let { VariantComparison((it["lift"] as? Number)?.toDouble(), (it["confidence"] as? Number)?.toDouble()) }
    assertEquals((result as JsonPrimitive).content, describeVariantComparison(comparison), args.toString())
  }

  @Test
  fun windowAndOverlayRules() {
    assertEquals(CampaignWindow.UNDATED, campaignWindowState(null, null, 5))
    assertEquals(CampaignWindow.UPCOMING, campaignWindowState(10, null, 5))
    assertEquals(CampaignWindow.ENDED, campaignWindowState(1, 4, 5))
    assertEquals(CampaignWindow.RUNNING, campaignWindowState(1, 9, 5))
    assertEquals("off", overlayStatus(false, null, null, 5))
    assertEquals("live", overlayStatus(true, null, null, 5))
    assertEquals("scheduled", overlayStatus(true, 9, null, 5))
    assertEquals("scheduled", overlayStatus(true, null, 4, 5))
  }
}
