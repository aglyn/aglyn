package com.aglyn.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.max
import kotlin.math.min

/** A section title on a dashboard, with an optional action on the right. */
@Composable
fun DashboardSectionTitle(title: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
  Row(modifier.fillMaxWidth().heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(
      title,
      Modifier.weight(1f).semantics { heading() },
      style = MaterialTheme.typography.titleMedium,
      color = MaterialTheme.colorScheme.onSurface,
    )
    action?.invoke()
  }
}

/** One tile of a [QuickActionGrid]. */
data class QuickActionItem(val key: String, val title: String, val icon: String, val onClick: () -> Unit)

/**
 * Quick actions as a grid that fills the row: as many columns as fit at
 * [minTileWidth] (at most [maxColumns]), never more columns than tiles, and
 * every tile the same width.
 */
@Composable
fun QuickActionGrid(
  items: List<QuickActionItem>,
  modifier: Modifier = Modifier,
  minTileWidth: Dp = 80.dp,
  maxColumns: Int = 6,
) {
  if (items.isEmpty()) return
  val gap = space(1f)
  // Larger text needs wider tiles, so a label never breaks inside a word.
  val tileWidth = minTileWidth * LocalDensity.current.fontScale.coerceAtLeast(1f)
  BoxWithConstraints(modifier.fillMaxWidth()) {
    val fit = max(1, ((maxWidth + gap) / (tileWidth + gap)).toInt())
    val most = min(min(fit, maxColumns), items.size)
    // Balance the rows: 4 tiles that fit 3 to a row become 2 rows of 2.
    val rowsNeeded = (items.size + most - 1) / most
    val columns = (items.size + rowsNeeded - 1) / rowsNeeded
    Column(verticalArrangement = Arrangement.spacedBy(gap)) {
      for (row in items.chunked(columns)) {
        Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
          for (item in row) QuickActionTile(item, Modifier.weight(1f))
          repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
        }
      }
    }
  }
}

@Composable
private fun QuickActionTile(item: QuickActionItem, modifier: Modifier) {
  Surface(
    modifier
      .heightIn(min = 88.dp)
      .clip(MaterialTheme.shapes.large)
      .border(1.dp, MaterialTheme.colorScheme.outlineVariant, MaterialTheme.shapes.large)
      .clickable(role = Role.Button, onClickLabel = item.title, onClick = item.onClick)
      .testTag("quick-action-${item.key}"),
    color = MaterialTheme.colorScheme.surfaceContainerLowest,
  ) {
    Column(
      Modifier.padding(horizontal = space(1f), vertical = space(1.5f)),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      IconBadge(AglynIcons.named(item.icon), MaterialTheme.colorScheme.primary)
      Text(
        item.title,
        style = MaterialTheme.typography.labelMedium,
        textAlign = TextAlign.Center,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
      )
    }
  }
}

/** An icon on a soft disc of its own color. */
@Composable
fun IconBadge(icon: ImageVector, tint: Color, modifier: Modifier = Modifier, size: Dp = 40.dp) {
  Box(
    modifier.size(size).clip(CircleShape).background(tint.copy(alpha = 0.14f)),
    contentAlignment = Alignment.Center,
  ) { Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(size * 0.55f)) }
}

/**
 * A summary card: a label, one large number and a caption. The whole card
 * opens [onClick] and says so with a chevron and [actionLabel] for
 * accessibility; it never carries a bare "View" link.
 */
