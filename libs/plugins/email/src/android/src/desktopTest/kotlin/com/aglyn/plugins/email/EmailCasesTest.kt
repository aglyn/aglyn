package com.aglyn.plugins.email

import kotlinx.serialization.json.Json
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
import kotlinx.serialization.json.longOrNull
import java.io.File
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Replays the console's own answers (function-cases.generated.json) through the Email plugin's ports. */
class EmailCasesTest {
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

  @Test
  fun sendDisplayCases() = cases("campaignSendDisplay").forEach { (args, result) ->
    val got = campaignSendDisplay(map(args[0]))
    val want = result.jsonObject
    val progress = want.getValue("progress").jsonObject
    assertEquals((want["state"] as JsonPrimitive).content, got.state, args.toString())
    assertEquals((want["label"] as JsonPrimitive).content, got.label, args.toString())
    assertEquals((progress["label"] as JsonPrimitive).content, got.progress.label, args.toString())
    assertEquals((progress["reached"] as JsonPrimitive).longOrNull, got.progress.reached.toLong(), args.toString())
  }

  @Test
  fun reportCases() = cases("campaignReport").forEach { (args, result) ->
    val got = campaignReport(map(args[0]))
    val want = result.jsonObject
    val caveats = want["caveats"]?.jsonArray.orEmpty().map { (it.jsonObject["id"] as JsonPrimitive).content }
    assertEquals(caveats, got.caveats.map { it.id }, args.toString())
    val rates = want["rates"]?.jsonObject.orEmpty()
    for ((key, rate) in rates) {
      val gotRate = got.rates[key]
      if (rate is JsonNull) {
        assertNull(gotRate, "$args $key")
      } else {
        val value = (rate.jsonObject["value"] as JsonPrimitive).doubleOrNull!!
        assertTrue(gotRate != null && abs(gotRate.value - value) < 1e-9, "$args $key")
      }
    }
  }

  @Test
  fun linkReportCases() = cases("sendLinkReport").forEach { (args, result) ->
    val got = sendLinkReport(map(args[0]))
    val want = result.jsonObject
    assertEquals(want["rows"]?.jsonArray.orEmpty().map { (it.jsonObject["url"] as JsonPrimitive).content }, got.rows.map { it.url }, args.toString())
    assertEquals((want["attributedClicks"] as JsonPrimitive).longOrNull, got.attributedClicks.toLong(), args.toString())
  }

  @Test
  fun newDesignCases() {
    cases("emailDesignStarterNodes").forEach { (args, result) ->
      val ids = args[0].jsonObject
      val got = emailDesignStarterNodes((ids["sectionId"] as JsonPrimitive).content, (ids["textId"] as JsonPrimitive).content)
      assertEquals(plain(result), got, args.toString())
    }
    cases("emailDesignDocuments").forEach { (args, result) ->
      val input = args[0].jsonObject
      val (screen, version) = emailDesignDocuments(
        (input["screenId"] as JsonPrimitive).content,
        (input["versionId"] as JsonPrimitive).content,
        (input["displayName"] as JsonPrimitive).content,
        map(input["nodes"])!!,
      )
      assertEquals(plain(result.jsonObject["screen"]), screen, args.toString())
      assertEquals(plain(result.jsonObject["version"]), version, args.toString())
    }
  }

  @Test
  fun audiencePickSplitsOnce() {
    assertEquals("list", AudiencePick("list:abc").kind)
    assertEquals("abc", AudiencePick("list:abc").listId)
    assertEquals("s1", AudiencePick("segment:s1").segmentId)
    assertEquals("list:L", AudiencePick.stored(mapOf("audience" to "list", "listId" to "L"))?.raw)
    assertEquals(listOf("a@x.test", "b@x.test", "c@x.test"), addressesIn("a@x.test, b@x.test;\nc@x.test"))
  }
}
