package com.aglyn.plugins.bookings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.BookingInPersonState
import com.aglyn.contracts.BookingState
import com.aglyn.contracts.bookingStateLabel
import com.aglyn.contracts.formatLocalDay
import com.aglyn.contracts.formatReceiptMoney
import com.aglyn.contracts.localParts
import com.aglyn.contracts.rescheduleRefusal
import com.aglyn.contracts.shiftLocalDays
import com.aglyn.contracts.shiftLocalMonths
import com.aglyn.contracts.startOfLocalDay
import com.aglyn.contracts.startOfLocalWeek
import com.aglyn.core.Live
import com.aglyn.hardware.CardCollectorState
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.CalendarEvent
import com.aglyn.ui.CalendarHeader
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.MetricCard
import com.aglyn.ui.MonthGrid
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TimeGrid
import com.aglyn.ui.TimeSlotPicker
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.formatClock
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/*
 * The Bookings page, natively: the site's bookings on a calendar (day, week
 * and month) or as the upcoming list the console shows, one booker's
 * bookings from a CRM link (`?email=`), and a booking's detail with check-in,
 * reschedule, cancel (refunding what was paid) and payment at the counter.
 */

@OptIn(ExperimentalTime::class)
internal fun currentMs() = Clock.System.now().toEpochMilliseconds()

internal fun usd(cents: Long) = formatReceiptMoney(cents.toDouble(), "usd")

enum class CalendarMode(val key: String, val label: String) {
  LIST("list", "Upcoming"),
  DAY("day", "Day"),
  WEEK("week", "Week"),
  MONTH("month", "Month"),
}

/** The range a mode shows around [anchorMs]: the day, its Sunday-first week, or its month. */
fun calendarRange(mode: CalendarMode, anchorMs: Long, timeZone: String? = null): LongRange = when (mode) {
  CalendarMode.DAY -> startOfLocalDay(anchorMs, timeZone).let { it until shiftLocalDays(it, 1, timeZone) }
  CalendarMode.WEEK -> startOfLocalWeek(anchorMs, timeZone).let { it until shiftLocalDays(it, 7, timeZone) }
  CalendarMode.MONTH -> shiftLocalMonths(anchorMs, 0, timeZone).let { it until shiftLocalMonths(it, 1, timeZone) }
  CalendarMode.LIST -> startOfLocalDay(anchorMs, timeZone).let { it until Long.MAX_VALUE }
}

/** The anchor a step of previous or next lands on. */
fun stepAnchor(mode: CalendarMode, anchorMs: Long, step: Int, timeZone: String? = null): Long = when (mode) {
  CalendarMode.DAY, CalendarMode.LIST -> shiftLocalDays(anchorMs, step, timeZone)
  CalendarMode.WEEK -> shiftLocalDays(anchorMs, step * 7, timeZone)
  CalendarMode.MONTH -> shiftLocalMonths(anchorMs, step, timeZone)
}

/** A booking's chip: its state, checked in, or paid. */
fun bookingChip(row: BookingRow, nowMs: Long): Pair<String, StatusTone> {
  val state = row.state(nowMs)
  return when {
    state == BookingState.CANCELED -> bookingStateLabel(state) to StatusTone.NEUTRAL
    state == BookingState.EXPIRED -> bookingStateLabel(state) to StatusTone.ERROR
    state == BookingState.PENDING_PAYMENT -> bookingStateLabel(state) to StatusTone.WARNING
    row.checkedInAtMs != null -> "Checked in" to StatusTone.SUCCESS
    else -> bookingStateLabel(state) to StatusTone.INFO
  }
}

fun calendarEventOf(row: BookingRow, nowMs: Long): CalendarEvent {
  val (_, tone) = bookingChip(row, nowMs)
  val state = row.state(nowMs)
  return CalendarEvent(
    id = row.id,
    title = row.name,
    subtitle = row.serviceName,
    startMs = row.startsAtMs,
    endMs = maxOf(row.endsAtMs, row.startsAtMs + 15 * 60_000),
    tone = tone,
    canceled = state == BookingState.CANCELED || state == BookingState.EXPIRED,
  )
}

