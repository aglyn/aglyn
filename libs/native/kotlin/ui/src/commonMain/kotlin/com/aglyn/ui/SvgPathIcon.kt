package com.aglyn.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * The shape of an SVG path (`M…`): a Material Design icon's `iconPath`, which a component stores, or null for a string no path
 * parser reads. The icons are 24 units square.
 */
fun svgPathOf(data: String?): Path? =
  data?.takeIf { it.isNotBlank() }?.let { runCatching { PathParser().parsePathString(it).toPath() }.getOrNull() }

/** A Material Design icon drawn from its SVG path, at [size] and in [tint]; nothing is drawn for a path that does not parse. */
@Composable
fun SvgPathIcon(
  path: String?,
  contentDescription: String?,
  modifier: Modifier = Modifier,
  size: Dp = 24.dp,
  tint: Color = LocalContentColor.current,
) {
  val shape = remember(path) { svgPathOf(path) }
  Canvas(modifier.size(size).semantics { if (contentDescription != null) this.contentDescription = contentDescription }) {
    val drawn = shape ?: return@Canvas
    val scale = this.size.width / 24f
    withTransform({ scale(scale, scale, Offset.Zero) }) { drawPath(drawn, tint) }
  }
}
