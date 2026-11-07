// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.marketplace

import com.aglyn.core.jsonValue
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The publisher's connection credentials (AGL-4196): the console's card spec, and the Swift `ListingConnectionCredentialsTests`. */
class ListingConnectionCredentialsTest {
  @Test
  fun redirectUriIsTheConsoleCallback() {
    assertEquals("https://app.aglyn.com/api/plugin-connections/connect/callback", pluginConnectionRedirectUri("https://app.aglyn.com/"))
    assertEquals("http://10.0.2.2:4200/api/plugin-connections/connect/callback", pluginConnectionRedirectUri("http://10.0.2.2:4200"))
  }

  @Test
  fun theAnswerSaysSetOrNotSetAndNeverAValue() {
    val answer = PluginConnectionCredentialsAnswer.from(
      jsonValue(
        mapOf(
          "configured" to true,
          "credentials" to listOf(
            mapOf("connectionId" to "google", "label" to "Google Business Profile", "set" to true, "updatedAtMs" to 1_793_958_000_000.0),
            mapOf("connectionId" to "other", "label" to "Other", "set" to false, "updatedAtMs" to null),
            mapOf("label" to "No id"),
          ),
        ),
      ),
    )
    assertTrue(answer.configured)
    assertEquals(listOf("google", "other"), answer.credentials.map { it.connectionId })
    assertTrue(answer.credentials[0].set)
    assertEquals(1_793_958_000_000.0, answer.credentials[0].updatedAtMs)
    assertFalse(answer.credentials[1].set)
    assertNull(answer.credentials[1].updatedAtMs)
    assertEquals(emptyList(), PluginConnectionCredentialsAnswer.from(null).credentials)
  }

  @Test
  fun theKeyAndRouteAreTheConsoles() {
    assertEquals("marketplace.connectionCredentials", PLUGIN_CONNECTION_CREDENTIALS_KEY)
    assertEquals("/api/plugin-connections/credentials", PLUGIN_CONNECTION_CREDENTIALS_ROUTE)
  }
}
