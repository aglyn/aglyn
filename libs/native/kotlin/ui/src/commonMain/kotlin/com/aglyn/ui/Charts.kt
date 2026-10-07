package com.aglyn.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** One bar: its value, the label under it (or empty), and what a screen reader says. */
data class TrendBar(val value: Double, val label: String, val spoken: String)

/**
 * A row of bars over time (a day each, say), scaled to the largest, with the
 * labels beneath. The highlighted bar (today, usually) takes the primary
 * color; the rest take it softened. A bar of zero still shows a hairline so
 * an empty day reads as a day. The whole chart is one accessible element
 * that reads every bar.
 */
@Composable
fun TrendBars(
  bars: List<TrendBar>,
  modifier: Modifier = Modifier,
  height: Dp = 120.dp,
  highlightLast: Boolean = true,
  color: Color = MaterialTheme.colorScheme.primary,
) {
  val max = bars.maxOfOrNull { it.value }?.takeIf { it > 0 } ?: 1.0
  Column(
    modifier.semantics(mergeDescendants = true) { contentDescription = bars.joinToString("; ") { it.spoken } },
    verticalArrangement = Arrangement.spacedBy(space(0.5f)),
  ) {
    Row(Modifier.fillMaxWidth().height(height), horizontalArrangement = Arrangement.spacedBy(space(0.5f)), verticalAlignment = Alignment.Bottom) {
      bars.forEachIndexed { index, bar ->
        val strong = highlightLast && index == bars.lastIndex
        Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.BottomCenter) {
          Box(
            Modifier
              .fillMaxWidth()
              .fillMaxHeight(((bar.value / max).toFloat()).coerceIn(0.015f, 1f))
              .background(if (strong) color else color.copy(alpha = 0.38f), RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp)),
          )
        }
      }
    }
    if (bars.any { it.label.isNotEmpty() }) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
        bars.forEach { bar ->
          Text(
            bar.label,
            Modifier.weight(1f),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
          )
        }
      }
    }
  }
}