@Composable
private fun liveBookings(context: NativePluginContext, query: com.aglyn.core.FirestoreQuery?): Live<List<BookingRow>> {
  if (query == null) return Live.Loading
  val flow = remember(query, context.firestore) { context.firestore.observe(query) }
  val live by flow.collectAsState(Live.Loading)
  return when (val value = live) {
    is Live.Ready -> Live.Ready(value.value.map(::bookingRowOf))
    is Live.Failed -> value
    Live.Loading -> Live.Loading
  }
}

@Composable
internal fun liveServices(context: NativePluginContext): Live<List<ServiceRow>> {
  val hostId = context.hostId ?: return Live.Loading
  val flow = remember(hostId, context.firestore) { context.firestore.observe(servicesQuery(hostId)) }
  val live by flow.collectAsState(Live.Loading)
  return when (val value = live) {
    is Live.Ready -> Live.Ready(visibleServices(value.value))
    is Live.Failed -> value
    Live.Loading -> Live.Loading
  }
}

/** The site's bookings: calendar or upcoming list, with the picked booking beside it on wide windows. */
@Composable
fun BookingsCalendarScreen(context: NativePluginContext, params: NativeParams) {
  val hostId = context.hostId ?: return
  val width = currentWidthClass()
  val wide = width >= WidthClass.EXPANDED
  var mode by remember { mutableStateOf(if (width == WidthClass.COMPACT) CalendarMode.LIST else CalendarMode.WEEK) }
  var anchor by remember { mutableStateOf(currentMs()) }
  var serviceFilter by remember(params["service"]) { mutableStateOf(params["service"]) }
  var booker by remember(params["email"]) { mutableStateOf(params["email"]?.takeIf { it.isNotBlank() }) }
  var selected by remember(params["booking"]) { mutableStateOf(params["booking"]) }
  var shown by remember(mode, booker) { mutableStateOf(50) }
  val now = remember(anchor, mode) { currentMs() }
  val services = liveServices(context)

  val range = calendarRange(mode, anchor)
  val query = when {
    booker != null -> bookerBookingsQuery(hostId, booker!!, shown)
    mode == CalendarMode.LIST -> upcomingBookingsQuery(hostId, startOfLocalDay(now), shown)
    mode == CalendarMode.MONTH -> bookingsRangeQuery(hostId, startOfLocalWeek(range.first), shiftLocalDays(startOfLocalWeek(range.first), 42), serviceFilter)
    else -> bookingsRangeQuery(hostId, range.first, range.last + 1, serviceFilter)
  }
  val live = liveBookings(context, query)
  val rows = (live as? Live.Ready)?.value?.let { list -> if (serviceFilter != null && (booker != null || mode == CalendarMode.LIST)) list.filter { it.serviceId == serviceFilter } else list }

  fun open(id: String) {
    if (wide) selected = id else context.navigate(BOOKING_SCREEN, mapOf("booking" to id))
  }

  Row(Modifier.fillMaxSize().testTag("bookings-calendar")) {
    Column(Modifier.weight(if (wide) 0.62f else 1f).fillMaxHeight()) {
      BookingsToolbar(
        mode = mode,
        onMode = { mode = it },
        services = (services as? Live.Ready)?.value.orEmpty(),
        serviceFilter = serviceFilter,
        onService = { serviceFilter = it },
        onServices = { context.navigate(SERVICES_SCREEN) },
        showModes = booker == null,
      )
      if (booker != null) {
        NoticeBanner(
          "Bookings for $booker",
          StatusTone.INFO,
          Modifier.padding(horizontal = space(2f)),
          action = { TextButton(onClick = { booker = null }, modifier = Modifier.testTag("clear-booker")) { Text("Show all") } },
        )
      } else if (mode != CalendarMode.LIST) {
        CalendarHeader(
          title = when (mode) {
            CalendarMode.DAY -> formatLocalDay(range.first, "EEEE, MMMM d")
            CalendarMode.WEEK -> formatLocalDay(range.first, "MMM d") + " – " + formatLocalDay(range.last, "MMM d, yyyy")
            else -> formatLocalDay(range.first, "MMMM yyyy")
          },
          onPrevious = { anchor = stepAnchor(mode, anchor, -1) },
          onToday = { anchor = currentMs() },
          onNext = { anchor = stepAnchor(mode, anchor, 1) },
          modifier = Modifier.padding(horizontal = space(1f)),
        )
      }
      when {
        rows == null && live is Live.Failed -> EmptyState(
          "Could not load bookings",
          body = "Check the connection and try again.",
          icon = AglynIcons.named("error"),
          modifier = Modifier.testTag("bookings-error"),
        )
        rows == null -> SkeletonList(rows = 6)
        booker != null || mode == CalendarMode.LIST -> AgendaList(
          rows = rows.take(shown),
          nowMs = now,
          selected = selected,
          onOpen = ::open,
          hasMore = rows.size > shown,
          onMore = { shown += 50 },
          header = if (booker == null) ({ ReminderLine(rows, now) }) else null,
          empty = if (booker != null) "No bookings for $booker" else "No upcoming bookings",
        )
        mode == CalendarMode.MONTH -> MonthView(rows, anchor, now, selected, onPickDay = { anchor = it }, onOpen = ::open)
        else -> TimeGrid(
          dayStarts = if (mode == CalendarMode.DAY) listOf(range.first) else (0..6).map { shiftLocalDays(range.first, it) },
          events = rows.map { calendarEventOf(it, now) },
          nowMs = now,
          onEvent = { open(it.id) },
          selectedId = selected,
          modifier = Modifier.weight(1f),
        )
      }
    }
    if (wide) {
      VerticalDivider()
      Box(Modifier.weight(0.38f).fillMaxHeight()) {
        val id = selected
        if (id == null) {
          EmptyState("Pick a booking to see it here", icon = AglynIcons.named("event"))
        } else {
          BookingDetail(context, id, onBooker = { email -> booker = email; selected = null })
        }
      }
    }
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BookingsToolbar(
  mode: CalendarMode,
  onMode: (CalendarMode) -> Unit,
  services: List<ServiceRow>,
  serviceFilter: String?,
  onService: (String?) -> Unit,
  onServices: () -> Unit,
  showModes: Boolean,
) {
  Column(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      if (showModes) {
        ChoiceChipRow(
          options = CalendarMode.entries.map { ChipOption(it.key, it.label) },
          selected = mode.key,
          onSelect = { key -> onMode(CalendarMode.entries.first { it.key == key }) },
          modifier = Modifier.weight(1f).testTag("calendar-mode"),
        )
      } else {
        Box(Modifier.weight(1f))
      }
      TextButton(onClick = onServices, modifier = Modifier.testTag("open-services")) {
        Icon(AglynIcons.named("design_services"), contentDescription = null)
        Text("Services", Modifier.padding(start = space(0.5f)))
      }
    }
    if (services.size > 1) {
      ChoiceChipRow(
        options = listOf(ChipOption("", "All services")) + services.map { ChipOption(it.id, it.name) },
        selected = serviceFilter ?: "",
        onSelect = { onService(it.ifEmpty { null }) },
        modifier = Modifier.testTag("service-filter"),
      )
    }
  }
}

/** The console's reminder line: what the next pass mails, and what was mailed. */
@Composable
private fun ReminderLine(rows: List<BookingRow>, nowMs: Long) {
  val (due, sent) = reminderCounts(rows, nowMs)
  Text(
    "24-hour reminders · $due due in the next pass · $sent already sent",
    Modifier.padding(horizontal = space(2f), vertical = space(1f)).testTag("reminder-line"),
    style = MaterialTheme.typography.bodySmall,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
  )
}

@Composable
private fun AgendaList(
  rows: List<BookingRow>,
  nowMs: Long,
  selected: String?,
  onOpen: (String) -> Unit,
  hasMore: Boolean,
  onMore: () -> Unit,
  header: (@Composable () -> Unit)?,
  empty: String,
) {
  LazyColumn(Modifier.fillMaxSize().testTag("bookings-list")) {
    header?.let { item { it() } }
    if (rows.isEmpty()) item { EmptyState(empty, body = "Bookings made on your site show up here.", icon = AglynIcons.named("event")) }
    var lastDay: String? = null
    for (row in rows) {
      val day = localParts(row.startsAtMs).dayKey
      if (day != lastDay) {
        lastDay = day
        item(key = "day-$day") {
          Text(
            formatLocalDay(row.startsAtMs, "EEEE, MMMM d"),
            Modifier.padding(start = space(2f), end = space(2f), top = space(2f), bottom = space(0.5f)).semantics { heading() },
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
          )
        }
      }
      item(key = row.id) { BookingListRow(row, nowMs, selected == row.id) { onOpen(row.id) } }
    }
    if (hasMore) {
      item {
        Box(Modifier.fillMaxWidth().padding(space(2f)), contentAlignment = Alignment.Center) {
          OutlinedButton(onClick = onMore, modifier = Modifier.testTag("bookings-more")) { Text("Show more") }
        }
      }
    }
  }
}

@Composable
private fun BookingListRow(row: BookingRow, nowMs: Long, selected: Boolean, onClick: () -> Unit) {
  val (label, tone) = bookingChip(row, nowMs)
  val canceled = row.state(nowMs) == BookingState.CANCELED
  AglynListItem(
    title = "${row.serviceName} — ${row.name}",
    supporting = "${formatClock(row.startsAtMs)} – ${formatClock(row.endsAtMs)}" + (row.email?.let { " · $it" } ?: ""),
    icon = AglynIcons.named(if (canceled) "event_busy" else "event"),
    selected = selected,
    trailing = {
      Row(horizontalArrangement = Arrangement.spacedBy(space(0.5f)), verticalAlignment = Alignment.CenterVertically) {
        if (row.paidAmountCents > 0) Text(usd(row.paidAmountCents), style = MaterialTheme.typography.bodySmall)
        StatusChip(label, tone)
      }
    },
    onClick = onClick,
    modifier = Modifier.testTag("booking-${row.id}"),
  )
}

@Composable
private fun MonthView(rows: List<BookingRow>, anchorMs: Long, nowMs: Long, selected: String?, onPickDay: (Long) -> Unit, onOpen: (String) -> Unit) {
  val byDay = rows.groupBy { localParts(it.startsAtMs).dayKey }
  val dayKey = localParts(anchorMs).dayKey
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
    MonthGrid(
      monthStartMs = shiftLocalMonths(anchorMs, 0),
      selectedDayMs = anchorMs,
      nowMs = nowMs,
      eventsByDay = byDay.mapValues { (_, list) -> list.map { bookingChip(it, nowMs).second } },
      onSelectDay = onPickDay,
      modifier = Modifier.padding(horizontal = space(1f)),
    )
    HorizontalDivider(Modifier.padding(vertical = space(1f)))
    Text(
      formatLocalDay(anchorMs, "EEEE, MMMM d"),
      Modifier.padding(horizontal = space(2f)).semantics { heading() },
      style = MaterialTheme.typography.titleSmall,
    )
    val day = byDay[dayKey].orEmpty()
    if (day.isEmpty()) {
      Text("Nothing booked.", Modifier.padding(space(2f)), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    day.forEach { row -> BookingListRow(row, nowMs, row.id == selected) { onOpen(row.id) } }
  }
}

/** One booking: who, when, what was paid, and what may be done to it now. */
@Composable
fun BookingScreen(context: NativePluginContext, params: NativeParams) {
  val id = params["booking"] ?: return EmptyState("This booking is not available", icon = AglynIcons.named("event_busy"))
  BookingDetail(context, id, onBooker = { email -> context.navigate(BOOKINGS_CALENDAR_SCREEN, mapOf("email" to email)) })
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalUuidApi::class)
@Composable
fun BookingDetail(context: NativePluginContext, bookingId: String, onBooker: (String) -> Unit) {
  val hostId = context.hostId ?: return
  val flow = remember(hostId, bookingId, context.firestore) { context.firestore.observeDoc("${bookingsPath(hostId)}/$bookingId") }
  val live by flow.collectAsState(Live.Loading)
  val api = remember(hostId, context.api, context.writer) { BookingsApi(context.api, context.writer, hostId) }
  val scope = rememberCoroutineScope()
  var busy by remember(bookingId) { mutableStateOf(false) }
  var notice by remember(bookingId) { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var confirmCancel by remember(bookingId) { mutableStateOf(false) }
  var rescheduling by remember(bookingId) { mutableStateOf(false) }
  var paying by remember(bookingId) { mutableStateOf(false) }
  val uri = LocalUriHandler.current

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
        notice = (error.message ?: "That did not work. Try again.") to StatusTone.ERROR
      } finally {
        busy = false
      }
    }
  }

  val doc = when (val value = live) {
    Live.Loading -> return SkeletonList(rows = 5)
    is Live.Failed -> return EmptyState("Could not load this booking", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
    is Live.Ready -> value.value ?: return EmptyState("This booking is gone", icon = AglynIcons.named("event_busy"))
  }
  val row = bookingRowOf(doc)
  val now = currentMs()
  val actions = row.actions(now)
  val (label, tone) = bookingChip(row, now)
  val payment = row.payment(now)
  val collector = context.peripherals.cardCollector
  val readerState by (collector?.state ?: remember { kotlinx.coroutines.flow.MutableStateFlow<CardCollectorState?>(null) }).collectAsState()

  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 720.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("booking-detail"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      notice?.let { (message, noticeTone) -> NoticeBanner(message, noticeTone, action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } }) }
      SectionCard(null, Modifier.fillMaxWidth()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          StatusChip(label, tone)
          if (row.paidInPerson) StatusChip("Paid in person", StatusTone.SUCCESS)
          if (row.raw["paymentRisk"] != null) StatusChip("Payment flagged", StatusTone.WARNING)
        }
        Text(
          row.name,
          style = MaterialTheme.typography.titleLarge,
          modifier = Modifier.semantics { heading() },
          textDecoration = if (row.state(now) == BookingState.CANCELED) TextDecoration.LineThrough else null,
        )
        Text(row.serviceName, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        HorizontalDivider()
        Text(formatLocalDay(row.startsAtMs, "EEEE, MMMM d, yyyy"), style = MaterialTheme.typography.titleSmall)
        Text("${formatClock(row.startsAtMs)} – ${formatClock(row.endsAtMs)}", style = MaterialTheme.typography.bodyLarge)
        row.timeZone?.let { zone ->
          if (zone != com.aglyn.contracts.deviceTimeZone()) {
            Text(
              "${formatClock(row.startsAtMs, zone)} in $zone, where it was booked",
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
        row.rescheduledFromMs?.let {
          Text("Moved from ${formatLocalDay(it, "MMM d")} at ${formatClock(it)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        row.checkedInAtMs?.let {
          Text("Checked in at ${formatClock(it)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }

      SectionCard("Guest", Modifier.fillMaxWidth().testTag("booking-guest")) {
        row.email?.let { email ->
          AglynListItem(title = email, icon = AglynIcons.named("mail"), onClick = { runCatching { uri.openUri("mailto:$email") } })
        }
        row.phone?.let { phone ->
          AglynListItem(title = phone, icon = AglynIcons.named("phone"), onClick = { runCatching { uri.openUri("tel:$phone") } })
        }
        row.address?.let { AglynListItem(title = it, icon = AglynIcons.named("location_on")) }
        row.email?.let { email ->
          TextButton(onClick = { onBooker(email) }, modifier = Modifier.testTag("booker-bookings")) { Text("Every booking by this guest") }
        }
      }

      SectionCard("Payment", Modifier.fillMaxWidth().testTag("booking-payment")) {
        when {
          row.paidAmountCents > 0 -> {
            Text("Paid ${usd(row.paidAmountCents)}", style = MaterialTheme.typography.bodyLarge)
            if (row.refundedCents > 0) Text("Refunded ${usd(row.refundedCents)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          payment == BookingInPersonState.AWAITING_ONLINE -> Text("The guest is paying online.", style = MaterialTheme.typography.bodyMedium)
          payment == BookingInPersonState.COLLECTING -> Text("A card is being taken for it now.", style = MaterialTheme.typography.bodyMedium)
          else -> Text("Nothing paid.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (payment == BookingInPersonState.PAYABLE) {
          if (collector != null) {
            Button(onClick = { paying = true }, enabled = readerState is CardCollectorState.Connected && !busy, modifier = Modifier.testTag("booking-take-payment")) { Text("Take payment") }
          } else {
            Text("Take its payment at the counter in Aglyn POS.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }

      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        if (actions.checkIn) {
          Button(onClick = { run("${row.name} is checked in.") { api.checkIn(row.id, true) } }, enabled = !busy, modifier = Modifier.testTag("booking-check-in")) {
            Icon(AglynIcons.named("person_check"), contentDescription = null)
            Text("Check in", Modifier.padding(start = space(0.5f)))
          }
        }
        if (actions.undoCheckIn) {
          OutlinedButton(onClick = { run("Check-in undone.") { api.checkIn(row.id, false) } }, enabled = !busy, modifier = Modifier.testTag("booking-undo-check-in")) { Text("Undo check-in") }
        }
        if (actions.reschedule) {
          OutlinedButton(onClick = { rescheduling = true }, enabled = !busy, modifier = Modifier.testTag("booking-reschedule")) { Text("Reschedule") }
        }
        if (actions.cancel) {
          OutlinedButton(onClick = { confirmCancel = true }, enabled = !busy, modifier = Modifier.testTag("booking-cancel")) {
            Text(if (actions.refundCents > 0) "Cancel and refund" else "Cancel booking")
          }
        }
      }
    }
  }

  if (confirmCancel) {
    val key = remember(bookingId) { Uuid.random().toString() }
    ActionDialog(
      title = "Cancel this booking?",
      body = if (actions.refundCents > 0) "${usd(actions.refundCents)} goes back to ${row.name}, and the time opens up again." else "${row.name}'s time opens up again.",
      confirmLabel = if (actions.refundCents > 0) "Refund and cancel" else "Cancel booking",
      destructive = true,
      busy = busy,
      icon = "event_busy",
      dismissLabel = "Keep it",
      onDismiss = { confirmCancel = false },
      onConfirm = {
        confirmCancel = false
        run(if (actions.refundCents > 0) "Refunded and canceled." else "Canceled.") { api.cancel(row, currentMs(), key) }
      },
    )
  }
  if (rescheduling) {
    RescheduleDialog(api, row, onDismiss = { rescheduling = false }) { startsAtMs ->
      rescheduling = false
      run("Moved to ${formatLocalDay(startsAtMs, "EEE, MMM d")} at ${formatClock(startsAtMs)}. ${row.name} was emailed.") { api.reschedule(row.id, startsAtMs) }
    }
  }
  if (paying && collector != null) {
    val suggested = (doc.data["serviceId"] as? String)?.let { serviceId ->
      val service by remember(serviceId) { context.firestore.observeDoc("${servicesPath(hostId)}/$serviceId") }.collectAsState(Live.Loading)
      bookingSuggestedCents((service as? Live.Ready)?.value?.data)
    }
    PayDialog(
      booking = CounterBooking(row.id, row.serviceId, row.serviceName, row.name, row.startsAtMs, row.endsAtMs, payment, row.paidAmountCents, suggested),
      onDismiss = { paying = false },
      pay = { cents, onPriced -> takeBookingPayment(context.api, collector, hostId, row.id, cents, "booking-${Uuid.random()}", onPriced) },
      onDone = { outcome ->
        paying = false
        notice = when (outcome) {
          is InPersonOutcome.Paid -> "${row.name} paid ${usd(outcome.amountCents)}." to StatusTone.SUCCESS
          InPersonOutcome.Canceled -> "The payment was canceled. Nobody was charged." to StatusTone.WARNING
          is InPersonOutcome.Failed -> outcome.message to StatusTone.ERROR
        }
      },
    )
  }
}

/** Open times for the booking's service, a page of whole days at a time, from the slots route. */
@Composable
private fun RescheduleDialog(api: BookingsApi, row: BookingRow, onDismiss: () -> Unit, onPick: (Long) -> Unit) {
  var slots by remember { mutableStateOf<List<Long>?>(null) }
  var next by remember { mutableStateOf<Long?>(null) }
  var zone by remember { mutableStateOf<String?>(null) }
  var error by remember { mutableStateOf<String?>(null) }
  var picked by remember { mutableStateOf<Long?>(null) }
  var loading by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  fun load(from: Long?) {
    loading = true
    scope.launch {
      try {
        val page = api.slots(row.serviceId, from)
        // The booking's own time is not a move.
        slots = slots.orEmpty() + page.slots.filter { it != row.startsAtMs }
        next = page.nextFromMs
        zone = page.timeZone
        error = null
      } catch (failure: CancellationException) {
        throw failure
      } catch (failure: Throwable) {
        error = failure.message ?: "Open times could not be loaded."
        if (slots == null) slots = emptyList()
      } finally {
        loading = false
      }
    }
  }
  androidx.compose.runtime.LaunchedEffect(row.id) { load(null) }
  val refusal = picked?.let { rescheduleRefusal(row.managed, it, currentMs()) }
  ActionDialog(
    title = "Move ${row.name}'s booking",
    body = "Pick an open time for ${row.serviceName}. The guest is emailed the new time.",
    confirmLabel = "Move it",
    onConfirm = { picked?.let(onPick) },
    onDismiss = onDismiss,
    icon = "schedule",
    busy = false,
    confirmEnabled = picked != null && refusal == null,
    error = error ?: refusal,
  ) {
    Column(Modifier.widthIn(max = 520.dp).verticalScroll(rememberScrollState()).testTag("reschedule-slots")) {
      when {
        slots == null -> SkeletonList(rows = 3)
        slots!!.isEmpty() && next == null -> Text("No open times left in the booking window.", style = MaterialTheme.typography.bodyMedium)
        else -> TimeSlotPicker(slots!!, picked, { picked = it })
      }
      if (next != null) {
        TextButton(onClick = { load(next) }, enabled = !loading, modifier = Modifier.testTag("slots-more")) { Text(if (loading) "Loading…" else "Later times") }
      }
      zone?.let {
        if (it != com.aglyn.contracts.deviceTimeZone()) {
          Text("Times are shown on this device's clock; the service runs on $it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
  }
}

/** Home's bookings card: today's count and who is next. */
@Composable
fun BookingsTodayWidget(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val now = remember { currentMs() }
  val start = startOfLocalDay(now)
  val live = liveBookings(context, remember(hostId, start) { bookingsRangeQuery(hostId, start, shiftLocalDays(start, 1)) })
  val rows = (live as? Live.Ready)?.value?.filter { it.state(now) != BookingState.CANCELED && it.state(now) != BookingState.EXPIRED }
  val next = rows?.firstOrNull { it.endsAtMs > now }
  MetricCard(
    title = "Today's bookings",
    value = rows?.size?.toString(),
    caption = next?.let { "Next: ${formatClock(it.startsAtMs)} · ${it.name}" } ?: rows?.let { if (it.isEmpty()) "Nothing booked today" else "All done for today" },
    icon = "event",
    actionLabel = "Open bookings",
    modifier = Modifier.fillMaxSize().testTag("bookings-today"),
    loading = live is Live.Loading,
    error = if (live is Live.Failed) "Could not load bookings." else null,
    onClick = { context.navigate(BOOKINGS_CALENDAR_SCREEN) },
  )
}

