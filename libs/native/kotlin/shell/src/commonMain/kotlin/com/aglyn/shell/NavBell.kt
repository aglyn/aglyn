package com.aglyn.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.WorkspaceState
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.TextButton
import kotlinx.coroutines.launch

/** Which notifications the bell's popover lists. */
internal enum class BellScope(val label: String) { EVERYWHERE("All workspaces"), WORKSPACE("This workspace"), SITE("This site") }

/** How many of the newest notifications the popover shows. */
private const val BELL_ROWS = 15

/**
 * The bell's popover (it replaces the Notifications row in the sidebar): All or Unread, a scope (every workspace, this
 * workspace, this site), each row with its alert level, Mark all read, the gear to the notification settings and See all.
 */
@Composable
internal fun BellPopover(
  services: ShellServices,
  context: ShellPluginContext,
  workspace: WorkspaceState,
  uid: String,
  expanded: Boolean,
  onDismiss: () -> Unit,
  onSeeAll: () -> Unit,
  onSettings: () -> Unit,
) {
  var unreadOnly by remember { mutableStateOf(false) }
  var scopeFilter by remember { mutableStateOf(BellScope.EVERYWHERE) }
  var scopeMenu by remember { mutableStateOf(false) }
  val feed = notificationFeed(services, uid, 60)
  val scope = rememberCoroutineScope()
  val now = remember(expanded) { nowMillis() }
  val rows = (feed as? Live.Ready)?.value.orEmpty()
    .filter { !unreadOnly || !it.read }
    .filter {
      when (scopeFilter) {
        BellScope.EVERYWHERE -> true
        BellScope.WORKSPACE -> it.orgId == workspace.org?.id
        BellScope.SITE -> it.hostId == workspace.site?.id
      }
    }
    .take(BELL_ROWS)
  DropdownMenu(expanded, onDismissRequest = onDismiss, modifier = Modifier.width(400.dp).testTag("bell-popover")) {
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
      Text("Notifications", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
      TitleBarButton("Notification settings", "settings", "bell-settings") { onDismiss(); onSettings() }
    }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
        SegmentedButton(!unreadOnly, onClick = { unreadOnly = false }, shape = SegmentedButtonDefaults.itemShape(0, 2), modifier = Modifier.testTag("bell-all")) { Text("All") }
        val unread = (feed as? Live.Ready)?.value.orEmpty().count { !it.read }
        SegmentedButton(unreadOnly, onClick = { unreadOnly = true }, shape = SegmentedButtonDefaults.itemShape(1, 2), modifier = Modifier.testTag("bell-unread")) { Text(if (unread > 0) "Unread · $unread" else "Unread") }
      }
      Box {
        TextButton(onClick = { scopeMenu = true }, modifier = Modifier.testTag("bell-scope")) { Text(scopeFilter.label); Icon(AglynIcons.named("expand_more"), null, Modifier.size(18.dp)) }
        DropdownMenu(scopeMenu, onDismissRequest = { scopeMenu = false }) {
          for (option in BellScope.entries) {
            if (option == BellScope.SITE && workspace.site == null) continue
            MenuRow(option.label, if (option == scopeFilter) "check" else null, tag = "bell-scope-${option.name.lowercase()}") { scopeFilter = option; scopeMenu = false }
          }
        }
      }
    }
    HorizontalDivider()
    if (feed is Live.Loading) {
      Text("Loading…", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else if (rows.isEmpty()) {
      Text(if (unreadOnly) "Nothing unread." else "Nothing here yet.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else {
      // A menu measures its content's intrinsic width, which a lazy list cannot give: the rows are plain (the feed is
      // a bounded page) and the menu scrolls them.
      Column {
        for (row in rows) androidx.compose.runtime.key(row.id) {
          Row(
            Modifier.fillMaxWidth().clickable {
              onDismiss()
              if (!row.read) scope.launch { runCatching { markNotificationRead(services.writer, uid, row.id) } }
              context.openNotification(row)
            }.padding(horizontal = 16.dp, vertical = 10.dp).testTag("bell-row-${row.id}").semantics(mergeDescendants = true) {
              contentDescription = (if (row.read) "" else "Unread. ") + row.title
            },
            horizontalArrangement = Arrangement.spacedBy(10.dp),
          ) {
            Box(Modifier.padding(top = 6.dp).size(8.dp).clip(CircleShape).background(if (row.read) androidx.compose.ui.graphics.Color.Transparent else levelTint(row.level)))
            Column(Modifier.weight(1f)) {
              Text(row.title, style = MaterialTheme.typography.bodyMedium, fontWeight = if (row.read) null else FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
              val where = context.workspaceName(row)
              val at = row.createdAt?.let { relativeTime(it.seconds * 1000, now) }
              Text(listOfNotNull(where, at).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
          }
        }
      }
    }
    HorizontalDivider()
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
      TextButton(
        onClick = {
          scope.launch {
            runCatching {
              val page = services.firestore.page(FirestoreQuery("users/$uid/notifications", orderBy = listOf(FirestoreOrder("createdAt", descending = true)), limit = MARK_ALL_WINDOW))
              unreadIds(page.docs).forEach { markNotificationRead(services.writer, uid, it) }
            }
          }
        },
        modifier = Modifier.testTag("bell-mark-all"),
      ) { Text("Mark all read") }
      Box(Modifier.weight(1f))
      TextButton(onClick = { onDismiss(); onSeeAll() }, modifier = Modifier.testTag("bell-see-all")) { Text("See all") }
    }
  }
}
