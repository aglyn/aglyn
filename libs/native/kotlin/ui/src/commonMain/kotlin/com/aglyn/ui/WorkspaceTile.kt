package com.aglyn.ui

import androidx.compose.foundation.Image
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.max
import kotlin.math.min

/** A workspace's initials: the first letter of its first two words ("Elevated Concepts" → EC), or its first letter. */
fun workspaceInitials(name: String): String {
  val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() && it.first().isLetterOrDigit() }
  return when {
    words.isEmpty() -> "?"
    words.size == 1 -> words[0].take(1).uppercase()
    else -> (words[0].take(1) + words[1].take(1)).uppercase()
  }
}

/**
 * A workspace's picture: its logo when it has one, else its initials on its color (the person's pick, its brand color, a
 * color taken from its logo, else the brand slate). [selected] rings it; [badge] shows a count of what waits there.
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
) {
  val shell = shellColors
  val radius = size * 0.28f
  val shape = RoundedCornerShape(radius)
  val shown = (if (isSystemInDarkTheme()) darkLogoUrl else null) ?: logoUrl
  val image = rememberRemoteBitmap(shown)
  val fill = color ?: LocalAglynPalette.current.tertiary.main
  Box(modifier.size(size + if (selected) 8.dp else 0.dp), contentAlignment = Alignment.Center) {
    if (selected) Box(Modifier.size(size + 8.dp).border(2.dp, shell.ring, RoundedCornerShape(radius + 4.dp)))
    Box(
      Modifier.size(size).clip(shape).background(if (image != null) MaterialTheme.colorScheme.surfaceContainerLowest else fill),
      contentAlignment = Alignment.Center,
    ) {
      if (image != null) {
        Image(image, contentDescription = null, modifier = Modifier.size(size).padding(size * 0.12f), contentScale = ContentScale.Fit)
      } else {
        Text(
          workspaceInitials(name),
          color = readableOn(fill),
          fontWeight = FontWeight.SemiBold,
          fontSize = (size.value * if (workspaceInitials(name).length > 1) 0.36f else 0.42f).sp,
          maxLines = 1,
        )
      }
    }
    if (badge > 0) {
      Box(
        Modifier.align(Alignment.TopEnd).offset(x = 2.dp, y = (-2).dp).sizeIn(minWidth = 18.dp, minHeight = 18.dp)
          .clip(CircleShape).background(shell.badge).padding(horizontal = 4.dp),
        contentAlignment = Alignment.Center,
      ) {
        Text(if (badge > 99) "99+" else badge.toString(), color = shell.onBadge, fontSize = 10.sp, fontWeight = FontWeight.Bold, maxLines = 1)
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
