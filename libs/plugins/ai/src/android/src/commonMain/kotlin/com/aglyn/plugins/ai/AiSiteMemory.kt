package com.aglyn.plugins.ai

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space

/** The host subcollection the preferences live in (`AI_SITE_MEMORY_SUBCOLLECTION`). */
const val AI_SITE_MEMORY_SUBCOLLECTION = "aiMemory"

/** At most this many are kept per site (`AI_SITE_MEMORY_MAX`). */
const val AI_SITE_MEMORY_MAX = 12

/** A stored preference: what Aglyn AI learned from an edit the owner applied. */
data class AiSitePreference(val id: String, val text: String, val count: Int, val lastSeenAtMs: Double)

private fun numberOrNull(value: Any?): Double? = when (value) {
  is Number -> value.toDouble()
  is String -> value.trim().toDoubleOrNull()
  else -> null
}

/** A stored row as a preference; null for one this version cannot read (`aiSitePreferenceOf`). */
fun aiSitePreferenceOf(id: String, raw: Map<String, Any?>?): AiSitePreference? {
  val text = (raw?.get("text") as? String)?.trim()?.take(120).orEmpty()
  if (text.isEmpty()) return null
  val count = numberOrNull(raw?.get("count"))?.takeIf { it.isFinite() && it > 0 }?.let { kotlin.math.floor(it).toInt() } ?: 1
  val last = numberOrNull(raw?.get("lastSeenAtMs"))?.takeIf { it.isFinite() } ?: 0.0
  return AiSitePreference(id, text, count, last)
}

/** Most repeated first, then the most recent: the order the console lists them. */
fun aiSitePreferences(rows: List<FirestoreDoc>): List<AiSitePreference> =
  rows.mapNotNull { aiSitePreferenceOf(it.id, it.data) }.sortedWith(compareByDescending<AiSitePreference> { it.count }.thenByDescending { it.lastSeenAtMs })

/** "Seen in 1 applied edit", "Seen in 3 applied edits". */
fun aiSitePreferenceSeen(count: Int): String = if (count == 1) "Seen in 1 applied edit" else "Seen in $count applied edits"

/**
 * What Aglyn AI learned from this site's edits, on Setup → Business profile (the console's `hostBusinessProfile`
 * widget): the short preferences the assist edit route distilled from the edits the owner applied, which every later AI
 * job for the site reads. The owner reads them here and forgets one, or all of them.
 *
 * Read and deleted from the client: the rules let a site's members read and delete `aiMemory` and refuse them a create or
 * an update, because a client write would put words of their choosing into later prompts.
 */
@Composable
fun AiSiteMemoryCard(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val flow = remember(hostId, context.firestore) { context.firestore.observe(FirestoreQuery("hosts/$hostId/$AI_SITE_MEMORY_SUBCOLLECTION", limit = AI_SITE_MEMORY_MAX * 2)) }
  val live by flow.collectAsState(Live.Loading)
  val scope = rememberCoroutineScope()
  val runner = remember { ActionRunner(scope, roleHint = "an author, editor or admin") }
  var clearing by remember { mutableStateOf(false) }
  val preferences = (live as? Live.Ready)?.value?.let(::aiSitePreferences).orEmpty()

  SectionCard(
    "What Aglyn AI learned",
    Modifier.fillMaxWidth().testTag("ai-site-memory"),
    action = {
      if (preferences.isNotEmpty()) {
        TextButton(onClick = { runner.clear(); clearing = true }, enabled = !runner.busy, modifier = Modifier.testTag("ai-memory-forget-all")) { Text("Forget all") }
      }
    },
  ) {
    Text(
      "Short preferences from the edits you applied with Assist. Every AI job for this site reads them.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
    runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS) }
    if (preferences.isEmpty()) {
      Text(
        if (live is Live.Loading) "Loading…" else "Nothing learned yet. When you apply an Assist edit that shows a preference, such as shorter copy or no emoji, it appears here.",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    } else {
      Column(Modifier.fillMaxWidth()) {
        preferences.forEachIndexed { index, preference ->
          if (index > 0) HorizontalDivider()
          Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            Column(Modifier.weight(1f)) {
              Text(preference.text, style = MaterialTheme.typography.bodyMedium)
              Text(aiSitePreferenceSeen(preference.count), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(
              onClick = {
                runner.run("Aglyn AI will no longer use that preference.") { context.writer.delete("hosts/$hostId/$AI_SITE_MEMORY_SUBCOLLECTION/${preference.id}") }
              },
              enabled = !runner.busy,
              modifier = Modifier.testTag("ai-memory-forget-${preference.id}"),
            ) { Text("Forget") }
          }
        }
      }
    }
  }
  if (clearing) {
    ActionDialog(
      title = "Forget everything Aglyn AI learned here?",
      body = "Later AI jobs for this site stop using these preferences. Aglyn AI learns again from the edits you apply next.",
      icon = "delete",
      confirmLabel = "Forget all",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = { clearing = false },
      onConfirm = {
        runner.run("Aglyn AI forgot what it learned on this site.", onDone = { clearing = false }) {
          preferences.forEach { context.writer.delete("hosts/$hostId/$AI_SITE_MEMORY_SUBCOLLECTION/${it.id}") }
        }
      },
    )
  }
}
