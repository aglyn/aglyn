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
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
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

/**
 * The range a stats card reads, in the console's words (`7 days` … `90 days`), as Figma's Segmented control
 * (Segmented/Segment, Android 344:44710): the picked range a pill on the surface, the others its secondary text, never
 * the platform's outlined segments with the pink container.
 */
@Composable
fun RangePicker(days: Int, choices: List<Int>, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
  val shape = RoundedCornerShape(LocalShellMetrics.current.controlRadius)
  val scheme = MaterialTheme.colorScheme
  Row(modifier.selectableGroup(), verticalAlignment = Alignment.CenterVertically) {
    choices.forEach { choice ->
      val picked = choice == days
      Text(
        "$choice days",
        Modifier
          .clip(shape)
          .background(if (picked) scheme.surface else Color.Transparent)
          .selectable(selected = picked, role = Role.Tab, onClick = { onSelect(choice) })
          .padding(horizontal = space(1.5f), vertical = space(0.5f))
          .testTag("range-$choice"),
        style = MaterialTheme.typography.labelLarge,
        fontWeight = FontWeight.SemiBold,
        color = if (picked) scheme.onSurface else scheme.onSurfaceVariant,
        maxLines = 1,
      )
    }
  }
}

/**
 * A stats section on a dashboard: its title and the controls on its right, then its card. A [link] (View details) ends
 * the title row; where the controls do not fit beside it they take the next line (Figma Traffic: one row on a tablet,
 * 332:42419; on a phone the title and View details, then the range under them, 344:44710).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StatsSection(
  title: String,
  modifier: Modifier = Modifier,
  accessory: (@Composable () -> Unit)? = null,
  link: (@Composable () -> Unit)? = null,
  content: @Composable () -> Unit,
) {
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    if (link == null) {
      FlowRow(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalArrangement = Arrangement.spacedBy(space(1f)),
        itemVerticalAlignment = Alignment.CenterVertically,
      ) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
        accessory?.invoke()
      }
    } else {
      StatsHead(
        title = { Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() }) },
        accessory = { accessory?.invoke() },
        link = link,
      )
    }
    StatsCard { content() }
  }
}

/**
 * The title, the controls and the link of a stats section's head: one row when all three fit (title at the start, the
 * controls and the link at the end), else the title and the link on the first row and the controls under them.
 */
@Composable
private fun StatsHead(title: @Composable () -> Unit, accessory: @Composable () -> Unit, link: @Composable () -> Unit) {
  val gap = space(2f)
  val rowGap = space(1f)
  Layout(
    contents = listOf(title, accessory, link),
    modifier = Modifier.fillMaxWidth(),
  ) { (titles, accessories, links), constraints ->
    val loose = constraints.copy(minWidth = 0, minHeight = 0)
    val linkP = links.map { it.measure(loose) }
    val linkW = linkP.maxOfOrNull { it.width } ?: 0
    val accP = accessories.map { it.measure(loose) }
    val accW = accP.maxOfOrNull { it.width } ?: 0
    val gapPx = gap.roundToPx()
    val titleP = titles.map { it.measure(loose.copy(maxWidth = (constraints.maxWidth - linkW - gapPx).coerceAtLeast(0))) }
    val titleW = titleP.maxOfOrNull { it.width } ?: 0
    val oneRow = titleW + gapPx + accW + gapPx + linkW <= constraints.maxWidth
    val width = constraints.maxWidth
    val firstH = maxOf(titleP.maxOfOrNull { it.height } ?: 0, linkP.maxOfOrNull { it.height } ?: 0, if (oneRow) accP.maxOfOrNull { it.height } ?: 0 else 0)
    val accH = accP.maxOfOrNull { it.height } ?: 0
    val height = if (oneRow || accW == 0) firstH else firstH + rowGap.roundToPx() + accH
    layout(width, height) {
      titleP.forEach { it.placeRelative(0, (firstH - it.height) / 2) }
      linkP.forEach { it.placeRelative(width - it.width, (firstH - it.height) / 2) }
      if (oneRow) {
        accP.forEach { it.placeRelative(width - linkW - gapPx - it.width, (firstH - it.height) / 2) }
      } else {
        accP.forEach { it.placeRelative(0, firstH + rowGap.roundToPx()) }
      }
    }
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
