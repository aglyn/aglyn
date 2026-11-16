package com.aglyn.site.pages

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.PasswordVisualTransformation
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.core.planFeatureCarried
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.DateTimeField
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.PlainSection
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.TextButton
import com.aglyn.ui.UpgradeNotice
import com.aglyn.ui.formatDateTime
import com.aglyn.ui.space

/*
 * The console page view's Publishing schedule and Page Access cards
 * (AGL-113, AGL-4086), as sections of the page's details. The Apple kit's
 * PageSettingsSections.swift. Times are UTC, as the content scheduler's are.
 */

/** A schedule's time as the sections show it. */
internal fun pageScheduleTime(millis: Long): String = "${formatDateTime(millis, withTime = true)} UTC"

/** Whether the workspace's plan carries scheduled publishing; null while the workspace is still being read. */
@Composable
internal fun rememberSchedulingCarried(context: NativePluginContext): Boolean? {
  val orgId = context.orgId ?: return null
  val org by remember(orgId, context.firestore) { context.firestore.observeDoc("orgs/$orgId") }.collectAsState(Live.Loading)
  return (org as? Live.Ready)?.let { planFeatureCarried(it.value?.data, SCHEDULED_PUBLISHING_FEATURE) }
}

/**
 * The page's schedule: the pending publish or unpublish (cancel it), a
 * schedule that came due and did not run (dismiss it), and Schedule publish /
 * Schedule unpublish, locked with the console's upsell on a plan without it.
 */
