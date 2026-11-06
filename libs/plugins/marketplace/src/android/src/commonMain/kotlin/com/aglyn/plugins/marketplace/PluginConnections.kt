// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.marketplace

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.boolField
import com.aglyn.core.field
import com.aglyn.core.jsonBody
import com.aglyn.core.numberField
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.LocalSlotParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.rememberMemberPermissions
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.UpgradeKind
import com.aglyn.ui.UpgradeNotice
import com.aglyn.ui.formatDateTime
import com.aglyn.ui.space
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/*
 * A site's connections for one installed marketplace plugin (AGL-4196): the console's `SitePluginConnectionsCard`, in the
 * `sitePluginConnections` slot of the site's plugin page. A plugin's manifest may declare connections (another service the
 * platform signs in to, what the owner picks there, a scheduled sync); the platform runs them, so this screen is the same
 * for every plugin, one card per declared connection, generated from the pinned manifest and the status route. Every
 * prerequisite stays on screen: a plan without connections, a publisher who has not set the connection up, a deployment
 * that cannot run them yet and a person without the site key each keep the card, with its buttons off and the reason
 * said. The Apple plugin's PluginConnections.swift draws the same.
 */

const val PLUGIN_CONNECTIONS_SITE_KEY = "marketplace.siteConnections"
const val PLUGIN_CONNECTIONS_PLAN_REFUSAL = "Connecting a plugin to another service comes with the Starter, Pro and Custom plans."
const val PLUGIN_CONNECTIONS_NOT_CONFIGURED_TEXT = "Connecting plugins to other services is not available here yet."

fun pluginConnectionNotSetUpText(label: String): String =
  "The plugin's publisher has not finished setting up $label yet. You can connect once they have."

/** The console routes (`PLUGIN_CONNECTIONS_API_ROUTES`). */
object PluginConnectionsRoute {
  const val STATUS = "/api/plugin-connections/status"
  const val CONNECT_START = "/api/plugin-connections/connect/start"
  const val RESOURCES = "/api/plugin-connections/resources"
  const val CHOOSE = "/api/plugin-connections/choose"
  const val SYNC = "/api/plugin-connections/sync"
  const val DISCONNECT = "/api/plugin-connections/disconnect"
}

data class PluginConnectionChoice(val id: String, val label: String)

private fun choiceOf(element: JsonElement?): PluginConnectionChoice? =
  element.field("id")?.let { PluginConnectionChoice(it, element.field("label") ?: it) }

/** What the console may see of a site's connection (`PluginConnectionView`). */
data class PluginConnectionState(
  val status: String,
  val choices: Map<String, PluginConnectionChoice>,
  val ready: Boolean,
  val lastSyncAtMs: Double?,
  val nextSyncAtMs: Double?,
  val lastError: String?,
) {
  companion object {
    fun from(element: JsonElement?): PluginConnectionState? {
      val status = (element as? JsonObject).field("status") ?: return null
      val choices = ((element as JsonObject)["choices"] as? JsonObject).orEmpty().mapNotNull { (key, value) -> choiceOf(value)?.let { key to it } }.toMap()
      return PluginConnectionState(
        status, choices, element.boolField("ready") ?: false, element.numberField("lastSyncAtMs"), element.numberField("nextSyncAtMs"),
        element.field("lastError"),
      )
    }
  }
}

