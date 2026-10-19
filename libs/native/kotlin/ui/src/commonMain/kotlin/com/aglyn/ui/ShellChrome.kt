package com.aglyn.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.unit.dp

/**
 * The navigation shell's colors (the rail, the sidebar, the title bar, badges and the color picks), derived once from
 * the theme's tokens so no screen types a color of its own. The Theme setting (Phase 4) swaps the scheme they derive from.
 */
@Immutable
data class ShellColors(
  /** The workspace rail's ground: the page tinted toward the brand slate. */
  val rail: Color,
  val onRail: Color,
  /** The sidebar's ground. */
  val sidebar: Color,
  /** The title bar above the main area. */
  val titleBar: Color,
  val selected: Color,
  val onSelected: Color,
  /** An unread count on a rail tile or a row. */
  val badge: Color,
  val onBadge: Color,
  /** The ring around the rail tile of the workspace on screen. */
  val ring: Color,
  val divider: Color,
  /**
   * The colors a person can pick for a workspace (and a starred item's dot), in the picker's order: the brand blue,
   * violet and pink, green, orange, red, yellow and slate.
   */
  val picks: List<Color>,
)

/** The brand gradient's middle stop (242°, #00B0FF → #7A5CF0 → #E040FB), the only brand color with no palette intent. */
private val BrandViolet = Color(0xFF7A5CF0)

fun shellColors(scheme: ColorScheme, palette: AglynPalette, surfaces: ThemeSurfaces? = null): ShellColors {
  val dark = scheme.background.luminance() < 0.5f
  val rail = surfaces?.rail ?: lerp(scheme.background, palette.tertiary.main, if (dark) 0.18f else 0.07f)
  // A rail darker than the page it sits on (Ocean's) takes light ink.
  val onRail = if (rail.luminance() < 0.25f && !dark) Color.White.copy(alpha = 0.86f) else scheme.onSurfaceVariant
  return ShellColors(
    rail = rail,
    onRail = onRail,
    sidebar = scheme.surfaceContainerLow,
    titleBar = surfaces?.titleBar ?: scheme.surfaceContainerLow,
    selected = scheme.primaryContainer,
    onSelected = scheme.onPrimaryContainer,
    badge = palette.secondary.main,
    onBadge = palette.secondary.contrastText,
    ring = scheme.primary,
    divider = scheme.outlineVariant,
    picks = listOf(
      palette.primary.main,
      BrandViolet,
      palette.secondary.main,
      palette.success.text,
      palette.warning.text,
      palette.error.main,
      palette.warning.main,
      palette.tertiary.main,
    ),
  )
}

val LocalShellColors = staticCompositionLocalOf { shellColors(AglynLightColorScheme, AglynTokens.light) }

/** The shell's colors in effect. */
val shellColors: ShellColors
  @Composable @ReadOnlyComposable get() = LocalShellColors.current

/** A workspace color as the light tint the app wears while that workspace is on screen. */
fun workspaceTint(color: Color, over: Color, dark: Boolean): Color = color.copy(alpha = if (dark) 0.16f else 0.08f).compositeOver(over)

/** Text that reads on [background]: the theme's own dark or light ink, whichever contrasts more. */
@Composable
fun readableOn(background: Color): Color {
  val scheme = MaterialTheme.colorScheme
  val darkInk = if (scheme.background.luminance() < 0.5f) scheme.background else scheme.onBackground
  val lightInk = if (scheme.background.luminance() < 0.5f) scheme.onBackground else scheme.background
  return if (background.luminance() > 0.45f) darkInk else lightInk
}

/** `#RRGGBB` for a color, as account preferences store a pick. */
fun Color.toHex(): String {
  fun part(value: Float) = (value * 255 + 0.5f).toInt().coerceIn(0, 255).toString(16).padStart(2, '0').uppercase()
  return "#" + part(red) + part(green) + part(blue)
}

/** A `#RRGGBB` string as a color; null when it is not one. */
fun colorOfHex(hex: String?): Color? {
  if (hex == null || !Regex("^#[0-9A-Fa-f]{6}$").matches(hex)) return null
  return Color(0xFF000000 or hex.substring(1).toLong(16))
}

/** The rail's width, as the design draws it. */
val RailWidth = 68.dp

/** The sidebar's width. */
val SidebarWidth = 248.dp
