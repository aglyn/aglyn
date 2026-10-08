package com.aglyn.plugins.eventscalendar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.EventStatus
import com.aglyn.contracts.EventWriteInput
import com.aglyn.contracts.eventWrite
import com.aglyn.contracts.eventWriteProblem
import com.aglyn.contracts.formatLocalDay
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.Live
import com.aglyn.core.firestoreNow
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.DateTimeField
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.formatClock
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/*
 * A SITE'S EVENTS, as the Events page keeps them: `hosts/{hostId}/events`,
 * the newest 200 by start, drafts and published; add or edit one with the
 * page's own rule (`eventWrite`) and its own merge write, and delete one the
 * way the page does (`deletedAt` with `status: deleted`, which the public
 * listing reads).
 */

const val EVENTS_SCREEN = "events-calendar.events"

/** The page's ceiling: the newest 200, and a probe row that says there is more. */
const val EVENT_CEILING = 200

fun eventsPath(hostId: String) = "hosts/$hostId/events"

fun eventsQuery(hostId: String) = FirestoreQuery(eventsPath(hostId), orderBy = listOf(FirestoreOrder("startsAtMs", descending = true)), limit = EVENT_CEILING + 1)

data class EventRow(
  val id: String,
  val title: String,
  val startsAtMs: Long,
  val endsAtMs: Long?,
  val location: String,
  val organizer: String,
  val description: String,
  val coverImage: String,
  val coverImageAlt: String,
  val status: String,
  val deleted: Boolean,
)

fun eventRowOf(doc: FirestoreDoc): EventRow = EventRow(
  id = doc.id,
  title = doc.string("title") ?: "",
  startsAtMs = (doc.data["startsAtMs"] as? Number)?.toLong() ?: 0,
  endsAtMs = (doc.data["endsAtMs"] as? Number)?.toLong(),
  location = doc.string("location") ?: "",
  organizer = doc.string("organizer") ?: "",
  description = doc.string("description") ?: "",
  coverImage = doc.string("coverImage") ?: "",
  coverImageAlt = doc.string("coverImageAlt") ?: "",
  status = doc.string("status") ?: "draft",
  deleted = doc.data["deletedAt"] != null,
)

/** The page's list: the window minus the deleted, newest first; and whether the window was full. */
fun visibleEvents(docs: List<FirestoreDoc>): Pair<List<EventRow>, Boolean> =
  docs.take(EVENT_CEILING).map(::eventRowOf).filterNot { it.deleted }.sortedByDescending { it.startsAtMs } to (docs.size > EVENT_CEILING)

/** The editor as typed. */
data class EventDraft(
  val id: String?,
  val title: String = "",
  val startsAtMs: Long? = null,
  val endsAtMs: Long? = null,
  val location: String = "",
  val organizer: String = "",
  val description: String = "",
  val coverImage: String = "",
  val coverImageAlt: String = "",
  val status: EventStatus = EventStatus.DRAFT,
)

fun draftOf(row: EventRow) = EventDraft(
  row.id, row.title, row.startsAtMs, row.endsAtMs, row.location, row.organizer, row.description, row.coverImage, row.coverImageAlt,
  if (row.status == "published") EventStatus.PUBLISHED else EventStatus.DRAFT,
)

/**
 * The page's save: the shared rule's stored form, as a merge, with every
 * field the rule removes deleted (a merge would keep it), `updatedAt`, and
 * `createdAt` on a new event.
 */
fun eventMerge(draft: EventDraft): Map<String, Any?> {
  val write = eventWrite(
    EventWriteInput(
      coverImage = draft.coverImage, coverImageAlt = draft.coverImageAlt, description = draft.description,
      endsAtMs = draft.endsAtMs, location = draft.location, organizer = draft.organizer, startsAtMs = draft.startsAtMs ?: 0,
      status = draft.status, title = draft.title,
    ),
  )
  val fields = write.fields
  val now = firestoreNow()
  return buildMap {
    put("title", fields.title)
    put("startsAtMs", fields.startsAtMs)
    put("endsAtMs", fields.endsAtMs)
    put("status", fields.status.raw)
    fields.location?.let { put("location", it) }
    fields.organizer?.let { put("organizer", it) }
    fields.description?.let { put("description", it) }
    fields.coverImage?.let { put("coverImage", it) }
    fields.coverImageAlt?.let { put("coverImageAlt", it) }
    write.remove.forEach { put(it.raw, FirestoreDelete) }
    put("updatedAt", now)
    if (draft.id == null) put("createdAt", now)
  }
}

