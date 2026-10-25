package com.aglyn.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalWindowInfo

/**
 * How a content list's selected row is filled on a tablet or desktop list column (AGL-4012, as Apple's): square and the
 * list's whole width, the accent at [ACTIVE_LIGHT] / [ACTIVE_DARK] while the window is in front, the primary text at
 * [INACTIVE_LIGHT] / [INACTIVE_DARK] while another window is. A row under the pointer takes the theme's hover fill.
 * Sidebar rows keep their pill.
 */
object ListSelection {
  const val ACTIVE_LIGHT = 0.14f
  const val ACTIVE_DARK = 0.26f
  const val INACTIVE_LIGHT = 0.08f
  const val INACTIVE_DARK = 0.13f
}

/** Whether rows here select with the square, full-width fill: inside a list column beside its detail. */
@Composable
fun squareListSelection(): Boolean = LocalListColumn.current

/** The selected row's fill for [squareListSelection]. */
@Composable
fun listSelectionFill(): Color {
  val dark = LocalAglynDark.current
  val scheme = MaterialTheme.colorScheme
  return if (LocalWindowInfo.current.isWindowFocused) {
    scheme.primary.copy(alpha = if (dark) ListSelection.ACTIVE_DARK else ListSelection.ACTIVE_LIGHT)
  } else {
    scheme.onSurface.copy(alpha = if (dark) ListSelection.INACTIVE_DARK else ListSelection.INACTIVE_LIGHT)
  }
}

/** A square row's ground: the selection fill when [selected], the theme's hover fill under the pointer, else none. */
@Composable
fun Modifier.squareRowGround(selected: Boolean, interaction: MutableInteractionSource = remember { MutableInteractionSource() }): Modifier {
  val hovered by interaction.collectIsHoveredAsState()
  val fill = when {
    selected -> listSelectionFill()
    hovered -> MaterialTheme.colorScheme.surfaceContainerHigh
    else -> Color.Transparent
  }
  return hoverable(interaction).background(fill)
}
