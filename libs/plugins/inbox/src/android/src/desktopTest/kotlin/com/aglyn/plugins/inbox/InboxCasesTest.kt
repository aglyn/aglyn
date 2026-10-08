package com.aglyn.plugins.inbox

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
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays the console's own answers (function-cases.generated.json) through the Inbox's ports. */
class InboxCasesTest {
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
    is JsonPrimitive -> element.booleanOrNull ?: element.longOrNull ?: element.doubleOrNull ?: element.contentOrNull
  }

  @Suppress("UNCHECKED_CAST")
  private fun map(element: JsonElement?) = plain(element) as? Map<String, Any?>

  private fun str(element: JsonElement?) = (element as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull

  @Test
  fun messageSenderCases() = cases("messageSender").forEach { (args, result) ->
    val sender = messageSender(map(args[0]))
    assertEquals(str(result.jsonObject["name"]), sender.name, args.toString())
    assertEquals(str(result.jsonObject["email"]), sender.email, args.toString())
  }

  @Test
  fun submissionSenderCases() = cases("submissionSender").forEach { (args, result) ->
    val sender = if (args.size > 1) submissionSender(map(args[0]), str(args[1])!!) else submissionSender(map(args[0]))
    assertEquals(str(result.jsonObject["label"]), sender.label, args.toString())
    assertEquals(str(result.jsonObject["email"]), sender.email, args.toString())
    assertEquals(str(result.jsonObject["initials"]), sender.initials, args.toString())
  }

  @Test
  fun routingChipsCases() = cases("routingChips").forEach { (args, result) ->
    val chips = routingChips(map(args[0]))
    val expected = result.jsonArray.map { str(it.jsonObject["label"]) to str(it.jsonObject["color"]) }
    assertEquals(expected, chips.map { it.label to it.color.name.lowercase() }, args.toString())
  }

  @Test
  fun defaultReplySubjectCases() = cases("defaultReplySubject").forEach { (args, result) ->
    assertEquals(result.jsonPrimitive.content, defaultReplySubject(str(args[0]), str(args[1])), args.toString())
  }

  @Test
  fun readChipsAreTheStoredBoolean() {
    assertTrue(submissionsRequest(ReadFilter.ALL, null, "").clauses.isEmpty())
    val unread = submissionsRequest(ReadFilter.UNREAD, "form-1", " ada ")
    assertEquals(listOf("read" to "false", "formId" to "form-1"), unread.clauses.map { it.field to it.value })
    assertEquals(listOf("ada"), unread.search)
  }

  @Test
  fun permissionsFollowTheSiteRole() {
    assertEquals(InboxPermissions(canWrite = true, canReply = true), InboxPermissions.of("admin"))
    assertEquals(InboxPermissions(canWrite = true, canReply = false), InboxPermissions.of("author"))
    assertEquals(InboxPermissions(canWrite = false, canReply = false), InboxPermissions.of("viewer"))
  }
}
