package com.aglyn.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBarItemColors
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/*
 * The phone's bold brand look (AGL-3990), as shared pieces the phone shell adopts. Each draws its bold form only inside
 * [PhoneTheme] on a phone in the brand's look (the Aglyn theme in the brand blue), and its everyday form otherwise, so a
 * tablet, the desktop and the POS register never change. Figma: the Native App file's Phone page (2:7), whose frames carry
 * the Theme mode "Aglyn · phone (bold) 10/19".
 */

/**
 * The phone's theme: inside it, in the brand's look ([LocalBrandLook]) and when [enabled] (a phone, never the desktop's
 * narrow window), the grounds are [phoneBoldSurfaces] and [LocalPhoneBold] is on; otherwise [content] draws as it was.
 */
@Composable
fun PhoneTheme(enabled: Boolean = true, content: @Composable () -> Unit) {
  if (!enabled || !LocalBrandLook.current) {
    CompositionLocalProvider(LocalPhoneBold provides false, content = content)
    return
  }
  val dark = LocalAglynDark.current
  val surfaces = phoneBoldSurfaces(dark)
  val accent = LocalAccent.current
  val scheme = themedColorScheme(if (dark) AglynDarkColorScheme else AglynLightColorScheme, surfaces, accent, dark)
  val palette = themedPalette(if (dark) AglynTokens.dark else AglynTokens.light, surfaces, accent)
  CompositionLocalProvider(
    LocalThemeSurfaces provides surfaces,
    LocalAglynPalette provides palette,
    LocalPhoneBold provides true,
  ) {
    MaterialTheme(colorScheme = scheme, typography = MaterialTheme.typography, shapes = MaterialTheme.shapes, content = content)
  }
}

/** The brand gradient, 242° #00B0FF → #7A5CF0 at 55% → #E040FB (Figma `Brand/Gradient 242°`), across [box]. */
fun brandGradientBrush(box: Rect, alpha: Float = 1f): Brush {
  val (start, end) = FacetsLayout.gradientLine(box)
  val stops = AuthTokens.GRADIENT_STOPS.map { (argb, at) -> at to Color(argb).copy(alpha = alpha) }.toTypedArray()
  return Brush.linearGradient(*stops, start = start, end = end)
}

/**
 * The brand's soft glow behind the phone's top bar and title, in the bold look (Figma "Header glow": a 640 by 300 dp
 * ellipse of the gradient centered on the screen's top edge, blurred, at 30% in light and 42% in dark). Drawn as the
 * ellipse with a soft falloff, which every Android version draws the same. Put it first in a box that fills the screen.
 */
@Composable
fun PhoneHeaderGlow(modifier: Modifier = Modifier) {
  if (!LocalPhoneBold.current) return
  val opacity = if (LocalAglynDark.current) 0.42f else 0.30f
  // Tall enough for the glow's lower half and its blur: 150 + 80 dp under the screen's top edge.
  Canvas(modifier.fillMaxWidth().height(240.dp).graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen; alpha = opacity }.testTag("phone-header-glow")) {
    val blur = 80.dp.toPx()
    val w = 640.dp.toPx() + blur * 2
    val h = 300.dp.toPx() + blur * 2
    val box = Rect(Offset(size.width / 2 - w / 2, -h / 2), Size(w, h))
    drawOval(brandGradientBrush(box), topLeft = box.topLeft, size = box.size)
    // The blur: the ellipse fades out across the blur's width on both sides of its edge.
    scale(scaleX = 1f, scaleY = h / w, pivot = box.center) {
      drawCircle(
        Brush.radialGradient(0f to Color.Black, 0.5f to Color.Black, 1f to Color.Transparent, center = box.center, radius = w / 2),
        radius = w / 2, center = box.center, blendMode = BlendMode.DstIn,
      )
    }
  }
}

