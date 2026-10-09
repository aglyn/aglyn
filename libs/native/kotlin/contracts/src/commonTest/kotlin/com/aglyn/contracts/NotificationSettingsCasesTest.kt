package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays notification-settings-cases.generated.json: the console settings page's own answers. */
class NotificationSettingsCasesTest {
  private val cases = ContractJsonFormat.parseToJsonElement(ContractCaseJson.notificationSettingsCases).jsonObject.getValue("cases").jsonArray

  private fun plain(element: JsonElement): Any? = when (element) {
    is JsonNull -> null
    is JsonObject -> element.mapValues { plain(it.value) }
    is JsonArray -> element.map { plain(it) }
    is JsonPrimitive -> element.booleanOrNull ?: if (element.isString) element.content else element.content.toDoubleOrNull()
  }

  @Test
  fun everyCaseReplays() {
    assertTrue(cases.size >= 4)
    for (case in cases) {
      val obj = case.jsonObject
      val name = obj.getValue("name").jsonPrimitive.content
      @Suppress("UNCHECKED_CAST")
      val settings = plain(obj.getValue("settings")) as Map<String, Any?>
      val legacy = obj.getValue("legacy").jsonObject.mapValues { it.value.jsonPrimitive.boolean }
      for ((key, value) in obj.getValue("categoryValues").jsonObject) {
        val (category, channel) = key.split(':')
        assertEquals(value.jsonPrimitive.boolean, notificationCategoryValue(Notifications, settings, legacy, category, NotificationChannel.entries.first { it.wire == channel }), "$name $key")
      }
      for ((key, value) in obj.getValue("typeValues").jsonObject) {
        val type = key.substringBeforeLast(':')
        val channel = key.substringAfterLast(':')
        assertEquals(value.jsonPrimitive.boolean, notificationTypeValue(Notifications, settings, legacy, type, NotificationChannel.entries.first { it.wire == channel }), "$name $key")
      }
      val overridden = obj.getValue("overridden").jsonObject
      val ours = notificationOverriddenScopes(settings)
      assertEquals(overridden.getValue("orgIds").jsonArray.map { it.jsonPrimitive.content }, ours.orgIds, "$name orgs")
      assertEquals(overridden.getValue("hostIds").jsonArray.map { it.jsonPrimitive.content }, ours.hostIds, "$name hosts")
    }
  }

  @Test
  fun catalogCarriesTheSettingsPageData() {
    assertTrue(Notifications.digests.isNotEmpty())
    assertEquals(true, Notifications.entry("content.order")?.emailDefault)
    assertTrue(Notifications.entry("content.taskReminder")?.selfSentEmail?.isNotEmpty() == true)
    assertEquals("success", Notifications.level(null, "content.booking"))
    assertEquals("critical", Notifications.level("critical", "content.booking"))
  }
}
