package com.aglyn.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimeInput
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.formatLocalDay
import com.aglyn.contracts.localParts
import com.aglyn.contracts.shiftLocalDays

/*
 * Calendars for the apps' scheduling screens: a month grid, a day or week
 * time grid, a picker of open times, and a weekly hours editor. All read
 * instants (epoch ms) on a zone's wall clock; a null zone is the device's.
 */

/** One appointment on a calendar. */
data class CalendarEvent(
  val id: String,
  val title: String,
  val startMs: Long,
  val endMs: Long,
  val subtitle: String? = null,
  val tone: StatusTone = StatusTone.INFO,
  /** Drawn struck through and faded: it no longer holds its time. */
  val canceled: Boolean = false,
)

@Composable
private fun toneColors(tone: StatusTone): Pair<androidx.compose.ui.graphics.Color, androidx.compose.ui.graphics.Color> {
  val palette = LocalAglynPalette.current
  return when (tone) {
    StatusTone.SUCCESS -> palette.success.main.copy(alpha = 0.18f) to palette.success.text
    StatusTone.WARNING -> palette.warning.main.copy(alpha = 0.22f) to palette.warning.text
    StatusTone.ERROR -> palette.error.main.copy(alpha = 0.16f) to palette.error.text
    StatusTone.INFO -> palette.primary.main.copy(alpha = 0.16f) to palette.primary.text
    StatusTone.NEUTRAL -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
  }
}

/** "9 AM", "9:30 AM" on the device's clock style. */
fun formatClock(atMs: Long, timeZone: String? = null): String = formatLocalDay(atMs, "h:mm a", timeZone)

/** Minutes since midnight as "9:00 AM". */
fun formatMinutes(minutes: Int): String {
  val hour = minutes / 60
  val minute = minutes % 60
  val twelve = if (hour % 12 == 0) 12 else hour % 12
  return "$twelve:${minute.toString().padStart(2, '0')} ${if (hour < 12 || hour == 24) "AM" else "PM"}"
}

/**
 * A month: weekday header, then a week per row with each day's events as
 * dots in their tones. The picked day is ringed, today filled.
 */
