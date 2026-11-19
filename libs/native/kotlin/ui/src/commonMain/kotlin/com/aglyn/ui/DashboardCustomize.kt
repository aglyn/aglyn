package com.aglyn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

/**
 * One card in Customize dashboard: its stored id, its title, and the ids of the cards it may move among (null: it stays
 * where it is, as the console's Traffic card does).
 */
data class DashboardCustomizeRow(val id: String, val title: String, val groupIds: List<String>? = null)

/**
 * The console's Customize dashboard dialog: a switch per card and Move up / Move down within its group. Each change is
 * saved as it is made; Done only closes. The Apple kit's `DashboardCustomizeSheet`.
 */
@Composable
fun DashboardCustomizeSheet(
  rows: List<DashboardCustomizeRow>,
  ready: Boolean,
  isHidden: (String) -> Boolean,
  setHidden: (String, Boolean) -> Unit,
  move: (List<String>, String, Int) -> Unit,
  onDismiss: () -> Unit,
) {
  AlertDialog(
    onDismissRequest = onDismiss,
    modifier = Modifier.testTag("dashboard-customize"),
    title = { Text("Customize dashboard") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        Text(
          "Switch off the cards you do not need. Nothing is deleted — turn one back on any time.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (!ready) {
          CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally).padding(space(2f)))
        } else {
          rows.forEach { row ->
            val hidden = isHidden(row.id)
            val position = row.groupIds?.indexOf(row.id) ?: -1
            val last = (row.groupIds?.size ?: 0) - 1
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
              Switch(
                checked = !hidden,
                onCheckedChange = { setHidden(row.id, !it) },
                modifier = Modifier.testTag("dashboard-show-${row.id}").semantics { contentDescription = "Show ${row.title}" },
              )
              Text(
                row.title,
                Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                color = if (hidden) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
              )
              IconButton(onClick = { move(row.groupIds.orEmpty(), row.id, -1) }, enabled = position > 0, modifier = Modifier.testTag("dashboard-up-${row.id}")) {
                Icon(AglynIcons.named("arrow_upward"), contentDescription = "Move ${row.title} up")
              }
              IconButton(onClick = { move(row.groupIds.orEmpty(), row.id, 1) }, enabled = position in 0 until last, modifier = Modifier.testTag("dashboard-down-${row.id}")) {
                Icon(AglynIcons.named("arrow_downward"), contentDescription = "Move ${row.title} down")
              }
            }
          }
        }
      }
    },
    confirmButton = { TextButton(onClick = onDismiss, modifier = Modifier.testTag("dashboard-customize-done")) { Text("Done") } },
  )
}
