// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.marketplace

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.jsonBody
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.rememberMemberPermissions
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.formatDateTime
import com.aglyn.ui.space
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * The publisher's OAuth app for each connection a plugin declares (AGL-4196): the console's
 * `ListingConnectionCredentialsCard`, on the listing page the publisher opens from Sell. A plugin that declares a
 * connection signs site owners in with its publisher's own OAuth app, and the platform keeps that app's client ID and
 * secret sealed. This sets, replaces and clears them. It is write-only: the route never answers either value, so all it
 * can show is Set or Not set, and the redirect URI the publisher registers at the provider. The Swift plugin's
 * ListingConnectionCredentials.swift draws the same.
 */

/** "Set a listing's connection credentials", the key the credentials route asks of the publishing workspace's member. */
const val PLUGIN_CONNECTION_CREDENTIALS_KEY = "marketplace.connectionCredentials"

/** The console route that reads, sets and clears a listing's connection credentials. */
const val PLUGIN_CONNECTION_CREDENTIALS_ROUTE = "/api/plugin-connections/credentials"

/** The address a publisher registers at the provider as the OAuth app's redirect URI (`pluginConnectionRedirectUri`). */
fun pluginConnectionRedirectUri(origin: String): String = origin.trimEnd('/') + "/api/plugin-connections/connect/callback"

/** One declared connection's OAuth app, as the route answers it: whether it is set, never its values. */
data class PluginConnectionCredentials(val connectionId: String, val label: String, val set: Boolean, val updatedAtMs: Double?) {
  companion object {
    fun from(json: JsonElement?): PluginConnectionCredentials? {
      val obj = json as? JsonObject ?: return null
      val id = (obj["connectionId"] as? JsonPrimitive)?.contentOrNull ?: return null
      return PluginConnectionCredentials(
        connectionId = id,
        label = (obj["label"] as? JsonPrimitive)?.contentOrNull ?: id,
        set = (obj["set"] as? JsonPrimitive)?.booleanOrNull ?: false,
        updatedAtMs = (obj["updatedAtMs"] as? JsonPrimitive)?.doubleOrNull,
      )
    }
  }
}

/** The credentials route's answer: whether the deployment can run connections, and each declared connection. */
data class PluginConnectionCredentialsAnswer(val configured: Boolean, val credentials: List<PluginConnectionCredentials>) {
  companion object {
    fun from(json: JsonElement?): PluginConnectionCredentialsAnswer {
      val obj = json as? JsonObject
      return PluginConnectionCredentialsAnswer(
        configured = (obj?.get("configured") as? JsonPrimitive)?.booleanOrNull ?: false,
        credentials = (obj?.get("credentials") as? JsonArray).orEmpty().mapNotNull(PluginConnectionCredentials::from),
      )
    }
  }
}

/** The credentials route, as the signed-in member. */
class PluginConnectionCredentialsApi(private val api: ConsoleApiClient, private val listingId: String) {
  suspend fun read(): PluginConnectionCredentialsAnswer =
    PluginConnectionCredentialsAnswer.from(api.request(PLUGIN_CONNECTION_CREDENTIALS_ROUTE, ApiMethod.GET, query = mapOf("listingId" to listingId)))

  suspend fun save(connectionId: String, clientId: String, clientSecret: String): PluginConnectionCredentialsAnswer =
    PluginConnectionCredentialsAnswer.from(
      api.request(
        PLUGIN_CONNECTION_CREDENTIALS_ROUTE, ApiMethod.POST,
        jsonBody("listingId" to listingId, "connectionId" to connectionId, "clientId" to clientId, "clientSecret" to clientSecret),
      ),
    )

  suspend fun clear(connectionId: String): PluginConnectionCredentialsAnswer =
    PluginConnectionCredentialsAnswer.from(
      api.request(PLUGIN_CONNECTION_CREDENTIALS_ROUTE, ApiMethod.POST, jsonBody("listingId" to listingId, "connectionId" to connectionId, "clear" to true)),
    )
}

private sealed interface CredentialsLoad {
  data object Loading : CredentialsLoad
  data class Failed(val message: String, val refused: Boolean) : CredentialsLoad
  data class Ready(val answer: PluginConnectionCredentialsAnswer) : CredentialsLoad
}

/**
 * The listing page's connection credentials, for its publisher: one card per connection the latest version declares,
 * and nothing for a listing that declares none.
 */
@Composable
fun ListingConnectionCredentialsCards(context: NativePluginContext, listingId: String) {
  val api = remember(context.api, listingId) { PluginConnectionCredentialsApi(context.api, listingId) }
  var load by remember(listingId) { mutableStateOf<CredentialsLoad>(CredentialsLoad.Loading) }
  LaunchedEffect(listingId) {
    load = try {
      CredentialsLoad.Ready(api.read())
    } catch (failure: Throwable) {
      if (failure is kotlinx.coroutines.CancellationException) throw failure
      CredentialsLoad.Failed(
        (failure as? ConsoleApiError)?.message ?: "The connection credentials could not be read. Try again.",
        pluginConnectionRefusalReason(failure) == "permission",
      )
    }
  }
  when (val current = load) {
    is CredentialsLoad.Failed -> SectionCard("Connection credentials", modifier = Modifier.testTag("connection-credentials-error")) {
      NoticeBanner(current.message, if (current.refused) StatusTone.INFO else StatusTone.ERROR)
    }
    is CredentialsLoad.Ready -> current.answer.credentials.forEach { entry ->
      ListingConnectionCredentialsCard(context, entry, current.answer.configured, api) { load = CredentialsLoad.Ready(it) }
    }
    CredentialsLoad.Loading -> Unit
  }
}

