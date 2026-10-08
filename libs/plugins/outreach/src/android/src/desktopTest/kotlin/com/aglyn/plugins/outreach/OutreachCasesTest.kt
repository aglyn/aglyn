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
}