@Composable
internal fun PageScheduleSection(
  context: NativePluginContext,
  page: PageNode,
  live: Boolean,
  settings: PageSettings,
  carried: Boolean?,
  api: PageSettingsApi,
  runner: ActionRunner,
  canPublish: Boolean,
  onSchedule: (unpublish: Boolean) -> Unit,
) {
  val locked = carried == false
  val ready = carried != null
  PlainSection("Schedule", Modifier.testTag("page-schedule")) {
    settings.pending?.let { pending ->
      Row(Modifier.fillMaxWidth().testTag("page-schedule-pending"), verticalAlignment = Alignment.CenterVertically) {
        StatusChip(pageScheduleLabel(pending, ::pageScheduleTime), StatusTone.INFO)
        androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
        TextButton(onClick = { runner.run("Schedule canceled") { api.cancelSchedule(page.id) } }, enabled = canPublish && !runner.busy, modifier = Modifier.testTag("page-schedule-cancel")) { Text("Cancel") }
      }
    }
    settings.skippedLabel?.let { skipped ->
      Row(Modifier.fillMaxWidth().testTag("page-schedule-skipped"), verticalAlignment = Alignment.CenterVertically) {
        StatusChip(skipped, StatusTone.WARNING, Modifier.weight(1f, fill = false))
        androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
        TextButton(onClick = { runner.run("Schedule canceled") { api.cancelSchedule(page.id) } }, enabled = canPublish && !runner.busy) { Text("Dismiss") }
      }
      settings.skippedHelp?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
      OutlinedButton(
        onClick = { onSchedule(false) },
        enabled = canPublish && ready && !locked && page.versionId != null,
        modifier = Modifier.testTag("page-schedule-publish"),
      ) { Text("Schedule publish") }
      OutlinedButton(
        onClick = { onSchedule(true) },
        enabled = canPublish && ready && !locked && live,
        modifier = Modifier.testTag("page-schedule-unpublish"),
      ) { Text("Schedule unpublish") }
    }
    when {
      locked -> UpgradeNotice(schedulingUpsell(), action = { context.navigate("core.billing.plans") })
      !canPublish -> Text("Your role on this site can edit content but not publish it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

/** Who may see the page: the visibility, the page password, and the per-page preview switch. */
@Composable
internal fun PageAccessSection(
  page: PageNode,
  livePath: String?,
  settings: PageSettings,
  host: FirestoreDoc?,
  api: PageSettingsApi,
  runner: ActionRunner,
  canEdit: Boolean,
  canPublish: Boolean,
) {
  val inPreview = isPageInPreview(host?.data, page.id)
  var password by remember(page.id) { mutableStateOf("") }
  PlainSection("Page access", Modifier.testTag("page-access")) {
    val options = PageVisibility.entries.map { SelectOption(it.name, it.label) }
    SelectField(
      label = "Visibility",
      options = options,
      selected = settings.visibility?.name,
      onSelect = { picked ->
        val next = picked?.let { PageVisibility.valueOf(it) } ?: return@SelectField
        if (next == settings.visibility) return@SelectField
        val had = settings.hasPassword
        runner.run("Page access updated") { api.setVisibility(page.id, next, had, livePath) }
      },
      enabled = canEdit && !runner.busy,
      supporting = settings.visibility?.hint,
      modifier = Modifier.testTag("page-visibility"),
    )
    if (settings.visibility == PageVisibility.PASSWORD) {
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
          password,
          { password = it },
          label = { Text("Page password") },
          singleLine = true,
          visualTransformation = PasswordVisualTransformation(),
          supportingText = { Text(if (settings.hasPassword) "A password is set — save a new one to change it." else "Save a password to protect this page.") },
          modifier = Modifier.weight(1f).testTag("page-password"),
        )
        OutlinedButton(
          onClick = {
            val value = password
            runner.run(if (value.isNotBlank()) "Password protection enabled" else "Password protection removed") {
              api.setPassword(page.id, value, livePath)
              password = ""
            }
          },
          enabled = canEdit && !runner.busy,
          modifier = Modifier.testTag("page-password-save"),
        ) { Text("Save") }
      }
    }
    SwitchRow(
      "Preview — only your team can see this page",
      checked = inPreview,
      onCheckedChange = { enabled ->
        runner.run(if (enabled) "Only your team can see this page now" else "This page is public once it is published") { api.setPreview(page.id, enabled) }
      },
      supporting = pagePreviewCaption(isSiteInPreview(host?.data), inPreview),
      enabled = canPublish && !runner.busy,
      modifier = Modifier.testTag("page-preview-switch"),
    )
    Text("Per-user editor permissions arrive with the team user manager.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

/** Schedule publication / Schedule unpublish: a version (publishing) and a future time. */
@Composable
internal fun PageScheduleDialog(
  context: NativePluginContext,
  hostId: String,
  page: PageNode,
  unpublish: Boolean,
  presetVersionId: String?,
  api: PageSettingsApi,
  runner: ActionRunner,
  close: () -> Unit,
) {
  var versionId by remember(page.id) { mutableStateOf(presetVersionId ?: page.versionId) }
  var at by remember(page.id) { mutableStateOf<Long?>(defaultScheduleMillis(nowMillis())) }
  val versions by remember(hostId, page.id, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/screens/${page.id}/versions", orderBy = listOf(FirestoreOrder("createdAt", descending = true)), limit = 20))
  }.collectAsState(Live.Loading)
  val future = at?.let { it > nowMillis() } == true
  ActionDialog(
    title = if (unpublish) "Schedule unpublish" else "Schedule publication",
    body = if (unpublish) {
      "The page goes offline once the time passes (applied on the next site refresh). Only one pending schedule exists per page."
    } else {
      "The selected version becomes the live version at the chosen time (applied on the next site refresh after it passes). Only one pending schedule exists per page."
    },
    icon = "schedule",
    confirmLabel = "Schedule",
    confirmEnabled = future && (unpublish || versionId != null),
    busy = runner.busy,
    error = runner.error,
    onDismiss = close,
    onConfirm = {
      val time = at ?: return@ActionDialog
      runner.run("Scheduled to ${if (unpublish) "unpublish" else "publish"} ${pageScheduleTime(time)}", onDone = close) {
        api.schedule(page.id, unpublish, versionId, time)
      }
    },
  ) {
    if (!unpublish) {
      val rows = (versions as? Live.Ready)?.value?.map(::pageVersionOf).orEmpty()
      SelectField(
        label = "Version",
        options = rows.mapIndexed { index, version -> SelectOption(version.id, version.name ?: "Version ${rows.size - index}") },
        selected = versionId,
        onSelect = { versionId = it },
        modifier = Modifier.testTag("page-schedule-version"),
      )
    }
    DateTimeField(
      if (unpublish) "Unpublish at" else "Publish at",
      at,
      { at = it },
      withTime = true,
      supporting = if (at != null && !future) "Pick a future date/time" else "UTC",
      modifier = Modifier.testTag("page-schedule-at"),
    )
  }
}
