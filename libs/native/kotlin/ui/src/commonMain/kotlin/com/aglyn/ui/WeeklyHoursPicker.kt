package com.aglyn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.ParsedWeeklyHours
import com.aglyn.contracts.WEEKLY_HOURS_DAYS
import com.aglyn.contracts.WeeklyHours
import com.aglyn.contracts.WeeklyHoursInterval
import com.aglyn.contracts.clockLabel
import com.aglyn.contracts.weeklyHoursFromText
import com.aglyn.contracts.weeklyHoursToText

private const val LAST_MINUTE = 23 * 60 + 59

/** Every quarter hour, plus 11:59 PM so a day can run to midnight. */
private val TIME_OPTIONS: List<Int> = List(96) { it * 15 } + LAST_MINUTE

private val DEFAULT_INTERVAL = WeeklyHoursInterval(9 * 60, 17 * 60)

/**
 * A week of opening hours chosen by clicking: a switch per day, and for an open day one or more From/To times
 * picked from a menu. Nothing is typed. [sameDay] makes every interval end on the day it starts: the To menu offers only
 * times after From; off by default, where a To before From runs past midnight. The console's WeeklyHoursPicker.
 */
@Composable
fun WeeklyHoursPicker(
  value: WeeklyHours,
  onChange: (WeeklyHours) -> Unit,
  modifier: Modifier = Modifier,
  label: String? = null,
  supporting: String? = null,
  enabled: Boolean = true,
  defaultInterval: WeeklyHoursInterval = DEFAULT_INTERVAL,
  intervalNoun: String = "hours",
  sameDay: Boolean = false,
) {
  fun setDay(index: Int, intervals: List<WeeklyHoursInterval>) = onChange(value.mapIndexed { at, day -> if (at == index) intervals else day })

  fun optionsFor(current: Int, after: Int? = null): List<InputChoice> {
    val options = if (current in TIME_OPTIONS) TIME_OPTIONS else (TIME_OPTIONS + current).sorted()
    return options.filter { after == null || it > after || it == current }.map { InputChoice("$it", clockLabel(it)) }
  }

  fun changed(interval: WeeklyHoursInterval, edge: String, minutes: Int): WeeklyHoursInterval {
    var next = if (edge == "start") interval.copy(start = minutes) else interval.copy(end = minutes)
    // A From moved past its To drags the To along, keeping the length.
    if (sameDay && next.end <= next.start) next = next.copy(end = minOf(next.start + maxOf(interval.end - interval.start, 60), LAST_MINUTE))
    return next
  }

  Column(modifier.fillMaxWidth().testTag("weekly-hours"), verticalArrangement = Arrangement.spacedBy(space(0.75f))) {
    if (label != null) Text(label, style = MaterialTheme.typography.titleSmall)
    for ((index, name) in WEEKLY_HOURS_DAYS.map { it.index to it.name }) {
      val intervals = value.getOrNull(index).orEmpty()
      val open = intervals.isNotEmpty()
      Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        SwitchRow(
          name,
          open,
          { on -> setDay(index, if (on) listOf(defaultInterval) else emptyList()) },
          Modifier.testTag("hours-day-$index"),
          supporting = if (open) null else "Closed",
          enabled = enabled,
        )
        if (open) {
          intervals.forEachIndexed { position, interval ->
            Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
              for (edge in listOf("start", "end")) {
                ChoiceField(
                  if (edge == "start") "From" else "To",
                  "${if (edge == "start") interval.start else interval.end}",
                  optionsFor(if (edge == "start") interval.start else interval.end, if (sameDay && edge == "end") interval.start else null),
                  { picked -> setDay(index, intervals.mapIndexed { i, item -> if (i == position) changed(item, edge, picked.toInt()) else item }) },
                  Modifier.weight(1f).testTag("hours-$index-$position-$edge"),
                  enabled = enabled,
                  allowEmpty = false,
                )
              }
              WithTooltip("Remove $name $intervalNoun${if (intervals.size > 1) " ${position + 1}" else ""}") { IconButton(onClick = { setDay(index, intervals.filterIndexed { i, _ -> i != position }) }, enabled = enabled) {
                Icon(AglynIcons.named("close"), contentDescription = "Remove $name $intervalNoun${if (intervals.size > 1) " ${position + 1}" else ""}")
              } }
            }
          }
          TextButton(
            onClick = {
              // A second interval starts an hour after the first ends, the usual shape of a lunch break.
              val start = minOf(intervals.last().end + 60, 22 * 60)
              setDay(index, intervals + WeeklyHoursInterval(start, minOf(start + 4 * 60, LAST_MINUTE)))
            },
            enabled = enabled,
            modifier = Modifier.testTag("hours-add-$index"),
          ) { Text("Add $intervalNoun") }
        }
      }
    }
    if (supporting != null) Text(supporting, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

/**
 * [WeeklyHoursPicker] over the stored hours text: reads the lines into a week and writes the week back as lines, so what
 * is saved is unchanged. Saved lines the picker cannot read are named under it.
 */
@Composable
fun OpeningHoursPicker(
  value: String,
  onChange: (String) -> Unit,
  modifier: Modifier = Modifier,
  label: String? = null,
  supporting: String? = null,
  enabled: Boolean = true,
  defaultInterval: WeeklyHoursInterval = DEFAULT_INTERVAL,
  intervalNoun: String = "hours",
  sameDay: Boolean = false,
) {
  val parsed: ParsedWeeklyHours = remember(value) { weeklyHoursFromText(value) }
  WeeklyHoursPicker(
    parsed.hours,
    { onChange(weeklyHoursToText(it)) },
    modifier,
    label,
    if (parsed.unreadLines.isNotEmpty()) {
      "Some saved hours could not be read (line ${parsed.unreadLines.joinToString(", ")}) and are not shown. Set the days again here and save to replace them."
    } else {
      supporting
    },
    enabled,
    defaultInterval,
    intervalNoun,
    sameDay,
  )
}
