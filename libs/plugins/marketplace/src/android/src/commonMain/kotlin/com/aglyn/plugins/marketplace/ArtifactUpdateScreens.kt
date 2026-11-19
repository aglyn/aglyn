// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.marketplace

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

/**
 * The update review of a copied listing, the console's `ArtifactUpdateDialog`: the version pair, why it cannot be merged or
 * that nothing changes, a schema's effect on stored records, then the changes in three groups — safe to take, yours kept, and
 * changed on both sides with "Take theirs" — and Install as a new copy or Apply. The Swift plugin's `ArtifactUpdateSheet`.
 */
@Composable
internal fun ArtifactUpdateDialog(
  context: NativePluginContext,
  listing: ListingRow,
  runner: ActionRunner,
  /** Installs the new version as a fresh copy where the route cannot detach one (anything but a component or a layout). */
  installCopy: () -> Unit,
  close: () -> Unit,
) {
  val hostId = context.hostId
  val api = remember(context.api, hostId) { hostId?.let { ArtifactUpdateApi(context.api, it) } }
  var preview by remember(listing.id) { mutableStateOf<ArtifactUpdatePreview?>(null) }
  var failed by remember(listing.id) { mutableStateOf<String?>(null) }
  val take = remember(listing.id) { mutableStateListOf<String>() }
  var confirmDestructive by remember(listing.id) { mutableStateOf(false) }
  LaunchedEffect(listing.id, api) {
    val updates = api ?: return@LaunchedEffect
    try {
      preview = updates.preview(listing.id)
    } catch (error: Throwable) {
      if (error is kotlinx.coroutines.CancellationException) throw error
      failed = (error as? ConsoleApiError)?.message ?: "Could not read this update"
    }
  }
  val loaded = preview
  ActionDialog(
    title = "Update ${listing.name}",
    confirmLabel = loaded?.applyLabel(take.size) ?: "Apply safe changes",
    confirmEnabled = loaded?.mergeable == true && (!loaded.destructive || confirmDestructive),
    busy = runner.busy,
    error = runner.error,
    icon = "download",
    onDismiss = { runner.error = null; close() },
    onConfirm = {
      val updates = api ?: return@ActionDialog
      val paths = loaded?.conflicts.orEmpty().map { it.path }.filter { it in take }
      val confirm = confirmDestructive
      // Left open on failure: a destructive schema update comes back asking for the tick, and closing would hide it.
      runner.run(onDone = close) { runner.notice = updates.apply(listing.id, "merge", paths, confirm) }
    },
    modifier = Modifier.testTag("artifact-update"),
  ) {
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      when {
        failed != null -> NoticeBanner(failed!!, StatusTone.ERROR)
        loaded == null -> SkeletonList(rows = 5)
        else -> {
          Text(loaded.versionLine, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          if (!loaded.mergeable) {
            NoticeBanner(loaded.reason.orEmpty(), StatusTone.INFO)
          } else if (loaded.identical) {
            NoticeBanner("Your copy already matches the new version — nothing to take.", StatusTone.SUCCESS)
          }
          loaded.schema?.let { schema ->
            NoticeBanner(
              "${schema.added} field(s) added, ${schema.removed} removed, ${schema.retyped} retyped.\n" +
                if (loaded.destructive) "This dataset holds ${schema.recordCount} record(s). Removing or retyping a field changes how their existing values read."
                else "Additive only — nothing already stored is reinterpreted.",
              if (loaded.destructive) StatusTone.WARNING else StatusTone.INFO,
            )
          }
          if (loaded.mergeable) {
            ChangeGroup("Safe to take", "Changed by the publisher, untouched here. Applied when you update.", loaded.safe)
            ChangeGroup("Your changes, kept", "Edited here and not upstream. The update leaves these alone.", loaded.kept)
            if (loaded.conflicts.isNotEmpty()) {
              HorizontalDivider()
              GroupHeading("Changed on both sides", loaded.conflicts.size, "Both you and the publisher changed these. Yours is kept unless you tick it.")
              loaded.conflicts.forEach { change ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().testTag("artifact-update-take-${change.path}")) {
                  Column(Modifier.weight(1f)) { ChangeText(change) }
                  Checkbox(checked = change.path in take, onCheckedChange = { on -> if (on) take.add(change.path) else take.remove(change.path) })
                  Text("Take theirs", style = MaterialTheme.typography.bodySmall)
                }
              }
            }
            if (loaded.unchanged > 0) {
              Text("${loaded.unchanged} field(s) identical in both versions.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
          if (loaded.destructive) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.testTag("artifact-update-confirm-destructive")) {
              Checkbox(checked = confirmDestructive, onCheckedChange = { confirmDestructive = it })
              Text("I understand this affects ${loaded.schema?.recordCount ?: 0} existing record(s)", style = MaterialTheme.typography.bodyMedium)
            }
          }
          // Always available, and the only way when there is no base: the customized copy is detached, never replaced.
          OutlinedButton(
            onClick = {
              val updates = api ?: return@OutlinedButton
              if (listing.artifactType == "component" || listing.artifactType == "layout") {
                runner.run(onDone = close) { runner.notice = updates.apply(listing.id, "copy") }
              } else {
                installCopy()
              }
            },
            enabled = !runner.busy,
            modifier = Modifier.testTag("artifact-update-copy"),
          ) { Text("Install as a new copy") }
        }
      }
    }
  }
}

@Composable
private fun GroupHeading(title: String, count: Int, caption: String) {
  Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
    Text(title, style = MaterialTheme.typography.titleSmall)
    StatusChip(count.toString())
  }
  Text(caption, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun ChangeGroup(title: String, caption: String, changes: List<ArtifactChange>) {
  if (changes.isEmpty()) return
  HorizontalDivider()
  GroupHeading(title, changes.size, caption)
  changes.forEach { ChangeText(it) }
}

@Composable
private fun ChangeText(change: ArtifactChange) {
  Text(describeChange(change.path, change.added, change.removed), style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace))
  if (!change.added && !change.removed) {
    Text(
      "yours: ${summarizeValue(change.current)} · theirs: ${summarizeValue(change.incoming)}",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }
}
