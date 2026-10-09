package com.aglyn.screens

import com.aglyn.contracts.PluginCatalog
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The switchboard rows carry the lists the console's switchboards write. */
class SwitchboardRowsTest {
  private fun list(vararg ids: String) = JsonArray(ids.map(::JsonPrimitive))
  private fun row(value: JsonElement, id: String): JsonObject =
    value.jsonObject.getValue("rows").jsonArray.first { it.jsonObject["id"]?.jsonPrimitive?.content == id }.jsonObject
  private fun strings(value: JsonElement?): List<String> = value?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
  private fun flag(value: JsonElement?): Boolean = value?.jsonPrimitive?.content == "true"

  @Test
  fun workspaceRowsSendTheWholeListWithTheCascadeOff() {
    val rows = SwitchboardRows.org(JsonObject(mapOf("enabledPlugins" to list("commerce", "accounts", "crm"))))
    val commerce = row(rows, "commerce")
    assertTrue(flag(commerce["on"]))
    assertEquals(PluginCatalog.label("accounts"), commerce["cascade"]?.jsonPrimitive?.content)
    val off = strings(commerce["disable"])
    assertFalse("commerce" in off)
    assertFalse("accounts" in off)
    assertTrue("crm" in off)
    val bookings = row(rows, "bookings")
    assertFalse(flag(bookings["on"]))
    assertTrue("bookings" in strings(bookings["enable"]))
    assertTrue(flag(row(rows, "mui")["locked"]))
    assertTrue(flag(row(SwitchboardRows.org(JsonNull), "bookings")["on"]))
  }

  @Test
  fun siteRowsWriteConsentOrRefusal() {
    val org = JsonObject(mapOf("enabledPlugins" to list("commerce", "accounts", "crm")))
    val rows = SwitchboardRows.site(org, JsonObject(mapOf("disabledPlugins" to list("crm"))))
    val crm = row(rows, "crm")
    assertEquals("off-for-site", crm["state"]?.jsonPrimitive?.content)
    assertEquals(emptyList(), strings(crm["turnOn"]?.jsonObject?.get("disabledPlugins")))
    val accounts = row(rows, "accounts")
    assertEquals("awaiting-opt-in", accounts["state"]?.jsonPrimitive?.content)
    assertEquals(listOf("accounts"), strings(accounts["turnOn"]?.jsonObject?.get("enabledPlugins")))
    val bookings = row(rows, "bookings")
    assertEquals("off-for-workspace", bookings["state"]?.jsonPrimitive?.content)
    assertFalse(flag(bookings["workspaceOn"]))
    val commerce = row(rows, "commerce")
    assertTrue(flag(commerce["on"]))
    assertEquals(listOf("crm", "commerce"), strings(commerce["turnOff"]?.jsonObject?.get("disabledPlugins")))
  }
}
