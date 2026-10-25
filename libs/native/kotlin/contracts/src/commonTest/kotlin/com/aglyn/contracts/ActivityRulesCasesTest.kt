package com.aglyn.contracts

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
import kotlin.test.Test
import kotlin.test.assertEquals

/** An activity row's words and a page's traffic figures: the console's own function cases and the row rules. */
class ActivityRulesCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
    it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
  }

  private fun plain(element: JsonElement?): Any? = when (element) {
    null, is JsonNull -> null
    is JsonObject -> element.mapValues { plain(it.value) }
    is JsonArray -> element.map { plain(it) }
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.doubleOrNull
  }

  @Test
  fun automationRunWords() {
    cases("describeAutomationRunAction").forEach { (args, result) ->
      assertEquals((result as? JsonPrimitive)?.takeIf { it.isString }?.content, describeAutomationRunAction(args[0].jsonPrimitive.content), args.toString())
    }
  }

  @Test
  fun pageTrafficSummary() {
    cases("summarizeScreenTraffic").forEach { (args, result) ->
      @Suppress("UNCHECKED_CAST")
      val days = (plain(args[0]) as List<Map<String, Any?>>).map { ScreenTrafficDay.of(it) }
      assertEquals(ContractJsonFormat.decodeFromJsonElement(ScreenTrafficSummary.serializer(), result), summarizeScreenTraffic(days), args.toString())
    }
  }

  @Test
  fun rowTextAndActor() {
    val brand = Contracts.platformBrandName
    assertEquals("Published version — Home", activityRowText(ActivityEntryFields(action = "Published version", targetType = "screen", targetName = "Home")))
    assertEquals("Page", activityRowText(ActivityEntryFields(targetType = "screen")))
    assertEquals("Created page Home with $brand AI", activityRowText(ActivityEntryFields(action = "ai.job.output", targetType = "screen", targetName = "Home")))
    assertEquals("Automation ran: Order created", activityRowText(ActivityEntryFields(action = "Action ran on order.created")))
    assertEquals("Mailbox", activityTypeLabel("outreach:mailbox"))
    assertEquals("jordan@example.com", activityActorLabel(ActivityEntryFields(actorId = "u1", actorEmail = "jordan@example.com")))
    assertEquals("API key Zapier", activityActorLabel(ActivityEntryFields(apiKeyName = "Zapier")))
    assertEquals("Account u1", activityActorLabel(ActivityEntryFields(actorId = "u1")))
    assertEquals("Workflow Follow-up", activityActorLabel(ActivityEntryFields(targetType = "workflow", targetName = "Follow-up", actorId = "system:engine")))
    assertEquals("$brand staff (staff@example.com)", activityActorLabel(ActivityEntryFields(staffActorEmail = "staff@example.com")))
  }
}
