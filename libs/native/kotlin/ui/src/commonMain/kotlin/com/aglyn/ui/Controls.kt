package com.aglyn.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.max

/**
 * An inline message in a pane: what happened, in the tone it happened in,
 * and an optional action ("Check the sale"). Announced to screen readers.
 */
@Composable
fun NoticeBanner(
  message: String,
  tone: StatusTone = StatusTone.INFO,
  modifier: Modifier = Modifier,
  action: (@Composable () -> Unit)? = null,
) {
  val palette = LocalAglynPalette.current
  val (container, content, icon) = when (tone) {
    StatusTone.SUCCESS -> Triple(palette.success.main.copy(alpha = 0.14f), palette.success.text, "check_circle")
    StatusTone.WARNING -> Triple(palette.warning.main.copy(alpha = 0.18f), palette.warning.text, "warning")
    StatusTone.ERROR -> Triple(palette.error.main.copy(alpha = 0.12f), palette.error.text, "error")
    StatusTone.INFO -> Triple(palette.info.main.copy(alpha = 0.12f), palette.info.text, "info")
    StatusTone.NEUTRAL -> Triple(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant, "info")
  }
  Surface(
    modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
    shape = MaterialTheme.shapes.medium,
    color = container,
    contentColor = content,
  ) {
    Row(
      Modifier.padding(horizontal = space(1.5f), vertical = space(1f)),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      Icon(AglynIcons.named(icon), contentDescription = null, modifier = Modifier.size(20.dp))
      Text(message, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
      action?.invoke()
    }
  }
}

/** A label on the left and a figure flush right: a totals row. */
@Composable
fun AmountRow(
  label: String,
  value: String,
  modifier: Modifier = Modifier,
  emphasized: Boolean = false,
  muted: Boolean = false,
) {
  val style = if (emphasized) MaterialTheme.typography.titleLarge else MaterialTheme.typography.bodyLarge
  val color = if (muted) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface
  Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Text(label, Modifier.weight(1f), style = style, color = color, fontWeight = if (emphasized) FontWeight.SemiBold else null)
    Text(value, style = style, color = color, fontWeight = if (emphasized) FontWeight.Bold else FontWeight.Medium, textAlign = TextAlign.End)
  }
}

/** Minus, the count, plus: a quantity the cashier nudges, held to [range]. */
@Composable
fun QuantityStepper(
  value: Int,
  onChange: (Int) -> Unit,
  modifier: Modifier = Modifier,
  range: IntRange = 0..99,
  label: String = "Quantity",
) {
  Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
    FilledTonalIconButton(
      onClick = { onChange(value - 1) },
      enabled = value > range.first,
      modifier = Modifier.size(36.dp).testTag("stepper-minus"),
    ) { Icon(AglynIcons.named(if (value - 1 <= 0) "delete" else "remove"), contentDescription = if (value - 1 <= 0) "Remove" else "One fewer") }
    Text(
      value.toString(),
      Modifier.widthIn(min = 28.dp).semantics { contentDescription = "$label $value" },
      style = MaterialTheme.typography.titleMedium,
      textAlign = TextAlign.Center,
    )
    FilledTonalIconButton(
      onClick = { onChange(value + 1) },
      enabled = value < range.last,
      modifier = Modifier.size(36.dp).testTag("stepper-plus"),
    ) { Icon(AglynIcons.named("add"), contentDescription = "One more") }
  }
}

data class ChipOption(val key: String, val label: String, val icon: String? = null)

/** One choice from a short set, as a scrolling row of chips (categories, tips, quick amounts). */
@Composable
fun ChoiceChipRow(
  options: List<ChipOption>,
  selected: String?,
  onSelect: (String) -> Unit,
  modifier: Modifier = Modifier,
  wrap: Boolean = false,
) {
  @Composable
  fun chip(option: ChipOption) {
    FilterChip(
      selected = option.key == selected,
      onClick = { onSelect(option.key) },
      label = { Text(option.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
      leadingIcon = option.icon?.let { name -> { Icon(AglynIcons.named(name), null, Modifier.size(FilterChipDefaults.IconSize)) } },
      modifier = Modifier.heightIn(min = 40.dp).testTag("chip-${option.key}"),
    )
  }
  if (wrap) {
    androidx.compose.foundation.layout.FlowRow(
      modifier,
      horizontalArrangement = Arrangement.spacedBy(space(1f)),
      verticalArrangement = Arrangement.spacedBy(space(0.5f)),
    ) { options.forEach { chip(it) } }
  } else {
    Row(modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      options.forEach { chip(it) }
    }
  }
}

/** Skeleton tiles standing in for a grid, as many columns as fit at [minTileWidth]. */
@Composable
fun SkeletonGrid(tiles: Int = 12, minTileWidth: Dp = 140.dp, tileHeight: Dp = 112.dp, modifier: Modifier = Modifier) {
  val width = minTileWidth * LocalDensity.current.fontScale.coerceAtLeast(1f)
  BoxWithConstraints(modifier.fillMaxWidth().padding(space(2f))) {
    val gap = space(1.5f)
    val columns = max(1, ((maxWidth + gap) / (width + gap)).toInt())
    Column(verticalArrangement = Arrangement.spacedBy(gap)) {
      for (row in (0 until tiles).chunked(columns)) {
        Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
          for (tile in row) Box(Modifier.weight(1f)) { Skeleton(Modifier.fillMaxWidth(), tileHeight) }
          repeat(columns - row.size) { Box(Modifier.weight(1f)) }
        }
      }
    }
  }
}