@Composable
fun MetricCard(
  title: String,
  value: String?,
  caption: String?,
  icon: String,
  actionLabel: String,
  modifier: Modifier = Modifier,
  tint: Color = MaterialTheme.colorScheme.primary,
  loading: Boolean = false,
  error: String? = null,
  onClick: () -> Unit,
) {
  Surface(
    modifier
      .clip(MaterialTheme.shapes.large)
      .clickable(role = Role.Button, onClickLabel = actionLabel, onClick = onClick),
    shape = MaterialTheme.shapes.large,
    color = MaterialTheme.colorScheme.surfaceContainerLowest,
    shadowElevation = 1.dp,
  ) {
    Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconBadge(AglynIcons.named(icon), tint, size = 36.dp)
        Text(
          title,
          Modifier.weight(1f).padding(start = space(1.5f)),
          style = MaterialTheme.typography.titleSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
        Icon(AglynIcons.named("chevron_right"), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      when {
        loading -> {
          Skeleton(Modifier.width(72.dp), 34.dp)
          Skeleton(Modifier.fillMaxWidth(0.7f), 14.dp)
        }
        error != null -> Text(error, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
        else -> {
          if (value != null) Text(value, style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.onSurface)
          if (caption != null) {
            Text(caption, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
  }
}

/** How much of a [DashboardGrid] row a card takes. */
enum class GridSpan { HALF, FULL }

/**
 * Cards in rows of [columns]: a HALF card takes one column and a FULL card
 * the whole row. A HALF card left alone at the end of a row stretches to fill
 * it, so the grid never shows a hole.
 */
@Composable
fun DashboardGrid(
  columns: Int,
  items: List<Pair<GridSpan, @Composable (Modifier) -> Unit>>,
  modifier: Modifier = Modifier,
  minCardWidth: Dp = 156.dp,
) {
  val gap = space(2f)
  val cardWidth = minCardWidth * LocalDensity.current.fontScale.coerceAtLeast(1f)
  BoxWithConstraints(modifier.fillMaxWidth()) {
    // Never more columns than fit at the card's minimum width (larger at larger text).
    val fit = max(1, ((maxWidth + gap) / (cardWidth + gap)).toInt())
    DashboardRows(min(columns, fit), items, gap)
  }
}

@Composable
private fun DashboardRows(columns: Int, items: List<Pair<GridSpan, @Composable (Modifier) -> Unit>>, gap: Dp) {
  val rows = mutableListOf<MutableList<Pair<GridSpan, @Composable (Modifier) -> Unit>>>()
  for (item in items) {
    val last = rows.lastOrNull()
    if (item.first == GridSpan.FULL || columns == 1 || last == null || last.size >= columns || last.first().first == GridSpan.FULL) {
      rows += mutableListOf(item)
    } else {
      last += item
    }
  }
  Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(gap)) {
    for (row in rows) {
      // Cards in one row share the tallest card's height.
      Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(gap)) {
        for ((_, content) in row) content(Modifier.weight(1f).fillMaxHeight())
      }
    }
  }
}

/** One activity row: a type icon on its level color, title, one line of body and when. */
@Composable
fun ActivityRow(
  title: String,
  body: String?,
  time: String?,
  icon: String,
  tint: Color,
  unread: Boolean,
  modifier: Modifier = Modifier,
  onClick: (() -> Unit)? = null,
) {
  val largeText = LocalDensity.current.fontScale >= 1.5f
  Row(
    modifier
      .fillMaxWidth()
      .clip(MaterialTheme.shapes.medium)
      .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
      .padding(horizontal = space(1f), vertical = space(1.25f)),
    verticalAlignment = Alignment.Top,
  ) {
    IconBadge(AglynIcons.named(icon), tint, size = 36.dp)
    Column(Modifier.weight(1f).padding(start = space(1.5f)), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
          title,
          Modifier.weight(1f),
          style = if (unread) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyLarge,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
        if (time != null && !largeText) {
          Text(
            time,
            Modifier.padding(start = space(1f)),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
          )
        }
      }
      if (body != null) {
        Text(
          body,
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
      }
      // At large text sizes the time takes its own line so the title keeps the width.
      if (time != null && largeText) {
        Text(time, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
      }
    }
    if (unread) {
      Box(Modifier.padding(start = space(1f), top = 6.dp).size(8.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
    }
  }
}

/**
 * The top of a site's dashboard: the workspace, the site's name and address,
 * whether it is live, and the two things a person does from here most —
 * visit the site and switch to another.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SiteHeaderCard(
  workspaceName: String?,
  siteName: String,
  address: String?,
  statusLabel: String?,
  statusTone: StatusTone,
  statusDetail: String?,
  modifier: Modifier = Modifier,
  onSwitch: () -> Unit,
  onVisit: (() -> Unit)?,
) {
  val largeText = LocalDensity.current.fontScale >= 1.5f
  Surface(
    modifier.fillMaxWidth().testTag("site-header"),
    shape = MaterialTheme.shapes.large,
    color = MaterialTheme.colorScheme.surfaceContainerLowest,
    shadowElevation = 1.dp,
  ) {
    Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconBadge(AglynIcons.named("public"), MaterialTheme.colorScheme.primary, size = 48.dp)
        Column(Modifier.weight(1f).padding(start = space(1.5f)), verticalArrangement = Arrangement.spacedBy(2.dp)) {
          if (workspaceName != null) {
            Text(
              workspaceName,
              style = MaterialTheme.typography.labelMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
          }
          Text(siteName, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
          if (address != null) {
            Text(address, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary, maxLines = 2, overflow = TextOverflow.Ellipsis)
          }
        }
        if (statusLabel != null && !largeText) StatusChip(statusLabel, statusTone, Modifier.testTag("site-status"))
      }
      // At large text sizes the pill takes its own line so the address keeps the width.
      if (statusLabel != null && largeText) StatusChip(statusLabel, statusTone, Modifier.testTag("site-status"))
      if (statusDetail != null) {
        Text(statusDetail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        if (onVisit != null) {
          androidx.compose.material3.Button(onClick = onVisit, modifier = Modifier.testTag("visit-site")) {
            Icon(AglynIcons.named("launch"), null, Modifier.size(18.dp))
            Spacer(Modifier.width(space(1f)))
            Text("Visit site")
          }
        }
        androidx.compose.material3.OutlinedButton(onClick = onSwitch, modifier = Modifier.testTag("home-switcher")) {
          Icon(AglynIcons.named("swap_horiz"), null, Modifier.size(18.dp))
          Spacer(Modifier.width(space(1f)))
          Text("Switch site")
        }
      }
    }
  }
}