@Composable
fun MonthGrid(
  monthStartMs: Long,
  selectedDayMs: Long?,
  nowMs: Long,
  eventsByDay: Map<String, List<StatusTone>>,
  onSelectDay: (Long) -> Unit,
  modifier: Modifier = Modifier,
  timeZone: String? = null,
) {
  val month = localParts(monthStartMs, timeZone)
  val first = shiftLocalDays(monthStartMs, -month.weekday, timeZone)
  val today = localParts(nowMs, timeZone).dayKey
  val picked = selectedDayMs?.let { localParts(it, timeZone).dayKey }
  Column(modifier.testTag("month-grid")) {
    Row(Modifier.fillMaxWidth()) {
      for (offset in 0..6) {
        Text(
          formatLocalDay(shiftLocalDays(first, offset, timeZone), "EEEEE", timeZone),
          Modifier.weight(1f).padding(vertical = space(0.5f)),
          style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
      }
    }
    for (week in 0..5) {
      val weekStart = shiftLocalDays(first, week * 7, timeZone)
      if (week > 0 && localParts(weekStart, timeZone).month != month.month) break
      Row(Modifier.fillMaxWidth()) {
        for (offset in 0..6) {
          val day = shiftLocalDays(weekStart, offset, timeZone)
          val parts = localParts(day, timeZone)
          val inMonth = parts.month == month.month
          val tones = eventsByDay[parts.dayKey].orEmpty()
          val isToday = parts.dayKey == today
          val isPicked = parts.dayKey == picked
          Column(
            Modifier
              .weight(1f)
              .aspectRatio(1f, matchHeightConstraintsFirst = false)
              .padding(2.dp)
              .clip(MaterialTheme.shapes.small)
              .then(if (isPicked) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, MaterialTheme.shapes.small) else Modifier)
              .clickable(role = Role.Button) { onSelectDay(day) }
              .semantics {
                contentDescription = formatLocalDay(day, "EEEE, MMMM d", timeZone) +
                  if (tones.isEmpty()) ", nothing booked" else ", ${tones.size} booked"
                selected = isPicked
              }
              .testTag("day-${parts.dayKey}"),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
          ) {
            Box(
              Modifier.size(28.dp).clip(CircleShape).then(if (isToday) Modifier.background(MaterialTheme.colorScheme.primary) else Modifier),
              contentAlignment = Alignment.Center,
            ) {
              Text(
                parts.day.toString(),
                style = MaterialTheme.typography.bodyMedium,
                color = when {
                  isToday -> MaterialTheme.colorScheme.onPrimary
                  inMonth -> MaterialTheme.colorScheme.onSurface
                  else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                },
              )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.height(8.dp).padding(top = 2.dp)) {
              tones.take(4).forEach { tone ->
                Box(Modifier.size(6.dp).clip(CircleShape).background(toneColors(tone).second))
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Days side by side on an hour grid, each event a block from its start to
 * its end, overlapping ones sharing the column. One day is a day view; seven
 * a week. Scrolls to the working day.
 */
@Composable
fun TimeGrid(
  dayStarts: List<Long>,
  events: List<CalendarEvent>,
  nowMs: Long,
  onEvent: (CalendarEvent) -> Unit,
  modifier: Modifier = Modifier,
  timeZone: String? = null,
  hourHeight: Dp = 56.dp,
  firstVisibleHour: Int = 7,
  selectedId: String? = null,
) {
  val scroll = rememberScrollState()
  val density = androidx.compose.ui.platform.LocalDensity.current
  LaunchedEffect(firstVisibleHour) { scroll.scrollTo(with(density) { (hourHeight * firstVisibleHour).roundToPx() }) }
  val gutter = 52.dp
  val today = localParts(nowMs, timeZone).dayKey
  Column(modifier.testTag("time-grid")) {
    Row(Modifier.fillMaxWidth().padding(start = gutter)) {
      for (day in dayStarts) {
        val isToday = localParts(day, timeZone).dayKey == today
        Column(Modifier.weight(1f).padding(vertical = space(0.5f)), horizontalAlignment = Alignment.CenterHorizontally) {
          Text(formatLocalDay(day, "EEE", timeZone), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          Box(
            Modifier.size(30.dp).clip(CircleShape).then(if (isToday) Modifier.background(MaterialTheme.colorScheme.primary) else Modifier),
            contentAlignment = Alignment.Center,
          ) {
            Text(
              formatLocalDay(day, "d", timeZone),
              style = MaterialTheme.typography.titleMedium,
              color = if (isToday) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
            )
          }
        }
      }
    }
    HorizontalDivider()
    Box(Modifier.fillMaxSize().verticalScroll(scroll)) {
      Column {
        for (hour in 0..23) {
          Row(Modifier.height(hourHeight).fillMaxWidth()) {
            Text(
              if (hour == 0) "" else formatMinutes(hour * 60).replace(":00", ""),
              Modifier.width(gutter).padding(end = space(1f)).offset(y = (-8).dp),
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              textAlign = androidx.compose.ui.text.style.TextAlign.End,
            )
            Column(Modifier.weight(1f)) { HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)) }
          }
        }
      }
      Row(Modifier.fillMaxWidth().height(hourHeight * 24).padding(start = gutter)) {
        for (day in dayStarts) {
          val dayEnd = shiftLocalDays(day, 1, timeZone)
          val dayEvents = events.filter { it.startMs < dayEnd && it.endMs > day }.sortedBy { it.startMs }
          // Lanes: each event takes the first lane free at its start.
          val laneEnds = mutableListOf<Long>()
          val laneOf = dayEvents.associate { event ->
            val lane = laneEnds.indexOfFirst { it <= event.startMs }.let { if (it < 0) { laneEnds += event.endMs; laneEnds.lastIndex } else { laneEnds[it] = event.endMs; it } }
            event.id to lane
          }
          val lanes = maxOf(1, laneEnds.size)
          BoxWithConstraints(Modifier.weight(1f).fillMaxSize().border(0.5.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))) {
            val laneWidth = maxWidth / lanes
            for (event in dayEvents) {
              val start = maxOf(event.startMs, day)
              val end = minOf(event.endMs, dayEnd)
              val top = hourHeight * ((start - day) / 3_600_000f)
              val height = maxOf(hourHeight * ((end - start) / 3_600_000f), 22.dp)
              val (background, foreground) = toneColors(event.tone)
              Surface(
                onClick = { onEvent(event) },
                modifier = Modifier
                  .offset(x = laneWidth * (laneOf[event.id] ?: 0), y = top)
                  .width(laneWidth)
                  .height(height)
                  .padding(1.dp)
                  .semantics { contentDescription = "${event.title}, ${formatClock(event.startMs, timeZone)} to ${formatClock(event.endMs, timeZone)}" }
                  .testTag("event-${event.id}"),
                shape = MaterialTheme.shapes.small,
                color = if (event.canceled) background.copy(alpha = 0.35f) else background,
                contentColor = foreground,
                border = if (event.id == selectedId) androidx.compose.foundation.BorderStroke(2.dp, foreground) else null,
              ) {
                Column(Modifier.padding(horizontal = 4.dp, vertical = 2.dp)) {
                  Text(
                    event.title,
                    style = MaterialTheme.typography.labelMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textDecoration = if (event.canceled) TextDecoration.LineThrough else null,
                  )
                  if (height > 36.dp) {
                    Text(
                      event.subtitle ?: formatClock(event.startMs, timeZone),
                      style = MaterialTheme.typography.labelSmall,
                      maxLines = 1,
                      overflow = TextOverflow.Ellipsis,
                    )
                  }
                }
              }
            }
            if (localParts(day, timeZone).dayKey == today) {
              val now = hourHeight * ((nowMs - day) / 3_600_000f)
              Box(Modifier.offset(y = now).fillMaxWidth().height(2.dp).background(MaterialTheme.colorScheme.error))
            }
          }
        }
      }
    }
  }
}

/** Open times grouped by day, each a chip; the picked one is selected. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TimeSlotPicker(
  slots: List<Long>,
  selected: Long?,
  onSelect: (Long) -> Unit,
  modifier: Modifier = Modifier,
  timeZone: String? = null,
) {
  val byDay = slots.groupBy { localParts(it, timeZone).dayKey }
  Column(modifier.testTag("slot-picker"), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    for ((_, daySlots) in byDay) {
      Text(
        formatLocalDay(daySlots.first(), "EEEE, MMMM d", timeZone),
        style = MaterialTheme.typography.titleSmall,
        modifier = Modifier.semantics { heading() },
      )
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        for (slot in daySlots) {
          FilterChip(
            selected = slot == selected,
            onClick = { onSelect(slot) },
            label = { Text(formatClock(slot, timeZone)) },
            modifier = Modifier.testTag("slot-$slot"),
          )
        }
      }
    }
  }
}

/** One open interval of a day, minutes since midnight. */
data class HoursWindow(val start: Int, val end: Int)

/**
 * A week of opening hours, Sunday first: each day lists its intervals as
 * chips (tap to change, × to remove) and adds one with +. Closed days read
 * Closed.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WeeklyHoursEditor(
  dayLabels: List<String>,
  days: List<List<HoursWindow>>,
  onChange: (List<List<HoursWindow>>) -> Unit,
  modifier: Modifier = Modifier,
) {
  var editing by remember { mutableStateOf<Pair<Int, Int?>?>(null) }
  Column(modifier.testTag("weekly-hours"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    dayLabels.forEachIndexed { index, label ->
      val windows = days.getOrElse(index) { emptyList() }
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.width(48.dp), style = MaterialTheme.typography.labelLarge)
        FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
          if (windows.isEmpty()) {
            Text("Closed", Modifier.padding(vertical = space(1f)), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          windows.forEachIndexed { at, window ->
            InputChip(
              selected = false,
              onClick = { editing = index to at },
              label = { Text("${formatMinutes(window.start)} – ${formatMinutes(window.end)}") },
              trailingIcon = {
                Icon(
                  AglynIcons.named("close"),
                  contentDescription = "Remove ${formatMinutes(window.start)} to ${formatMinutes(window.end)} on $label",
                  modifier = Modifier.size(18.dp).clickable { onChange(days.mapIndexed { d, list -> if (d == index) list.filterIndexed { i, _ -> i != at } else list }) },
                )
              },
              modifier = Modifier.testTag("hours-$index-$at"),
            )
          }
        }
        IconButton(onClick = { editing = index to null }, modifier = Modifier.testTag("hours-add-$index")) {
          Icon(AglynIcons.named("add"), contentDescription = "Add hours on $label")
        }
      }
    }
  }
  editing?.let { (day, at) ->
    val current = at?.let { days.getOrNull(day)?.getOrNull(it) } ?: days.getOrNull(day)?.lastOrNull()?.let { HoursWindow(it.end, minOf(it.end + 60, 24 * 60)) } ?: HoursWindow(9 * 60, 17 * 60)
    TimeRangeDialog(
      title = "${dayLabels[day]} hours",
      initial = current,
      onDismiss = { editing = null },
      onConfirm = { window ->
        val list = days.getOrElse(day) { emptyList() }
        val next = (if (at == null) list + window else list.mapIndexed { i, w -> if (i == at) window else w }).sortedBy { it.start }
        onChange(days.mapIndexed { d, l -> if (d == day) next else l }.let { if (it.size < 7) it + List(7 - it.size) { emptyList() } else it })
        editing = null
      },
    )
  }
}

/** A start and an end time, each typed on the clock; the end must follow the start. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimeRangeDialog(title: String, initial: HoursWindow, onDismiss: () -> Unit, onConfirm: (HoursWindow) -> Unit) {
  val start = rememberTimePickerState(initial.start / 60, initial.start % 60)
  val end = rememberTimePickerState(minOf(initial.end, 24 * 60 - 1) / 60, minOf(initial.end, 24 * 60 - 1) % 60)
  val startMinutes = start.hour * 60 + start.minute
  val endMinutes = (end.hour * 60 + end.minute).let { if (it == 0) 24 * 60 else it }
  val valid = endMinutes > startMinutes
  ActionDialog(
    title = title,
    confirmLabel = "Done",
    onConfirm = { onConfirm(HoursWindow(startMinutes, endMinutes)) },
    onDismiss = onDismiss,
    icon = "schedule",
    confirmEnabled = valid,
    error = if (valid) null else "The end comes after the start.",
    dismissLabel = "Cancel",
  ) {
    Column(Modifier.horizontalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Text("Opens", style = MaterialTheme.typography.labelLarge)
      TimeInput(start, Modifier.testTag("time-start"))
      Text("Closes", style = MaterialTheme.typography.labelLarge)
      TimeInput(end, Modifier.testTag("time-end"))
    }
  }
}

/** A row of previous / today / next with the period's name, for a calendar's header. */
@Composable
fun CalendarHeader(
  title: String,
  onPrevious: () -> Unit,
  onToday: () -> Unit,
  onNext: () -> Unit,
  modifier: Modifier = Modifier,
  trailing: (@Composable () -> Unit)? = null,
) {
  Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    IconButton(onClick = onPrevious, modifier = Modifier.testTag("calendar-previous")) { Icon(AglynIcons.named("chevron_left"), contentDescription = "Previous") }
    IconButton(onClick = onNext, modifier = Modifier.testTag("calendar-next")) { Icon(AglynIcons.named("chevron_right"), contentDescription = "Next") }
    Text(title, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    TextButton(onClick = onToday, modifier = Modifier.testTag("calendar-today")) { Text("Today") }
    trailing?.invoke()
    Spacer(Modifier.width(space(0.5f)))
  }
}

/**
 * A date and a time as one field: tap to pick the day, then the time. Reads
 * and writes epoch ms on [timeZone]'s wall clock (null is the device's).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateTimeField(
  label: String,
  valueMs: Long?,
  onChange: (Long?) -> Unit,
  modifier: Modifier = Modifier,
  timeZone: String? = null,
  clearable: Boolean = false,
) {
  var step by remember { mutableStateOf(0) }
  var pickedDay by remember { mutableStateOf<Long?>(null) }
  val text = valueMs?.let { formatLocalDay(it, "EEE, MMM d, yyyy", timeZone) + " · " + formatClock(it, timeZone) } ?: ""
  Row(modifier, verticalAlignment = Alignment.CenterVertically) {
    androidx.compose.material3.OutlinedTextField(
      value = text,
      onValueChange = {},
      readOnly = true,
      label = { Text(label) },
      placeholder = { Text("Pick a date") },
      trailingIcon = {
        IconButton(onClick = { step = 1 }) { Icon(AglynIcons.named("calendar_month"), contentDescription = "Pick $label") }
      },
      modifier = Modifier.weight(1f).clickable { step = 1 },
    )
    if (clearable && valueMs != null) {
      IconButton(onClick = { onChange(null) }) { Icon(AglynIcons.named("close"), contentDescription = "Clear $label") }
    }
  }
  if (step == 1) {
    // The picker speaks UTC midnights; the day is moved onto the zone's clock.
    val initialUtc = valueMs?.let { localParts(it, timeZone) }?.let { com.aglyn.contracts.localDayStart(it.year, it.month, it.day, "UTC") }
    val state = androidx.compose.material3.rememberDatePickerState(initialSelectedDateMillis = initialUtc)
    androidx.compose.material3.DatePickerDialog(
      onDismissRequest = { step = 0 },
      confirmButton = {
        TextButton(onClick = { pickedDay = state.selectedDateMillis; step = if (state.selectedDateMillis != null) 2 else 0 }, modifier = Modifier.testTag("date-next")) { Text("Next") }
      },
      dismissButton = { TextButton(onClick = { step = 0 }) { Text("Cancel") } },
    ) { androidx.compose.material3.DatePicker(state) }
  }
  if (step == 2) {
    val parts = valueMs?.let { localParts(it, timeZone) }
    val time = rememberTimePickerState(parts?.hour ?: 9, parts?.minute ?: 0)
    ActionDialog(
      title = label,
      confirmLabel = "Done",
      icon = "schedule",
      dismissLabel = "Cancel",
      onDismiss = { step = 0 },
      onConfirm = {
        val day = localParts(pickedDay ?: 0, "UTC")
        val start = com.aglyn.contracts.localDayStart(day.year, day.month, day.day, timeZone)
        onChange(start + (time.hour * 60 + time.minute) * 60_000L)
        step = 0
      },
    ) { TimeInput(time, Modifier.testTag("time-input")) }
  }
}
