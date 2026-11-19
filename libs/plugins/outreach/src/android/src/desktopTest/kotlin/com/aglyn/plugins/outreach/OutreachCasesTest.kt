package com.aglyn.plugins.outreach

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
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Replays the console's own answers (function-cases.generated.json) through the Outreach plugin's ports. */
class OutreachCasesTest {
  private val functions = Json.parseToJsonElement(
    File("../../../../native/contracts/function-cases.generated.json").readText(),
  ).jsonObject.getValue("functions").jsonObject

  private fun plain(element: JsonElement?): Any? = when (element) {
    null, JsonNull -> null
    is JsonObject -> element.mapValues { plain(it.value) }
    is JsonArray -> element.map(::plain)
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.longOrNull ?: element.doubleOrNull
  }

  /** The errors the editor holds a save on are the console's, path for path; warnings stay the route's. */
  @Suppress("UNCHECKED_CAST")
  @Test
  fun sequenceErrorCases() {
    val cases = functions.getValue("validateOutreachSequence").jsonObject.getValue("cases").jsonArray
    for (case in cases) {
      val c = plain(case) as Map<String, Any?>
      val sequence = (c["args"] as List<Any?>)[0] as Map<String, Any?>
      val steps = (sequence["steps"] as? List<Map<String, Any?>>).orEmpty().map(SequenceStep::of)
      val got = validateSequence(sequence["name"] as? String ?: "", sequence["mailboxId"] as? String ?: "", steps)
      val want = (c["result"] as List<Map<String, Any?>>).filter { it["severity"] == "error" }
      assertEquals(want.map { it["code"] }, got.map { it.code }, sequence.toString())
      assertEquals(want.map { it["path"] }, got.map { it.path }, sequence.toString())
      assertEquals(want.map { it["message"] }, got.map { it.message }, sequence.toString())
    }
  }

  @Test
  fun permissionFollowsRoleCustomRoleAndOverride() {
    assertTrue(outreachPermitted(mapOf("role" to "owner"), null))
    assertTrue(outreachPermitted(mapOf("role" to "admin"), null))
    assertFalse(outreachPermitted(mapOf("role" to "editor"), null))
    assertFalse(outreachPermitted(null, null))
    assertTrue(outreachPermitted(mapOf("role" to "editor", "roleId" to "r"), mapOf("permissions" to mapOf("outreach.use" to true))))
    assertFalse(outreachPermitted(mapOf("role" to "admin", "roleId" to "r"), mapOf("permissions" to mapOf("outreach.use" to false))))
    assertFalse(outreachPermitted(mapOf("role" to "admin", "permissions" to mapOf("outreach.use" to false)), null))
  }

  /** A sequence's Results read as the console's `outreachSequenceReport` reads them, figure for figure and caveat for caveat. */
  @Suppress("UNCHECKED_CAST")
  @Test
  fun sequenceReportCases() {
    val cases = functions.getValue("outreachSequenceReport").jsonObject.getValue("cases").jsonArray
    fun num(value: Any?) = (value as? Number)?.toDouble()
    for ((index, case) in cases.withIndex()) {
      val c = plain(case) as Map<String, Any?>
      val args = c["args"] as List<Any?>
      val got = outreachSequenceReport(args[0] as? Map<String, Any?>, args[1] == true, args.getOrNull(2) == true)
      val want = c["result"] as Map<String, Any?>
      val label = "case $index"
      assertEquals(num(want["sent"]), got.sent, label)
      assertEquals(num(want["people"]), got.people, label)
      assertEquals(num(want["clicks"]), got.clicks, label)
      assertEquals(num(want["uniqueClicks"]), got.uniqueClicks, label)
      assertEquals(num(want["machineClicks"]), got.machineClicks, label)
      assertEquals(num(want["lastClickAtMs"]), got.lastClickAtMs, label)
      assertEquals(want["clickTracked"], got.clickTracked, label)
      assertEquals(want["openTracked"], got.openTracked, label)
      assertEquals(num(want["openPeople"]), got.openPeople, label)
      assertEquals(num(want["opens"]), got.opens, label)
      assertEquals(num(want["uniqueOpens"]), got.uniqueOpens, label)
      assertEquals(num(want["machineOpens"]), got.machineOpens, label)
      assertEquals(num(want["proxyOpens"]), got.proxyOpens, label)
      assertEquals(num(want["lastOpenAtMs"]), got.lastOpenAtMs, label)
      assertEquals(want["opensUnmeasured"], got.opensUnmeasured, label)
      val rates = want["rates"] as Map<String, Any?>
      for ((rate, wanted) in listOf(got.clickRate to rates["click"], got.openRate to rates["open"])) {
        val obj = wanted as? Map<String, Any?>
        assertEquals(num(obj?.get("numerator")), rate?.numerator, label)
        assertEquals(num(obj?.get("denominator")), rate?.denominator, label)
        assertEquals(obj?.get("denominatorLabel"), rate?.denominatorLabel, label)
        assertEquals(num(obj?.get("value")) ?: -1.0, rate?.value ?: -1.0, 1e-12, label)
      }
      val caveats = want["caveats"] as List<Map<String, Any?>>
      assertEquals(caveats.map { it["id"] }, got.caveats.map { it.id }, label)
      assertEquals(caveats.map { it["message"] }, got.caveats.map { it.message }, label)
    }
  }

  /** The links followed are the campaign report's own table (the core's `sendLinkReport`). */
  @Suppress("UNCHECKED_CAST")
  @Test
  fun sequenceLinkReportCases() {
    val cases = functions.getValue("outreachSequenceLinkReport").jsonObject.getValue("cases").jsonArray
    for ((index, case) in cases.withIndex()) {
      val c = plain(case) as Map<String, Any?>
      val got = com.aglyn.core.sendLinkReport((c["args"] as List<Any?>)[0] as? Map<String, Any?>)
      val want = c["result"] as Map<String, Any?>
      val rows = want["rows"] as List<Map<String, Any?>>
      assertEquals(rows.map { it["url"] }, got.rows.map { it.url }, "case $index")
      assertEquals(rows.map { (it["clicks"] as Number).toLong() }, got.rows.map { it.clicks }, "case $index")
      assertEquals((want["overflowClicks"] as Number).toLong(), got.overflowClicks, "case $index")
      assertEquals(want["truncated"], got.truncated, "case $index")
    }
    assertEquals("—", formatOutreachTime(null, null))
  }
}

