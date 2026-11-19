// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.marketplace

import androidx.compose.material3.AssistChip
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.aglyn.core.ApiMethod
import com.aglyn.core.Live
import com.aglyn.core.jsonBody
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.LocalSlotProps
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/*
 * "Update available" on a template this plugin installed (the console's `TemplateInstallStatus`, AGL-671, the
 * `templateInstallStatus` zone on a row of a site's Templates library, AGL-3080). The comparison is the copy path of
 * `resolveUpdateState`. Updating re-installs through `marketplace/install-template`, so a copy the site edited since
 * installing it loses those edits, which is asked first; pages already created from it are never touched. The Swift
 * plugin's TemplateInstallStatus.swift draws the same.
 */

/** The source type this plugin stamps on the templates it installs (`TEMPLATE_SOURCE_TYPE`). */
internal const val MARKETPLACE_TEMPLATE_SOURCE = "marketplace"

/** The route an update re-installs through: the same `marketplace/install-template` an install uses. */
internal const val TEMPLATE_REINSTALL_ROUTE = "/api/marketplace/install-template"

/** The confirmation before an edited copy is replaced, as the console asks it. */
fun templateReplaceQuestion(name: String): Pair<String, String> =
  "Replace your edited copy?" to
    "You have edited \"$name\" since installing it. Updating replaces it with the publisher’s latest version, and your " +
    "changes to this template are lost. Pages you already created from it are unaffected."

/** What a finished template update says. */
fun templateUpdatedMessage(version: String): String = "Updated to v$version — pages you already created are unchanged."

@Composable
internal fun TemplateInstallStatusChip(context: NativePluginContext) {
  val props = LocalSlotProps.current
  val listingId = props["listingId"].takeIf { props["sourceType"] == MARKETPLACE_TEMPLATE_SOURCE } ?: return
  val name = props["displayName"].orEmpty()
  val live by remember(listingId, context.firestore) { context.firestore.observeDoc("$LISTINGS/$listingId") }.collectAsState(Live.Loading)
  val doc = (live as? Live.Ready)?.value?.takeIf { it.data["deletedAt"] == null } ?: return
  val latest = doc.string("latestVersion") ?: (doc.data["latestVersion"] as? Number)?.let { com.aglyn.pluginhost.jsNumber(it.toDouble()) }
  val source = buildMap<String, Any?> {
    put("type", MARKETPLACE_TEMPLATE_SOURCE)
    put("listingId", listingId)
    props["version"]?.let { put("version", it) }
  }
  val (state, installed) = copyUpdateState(mapOf("source" to source), latest, "template")
  if (state != "update-available") return
  val scope = rememberCoroutineScope()
  val runner = remember(listingId) { ActionRunner(scope) }
  var confirming by remember(listingId) { mutableStateOf(false) }
  var said by remember(listingId) { mutableStateOf<String?>(null) }
  val update = {
    val hostId = props["hostId"]
    if (hostId != null) {
      runner.run {
        val answer = context.api.request(TEMPLATE_REINSTALL_ROUTE, ApiMethod.POST, jsonBody("listingId" to listingId, "hostId" to hostId))
        val version = ((answer as? JsonObject)?.get("version") as? JsonPrimitive)?.let { if (it.isString) it.content else it.doubleOrNull?.let { n -> com.aglyn.pluginhost.jsNumber(n) } }
        said = templateUpdatedMessage(version.orEmpty())
      }
    }
  }
  AssistChip(
    onClick = { if (props["edited"] == "true") confirming = true else update() },
    enabled = !runner.busy,
    label = { Text(if (runner.busy) "Updating…" else "Update available") },
    leadingIcon = { Icon(AglynIcons.named("download"), contentDescription = null) },
    modifier = Modifier.testTag("template-update-${props["templateId"].orEmpty()}").semantics {
      contentDescription = "Update $name. You have v${installed.orEmpty()} · v${latest.orEmpty()} available"
    },
  )
  if (confirming) {
    val (title, body) = templateReplaceQuestion(name)
    ActionDialog(title = title, body = body, confirmLabel = "Replace", destructive = true, onDismiss = { confirming = false }, onConfirm = {
      confirming = false
      update()
    })
  }
  val message = said ?: runner.error
  if (message != null) {
    // The update replaced this row's template: once its message is read, the library reads its list again.
    val changed = com.aglyn.pluginhost.LocalSlotChanged.current
    val close = {
      val updated = said != null
      said = null
      runner.error = null
      if (updated) changed()
    }
    ActionDialog(title = name, body = message, confirmLabel = "OK", dismissLabel = "Close", onDismiss = close, onConfirm = close)
  }
}
