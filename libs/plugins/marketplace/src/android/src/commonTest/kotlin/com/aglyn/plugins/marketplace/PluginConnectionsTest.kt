// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.marketplace

import com.aglyn.core.ConsoleApiError
import com.aglyn.core.jsonValue
import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A site's connections for an installed plugin (AGL-4196): the console's `plugin-connection-card.spec.ts`, and the Swift `PluginConnectionsTests`. */
class PluginConnectionsTest {
  private fun view(status: String = "connected", ready: Boolean = false, choices: Map<String, Any?> = emptyMap(), lastSync: Double? = null): Map<String, Any?> =
    mapOf("status" to status, "ready" to ready, "choices" to choices, "lastSyncAtMs" to lastSync, "lastError" to null)

  private fun entry(connection: Map<String, Any?>? = null, credentialsSet: Boolean = true, planAllows: Boolean = true): PluginConnectionEntry =
    PluginConnectionEntry.from(
      jsonValue(
        mapOf(
          "listingId" to "listing-1", "connectionId" to "gbp", "provider" to "google", "label" to "Google Business Profile",
          "resources" to listOf(mapOf("id" to "accounts", "label" to "Account"), mapOf("id" to "locations", "label" to "Location")),
          "connection" to connection, "credentialsSet" to credentialsSet, "planAllows" to planAllows,
        ),
      ),
    )!!

  private fun state(json: Map<String, Any?>): PluginConnectionState? = PluginConnectionState.from(jsonValue(json))

  @Test
  fun phases() {
    assertEquals(PluginConnectionPhase.NOT_CONFIGURED, pluginConnectionPhase(entry(), configured = false))
    assertEquals(PluginConnectionPhase.NOT_SET_UP, pluginConnectionPhase(entry(credentialsSet = false), configured = true))
    assertEquals(PluginConnectionPhase.NOT_CONNECTED, pluginConnectionPhase(entry(), configured = true))
    assertEquals(PluginConnectionPhase.CHOOSING, pluginConnectionPhase(entry(view()), configured = true))
    assertEquals(PluginConnectionPhase.CONNECTED, pluginConnectionPhase(entry(view(ready = true)), configured = true))
    assertEquals(PluginConnectionPhase.RECONNECT, pluginConnectionPhase(entry(view("reconnect_required")), configured = true))
    assertEquals(PluginConnectionPhase.ERROR, pluginConnectionPhase(entry(view("error")), configured = true))
  }

  @Test
  fun chipsSayWhatTheConsoleSays() {
    assertEquals("Connected", PluginConnectionPhase.CONNECTED.chip)
    assertEquals("Waiting on the publisher", PluginConnectionPhase.NOT_SET_UP.chip)
    assertEquals("Reconnect needed", PluginConnectionPhase.RECONNECT.chip)
  }

  @Test
  fun resourcesInOrder() {
    assertEquals("accounts", nextPluginConnectionResource(entry())?.id)
    val one = entry(view(choices = mapOf("accounts" to mapOf("id" to "a", "label" to "A"))))
    assertEquals("locations", nextPluginConnectionResource(one)?.id)
    assertEquals("A", one.connection?.choices?.get("accounts")?.label)
  }

  @Test
  fun nextSync() {
    assertEquals(PluginConnectionNextSync.At(1000.0 + 7_200_000), pluginConnectionNextSync(state(view(ready = true, lastSync = 1000.0)), 2.0))
    assertEquals(PluginConnectionNextSync.Soon, pluginConnectionNextSync(state(view(ready = true)), 2.0))
    assertNull(pluginConnectionNextSync(state(view(ready = false)), 2.0))
    assertNull(pluginConnectionNextSync(state(view("reconnect_required", ready = true)), 2.0))
  }

  @Test
  fun statusDecodes() {
    val status = PluginConnectionsStatus.from(
      jsonValue(mapOf("configured" to true, "planAllows" to false, "connections" to listOf(mapOf("listingId" to "l", "connectionId" to "c")))),
    )
    assertTrue(status.configured)
    assertEquals(false, status.planAllows)
    assertEquals(listOf("l/c"), status.connections.map { it.key })
  }

  @Test
  fun declaredConnections() {
    val manifest = mapOf("connections" to listOf(mapOf("id" to "gbp", "label" to "Google Business Profile", "sync" to mapOf("intervalHours" to 6)), mapOf("id" to "x")))
    assertEquals(listOf(DeclaredPluginConnection("gbp", "Google Business Profile", 6.0)), declaredPluginConnections(manifest))
    assertEquals(emptyList(), declaredPluginConnections(null))
  }

  @Test
  fun returnToIsTheSitePluginPage() {
    assertEquals(
      "https://app.aglyn.com/acme/hosts/main/admin/plugins/listing-1",
      pluginConnectionReturnTo("https://app.aglyn.com/", "acme", "main", "listing-1"),
    )
  }

  @Test
  fun refusalReason() {
    val body: JsonElement = jsonValue(mapOf("reason" to "plan"))
    assertEquals("plan", pluginConnectionRefusalReason(ConsoleApiError("No", 403, body)))
    assertNull(pluginConnectionRefusalReason(ConsoleApiError("Not found", 404, null)))
  }

  @Test
  fun waitAndShares() {
    assertEquals("Google Business Profile synced moments ago. You can sync it again in 42 seconds.", pluginConnectionTooSoonText("Google Business Profile", 41_200.0))
    assertEquals("Shares data with: a.example.com, b.example.com", pluginConnectionSharesText(listOf("a.example.com", "b.example.com")))
    assertNull(pluginConnectionSharesText(emptyList()))
    assertNull(pluginConnectionNextSync(state(view("error", ready = true, lastSync = 5.0)), 2.0))
    assertEquals(listOf("h.example.com"), PluginConnectionEntry.from(jsonValue(mapOf("listingId" to "l", "connectionId" to "c", "hosts" to listOf("h.example.com"))))!!.hosts)
  }

  @Test
  fun copyMatchesTheConsole() {
    assertEquals("Connecting a plugin to another service comes with the Starter, Pro and Custom plans.", PLUGIN_CONNECTIONS_PLAN_REFUSAL)
    assertEquals("marketplace.siteConnections", PLUGIN_CONNECTIONS_SITE_KEY)
  }

  @Test
  fun syncFailedTextAddsNoSecondPeriod() {
    assertEquals(
      "The last sync did not work: Google Business Profile did not answer: Internal error encountered. It tries again on schedule, or you can sync now.",
      pluginConnectionSyncFailedText("Google Business Profile did not answer: Internal error encountered."),
    )
    assertEquals("The last sync did not work. It tries again on schedule, or you can sync now.", pluginConnectionSyncFailedText(null))
  }
}
