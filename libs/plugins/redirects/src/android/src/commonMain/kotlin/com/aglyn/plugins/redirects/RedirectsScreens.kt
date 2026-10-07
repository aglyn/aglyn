package com.aglyn.plugins.redirects

import androidx.compose.foundation.layout.Arrangement
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ActionDialog
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.Alignment
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.material3.TextButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.Button
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.EmptyState
import com.aglyn.ui.MetricCard
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

private fun matchLabel(kind: String?) = "${kind ?: "exact"} match"

/**
 * The site's redirect rules, the rule beside the list on wide windows: add
 * one, edit it, switch it off and on, or delete it, with the Redirects page's
 * own checks and writes ([RedirectsEditor]).
 */
@Composable
fun RedirectsListScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val live = hostRedirects(context)
  val scope = rememberCoroutineScope()
  val editor = remember(hostId, context.uid) {
    RedirectsEditor(ConsoleRedirectsWriteApi(context.api, context.writer, hostId), context.uid, scope)
  }
  AglynListDetail(
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        Row(
          Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Text("Rules", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          Button(onClick = editor::add, Modifier.testTag("add-redirect")) {
            Icon(AglynIcons.named("add"), contentDescription = null)
            Text("Add redirect", Modifier.padding(start = space(1f)))
          }
        }
        if (editor.draft == null && editor.deleting == null) {
          editor.error?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.padding(horizontal = space(2f))) }
          editor.notice?.let { message ->
            NoticeBanner(message, StatusTone.SUCCESS, Modifier.padding(horizontal = space(2f)), action = { TextButton(onClick = { editor.notice = null }) { Text("Dismiss") } })
          }
        }
        when (live) {
          Live.Loading -> SkeletonList(rows = 4)
          is Live.Failed -> EmptyState(
            "Could not load this site's redirects",
            body = "Check the connection and try again.",
            icon = AglynIcons.named("error"),
          )
          is Live.Ready -> LazyColumn(Modifier.fillMaxSize().testTag("redirects-list")) {
            if (live.value.isEmpty()) {
              item {
                EmptyState("No redirects yet", body = "Send an old address to a new one, so links and search results keep working.", icon = AglynIcons.named("alt_route"))
              }
            }
            items(live.value, key = { it.id }) { row ->
              AglynListItem(
                title = row.source,
                supporting = "${row.statusCode} → ${row.destination}",
                icon = AglynIcons.named(if (row.enabled) "alt_route" else "pause_circle"),
                selected = row.id == selected,
                trailing = { if (!row.enabled) StatusChip("Off") },
                onClick = { onSelect(row.id) },
                modifier = Modifier.testTag("redirect-${row.id}"),
              )
            }
          }
        }
      }
    },
    detail = { selected ->
      val row = (live as? Live.Ready)?.value?.firstOrNull { it.id == selected }
      if (row == null) {
        EmptyState("Pick a redirect to see it here", icon = AglynIcons.named("alt_route"))
      } else {
        RedirectDetail(row, editor)
      }
    },
  )
  RedirectDialogs(editor)
}

@Composable
private fun RedirectDetail(row: RedirectRow, editor: RedirectsEditor) {
  Column(Modifier.fillMaxSize().padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
    SectionCard(
      null,
      Modifier.fillMaxWidth().testTag("redirect-detail"),
    ) {
      Text(row.source, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
      HorizontalDivider()
      Text("Sends visitors to", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Text(row.destination, style = MaterialTheme.typography.bodyLarge)
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        StatusChip(row.statusCode.toString(), StatusTone.INFO)
        StatusChip(matchLabel(row.kind))
        StatusChip(if (row.enabled) "On" else "Off", if (row.enabled) StatusTone.SUCCESS else StatusTone.NEUTRAL)
      }
      SwitchRow(
        "Redirect is on",
        row.enabled,
        { on -> editor.toggle(row, on) },
        supporting = "Switch it off to stop redirecting without deleting the rule.",
        enabled = !editor.busy,
        modifier = Modifier.testTag("redirect-enabled"),
      )
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Button(onClick = { editor.edit(row) }, Modifier.testTag("edit-redirect")) { Text("Edit") }
        OutlinedButton(onClick = { editor.askDelete(row) }, Modifier.testTag("delete-redirect")) { Text("Delete") }
      }
    }
  }
}

@Composable
private fun RedirectDialogs(editor: RedirectsEditor) {
  editor.draft?.let { draft ->
    ActionDialog(
      title = if (draft.id == null) "Add a redirect" else "Edit redirect",
      icon = "alt_route",
      confirmLabel = "Save",
      confirmEnabled = draft.source.isNotBlank() && draft.destination.isNotBlank(),
      busy = editor.busy,
      error = editor.error,
      onDismiss = editor::close,
      onConfirm = editor::save,
    ) {
      ChoiceChipRow(
        options = REDIRECT_KIND_CHOICES.map { (key, label) -> ChipOption(key, label) },
        selected = draft.kind,
        onSelect = { editor.change(draft.copy(kind = it)) },
        wrap = true,
      )
      OutlinedTextField(
        draft.source,
        { editor.change(draft.copy(source = it)) },
        label = { Text(if (draft.kind == "regex") "Pattern" else "From path") },
        placeholder = { Text(if (draft.kind == "regex") "^/blog/(.*)$" else "/old-page") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("redirect-source"),
      )
      OutlinedTextField(
        draft.destination,
        { editor.change(draft.copy(destination = it)) },
        label = { Text("To") },
        placeholder = { Text("/new-page or https://…") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("redirect-destination"),
      )
      ChoiceChipRow(
        options = REDIRECT_STATUS_CHOICES.map { (code, label) -> ChipOption(code.toString(), label) },
        selected = draft.statusCode.toString(),
        onSelect = { editor.change(draft.copy(statusCode = it.toLong())) },
        wrap = true,
      )
      OutlinedTextField(
        draft.priority,
        { editor.change(draft.copy(priority = it.filter(Char::isDigit).take(6))) },
        label = { Text("Priority (optional)") },
        supportingText = { Text("Lower runs first. Rules with none run at $REDIRECT_DEFAULT_PRIORITY.") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        modifier = Modifier.fillMaxWidth(),
      )
    }
  }
  editor.deleting?.let { row ->
    ActionDialog(
      title = "Delete this redirect?",
      body = "${row.source} stops redirecting.",
      icon = "delete",
      confirmLabel = "Delete",
      destructive = true,
      busy = editor.busy,
      error = editor.error,
      onDismiss = editor::close,
      onConfirm = editor::confirmDelete,
    )
  }
}

/**
 * The Redirects card on the dashboard: how many rules the site serves and
 * how many are switched off. The whole card opens the Redirects screen.
 */
@Composable
fun RedirectsSummaryWidget(context: NativePluginContext) {
  val live = hostRedirects(context)
  val rows = (live as? Live.Ready)?.value
  val off = rows?.count { !it.enabled } ?: 0
  val on = rows?.let { it.size - off }
  MetricCard(
    title = "Redirects",
    value = on?.toString(),
    caption = on?.let { (if (it == 1) "redirect is on" else "redirects are on") + if (off > 0) " · $off off" else "" },
    icon = "alt_route",
    actionLabel = "Open redirects",
    modifier = Modifier.fillMaxSize().testTag("redirects-summary"),
    loading = live is Live.Loading,
    error = if (live is Live.Failed) "Could not load redirects." else null,
    onClick = { context.navigate(REDIRECTS_LIST_SCREEN) },
  )
}