@OptIn(ExperimentalUuidApi::class)
suspend fun saveEvent(writer: FirestoreWriter, hostId: String, draft: EventDraft): String {
  val id = draft.id ?: Uuid.random().toHexString().take(20)
  writer.merge("${eventsPath(hostId)}/$id", eventMerge(draft))
  return id
}

/** The page's delete: `deletedAt`, and `status: deleted`, which the public listing's query reads. */
suspend fun deleteEvent(writer: FirestoreWriter, hostId: String, id: String) =
  writer.merge("${eventsPath(hostId)}/$id", mapOf("deletedAt" to firestoreNow(), "status" to "deleted"))

private const val NEW = "new"

@Composable
fun EventsScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val flow = remember(hostId, context.firestore) { context.firestore.observe(eventsQuery(hostId)) }
  val live by flow.collectAsState(Live.Loading)
  val ready = (live as? Live.Ready)?.value?.let(::visibleEvents)
  val scope = rememberCoroutineScope()
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var deleting by remember { mutableStateOf<EventRow?>(null) }
  var busy by remember { mutableStateOf(false) }

  fun run(done: String, action: suspend () -> Unit) {
    busy = true
    notice = null
    scope.launch {
      try {
        action()
        notice = done to StatusTone.SUCCESS
      } catch (error: CancellationException) {
        throw error
      } catch (error: Throwable) {
        notice = (error.message ?: "That did not save. Try again.") to StatusTone.ERROR
      } finally {
        busy = false
      }
    }
  }

  AglynListDetail(
    modifier = Modifier.testTag("events"),
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)), verticalAlignment = Alignment.CenterVertically) {
          Text("Events", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          Button(onClick = { onSelect(NEW) }, modifier = Modifier.testTag("add-event")) {
            Icon(AglynIcons.named("add"), contentDescription = null)
            Text("Add event", Modifier.padding(start = space(1f)))
          }
        }
        notice?.let { (message, tone) ->
          NoticeBanner(message, tone, Modifier.padding(horizontal = space(2f)), action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } })
        }
        if (ready?.second == true) {
          NoticeBanner("Showing the newest $EVENT_CEILING events.", StatusTone.INFO, Modifier.padding(horizontal = space(2f)))
        }
        when {
          live is Live.Failed -> EmptyState("Could not load this site's events", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
          ready == null -> SkeletonList(rows = 4)
          ready.first.isEmpty() -> EmptyState(
            "No events yet",
            body = "Create events here, then drop an Event List element on any page; published events show with SEO event markup.",
            icon = AglynIcons.named("event"),
          )
          else -> LazyColumn(Modifier.fillMaxSize().testTag("events-list")) {
            items(ready.first, key = { it.id }) { row ->
              AglynListItem(
                title = row.title,
                supporting = formatLocalDay(row.startsAtMs, "EEE, MMM d, yyyy") + " · " + formatClock(row.startsAtMs) + (if (row.location.isNotEmpty()) " · ${row.location}" else ""),
                icon = AglynIcons.named("event"),
                selected = row.id == selected,
                trailing = { StatusChip(row.status, if (row.status == "published") StatusTone.SUCCESS else StatusTone.NEUTRAL) },
                onClick = { onSelect(row.id) },
                modifier = Modifier.testTag("event-${row.id}"),
              )
            }
          }
        }
      }
    },
    detail = { selected ->
      val row = ready?.first?.firstOrNull { it.id == selected }
      when {
        selected == null -> EmptyState("Pick an event to see it here", icon = AglynIcons.named("event"))
        selected == NEW -> EventEditor(EventDraft(null), busy) { draft -> run("Event saved.") { saveEvent(context.writer, hostId, draft) } }
        row == null -> EmptyState("This event is gone", icon = AglynIcons.named("event_busy"))
        else -> EventEditor(remember(row) { draftOf(row) }, busy, onDelete = { deleting = row }) { draft ->
          run("Event saved.") { saveEvent(context.writer, hostId, draft) }
        }
      }
    },
  )
  deleting?.let { row ->
    ActionDialog(
      title = "Delete this event?",
      body = "\"${row.title}\" disappears from your site.",
      confirmLabel = "Delete",
      destructive = true,
      icon = "delete",
      busy = busy,
      onDismiss = { deleting = null },
      onConfirm = {
        deleting = null
        run("Event deleted.") { deleteEvent(context.writer, hostId, row.id) }
      },
    )
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EventEditor(initial: EventDraft, busy: Boolean, onDelete: (() -> Unit)? = null, onSave: (EventDraft) -> Unit) {
  var draft by remember(initial) { mutableStateOf(initial) }
  val problem = eventWriteProblem(draft.title, draft.startsAtMs ?: 0)
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 720.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("event-editor"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      Text(if (initial.id == null) "New event" else draft.title.ifBlank { "Event" }, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
      SectionCard(null, Modifier.fillMaxWidth()) {
        ChoiceChipRow(
          options = listOf(ChipOption(EventStatus.DRAFT.raw, "Draft"), ChipOption(EventStatus.PUBLISHED.raw, "Published")),
          selected = draft.status.raw,
          onSelect = { raw -> draft = draft.copy(status = if (raw == EventStatus.PUBLISHED.raw) EventStatus.PUBLISHED else EventStatus.DRAFT) },
          modifier = Modifier.testTag("event-status"),
        )
        OutlinedTextField(
          draft.title,
          { draft = draft.copy(title = it.take(Contracts.eventTitleMaxLength.toInt())) },
          label = { Text("Title") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth().testTag("event-title"),
        )
        DateTimeField("Starts", draft.startsAtMs, { draft = draft.copy(startsAtMs = it) }, Modifier.fillMaxWidth().testTag("event-starts"))
        DateTimeField("Ends", draft.endsAtMs, { draft = draft.copy(endsAtMs = it) }, Modifier.fillMaxWidth().testTag("event-ends"), clearable = true)
        Text("Without an end after the start, an event lasts an hour.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(draft.location, { draft = draft.copy(location = it.take(Contracts.eventLocationMaxLength.toInt())) }, label = { Text("Location") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("event-location"))
        OutlinedTextField(draft.organizer, { draft = draft.copy(organizer = it.take(Contracts.eventOrganizerMaxLength.toInt())) }, label = { Text("Organizer") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("event-organizer"))
        OutlinedTextField(draft.description, { draft = draft.copy(description = it.take(Contracts.eventDescriptionMaxLength.toInt())) }, label = { Text("Description") }, minLines = 3, modifier = Modifier.fillMaxWidth().testTag("event-description"))
      }
      SectionCard("Cover", Modifier.fillMaxWidth()) {
        OutlinedTextField(draft.coverImage, { draft = draft.copy(coverImage = it) }, label = { Text("Cover image URL") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("event-cover"))
        if (draft.coverImage.isNotBlank()) {
          OutlinedTextField(
            draft.coverImageAlt,
            { draft = draft.copy(coverImageAlt = it.take(Contracts.eventCoverAltMaxLength.toInt())) },
            label = { Text("Cover image description") },
            supportingText = { Text("Leave it empty when the picture only decorates the title.") },
            modifier = Modifier.fillMaxWidth().testTag("event-cover-alt"),
          )
        }
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Button(onClick = { onSave(draft) }, enabled = problem == null && !busy, modifier = Modifier.testTag("event-save")) { Text("Save event") }
        onDelete?.let { TextButton(onClick = it, enabled = !busy, modifier = Modifier.testTag("event-delete")) { Text("Delete", color = MaterialTheme.colorScheme.error) } }
      }
      if (problem != null && (draft.title.isNotEmpty() || draft.startsAtMs != null)) {
        Text(problem, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
      }
    }
  }
}

/**
 * The Events Calendar plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. The site's events,
 * added, edited, published and deleted natively, and the Events page opening
 * natively from a link.
 */
fun registerEventsCalendarNative(r: NativePluginRegistrar) {
  r.screen(EVENTS_SCREEN, title = "Events", requiresSite = true, icon = "event") { context, _ -> EventsScreen(context) }
  r.quickAction("events-calendar.open", title = "Events", icon = "event", order = 320, requiresSite = true, screen = EVENTS_SCREEN)
  r.deepLink("events-calendar.page", path = "/events", screen = EVENTS_SCREEN)
}