/** The phone's tab bar items (Figma Phone/Tab item): in the bold look the tab in use is a #00B0FF indicator with a white icon. */
@Composable
fun phoneTabItemColors(): NavigationBarItemColors {
  val scheme = MaterialTheme.colorScheme
  if (!LocalPhoneBold.current) {
    return NavigationBarItemDefaults.colors(
      indicatorColor = scheme.primaryContainer,
      selectedIconColor = scheme.onPrimaryContainer,
      selectedTextColor = scheme.onPrimaryContainer,
    )
  }
  val accent = LocalAccent.current
  val muted = LocalThemeSurfaces.current?.textTertiary ?: scheme.onSurfaceVariant
  return NavigationBarItemDefaults.colors(
    indicatorColor = accent?.fill ?: scheme.primary,
    selectedIconColor = accent?.onFill ?: scheme.onPrimary,
    selectedTextColor = aglynAccentText,
    unselectedIconColor = muted,
    unselectedTextColor = muted,
  )
}

/** The phone's tab bar ground: the white surface in the bold look (Figma Phone/Tab bar), [fallback] otherwise. */
@Composable
fun phoneTabBarColor(fallback: Color): Color = if (LocalPhoneBold.current) LocalThemeSurfaces.current?.surface ?: fallback else fallback

/** The scope chip's ground on the tinted header: raised with a hairline in the bold look (Figma Phone/Scope chip), [fallback] otherwise. */
@Composable
fun phoneChipColor(fallback: Color): Color = if (LocalPhoneBold.current) LocalThemeSurfaces.current?.raised ?: fallback else fallback

/** The scope chip's hairline in the bold look; none otherwise. */
@Composable
fun phoneChipBorder(): androidx.compose.foundation.BorderStroke? =
  if (LocalPhoneBold.current) LocalThemeSurfaces.current?.let { androidx.compose.foundation.BorderStroke(1.dp, it.borderSubtle) } else null

/** Create new's tile in the tab bar: a white "+" on a 40 by 32 dp tile, radius 12; the brand gradient with its glow in the bold look. */
@Composable
fun PhoneCreateTile(modifier: Modifier = Modifier, contentDescription: String = "Create new") {
  val shape = RoundedCornerShape(12.dp)
  if (LocalPhoneBold.current) {
    val glow = Color(0x597A5CF0)
    Box(
      modifier.size(40.dp, 32.dp).shadow(8.dp, shape, ambientColor = glow, spotColor = glow).clip(shape)
        .drawBehind { drawRect(brandGradientBrush(Rect(Offset.Zero, size))) },
      contentAlignment = Alignment.Center,
    ) {
      Icon(AglynIcons.named("add"), contentDescription = contentDescription, tint = Color.White)
    }
  } else {
    Surface(shape = shape, color = MaterialTheme.colorScheme.primary, contentColor = MaterialTheme.colorScheme.onPrimary, modifier = modifier.size(40.dp, 32.dp)) {
      Box(contentAlignment = Alignment.Center) { Icon(AglynIcons.named("add"), contentDescription = contentDescription) }
    }
  }
}

/** A phone Menu row's leading icon in the bold look: the glyph in the accent's text shade on a 30 dp tile of its wash, radius 8 (Figma Phone/List row). */
@Composable
fun PhoneRowTile(icon: String, modifier: Modifier = Modifier) {
  val accent = LocalAccent.current
  Box(
    modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(accent?.soft ?: MaterialTheme.colorScheme.primaryContainer),
    contentAlignment = Alignment.Center,
  ) {
    Icon(AglynIcons.named(icon), contentDescription = null, modifier = Modifier.size(18.dp), tint = aglynAccentText)
  }
}

/** The AI entry's sparkle: the brand gradient in the bold look (Figma's ✦), the accent's icon shade otherwise. */
@Composable
fun AIGlyph(modifier: Modifier = Modifier, size: androidx.compose.ui.unit.Dp = 20.dp, contentDescription: String? = null) {
  val icon = AglynIcons.named("auto_awesome")
  if (LocalPhoneBold.current) {
    Icon(
      icon, contentDescription,
      modifier.size(size).graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
        .drawWithBrandGradient(),
      tint = Color.Black,
    )
  } else {
    Icon(icon, contentDescription, modifier.size(size), tint = LocalAccent.current?.icon ?: MaterialTheme.colorScheme.primary)
  }
}

/** Paints what is drawn in the brand gradient (the gradient kept where the content is). */
private fun Modifier.drawWithBrandGradient(): Modifier = drawWithContent {
  drawContent()
  drawRect(brandGradientBrush(Rect(Offset.Zero, size)), blendMode = BlendMode.SrcIn)
}
