package com.aglyn.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow

/*
 * The figures of a stats card (Figma "Homestats components (AGL-4011)": Stat/Tile, Top list/Row): the console's traffic
 * card's `StatTile` and `TopList`, shared by Home, Analytics and a page's detail on every screen size. The Apple kit's
 * `Stats.swift` draws the same parts.
 */

/** How a delta beside a figure reads: up is good, down is bad, flat is neither (the console's `+12% vs prior`). */
enum class DeltaTone { UP, DOWN, FLAT }

/**
 * One measurement: the figure, a delta under it when there is one, and the label that says what was measured. A note
 * says how it was counted (`today or overdue`). `value` null draws the loading placeholder; `valueColor` tints the
 * figure alone.
 */
@Composable
fun StatFigure(
  value: String?,
  label: String,
  modifier: Modifier = Modifier,
  delta: String? = null,
  deltaTone: DeltaTone = DeltaTone.FLAT,
  note: String? = null,
  valueColor: Color? = null,
) {
  val palette = LocalAglynPalette.current
  Column(modifier.semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(space(0.25f))) {
    if (value == null) {
      Skeleton(Modifier.widthIn(min = space(6f)), space(3f))
    } else {
      Text(
        value,
        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
        color = valueColor ?: MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }
    Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    if (delta != null) {
      Text(
        delta,
        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
        color = when (deltaTone) {
          DeltaTone.UP -> palette.success.text
          DeltaTone.DOWN -> palette.error.text
          DeltaTone.FLAT -> MaterialTheme.colorScheme.onSurfaceVariant
        },
      )
    }
    if (note != null) Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

/** A row of figures that wraps onto the next line when it runs out of width. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StatFigures(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
  FlowRow(
    modifier.fillMaxWidth(),
    horizontalArrangement = Arrangement.spacedBy(space(3f)),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) { content() }
}

/**
 * A ranked breakdown: a title and its rows, each a label and its count. Draws nothing without rows, as the console's
 * `TopList` does.
 */
@Composable
fun TopList(title: String, rows: List<Pair<String, String>>, modifier: Modifier = Modifier) {
  if (rows.isEmpty()) return
  Column(modifier.widthIn(min = space(27.5f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    Text(title, style = MaterialTheme.typography.titleSmall)
    rows.forEach { (label, count) ->
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(count, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

/** The range a stats card reads, in the console's words (`7 days` … `90 days`), as one segmented control. */
@Composable
fun RangePicker(days: Int, choices: List<Int>, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
  SingleChoiceSegmentedButtonRow(modifier) {
    choices.forEachIndexed { index, choice ->
      SegmentedButton(
        selected = choice == days,
        onClick = { onSelect(choice) },
        shape = SegmentedButtonDefaults.itemShape(index, choices.size),
        icon = {},
      ) { Text("$choice days", maxLines = 1) }
    }
  }
}

/** A stats section on a dashboard: its title and the controls on its right, then its card. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StatsSection(
  title: String,
  modifier: Modifier = Modifier,
  accessory: (@Composable () -> Unit)? = null,
  content: @Composable () -> Unit,
) {
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    FlowRow(
      Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.SpaceBetween,
      verticalArrangement = Arrangement.spacedBy(space(1f)),
      itemVerticalAlignment = Alignment.CenterVertically,
    ) {
      Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
      accessory?.invoke()
    }
    StatsCard { content() }
  }
}

/** The kit's card surface around a stats card's content: paper, a hairline, the card radius. */
@Composable
fun StatsCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
  Column(
    modifier.fillMaxWidth()
      .background(MaterialTheme.colorScheme.surface, MaterialTheme.shapes.large)
      .border(androidx.compose.foundation.BorderStroke(androidx.compose.material3.DividerDefaults.Thickness, MaterialTheme.colorScheme.outlineVariant), MaterialTheme.shapes.large)
      .padding(space(2f)),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) { content() }
}
