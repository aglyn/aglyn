package com.aglyn.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** A list row: leading icon, title, optional supporting line and trailing slot. */
@Composable
fun AglynListItem(
  title: String,
  modifier: Modifier = Modifier,
  supporting: String? = null,
  icon: ImageVector? = null,
  selected: Boolean = false,
  /** Unread or otherwise new: the title reads heavier. */
  emphasized: Boolean = false,
  trailing: (@Composable () -> Unit)? = null,
  onClick: (() -> Unit)? = null,
) {
  ListItem(
    modifier = modifier.then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
    headlineContent = {
      Text(
        title,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        fontWeight = if (emphasized) FontWeight.SemiBold else null,
      )
    },
    supportingContent = supporting?.let { { Text(it, maxLines = 2, overflow = TextOverflow.Ellipsis) } },
    leadingContent = icon?.let {
      {
        Box(
          Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer),
          contentAlignment = Alignment.Center,
        ) { Icon(it, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer) }
      }
    },
    trailingContent = trailing,
    colors = ListItemDefaults.colors(
      containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
    ),
  )
}

/** A centered message for an empty list or an unpicked detail pane. */
@Composable
fun EmptyState(
  title: String,
  modifier: Modifier = Modifier,
  body: String? = null,
  icon: ImageVector? = null,
  action: (@Composable () -> Unit)? = null,
) {
  Box(modifier.fillMaxSize().padding(space(3f)), contentAlignment = Alignment.Center) {
    Column(
      Modifier.widthIn(max = 420.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      if (icon != null) {
        Icon(icon, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
      if (body != null) {
        Text(
          body,
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          textAlign = TextAlign.Center,
        )
      }
      if (action != null) {
        Spacer(Modifier.height(space(1f)))
        action()
      }
    }
  }
}

/** A pulsing placeholder block while content loads. */
@Composable
fun Skeleton(modifier: Modifier = Modifier, height: Dp = 16.dp) {
  val transition = rememberInfiniteTransition()
  val pulse by transition.animateFloat(0.45f, 0.9f, infiniteRepeatable(tween(800), RepeatMode.Reverse))
  Box(
    modifier
      .fillMaxWidth()
      .height(height)
      .alpha(pulse)
      .clip(MaterialTheme.shapes.small)
      .background(MaterialTheme.colorScheme.surfaceVariant)
      .testTag("skeleton"),
  )
}

/** Skeleton rows standing in for a list. */
@Composable
fun SkeletonList(rows: Int = 4, modifier: Modifier = Modifier) {
  Column(modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    repeat(rows) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant))
        Column(Modifier.padding(start = space(2f)), verticalArrangement = Arrangement.spacedBy(6.dp)) {
          Skeleton(Modifier.fillMaxWidth(0.6f), 14.dp)
          Skeleton(Modifier.fillMaxWidth(0.4f), 12.dp)
        }
      }
    }
  }
}

enum class StatusTone { NEUTRAL, SUCCESS, WARNING, ERROR, INFO }

/** A small rounded label for a row's state. */
@Composable
fun StatusChip(label: String, tone: StatusTone = StatusTone.NEUTRAL, modifier: Modifier = Modifier) {
  val palette = LocalAglynPalette.current
  val (background, foreground) = when (tone) {
    StatusTone.SUCCESS -> palette.success.main.copy(alpha = 0.16f) to palette.success.text
    StatusTone.WARNING -> palette.warning.main.copy(alpha = 0.2f) to palette.warning.text
    StatusTone.ERROR -> palette.error.main.copy(alpha = 0.14f) to palette.error.text
    StatusTone.INFO -> palette.info.main.copy(alpha = 0.14f) to palette.info.text
    StatusTone.NEUTRAL -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
  }
  Surface(modifier, shape = CircleShape, color = background, contentColor = foreground) {
    Text(
      label,
      Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
      style = MaterialTheme.typography.labelMedium,
    )
  }
}

/** A titled card on the dashboard and in detail panes. */
@Composable
fun SectionCard(
  title: String?,
  modifier: Modifier = Modifier,
  action: (@Composable () -> Unit)? = null,
  onClick: (() -> Unit)? = null,
  content: @Composable () -> Unit,
) {
  Surface(
    modifier.then(if (onClick != null) Modifier.clip(MaterialTheme.shapes.large).clickable(onClick = onClick) else Modifier),
    shape = MaterialTheme.shapes.large,
    color = MaterialTheme.colorScheme.surfaceContainerLowest,
    tonalElevation = 1.dp,
    shadowElevation = 1.dp,
  ) {
    Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      if (title != null || action != null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          if (title != null) {
            Text(
              title,
              Modifier.weight(1f),
              style = MaterialTheme.typography.titleSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
          action?.invoke()
        }
      }
      content()
    }
  }
}