/** One declared connection's OAuth app: set or not, the redirect URI, and the form that replaces it. */
@Composable
private fun ListingConnectionCredentialsCard(
  context: NativePluginContext,
  entry: PluginConnectionCredentials,
  configured: Boolean,
  api: PluginConnectionCredentialsApi,
  onAnswer: (PluginConnectionCredentialsAnswer) -> Unit,
) {
  val scope = rememberCoroutineScope()
  val runner = remember(entry.connectionId) { ActionRunner(scope) }
  @Suppress("DEPRECATION") val clipboard = LocalClipboardManager.current
  val canSet = rememberMemberPermissions(context).can(PLUGIN_CONNECTION_CREDENTIALS_KEY)
  val refusal = com.aglyn.contracts.permissionRefusalText(PLUGIN_CONNECTION_CREDENTIALS_KEY)
  val redirectUri = pluginConnectionRedirectUri(context.api.origin)
  var editing by remember(entry.connectionId) { mutableStateOf(false) }
  var clientId by remember(entry.connectionId) { mutableStateOf("") }
  var clientSecret by remember(entry.connectionId) { mutableStateOf("") }
  var confirmingClear by remember(entry.connectionId) { mutableStateOf(false) }
  val close = {
    editing = false
    clientId = ""
    clientSecret = ""
  }

  // The actions sit under the content, as on the site's connection card and in the Figma frames.
  val actions: @Composable () -> Unit = {
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
      if (editing) {
        Button(
          onClick = {
            val id = clientId.trim()
            val secret = clientSecret.trim()
            runner.run("${entry.label} credentials saved.") {
              val answer = api.save(entry.connectionId, id, secret)
              close()
              onAnswer(answer)
            }
          },
          enabled = !runner.busy && clientId.isNotBlank() && clientSecret.isNotBlank(),
          modifier = Modifier.testTag("connection-credentials-save-${entry.connectionId}"),
        ) { Text(if (runner.busy) "Saving…" else "Save") }
        TextButton(onClick = { close() }, enabled = !runner.busy) { Text("Cancel") }
      } else {
        // Set and Replace stay on screen when they cannot be used, off, with the reason below (prerequisites are never hidden).
        val setEnabled = !runner.busy && canSet && configured
        if (entry.set) {
          OutlinedButton(onClick = { editing = true }, enabled = setEnabled, modifier = Modifier.testTag("connection-credentials-set-${entry.connectionId}")) { Text("Replace") }
          TextButton(onClick = { confirmingClear = true }, enabled = !runner.busy && canSet, modifier = Modifier.testTag("connection-credentials-clear-${entry.connectionId}")) {
            Text("Clear", color = MaterialTheme.colorScheme.error)
          }
        } else {
          Button(onClick = { editing = true }, enabled = setEnabled, modifier = Modifier.testTag("connection-credentials-set-${entry.connectionId}")) { Text("Set credentials") }
        }
      }
    }
  }

  SectionCard("Connection credentials: ${entry.label}", modifier = Modifier.testTag("connection-credentials-${entry.connectionId}")) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1.5f)), modifier = Modifier.fillMaxWidth()) {
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
        StatusChip(if (entry.set) "Set" else "Not set", if (entry.set) StatusTone.SUCCESS else StatusTone.NEUTRAL)
        if (entry.set && entry.updatedAtMs != null) {
          Text(
            "Last changed " + formatDateTime(entry.updatedAtMs.toLong(), withTime = true) + " UTC",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }
      Text(
        if (entry.set) "Sites sign in to this service with your OAuth app. The client ID and secret are never shown again; replace them to change them."
        else "Until these are set, sites that install your plugin cannot connect this service.",
        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      if (!configured) NoticeBanner(PLUGIN_CONNECTIONS_NOT_CONFIGURED_TEXT, StatusTone.INFO)
      if (!canSet) NoticeBanner(refusal, StatusTone.INFO)
      runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
      runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = runner::clear) { Text("Dismiss") } }) }
      Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        Text("Redirect URI", style = MaterialTheme.typography.labelLarge)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          Text(redirectUri, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace))
          TextButton(
            onClick = {
              clipboard.setText(AnnotatedString(redirectUri))
              runner.notice = "Redirect URI copied."
            },
            modifier = Modifier.testTag("connection-credentials-copy-${entry.connectionId}"),
          ) { Text("Copy") }
        }
        Text(
          "Register this address at the provider as your OAuth app's redirect URI, exactly as shown.",
          style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      if (editing) {
        OutlinedTextField(
          clientId, { clientId = it }, label = { Text("Client ID") }, singleLine = true, enabled = !runner.busy,
          keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii),
          modifier = Modifier.fillMaxWidth().testTag("connection-credentials-client-id-${entry.connectionId}"),
        )
        OutlinedTextField(
          clientSecret, { clientSecret = it }, label = { Text("Client secret") }, singleLine = true, enabled = !runner.busy,
          visualTransformation = PasswordVisualTransformation(),
          keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Password),
          supportingText = { Text("Stored sealed. It cannot be read back, by you or anyone else.") },
          modifier = Modifier.fillMaxWidth().testTag("connection-credentials-client-secret-${entry.connectionId}"),
        )
      }
      actions()
    }
  }
  if (confirmingClear) {
    ActionDialog(
      title = "Clear the ${entry.label} credentials?",
      confirmLabel = "Clear",
      onConfirm = {
        runner.run("${entry.label} credentials cleared.") {
          onAnswer(api.clear(entry.connectionId))
          confirmingClear = false
        }
      },
      onDismiss = { confirmingClear = false },
      body = "Sites already connected stop syncing, and nobody can connect until you set new ones.",
      busy = runner.busy,
      error = runner.error,
      destructive = true,
    )
  }
}
