package com.aglyn.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.ripple
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** How far a list row's rounded container sits in from the list's edges, so its content stays on the 16 dp line. */
internal val ListRowInset = 8.dp

/**
 * A list row on the Material 3 list tokens: a 40 dp leading circle, a BodyLarge title (two lines at most), a BodyMedium
 * supporting line and a trailing slot, at least 56 dp tall (72 with a supporting line).
 *
 * Every row sits in a rounded container inset from the list's edges, so a selected row reads as one shape: the container
 * fills with primaryContainer, the title turns semibold and the leading circle inverts, which keeps selection from
 * relying on color alone. Pressed and hovered states are clipped to the same shape, and keyboard focus draws a 2 dp
 * primary outline around it. The same shape marks the selected destination in the navigation drawer.
 */
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
  /** A workspace's logo or a site's favicon in the icon's place; the icon shows while there is none. */
  imageUrl: String? = null,
  darkImageUrl: String? = null,
) {
  val colors = MaterialTheme.colorScheme
  val shape = MaterialTheme.shapes.large
  val interaction = remember { MutableInteractionSource() }
  val focused by interaction.collectIsFocusedAsState()
  val content = if (selected && !squareListSelection()) colors.onPrimaryContainer else colors.onSurface
  val compact = LocalUiDensity.current.compact
  // In a full-bleed list the row's icon and trailing sit on the column's content inset E; in a padded pane, its own 8.
  // In a list column beside its detail (tablet, desktop) a selected row fills square, the column's whole width, its
  // content on E (AGL-4012); elsewhere the row is a rounded container inset from the list's edges.
  val square = squareListSelection()
  val outer = if (square) 0.dp else LocalContentInset.current?.let { (it - ListRowInset).coerceAtLeast(0.dp) } ?: ListRowInset
  val inner = if (square) LocalContentInset.current ?: contentInset() else ListRowInset
  val innerPadding = if (square) squareRowPadding(inner) else androidx.compose.foundation.layout.PaddingValues(horizontal = ListRowInset)
  Row(
    modifier
      .fillMaxWidth()
      .then(
        if (square) Modifier.squareRowBox().squareRowGround(selected, interaction)
        else Modifier.padding(horizontal = outer, vertical = 1.dp).clip(shape).background(if (selected) colors.primaryContainer else Color.Transparent),
      )
      .then(if (focused) Modifier.border(2.dp, colors.primary, if (square) androidx.compose.ui.graphics.RectangleShape else shape) else Modifier)
      .then(
        if (onClick != null) {
          Modifier.clickable(interactionSource = interaction, indication = if (square) null else ripple(), onClick = onClick)
        } else {
          Modifier
        },
      )
      .semantics(mergeDescendants = onClick != null) { if (selected) this.selected = true }
      .heightIn(min = if (supporting != null) (if (compact) 60.dp else 72.dp) else (if (compact) 48.dp else 56.dp))
      .padding(innerPadding).padding(vertical = if (compact) 6.dp else 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    if (icon != null) {
      BrandPicture(imageUrl, darkImageUrl, 40.dp, CircleShape) {
        Box(
          Modifier.size(40.dp).clip(CircleShape).background(if (selected) colors.primary else colors.primaryContainer),
          contentAlignment = Alignment.Center,
        ) { Icon(icon, contentDescription = null, tint = if (selected) colors.onPrimary else colors.onPrimaryContainer) }
      }
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(
        title,
        style = MaterialTheme.typography.bodyLarge,
        color = content,
        // One line at every width, the tail truncated (Figma's list rows).
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        fontWeight = if (emphasized || selected) FontWeight.SemiBold else null,
      )
      if (supporting != null) {
        Text(
          supporting,
          style = MaterialTheme.typography.bodyMedium,
          color = if (selected && !squareListSelection()) colors.onPrimaryContainer else colors.onSurfaceVariant,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }
    if (trailing != null) {
      CompositionLocalProvider(
        LocalContentColor provides if (selected) colors.onPrimaryContainer else colors.onSurfaceVariant,
        LocalTextStyle provides MaterialTheme.typography.labelMedium,
      ) { trailing() }
    }
  }
}

/** What an [EmptyState] stands for: nothing yet, a feature the plan does not include, or a real failure. */
enum class EmptyTone { NEUTRAL, UPSELL, ERROR }

/**
 * A centered message for an empty list, a missing feature or a failure: a 48 dp icon in a 72 dp tonal circle, a
 * TitleMedium title, a BodyMedium body (360 dp wide at most) and at most one action. A plan or add-on the workspace does
 * not have yet is an [EmptyTone.UPSELL] (brand tone, never an error glyph); [EmptyTone.ERROR] is for real failures only.
 */
@Composable
fun EmptyState(
  title: String,
  modifier: Modifier = Modifier,
  body: String? = null,
  icon: ImageVector? = null,
  tone: EmptyTone = EmptyTone.NEUTRAL,
  action: (@Composable () -> Unit)? = null,
) {
  val colors = MaterialTheme.colorScheme
  val (circle, glyph) = when (tone) {
    EmptyTone.NEUTRAL -> colors.surfaceContainerHigh to colors.onSurfaceVariant
    EmptyTone.UPSELL -> colors.primaryContainer to colors.onPrimaryContainer
    EmptyTone.ERROR -> colors.errorContainer to colors.onErrorContainer
  }
  Box(modifier.fillMaxSize().padding(space(3f)), contentAlignment = Alignment.Center) {
    Column(
      Modifier.widthIn(max = 360.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      if (icon != null) {
        Box(Modifier.size(72.dp).clip(CircleShape).background(circle), contentAlignment = Alignment.Center) {
          Icon(icon, null, Modifier.size(40.dp), tint = glyph)
        }
        Spacer(Modifier.height(space(0.5f)))
      }
      Text(
        title,
        Modifier.semantics { heading() },
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Medium,
        textAlign = TextAlign.Center,
      )
      if (body != null) {
        Text(
          body,
          style = MaterialTheme.typography.bodyMedium,
          color = colors.onSurfaceVariant,
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

/**
 * The detail pane of a list-detail before anything is picked: a quiet 32 dp icon over one TitleMedium line in
 * onSurfaceVariant, centered, with no card and no button ("Pick a product to see it here"), as Mail and Gmail leave it.
 */
@Composable
fun SelectionPlaceholder(title: String, icon: ImageVector? = null, modifier: Modifier = Modifier) {
  Box(modifier.fillMaxSize().padding(space(3f)).testTag("selection-placeholder"), contentAlignment = Alignment.Center) {
    Column(
      Modifier.widthIn(max = 360.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      if (icon != null) Icon(icon, null, Modifier.size(32.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f))
      Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
  }
}

/**
 * The top of a detail pane: a 56 dp tile (the item's picture, else its icon on a tonal ground), its name in TitleLarge,
 * an optional line under it, a status chip and the pane's own actions at the end.
 */
@Composable
fun DetailHeader(
  title: String,
  modifier: Modifier = Modifier,
  icon: ImageVector? = null,
  image: (@Composable () -> Unit)? = null,
  subtitle: String? = null,
  status: (@Composable () -> Unit)? = null,
  actions: (@Composable () -> Unit)? = null,
) {
  Row(
    modifier.fillMaxWidth().testTag("detail-header"),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    if (image != null || icon != null) {
      Box(
        Modifier.size(56.dp).clip(MaterialTheme.shapes.medium).background(MaterialTheme.colorScheme.primaryContainer),
        contentAlignment = Alignment.Center,
      ) {
        if (image != null) image() else Icon(icon!!, null, Modifier.size(28.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
      }
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
      Text(title, Modifier.semantics { heading() }, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
      if (subtitle != null) {
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
      }
      status?.invoke()
    }
    actions?.invoke()
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

/** A plain section's measures in a detail column (Apple's plain grouped form): its title 17/22 semibold, 20 above, 10 below. */
object PlainSection {
  val above = 20.dp
  val below = 10.dp
  val titleSize = 17.sp
  val titleLine = 22.sp
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
  // Inside a tablet or desktop detail column a section is plain (AGL-4012, Apple's plain grouped form): on the column's
  // surface with no card or grey, its title 17 semibold with 20 above and 10 below, its content on the column's edges.
  // Settings pages, a phone, and anything outside a detail column keep the card.
  if (LocalDetailPane.current && currentWidthClass() != WidthClass.COMPACT) {
    Column(
      modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).testTag("plain-section"),
      verticalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      if (title != null || action != null) {
        Row(Modifier.padding(top = PlainSection.above, bottom = PlainSection.below - space(1f)), verticalAlignment = Alignment.CenterVertically) {
          if (title != null) Text(title, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleMedium.copy(fontSize = PlainSection.titleSize, lineHeight = PlainSection.titleLine), fontWeight = FontWeight.SemiBold)
          action?.invoke()
        }
      }
      content()
    }
    return
  }
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
