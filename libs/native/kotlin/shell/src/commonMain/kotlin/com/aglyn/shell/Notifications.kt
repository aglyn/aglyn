package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.NotificationCatalog
import com.aglyn.contracts.Notifications
import com.aglyn.core.ApiMethod
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.Live
import com.aglyn.core.firestoreNow
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.ActivityRow
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * THE NOTIFICATIONS FEED: the console's "All notifications" page and its
 * bell, natively. `users/{uid}/notifications` newest first, filtered by Status
 * (`read`) and Type on the query itself (the composite indexes the console's
 * filters use), a page at a time; mark all read; opening a row marks it read
 * and follows its link natively; an invitation opens its accept or decline.
 */

/** The console feed's page size (TABLE_PAGE_SIZE_DEFAULT). */
const val NOTIFICATION_PAGE = 25

/** The newest unread the console's "Mark all read" settles in one go. */
const val MARK_ALL_WINDOW = 200

/** Firestore's cap on an `in` filter: a Type pick past it is refused whole, as `planNotificationFilters` does. */
const val NOTIFICATION_TYPE_PICK_MAX = 30

enum class NotificationStatusFilter(val key: String, val label: String, val read: Boolean?) {
  ALL("all", "All", null),
  NEW("new", "New", false),
  READ("read", "Read", true),
}

data class NotificationFilter(
  val status: NotificationStatusFilter = NotificationStatusFilter.ALL,
  val types: Set<String> = emptySet(),
)

/** The feed's query for [filter], [limit] rows plus one probe row that says there is more. */
fun notificationFeedQuery(uid: String, filter: NotificationFilter, limit: Int): FirestoreQuery {
  val filters = buildList {
    when (filter.types.size) {
      0 -> Unit
      1 -> add(FirestoreFilter("type", FilterOp.EQ, filter.types.first()))
      else -> add(FirestoreFilter("type", FilterOp.IN, filter.types.sorted().take(NOTIFICATION_TYPE_PICK_MAX)))
    }
    filter.status.read?.let { add(FirestoreFilter("read", FilterOp.EQ, it)) }
  }
  return FirestoreQuery(
    "users/$uid/notifications",
    filters = filters,
    orderBy = listOf(FirestoreOrder("createdAt", descending = true)),
    limit = limit + 1,
  )
}

fun feedNotificationOf(doc: FirestoreDoc): FeedNotification = FeedNotification(
  id = doc.id,
  title = doc.string("title") ?: "",
  body = doc.string("body"),
  link = doc.string("link"),
  // `readAt` is what the console's Status column draws; `read` is what its filter reads.
  read = doc.bool("read") == true || doc.data["readAt"] != null,
  level = doc.string("level"),
  type = doc.string("type"),
  createdAt = doc.data["createdAt"] as? FirestoreTimestamp,
  orgId = doc.string("orgId"),
  hostId = doc.string("hostId"),
  inviteId = doc.string("inviteId"),
)

/** The write that marks one notification read, as the console's: `read` beside `readAt`. */
fun markReadWrite(): Map<String, Any?> = mapOf("read" to true, "readAt" to firestoreNow())

suspend fun markNotificationRead(writer: FirestoreWriter, uid: String, id: String) =
  writer.merge("users/$uid/notifications/$id", markReadWrite())

/** The ids "Mark all read" settles: the newest [MARK_ALL_WINDOW] that are not read yet. */
fun unreadIds(docs: List<FirestoreDoc>): List<String> = docs.filter { it.data["readAt"] == null && it.bool("read") != true }.map { it.id }