/** One declared connection with where it stands for the site (`PluginConnectionStatusEntry`). */
data class PluginConnectionEntry(
  val listingId: String,
  val connectionId: String,
  val label: String,
  val description: String?,
  val resources: List<PluginConnectionChoice>,
  val connection: PluginConnectionState?,
  val credentialsSet: Boolean,
  val planAllows: Boolean,
  /** Every host the connection's data goes to or comes from (`pluginConnectionHosts`). */
  val hosts: List<String> = emptyList(),
) {
  val key: String get() = "$listingId/$connectionId"

  companion object {
    fun from(element: JsonElement): PluginConnectionEntry? {
      val listingId = element.field("listingId") ?: return null
      val connectionId = element.field("connectionId") ?: return null
      val resources = ((element as JsonObject)["resources"] as? JsonArray).orEmpty().mapNotNull(::choiceOf)
      return PluginConnectionEntry(
        listingId, connectionId, element.field("label") ?: connectionId, element.field("description"), resources,
        PluginConnectionState.from(element["connection"]), element.boolField("credentialsSet") ?: false, element.boolField("planAllows") ?: false,
        (element["hosts"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull },
      )
    }
  }
}

data class PluginConnectionsStatus(val configured: Boolean, val planAllows: Boolean, val connections: List<PluginConnectionEntry>) {
  companion object {
    fun from(element: JsonElement?): PluginConnectionsStatus = PluginConnectionsStatus(
      element.boolField("configured") ?: false,
      element.boolField("planAllows") ?: false,
      ((element as? JsonObject)?.get("connections") as? JsonArray).orEmpty().mapNotNull(PluginConnectionEntry::from),
    )
  }
}

enum class PluginConnectionPhase(val chip: String, val tone: StatusTone) {
  NOT_CONFIGURED("Not available yet", StatusTone.NEUTRAL),
  NOT_SET_UP("Waiting on the publisher", StatusTone.NEUTRAL),
  NOT_CONNECTED("Not connected", StatusTone.NEUTRAL),
  CHOOSING("Finish setting up", StatusTone.INFO),
  CONNECTED("Connected", StatusTone.SUCCESS),
  RECONNECT("Reconnect needed", StatusTone.WARNING),
  ERROR("Sync failed", StatusTone.ERROR),
}

/** Where one declared connection stands (`pluginConnectionPhase`). */
fun pluginConnectionPhase(entry: PluginConnectionEntry, configured: Boolean): PluginConnectionPhase {
  if (!configured) return PluginConnectionPhase.NOT_CONFIGURED
  val connection = entry.connection ?: return if (entry.credentialsSet) PluginConnectionPhase.NOT_CONNECTED else PluginConnectionPhase.NOT_SET_UP
  return when {
    connection.status == "reconnect_required" -> PluginConnectionPhase.RECONNECT
    connection.status == "error" -> PluginConnectionPhase.ERROR
    connection.ready -> PluginConnectionPhase.CONNECTED
    else -> PluginConnectionPhase.CHOOSING
  }
}

/** The first declared resource the site has not chosen yet, in order. */
fun nextPluginConnectionResource(entry: PluginConnectionEntry): PluginConnectionChoice? =
  entry.resources.firstOrNull { entry.connection?.choices?.get(it.id) == null }

sealed interface PluginConnectionNextSync {
  data class At(val ms: Double) : PluginConnectionNextSync
  data object Soon : PluginConnectionNextSync
}

/** When the next scheduled sync runs: what the sync recorded, else the last one plus the manifest's interval. */
fun pluginConnectionNextSync(connection: PluginConnectionState?, intervalHours: Double?): PluginConnectionNextSync? {
  // A failed sync backs off on the server, so the interval no longer says when it runs again.
  if (connection == null || connection.status != "connected" || !connection.ready) return null
  connection.nextSyncAtMs?.let { return PluginConnectionNextSync.At(it) }
  if (intervalHours == null || intervalHours <= 0) return null
  val last = connection.lastSyncAtMs ?: return PluginConnectionNextSync.Soon
  return PluginConnectionNextSync.At(last + intervalHours * 3_600_000)
}

data class DeclaredPluginConnection(val id: String, val label: String, val intervalHours: Double?)

/** The connections a pinned manifest declares, by id and label. */
fun declaredPluginConnections(manifest: Map<*, *>?): List<DeclaredPluginConnection> =
  ((manifest?.get("connections") as? List<*>).orEmpty()).mapNotNull { one ->
    val record = one as? Map<*, *> ?: return@mapNotNull null
    val id = (record["id"] as? String)?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
    val label = record["label"] as? String ?: return@mapNotNull null
    DeclaredPluginConnection(id, label, ((record["sync"] as? Map<*, *>)?.get("intervalHours") as? Number)?.toDouble())
  }

/** The console page a connect comes back to: the site's page for the plugin. */
fun pluginConnectionReturnTo(origin: String, orgSlug: String?, hostSlug: String?, listingId: String): String {
  val trimmed = origin.trimEnd('/')
  if (orgSlug == null || hostSlug == null) return "$trimmed/"
  return "$trimmed/$orgSlug/hosts/$hostSlug/admin/plugins/$listingId"
}

/** What a site owner is told when "Sync now" comes within a minute of the last sync (`pluginConnectionTooSoonText`). */
fun pluginConnectionTooSoonText(label: String, retryAfterMs: Double?): String =
  if (retryAfterMs == null || retryAfterMs <= 0) "$label synced moments ago. You can sync it again in a minute."
  else "$label synced moments ago. You can sync it again in ${kotlin.math.ceil(retryAfterMs / 1000).toInt()} seconds."

/** The failed-sync sentence (`pluginConnectionSyncFailedText`): the provider's own sentence without its closing period. */
fun pluginConnectionSyncFailedText(lastError: String?): String {
  val reason = lastError.orEmpty().trim().trimEnd('.', '!', '?', ' ')
  return if (reason.isEmpty()) "The last sync did not work. It tries again on schedule, or you can sync now."
  else "The last sync did not work: $reason. It tries again on schedule, or you can sync now."
}

/** Where a connection's data goes and comes from (`pluginConnectionSharesText`). */
fun pluginConnectionSharesText(hosts: List<String>): String? = if (hosts.isEmpty()) null else "Shares data with: ${hosts.joinToString(", ")}"

/** Why a route refused, when it says (`reason` in its JSON). */
fun pluginConnectionRefusalReason(failure: Throwable): String? = ((failure as? ConsoleApiError)?.body as? JsonObject)?.let {
  (it["reason"] as? JsonPrimitive)?.contentOrNull
}

/** A sync time as the app's other screens print one. */
private fun connectionTime(ms: Double): String = formatDateTime(ms.toLong(), withTime = true) + " UTC"

/** The connection routes for one site. */
class PluginConnectionsApi(private val api: ConsoleApiClient, private val hostId: String) {
  suspend fun status(listingId: String): PluginConnectionsStatus =
    PluginConnectionsStatus.from(api.request(PluginConnectionsRoute.STATUS, ApiMethod.GET, query = mapOf("hostId" to hostId, "listingId" to listingId)))

  suspend fun connectStart(listingId: String, connectionId: String, returnTo: String): String? =
    api.request(
      PluginConnectionsRoute.CONNECT_START, ApiMethod.POST,
      jsonBody("hostId" to hostId, "listingId" to listingId, "connectionId" to connectionId, "returnTo" to returnTo),
    ).field("authorizeUrl")

  suspend fun resources(listingId: String, connectionId: String, resource: String): List<PluginConnectionChoice> {
    val answer = api.request(
      PluginConnectionsRoute.RESOURCES, ApiMethod.GET,
      query = mapOf("hostId" to hostId, "listingId" to listingId, "connectionId" to connectionId, "resource" to resource),
    )
    return ((answer as? JsonObject)?.get("items") as? JsonArray).orEmpty().mapNotNull(::choiceOf)
  }

  suspend fun choose(listingId: String, connectionId: String, resource: String, id: String): PluginConnectionState? =
    PluginConnectionState.from(
      (api.request(
        PluginConnectionsRoute.CHOOSE, ApiMethod.POST,
        jsonBody("hostId" to hostId, "listingId" to listingId, "connectionId" to connectionId, "resource" to resource, "id" to id),
      ) as? JsonObject)?.get("connection"),
    )

  /** Runs the declared sync once: the view after it, and whether it worked (`synced`). */
  suspend fun sync(listingId: String, connectionId: String): Pair<PluginConnectionState?, Boolean> {
    val answer = api.request(PluginConnectionsRoute.SYNC, ApiMethod.POST, jsonBody("hostId" to hostId, "listingId" to listingId, "connectionId" to connectionId))
    return PluginConnectionState.from((answer as? JsonObject)?.get("connection")) to (answer.boolField("synced") ?: false)
  }

  suspend fun disconnect(listingId: String, connectionId: String) {
    api.request(PluginConnectionsRoute.DISCONNECT, ApiMethod.POST, jsonBody("hostId" to hostId, "listingId" to listingId, "connectionId" to connectionId))
  }
}

// The slot

private sealed interface ConnectionsLoad {
  data object Loading : ConnectionsLoad
  data class Failed(val message: String, val refused: Boolean) : ConnectionsLoad
  data class Ready(val status: PluginConnectionsStatus) : ConnectionsLoad
}

/** The `sitePluginConnections` slot: one card per connection the site's pinned manifest declares. */
@Composable
fun SitePluginConnectionsCard(context: NativePluginContext) {
  val listingId = LocalSlotParams.current["pluginId"].orEmpty()
  val hostId = context.hostId.orEmpty()
  val api = remember(context.api, hostId) { PluginConnectionsApi(context.api, hostId) }
  val keyRefused = !rememberMemberPermissions(context).can(PLUGIN_CONNECTIONS_SITE_KEY)
  var declared by remember(hostId, listingId) { mutableStateOf<List<DeclaredPluginConnection>?>(null) }
  var pluginName by remember(hostId, listingId) { mutableStateOf("this plugin") }
  var load by remember(hostId, listingId) { mutableStateOf<ConnectionsLoad>(ConnectionsLoad.Loading) }
  var nonce by remember(hostId, listingId) { mutableIntStateOf(0) }

  LaunchedEffect(hostId, listingId) {
    if (hostId.isEmpty() || listingId.isEmpty()) {
      declared = emptyList()
      return@LaunchedEffect
    }
    val pin = runCatching { context.firestore.get("hosts/$hostId/installs/$listingId") }.getOrNull()
      ?: context.orgId?.let { org -> runCatching { context.firestore.get("orgs/$org/installs/$listingId") }.getOrNull() }
    pluginName = pin?.string("displayName") ?: "this plugin"
    declared = declaredPluginConnections(pin?.data?.get("manifest") as? Map<*, *>)
  }
  LaunchedEffect(declared, nonce) {
    if (declared.isNullOrEmpty()) return@LaunchedEffect
    load = try {
      ConnectionsLoad.Ready(api.status(listingId))
    } catch (failure: Throwable) {
      if (failure is kotlinx.coroutines.CancellationException) throw failure
      ConnectionsLoad.Failed((failure as? ConsoleApiError)?.message ?: "The connections could not be read. Try again.", pluginConnectionRefusalReason(failure) == "permission")
    }
  }

  val connections = declared ?: return
  if (connections.isEmpty()) return
  Column(verticalArrangement = Arrangement.spacedBy(space(3f)), modifier = Modifier.fillMaxWidth().testTag("plugin-connections")) {
    val current = load
    when {
      keyRefused || (current is ConnectionsLoad.Failed && current.refused) -> connections.forEach { one ->
        SectionCard(title = one.label) {
          Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
            NoticeBanner(com.aglyn.contracts.permissionRefusalText(PLUGIN_CONNECTIONS_SITE_KEY), StatusTone.INFO)
            Button(onClick = {}, enabled = false) { Text("Connect") }
          }
        }
      }
      current is ConnectionsLoad.Failed -> NoticeBanner(current.message, StatusTone.ERROR) { TextButton(onClick = { nonce++ }) { Text("Try again") } }
      current is ConnectionsLoad.Ready -> current.status.connections.forEach { entry ->
        SitePluginConnection(
          context = context, entry = entry, configured = current.status.configured, planAllows = current.status.planAllows && entry.planAllows,
          pluginName = pluginName, intervalHours = connections.firstOrNull { it.id == entry.connectionId }?.intervalHours, api = api,
          onChange = { updated ->
            load = ConnectionsLoad.Ready(current.status.copy(connections = current.status.connections.map { if (it.key == entry.key) updated else it }))
          },
          onStale = { nonce++ },
        )
      }
      else -> SkeletonList(rows = 2)
    }
  }
}

