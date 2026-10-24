package com.aglyn.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** A workspace's initials: the first letter of its first two words ("Northwind Coffee" → NC), or its first letter. */
fun workspaceInitials(name: String): String {
  val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() && it.first().isLetterOrDigit() }
  return when {
    words.isEmpty() -> "?"
    words.size == 1 -> words[0].take(1).uppercase()
    else -> (words[0].take(1) + words[1].take(1)).uppercase()
  }
}

/** Figma's paper plate under a workspace logo (brand/white). */
internal val LogoPlate = Color.White

/** Each side of the plate around a mark's slot: (40 − 28) / 2 / 40, the same 6 / 40 and 5 / 32 as Figma's. */
internal const val LogoSlotInset = 0.15f

/**
 * A workspace's picture: its logo when it has one, else its initials on its color (the person's pick, its brand color, a
 * color taken from its logo, else the brand slate). [selected] rings it; [badge] shows a count of what waits there.
 * [initials] are the letters drawn without a logo: a workspace's one initial (the contract's `workspaceInitial`, Figma
 * Rail/Workspace tile, Type=Initial); a site's tile leaves them to [workspaceInitials], two letters.
 *
 * The logo follows Figma's Rail/Workspace tile (Components 2:2): a picture (opaque art, or a badge that already fits the
 * tile's shape) covers the tile (Type=Picture, 109:1419 / 109:1408); a mark on a transparent ground sits on the paper
 * plate, its ink fitted whole in the slot (Type=Logo, 97:899 / 5:47: 22 on 32, 28 on 40). It is decoded at the pixels it
 * is drawn at, so it is never minified on screen (AGL-4027).
 */
@Composable
fun WorkspaceTile(
  name: String,
  logoUrl: String?,
  darkLogoUrl: String? = null,
  color: Color?,
  modifier: Modifier = Modifier,
  size: Dp = 40.dp,
  selected: Boolean = false,
  badge: Int = 0,
  /** The tile's corner radius (the Size variant's: 8 on the desktop, 10 on tablets); proportional when not given. */
  cornerRadius: Dp? = null,
  badgeSize: Dp = 18.dp,
  /** The selected ring's box and radius (the Size variant's: 38/11 on the desktop, 48/14 on tablets). */
  ringBox: Dp = size + 8.dp,
  ringRadius: Dp? = null,
  /** The initials' size; proportional to the tile when not given. */
  initialSize: androidx.compose.ui.unit.TextUnit? = null,
  initials: String? = null,
  /** Whether the tile keeps its ring's box when it is not selected, so a column of tiles keeps one rhythm (the rail). */
  reserveRing: Boolean = false,
  /** The badge's cut-out ring, in the ground it sits on (Figma Badge: 2 in bg/rail), and where it sits off the corner. */
  badgeRing: Color? = null,
  badgeOffset: androidx.compose.ui.unit.DpOffset = androidx.compose.ui.unit.DpOffset.Zero,
) {
  val shell = shellColors
  val radius = cornerRadius ?: (size * 0.28f)
  val shape = RoundedCornerShape(radius)
  val shown = (if (isSystemInDarkTheme()) darkLogoUrl else null) ?: logoUrl
  // The slot keeps whole points of plate round a mark: 5 on 32, 6 on 40, as Figma draws them.
  val slot = size.value - 2 * (size.value * LogoSlotInset).roundToInt()
  val fit = BrandFit.Tile(size.value, (radius / size).coerceIn(0f, 0.5f), slot)
  val picture = rememberBrandPicture(shown, fit)
  // A workspace with no color of its own: the brand slate (#404C5C) in light and dark alike, as Figma's Rail draws it,
  // never the dark palette's light slate, which glared on the dark rail (AGL-4000).
  val fill = color ?: AglynTokens.light.tertiary.main
  val letters = initials ?: workspaceInitials(name)
  Box(modifier.size(if (selected || reserveRing) ringBox else size), contentAlignment = Alignment.Center) {
    // Selected: a 2 dp ring clear of the tile (the rail adds its 3 dp bar at the edge).
    if (selected) Box(Modifier.size(ringBox).border(2.dp, shell.ring, RoundedCornerShape(ringRadius ?: (radius + 4.dp))))
    if (picture != null) {
      val layout = fit.layout(picture.art)
      // A mark sits on Figma's paper plate: white in light and dark, a 1 dp subtle border.
      Box(
        Modifier.size(size).clip(shape)
          .then(if (layout.plate) Modifier.background(LogoPlate).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape) else Modifier),
        contentAlignment = Alignment.Center,
      ) {
        BrandDrawn(picture, layout, size)
      }
    } else {
      Box(Modifier.size(size).clip(shape).background(fill), contentAlignment = Alignment.Center) {
        Text(
          letters,
          color = readableOn(fill),
          fontWeight = FontWeight.SemiBold,
          fontSize = initialSize ?: (size.value * if (letters.length > 1) 0.36f else 0.42f).sp,
          maxLines = 1,
        )
      }
    }
    if (badge > 0) {
      // With a cut-out (the rail's), the ring is 2 dp OUTSIDE a fill of [badgeSize] (Figma Badge: the fill is 14 on the
      // desktop, 18 on tablets, and the cut-out is extra), so the ring's box is what [badgeOffset] places.
      Box(
        Modifier.align(Alignment.TopEnd).offset(badgeOffset.x, badgeOffset.y)
          .then(if (badgeRing != null) Modifier.clip(CircleShape).background(badgeRing).padding(2.dp) else Modifier)
          .sizeIn(minWidth = badgeSize, minHeight = badgeSize)
          .clip(CircleShape).background(shell.badge)
          .padding(horizontal = if (badgeRing != null) badgeSize * 0.2f else 4.dp),
        contentAlignment = Alignment.Center,
      ) {
        // Figma Label/Badge: 10 bold on both sizes (the rail's); elsewhere it scales with the badge.
        Text(
          if (badge > 99) "99+" else badge.toString(), color = shell.onBadge,
          fontSize = if (badgeRing != null) 10.sp else (badgeSize.value * 0.6f).sp, lineHeight = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1,
        )
      }
    }
  }
}