@Composable
internal fun NotificationsScreen(services: ShellServices, uid: String, context: ShellPluginContext, catalog: NotificationCatalog = Notifications) {
  var filter by remember(uid) { mutableStateOf(NotificationFilter()) }
  var shown by remember(uid, filter) { mutableStateOf(NOTIFICATION_PAGE) }
  val live by remember(uid, filter, shown) { services.firestore.observe(notificationFeedQuery(uid, filter, shown)) }.collectAsState(Live.Loading)
  var lastRows by remember(uid, filter) { mutableStateOf<List<FeedNotification>?>(null) }
  var markingAll by remember { mutableStateOf(false) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var pickingTypes by remember { mutableStateOf(false) }
  var invite by remember { mutableStateOf<FeedNotification?>(null) }
  val scope = rememberCoroutineScope()

  val ready = (live as? Live.Ready)?.value
  LaunchedEffect(ready) { if (ready != null) lastRows = ready.map(::feedNotificationOf) }
  // A grown page keeps the rows it had on screen until the larger read lands.
  val rows = ready?.map(::feedNotificationOf) ?: lastRows
  val compact = currentWidthClass() == WidthClass.COMPACT
  val hasMore = (rows?.size ?: 0) > shown
  val visible = rows?.take(shown)

  fun open(row: FeedNotification) {
    if (!row.read) scope.launch { runCatching { markNotificationRead(services.writer, uid, row.id) } }
    if (row.inviteId != null && row.orgId != null) {
      invite = row
      return
    }
    context.openNotification(row)
  }

  fun markAll() {
    if (markingAll) return
    markingAll = true
    notice = null
    scope.launch {
      try {
        val page = services.firestore.page(
          FirestoreQuery("users/$uid/notifications", orderBy = listOf(FirestoreOrder("createdAt", descending = true)), limit = MARK_ALL_WINDOW),
        )
        val ids = unreadIds(page.docs)
        ids.forEach { markNotificationRead(services.writer, uid, it) }
        notice = (if (ids.isEmpty()) "Everything was already read." else "Marked ${ids.size} read.") to StatusTone.SUCCESS
      } catch (error: CancellationException) {
        throw error
      } catch (error: Throwable) {
        notice = "Could not mark them read. Check the connection and try again." to StatusTone.ERROR
      } finally {
        markingAll = false
      }
    }
  }

  AglynListDetail(
    modifier = Modifier.testTag("notifications"),
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        FeedToolbar(
          filter = filter,
          catalog = catalog,
          markingAll = markingAll,
          onStatus = { filter = filter.copy(status = it) },
          onPickTypes = { pickingTypes = true },
          onClearTypes = { filter = filter.copy(types = emptySet()) },
          onMarkAll = ::markAll,
        )
        notice?.let { (text, tone) ->
          NoticeBanner(text, tone, Modifier.padding(horizontal = space(2f)), action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } })
        }
        when {
          visible == null && live is Live.Failed -> EmptyState(
            "Could not load notifications",
            body = "Check the connection and try again.",
            icon = AglynIcons.named("error"),
            modifier = Modifier.testTag("notifications-error"),
          )
          visible == null -> SkeletonList(rows = 6)
          visible.isEmpty() -> EmptyState(
            if (filter == NotificationFilter()) "You're all caught up" else "Nothing matches these filters",
            body = if (filter == NotificationFilter()) "New orders, bookings, form entries and alerts show up here." else "Clear a filter to see more.",
            icon = AglynIcons.named("notifications"),
            action = if (filter == NotificationFilter()) null else ({ OutlinedButton(onClick = { filter = NotificationFilter() }) { Text("Clear filters") } }),
            modifier = Modifier.testTag("notifications-empty"),
          )
          else -> {
            val now = remember(visible) { nowMillis() }
            LazyColumn(Modifier.fillMaxSize().testTag("notifications-list"), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = space(1f), vertical = space(0.5f))) {
              items(visible, key = { it.id }) { row ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                  ActivityRow(
                    title = row.title,
                    body = row.body,
                    time = row.createdAt?.let { relativeTime(it.epochMillis, now) },
                    icon = notificationIcon(row.type),
                    tint = levelTint(catalog.level(row.level, row.type)),
                    unread = !row.read,
                    // A phone follows the link at once, as the console's bell does;
                    // a wide window reads it beside the list first.
                    onClick = {
                      if (compact) {
                        open(row)
                      } else {
                        onSelect(row.id)
                        if (!row.read) scope.launch { runCatching { markNotificationRead(services.writer, uid, row.id) } }
                      }
                    },
                    modifier = Modifier.weight(1f).testTag("notification-${row.id}"),
                  )
                  if (!row.read) {
                    IconButton(
                      onClick = { scope.launch { runCatching { markNotificationRead(services.writer, uid, row.id) } } },
                      modifier = Modifier.testTag("mark-read-${row.id}"),
                    ) { Icon(AglynIcons.named("done"), contentDescription = "Mark ${row.title} read") }
                  }
                }
              }
              if (hasMore) {
                item {
                  Box(Modifier.fillMaxWidth().padding(space(2f)), contentAlignment = Alignment.Center) {
                    OutlinedButton(onClick = { shown += NOTIFICATION_PAGE }, Modifier.testTag("notifications-more")) { Text("Show more") }
                  }
                }
              }
            }
          }
        }
      }
    },
    detail = { selected ->
      val row = visible?.firstOrNull { it.id == selected }
      if (row == null) {
        EmptyState("Pick a notification to read it here", icon = AglynIcons.named("notifications"))
      } else {
        NotificationDetail(row, catalog, context.workspaceName(row), onOpen = { open(row) })
      }
    },
  )

  if (pickingTypes) {
    TypePickerDialog(catalog, filter.types, onDismiss = { pickingTypes = false }) {
      filter = filter.copy(types = it)
      pickingTypes = false
    }
  }
  invite?.let { row -> InviteDialog(services, row) { invite = null } }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FeedToolbar(
  filter: NotificationFilter,
  catalog: NotificationCatalog,
  markingAll: Boolean,
  onStatus: (NotificationStatusFilter) -> Unit,
  onPickTypes: () -> Unit,
  onClearTypes: () -> Unit,
  onMarkAll: () -> Unit,
) {
  Column(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      ChoiceChipRow(
        options = NotificationStatusFilter.entries.map { ChipOption(it.key, it.label) },
        selected = filter.status.key,
        onSelect = { key -> onStatus(NotificationStatusFilter.entries.first { it.key == key }) },
        modifier = Modifier.weight(1f).testTag("notifications-status"),
      )
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedButton(onClick = onPickTypes, Modifier.testTag("notifications-types")) {
        Icon(AglynIcons.named("filter_list"), contentDescription = null)
        Text(
          when (filter.types.size) {
            0 -> "All types"
            1 -> catalog.entry(filter.types.first())?.label ?: "1 type"
            else -> "${filter.types.size} types"
          },
          Modifier.padding(start = space(1f)),
        )
      }
      if (filter.types.isNotEmpty()) TextButton(onClick = onClearTypes) { Text("Clear") }
      TextButton(onClick = onMarkAll, enabled = !markingAll, modifier = Modifier.testTag("notifications-mark-all")) {
        Text(if (markingAll) "Marking…" else "Mark all read")
      }
    }
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NotificationDetail(row: FeedNotification, catalog: NotificationCatalog, workspace: String?, onOpen: () -> Unit) {
  val level = catalog.level(row.level, row.type)
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 720.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("notification-detail"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      SectionCard(null, Modifier.fillMaxWidth()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          StatusChip(catalog.levels.firstOrNull { it.id == level }?.label ?: "Info", levelTone(level))
          catalog.entry(row.type)?.let { StatusChip(it.label) }
          if (!row.read) StatusChip("New", StatusTone.INFO)
        }
        Text(row.title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
        row.createdAt?.let {
          Text(relativeTime(it.epochMillis, nowMillis()), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        workspace?.let { Text(it, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        row.body?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
        HorizontalDivider()
        when {
          row.inviteId != null && row.orgId != null -> Button(onClick = onOpen, Modifier.testTag("notification-open")) { Text("Review the invitation") }
          row.link != null -> Button(onClick = onOpen, Modifier.testTag("notification-open")) { Text("Open") }
          else -> Text("Nothing to open for this one.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
  }
}

internal fun levelTone(level: String?): StatusTone = when (levelIntent(level)) {
  "error" -> StatusTone.ERROR
  "warning" -> StatusTone.WARNING
  "success" -> StatusTone.SUCCESS
  "neutral" -> StatusTone.NEUTRAL
  else -> StatusTone.INFO
}

@Composable
private fun TypePickerDialog(catalog: NotificationCatalog, initial: Set<String>, onDismiss: () -> Unit, onApply: (Set<String>) -> Unit) {
  var picked by remember { mutableStateOf(initial) }
  ActionDialog(
    title = "Show types",
    confirmLabel = "Show",
    onConfirm = { onApply(picked) },
    onDismiss = onDismiss,
    icon = "filter_list",
    confirmEnabled = picked.size <= NOTIFICATION_TYPE_PICK_MAX,
    error = if (picked.size > NOTIFICATION_TYPE_PICK_MAX) "Pick at most $NOTIFICATION_TYPE_PICK_MAX types." else null,
  ) {
    Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()).testTag("notification-type-picker")) {
      for (category in catalog.categories) {
        Text(category.label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = space(1f)))
        for (entry in category.types) {
          Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Checkbox(
              checked = entry.type in picked,
              onCheckedChange = { on -> picked = if (on) picked + entry.type else picked - entry.type },
              modifier = Modifier.testTag("type-${entry.type}"),
            )
            Text(entry.label, style = MaterialTheme.typography.bodyMedium)
          }
        }
      }
    }
  }
}

/** The invitee's own invitation: accept or decline, through `/api/orgs/invites` as the console's dialog does. */
@Composable
private fun InviteDialog(services: ShellServices, row: FeedNotification, onDone: () -> Unit) {
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  var declining by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  fun respond(action: String) {
    busy = true
    error = null
    scope.launch {
      try {
        services.api.request(
          "/api/orgs/invites",
          ApiMethod.POST,
          buildJsonObject {
            put("orgId", row.orgId)
            put("action", action)
            put("inviteId", row.inviteId)
          },
        )
        if (action == "accept") row.orgId?.let { services.workspace.selectOrg(it) }
        onDone()
      } catch (failure: CancellationException) {
        throw failure
      } catch (failure: Throwable) {
        error = failure.message ?: if (action == "accept") "Accepting the invite failed" else "Declining the invite failed"
      } finally {
        busy = false
      }
    }
  }
  if (declining) {
    ActionDialog(
      title = "Decline this invitation?",
      body = row.body ?: row.title,
      confirmLabel = "Decline",
      destructive = true,
      busy = busy,
      error = error,
      onConfirm = { respond("decline") },
      onDismiss = { declining = false },
      icon = "group",
    )
  } else {
    ActionDialog(
      title = row.title,
      body = row.body,
      confirmLabel = "Accept",
      dismissLabel = "Not now",
      busy = busy,
      error = error,
      onConfirm = { respond("accept") },
      onDismiss = onDone,
      icon = "group",
    ) {
      TextButton(onClick = { declining = true }, enabled = !busy, modifier = Modifier.testTag("invite-decline")) { Text("Decline instead") }
    }
  }
}