/** One declared connection on the site: its state, what was chosen, and what can be done next. */
@Composable
private fun SitePluginConnection(
  context: NativePluginContext,
  entry: PluginConnectionEntry,
  configured: Boolean,
  planAllows: Boolean,
  pluginName: String,
  intervalHours: Double?,
  api: PluginConnectionsApi,
  onChange: (PluginConnectionEntry) -> Unit,
  onStale: () -> Unit,
) {
  val scope = rememberCoroutineScope()
  val runner = remember(entry.key) { ActionRunner(scope) }
  val uri = LocalUriHandler.current
  val label = entry.label
  val phase = pluginConnectionPhase(entry, configured)
  var changing by remember(entry.key) { mutableStateOf<Int?>(null) }
  var opened by remember(entry.key) { mutableStateOf(false) }
  var confirmingDisconnect by remember(entry.key) { mutableStateOf(false) }
  var wait by remember(entry.key) { mutableStateOf<String?>(null) }
  // A pinned version that declares no sync has nothing for Sync now to run, and no sync times to show.
  val declaresSync = intervalHours != null
  val resource = changing?.let { entry.resources.getOrNull(it) } ?: if (changing == null && phase == PluginConnectionPhase.CHOOSING) nextPluginConnectionResource(entry) else null
  var items by remember(entry.key, resource?.id) { mutableStateOf<List<PluginConnectionChoice>?>(null) }
  var itemsError by remember(entry.key, resource?.id) { mutableStateOf<String?>(null) }
  var picked by remember(entry.key, resource?.id) { mutableStateOf(resource?.let { entry.connection?.choices?.get(it.id)?.id }.orEmpty()) }
  val planReason = if (planAllows) null else PLUGIN_CONNECTIONS_PLAN_REFUSAL

  LaunchedEffect(entry.key, resource?.id, planAllows) {
    if (resource == null || !planAllows) return@LaunchedEffect
    try {
      val listed = api.resources(entry.listingId, entry.connectionId, resource.id)
      items = listed
      if (picked.isEmpty() && listed.size == 1) picked = listed[0].id
    } catch (failure: Throwable) {
      if (failure is kotlinx.coroutines.CancellationException) throw failure
      itemsError = runner.describe(failure)
      if (pluginConnectionRefusalReason(failure) == "reconnect") onStale()
    }
  }

  fun updated(connection: PluginConnectionState?) = entry.copy(connection = connection)

  fun connect() {
    val returnTo = pluginConnectionReturnTo(context.api.origin, context.orgSlug, context.hostSlug, entry.listingId)
    runner.run {
      api.connectStart(entry.listingId, entry.connectionId, returnTo)?.let { link ->
        opened = true
        uri.openUri(link)
      }
    }
  }

  fun choose(resource: PluginConnectionChoice) {
    val id = picked
    runner.run {
      val connection = api.choose(entry.listingId, entry.connectionId, resource.id, id)
      changing = changing?.let { if (it + 1 < entry.resources.size) it + 1 else null }
      if (connection?.ready == true) runner.notice = "$label is set up. It syncs on its own from now on."
      onChange(updated(connection))
    }
  }

  fun sync() {
    wait = null
    runner.run {
      try {
        val (connection, synced) = api.sync(entry.listingId, entry.connectionId)
        onChange(updated(connection))
        if (synced) runner.notice = "$label is up to date." else runner.error = "$label did not sync. See why above."
      } catch (failure: ConsoleApiError) {
        when (pluginConnectionRefusalReason(failure)) {
          // Not a failure: the last sync is under a minute old. Say how long, and show what it brought.
          "too-soon" -> {
            wait = pluginConnectionTooSoonText(label, failure.body.numberField("retryAfterMs"))
            PluginConnectionState.from((failure.body as? JsonObject)?.get("connection"))?.let { onChange(updated(it)) }
          }
          "reconnect", "not-connected", "choose-first" -> {
            onStale()
            throw failure
          }
          else -> throw failure
        }
      }
    }
  }

  fun disconnect() = runner.run {
    api.disconnect(entry.listingId, entry.connectionId)
    changing = null
    confirmingDisconnect = false
    runner.notice = "$label is disconnected."
    onChange(updated(null))
  }

  val disconnectButton: @Composable () -> Unit = {
    TextButton(onClick = { confirmingDisconnect = true }, enabled = !runner.busy, modifier = Modifier.testTag("plugin-connection-disconnect-${entry.connectionId}")) {
      Text("Disconnect", color = MaterialTheme.colorScheme.error)
    }
  }

  // The actions sit under the card's content, as the Figma frames and the iOS screen have them: in the header they
  // squeezed the connection's name into three lines on a phone.
  val actions: @Composable () -> Unit = {
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
      if (resource != null) {
        Button(
          onClick = { choose(resource) }, enabled = !runner.busy && picked.isNotEmpty() && planReason == null,
          modifier = Modifier.testTag("plugin-connection-use-${entry.connectionId}"),
        ) { Text(if (runner.busy) "Saving…" else "Use this ${resource.label.lowercase()}") }
        if (changing != null) TextButton(onClick = { changing = null }, enabled = !runner.busy) { Text("Cancel") }
        disconnectButton()
      } else {
        when (phase) {
          PluginConnectionPhase.NOT_CONFIGURED, PluginConnectionPhase.NOT_SET_UP, PluginConnectionPhase.NOT_CONNECTED ->
            Button(
              onClick = { connect() }, enabled = !runner.busy && phase == PluginConnectionPhase.NOT_CONNECTED && planReason == null,
              modifier = Modifier.testTag("plugin-connection-connect-${entry.connectionId}"),
            ) { Text(if (runner.busy) "Opening…" else "Connect") }
          PluginConnectionPhase.RECONNECT -> {
            Button(
              onClick = { connect() }, enabled = !runner.busy && planReason == null && entry.credentialsSet,
              modifier = Modifier.testTag("plugin-connection-reconnect-${entry.connectionId}"),
            ) { Text(if (runner.busy) "Opening…" else "Reconnect") }
            disconnectButton()
          }
          else -> {
            if (!declaresSync) {
              Unit
            } else if (phase == PluginConnectionPhase.ERROR) {
              Button(onClick = { sync() }, enabled = !runner.busy && planReason == null, modifier = Modifier.testTag("plugin-connection-sync-${entry.connectionId}")) {
                Text(if (runner.busy) "Syncing…" else "Sync now")
              }
            } else {
              OutlinedButton(onClick = { sync() }, enabled = !runner.busy && planReason == null, modifier = Modifier.testTag("plugin-connection-sync-${entry.connectionId}")) {
                Text(if (runner.busy) "Syncing…" else "Sync now")
              }
            }
            if (entry.resources.isNotEmpty()) {
              OutlinedButton(onClick = { changing = 0 }, enabled = !runner.busy && planReason == null) { Text("Change") }
            }
            disconnectButton()
          }
        }
      }
    }
  }

  SectionCard(
    title = label,
    action = { StatusChip(phase.chip, phase.tone) },
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f)), modifier = Modifier.testTag("plugin-connection-${entry.connectionId}")) {
      entry.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
      runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS) }
      wait?.let { NoticeBanner(it, StatusTone.INFO) }
      when (phase) {
        PluginConnectionPhase.NOT_CONFIGURED -> NoticeBanner(PLUGIN_CONNECTIONS_NOT_CONFIGURED_TEXT, StatusTone.INFO)
        PluginConnectionPhase.NOT_SET_UP -> NoticeBanner(pluginConnectionNotSetUpText(label), StatusTone.INFO)
        else -> if (planReason != null) {
          UpgradeNotice(if (entry.connection == null) planReason else "$planReason You can still disconnect it.", UpgradeKind.PLAN) {
            context.navigate("core.billing.plans")
          }
        }
      }
      when (phase) {
        PluginConnectionPhase.NOT_CONNECTED -> Text(
          "Connect $label so $pluginName can use it on this site. You sign in at $label and choose what to share; this site never sees your password.",
          style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        PluginConnectionPhase.RECONNECT -> NoticeBanner("$label no longer accepts this connection. Nothing syncs until you reconnect.", StatusTone.WARNING)
        PluginConnectionPhase.ERROR -> NoticeBanner(pluginConnectionSyncFailedText(entry.connection?.lastError), StatusTone.ERROR)
        else -> Unit
      }
      if (opened && (phase == PluginConnectionPhase.NOT_CONNECTED || phase == PluginConnectionPhase.RECONNECT)) {
        NoticeBanner("Finished signing in at $label? Check again to see it here.", StatusTone.INFO) {
          TextButton(onClick = onStale) { Text("Check again") }
        }
      }
      if (resource != null) {
        Text(
          "Choose the ${resource.label.lowercase()} $pluginName should use." + if (changing == null) " Nothing syncs until you do." else "",
          style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        val listed = items
        when {
          itemsError != null -> NoticeBanner(itemsError.orEmpty(), StatusTone.ERROR)
          listed == null && planAllows -> Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
            Text("Asking $label…", style = MaterialTheme.typography.bodySmall)
          }
          listed != null && listed.isEmpty() -> NoticeBanner(
            "The $label account you connected has nothing to choose here. Connect a different account, or add one at $label first.",
            StatusTone.INFO,
          )
          listed != null -> SelectField(
            label = resource.label, options = listed.map { SelectOption(it.id, it.label) }, selected = picked.ifEmpty { null },
            onSelect = { picked = it.orEmpty() }, enabled = !runner.busy && planAllows,
            modifier = Modifier.fillMaxWidth().testTag("plugin-connection-picker-${entry.connectionId}"),
          )
        }
      }
      val connection = entry.connection
      if (connection != null && changing == null) {
        entry.resources.forEach { one ->
          connection.choices[one.id]?.let { Text("${one.label}: ${it.label}", style = MaterialTheme.typography.bodyMedium) }
        }
        if (declaresSync && (phase == PluginConnectionPhase.CONNECTED || phase == PluginConnectionPhase.ERROR)) {
          val small = MaterialTheme.typography.bodySmall
          val muted = MaterialTheme.colorScheme.onSurfaceVariant
          Text(connection.lastSyncAtMs?.let { "Last synced ${connectionTime(it)}" } ?: "Not synced yet", style = small, color = muted)
          // A plan without connections is never run by the scheduled sync, so it has no next one to show.
          when (val next = if (planAllows) pluginConnectionNextSync(connection, intervalHours) else null) {
            is PluginConnectionNextSync.At -> Text("Next sync ${connectionTime(next.ms)}", style = small, color = muted)
            PluginConnectionNextSync.Soon -> Text("Next sync: within the hour", style = small, color = muted)
            null -> Unit
          }
        }
      }
      pluginConnectionSharesText(entry.hosts)?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      actions()
    }
  }

  if (confirmingDisconnect) {
    ActionDialog(
      title = "Disconnect $label?",
      confirmLabel = "Disconnect",
      onConfirm = { disconnect() },
      onDismiss = { confirmingDisconnect = false },
      body = "$pluginName stops receiving updates from $label on this site, and what it last brought in is removed from the site. You can connect again at any time.",
      busy = runner.busy,
    )
  }
}
