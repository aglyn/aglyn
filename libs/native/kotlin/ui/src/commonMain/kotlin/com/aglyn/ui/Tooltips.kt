package com.aglyn.ui

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipAnchorPosition
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * Names what [content] does in a Material 3 plain tooltip: shown on hover and keyboard focus, and on a long press on a
 * touch screen. Every icon-only button carries one, so a glyph is never the only thing that says what a button does.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WithTooltip(label: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
  TooltipBox(
    positionProvider = TooltipDefaults.rememberTooltipPositionProvider(TooltipAnchorPosition.Above),
    tooltip = { PlainTooltip { Text(label) } },
    state = rememberTooltipState(),
    modifier = modifier,
  ) { content() }
}

/** An icon-only button: its [label] is both the tooltip and what a screen reader says. */
@Composable
fun AglynIconButton(
  icon: ImageVector,
  label: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  tint: Color = Color.Unspecified,
) {
  WithTooltip(label) {
    IconButton(onClick = onClick, modifier = modifier, enabled = enabled) {
      Icon(icon, contentDescription = label, tint = if (tint == Color.Unspecified) LocalContentColor.current else tint)
    }
  }
}
