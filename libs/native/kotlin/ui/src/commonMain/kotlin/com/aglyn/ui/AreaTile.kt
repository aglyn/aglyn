package com.aglyn.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * The phone's Home tiles (AGL-4006; Figma Phone/Area tile 282:22072): every area of the scope as the same
 * tile, so none looks more important than another. Bold on a phone in the brand's look (inside PhoneTheme), the everyday
 * form elsewhere.
 */

/**
 * One area on the phone's Home and in the area switcher: its icon on a 56 dp plate, radius 16, its name under it in two
 * lines at most, and its Needs-you [badge] on the plate's corner. In the bold look the plate is the raised surface with a
 * hairline and the icon is in the accent's text shade; otherwise the plate is the sunken fill. The area on screen
 * ([current]) wears the accent ring. A long-press opens [onLongPress] (Add to tab bar, Star, Edit tab bar…).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun AreaTile(
  label: String,
  icon: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  badge: Int = 0,
  current: Boolean = false,
  onLongPress: (() -> Unit)? = null,
  /** A plugin's own count for the area (slot `sidebarCount.<row>`), drawn on the plate's corner in place of [badge]. */
  badgeSlot: (@Composable () -> Unit)? = null,
) {
  val bold = LocalPhoneBold.current
  val surfaces = LocalThemeSurfaces.current
  val scheme = MaterialTheme.colorScheme
  val accent = LocalAccent.current
  val shape = RoundedCornerShape(16.dp)
  val ring = when {
    current -> BorderStroke(2.dp, accent?.fill ?: scheme.primary)
    bold -> BorderStroke(1.dp, surfaces?.borderSubtle ?: scheme.outlineVariant)
    else -> null
  }
  Column(
    modifier
      .widthIn(min = 72.dp)
      .clip(RoundedCornerShape(12.dp))
      .combinedClickable(role = Role.Button, onClick = onClick, onLongClick = onLongPress)
      .padding(top = 4.dp, bottom = 4.dp)
      .semantics {
        contentDescription = if (badge > 0) "$label, $badge waiting" else label
        selected = current
      },
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    Box {
      Box(
        Modifier.size(56.dp).clip(shape)
          .background(if (bold) surfaces?.raised ?: scheme.surface else scheme.surfaceContainerHigh)
          .let { m -> ring?.let { m.border(it, shape) } ?: m },
        contentAlignment = Alignment.Center,
      ) {
        Icon(AglynIcons.named(icon), contentDescription = null, modifier = Modifier.size(26.dp), tint = if (bold) aglynAccentText else accent?.icon ?: scheme.primary)
      }
      if (badgeSlot != null) {
        Box(Modifier.align(Alignment.TopEnd).offset(x = 6.dp, y = (-6).dp)) { badgeSlot() }
      } else if (badge > 0) {
        Box(
          Modifier.align(Alignment.TopEnd).offset(x = 6.dp, y = (-6).dp)
            .widthIn(min = 18.dp).clip(CircleShape).background(accent?.fill ?: scheme.primary).padding(horizontal = 5.dp),
          contentAlignment = Alignment.Center,
        ) {
          Text(if (badge > 99) "99+" else "$badge", color = accent?.onFill ?: scheme.onPrimary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
        }
      }
    }
    Text(
      label,
      style = MaterialTheme.typography.labelMedium.copy(fontSize = 12.sp, lineHeight = 15.sp),
      fontWeight = FontWeight.SemiBold,
      color = if (current) aglynAccentText else scheme.onSurface,
      textAlign = TextAlign.Center,
      maxLines = 2,
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.fillMaxWidth(),
    )
  }
}

/** The phone Home's group heading over a row of tiles (Figma Phone/Section header): 13 semibold in the secondary text. */
@Composable
fun AreaGroupHeader(label: String, modifier: Modifier = Modifier) {
  Text(
    label,
    style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp),
    fontWeight = FontWeight.SemiBold,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    modifier = modifier.padding(top = 10.dp, bottom = 4.dp),
  )
}

/**
 * On a phone, the area title's ▾: opens every area of the scope as tiles to switch in place (AGL-4006). The shell provides
 * it while an area is on screen; a screen's title row ([ListScreenScaffold]) draws the ▾ when it is set.
 */
val LocalAreaSwitcher = staticCompositionLocalOf<(() -> Unit)?> { null }
