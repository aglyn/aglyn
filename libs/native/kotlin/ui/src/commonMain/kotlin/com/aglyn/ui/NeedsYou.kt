package com.aglyn.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * The lines on screen in Home's "Needs you", by id: a line is there only while something waits, so Home says "Nothing
 * needs you right now" when none is.
 */
class NeedsYouLines {
  internal val shown: SnapshotStateMap<String, Boolean> = mutableStateMapOf()
  val any: Boolean get() = shown.isNotEmpty()
}

/** Home's "Needs you" lines, for the lines to report themselves to. */
val LocalNeedsYou = compositionLocalOf<NeedsYouLines?> { null }

/**
 * One thing waiting on the person (Home's "Needs you"): a count and what it is ("3 orders to get ready for today"), the
 * list it opens, already filtered. Drawn only while something waits; nothing is drawn for nothing.
 */
@Composable
fun NeedsYouLine(id: String, icon: String, text: String, place: String, onClick: () -> Unit, tone: StatusTone = StatusTone.NEUTRAL) {
  val lines = LocalNeedsYou.current
  DisposableEffect(id, lines) {
    lines?.shown?.put(id, true)
    onDispose { lines?.shown?.remove(id) }
  }
  val palette = LocalAglynPalette.current
  val tint = when (tone) {
    StatusTone.ERROR -> palette.error.text
    StatusTone.WARNING -> palette.warning.text
    StatusTone.SUCCESS -> palette.success.text
    else -> MaterialTheme.colorScheme.primary
  }
  Row(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick)
      .heightIn(min = 52.dp).padding(horizontal = 12.dp, vertical = 8.dp)
      .testTag("needs-you-$id").semantics(mergeDescendants = true) { role = Role.Button },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Box(Modifier.size(32.dp).background(tint.copy(alpha = 0.12f), RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
      Icon(AglynIcons.named(icon), null, Modifier.size(18.dp), tint = tint)
    }
    Text(text, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
    Text(place, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Icon(AglynIcons.named("chevron_right"), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