/**
 * The color taken from a workspace's logo (the third of the three sources, Zach 2026-10-18): the most common strongly
 * colored hue among its pixels, skipping transparent, near-white, near-black and grey ones. Null while it loads, with no
 * logo, or for a logo with no color in it.
 */
@Composable
fun rememberLogoColor(logoUrl: String?): Color? {
  val image = rememberRemoteBitmap(logoUrl)
  var color by remember(logoUrl) { mutableStateOf<Color?>(null) }
  LaunchedEffect(image) { color = image?.let(::dominantColor) }
  return color
}

/** The most common saturated color in [image], bucketed by hue; null when the image has none. */
fun dominantColor(image: ImageBitmap): Color? {
  val step = max(1, min(image.width, image.height) / 48)
  val width = image.width / step
  val height = image.height / step
  if (width == 0 || height == 0) return null
  val pixels = IntArray(image.width * image.height)
  runCatching { image.readPixels(pixels) }.onFailure { return null }
  val buckets = HashMap<Int, MutableList<Int>>()
  for (y in 0 until height) for (x in 0 until width) {
    val argb = pixels[(y * step) * image.width + x * step]
    if ((argb ushr 24) < 200) continue
    val r = (argb shr 16) and 0xFF
    val g = (argb shr 8) and 0xFF
    val b = argb and 0xFF
    val hi = maxOf(r, g, b)
    val lo = minOf(r, g, b)
    if (hi < 40 || lo > 225 || hi - lo < 48) continue
    val hue = when (hi) {
      r -> ((g - b).toFloat() / (hi - lo) * 60 + 360) % 360
      g -> (b - r).toFloat() / (hi - lo) * 60 + 120
      else -> (r - g).toFloat() / (hi - lo) * 60 + 240
    }
    buckets.getOrPut((hue / 20).toInt()) { mutableListOf() } += argb
  }
  val top = buckets.values.maxByOrNull { it.size } ?: return null
  var r = 0L; var g = 0L; var b = 0L
  for (argb in top) { r += (argb shr 16) and 0xFF; g += (argb shr 8) and 0xFF; b += argb and 0xFF }
  return Color((r / top.size).toInt(), (g / top.size).toInt(), (b / top.size).toInt())
}
