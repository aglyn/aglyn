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
import androidx.compose.ui.unit.sp

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

/**
 * The shell's sizes for the kind of window it is in (the Figma Rail / Sidebar components' Size variant): Compact on the
 * desktop (pointer, Mac-native sizes), Touch on tablets. Phones have no rail and keep their own sizes.
 */
@Immutable
data class ShellMetrics(
  val compact: Boolean,
  val railWidth: androidx.compose.ui.unit.Dp,
  /** A workspace tile, and its corner radius. */
  val tile: androidx.compose.ui.unit.Dp,
  val tileRadius: androidx.compose.ui.unit.Dp,
  val badge: androidx.compose.ui.unit.Dp,
  /** The rail's section labels (PINNED, RECENT), in caps. */
  val railLabel: androidx.compose.ui.unit.TextUnit,
  val tileGap: androidx.compose.ui.unit.Dp,
  /** Create new and the account photo at the rail's foot. */
  val utility: androidx.compose.ui.unit.Dp,
  val sidebarWidth: androidx.compose.ui.unit.Dp,
  /** A sidebar row: height, text, icon, its selected pill's radius and the inset around it. */
  val row: androidx.compose.ui.unit.Dp,
  val rowText: androidx.compose.ui.unit.TextUnit,
  val rowIcon: androidx.compose.ui.unit.Dp,
  val pillRadius: androidx.compose.ui.unit.Dp,
  val rowInset: androidx.compose.ui.unit.Dp,
  /** The workspace / site header's logo and its radius. */
  val headerLogo: androidx.compose.ui.unit.Dp,
  val headerLogoRadius: androidx.compose.ui.unit.Dp,
  val titleBar: androidx.compose.ui.unit.Dp,
  /** Controls (buttons, fields, the search box), cards, and sheets or popovers. */
  val controlRadius: androidx.compose.ui.unit.Dp,
  val cardRadius: androidx.compose.ui.unit.Dp,
  val sheetRadius: androidx.compose.ui.unit.Dp,
  /** A title-bar icon button and its icon. */
  val barButton: androidx.compose.ui.unit.Dp,
  val barIcon: androidx.compose.ui.unit.Dp,
  /** The selected tile's ring box and radius, and the rail's left bar beside it. */
  val ringBox: androidx.compose.ui.unit.Dp,
  val ringRadius: androidx.compose.ui.unit.Dp,
  val selectionBar: androidx.compose.ui.unit.Dp,
  /** Create new's corner radius, and the account photo. */
  val utilityRadius: androidx.compose.ui.unit.Dp,
  val avatar: androidx.compose.ui.unit.Dp,
  /** A sidebar group's heading row, and a tile's initials. */
  val groupHeader: androidx.compose.ui.unit.Dp,
  val tileInitial: androidx.compose.ui.unit.TextUnit,
)

val CompactShellMetrics = ShellMetrics(
  compact = true, railWidth = 56.dp, tile = 32.dp, tileRadius = 8.dp, badge = 14.dp, railLabel = 9.sp, tileGap = 8.dp, utility = 28.dp,
  sidebarWidth = 248.dp, row = 28.dp, rowText = 13.sp, rowIcon = 16.dp, pillRadius = 6.dp, rowInset = 8.dp, headerLogo = 20.dp,
  headerLogoRadius = 5.dp, titleBar = 52.dp, controlRadius = 6.dp, cardRadius = 10.dp, sheetRadius = 12.dp, barButton = 28.dp, barIcon = 16.dp,
  ringBox = 38.dp, ringRadius = 11.dp, selectionBar = 18.dp, utilityRadius = 6.dp, avatar = 24.dp, groupHeader = 24.dp, tileInitial = 13.sp,
)

val TouchShellMetrics = ShellMetrics(
  compact = false, railWidth = 64.dp, tile = 40.dp, tileRadius = 10.dp, badge = 18.dp, railLabel = 10.sp, tileGap = 8.dp, utility = 36.dp,
  sidebarWidth = 256.dp, row = 36.dp, rowText = 15.sp, rowIcon = 18.dp, pillRadius = 8.dp, rowInset = 8.dp, headerLogo = 24.dp,
  headerLogoRadius = 6.dp, titleBar = 56.dp, controlRadius = 8.dp, cardRadius = 12.dp, sheetRadius = 16.dp, barButton = 40.dp, barIcon = 20.dp,
  ringBox = 48.dp, ringRadius = 14.dp, selectionBar = 22.dp, utilityRadius = 10.dp, avatar = 32.dp, groupHeader = 32.dp, tileInitial = 16.sp,
)

val LocalShellMetrics = staticCompositionLocalOf { TouchShellMetrics }

/** The desktop's radii (Compact): fields and controls 6, cards 10, menus, sheets and dialogs 12. */
val CompactShapes = androidx.compose.material3.Shapes(
  extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(6.dp),
  small = androidx.compose.foundation.shape.RoundedCornerShape(6.dp),
  medium = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
  large = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
  extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
)

/** The shell's sizes in effect. */
val shellMetrics: ShellMetrics
  @Composable @ReadOnlyComposable get() = LocalShellMetrics.current

/**
 * A button's shape in the window it is in: the Compact density's 6 dp corners on the desktop (Figma Button, Density =
 * Compact), the Touch pill elsewhere.
 */
@Composable
fun controlShape(): androidx.compose.ui.graphics.Shape {
  val metrics = LocalShellMetrics.current
  return if (metrics.compact) androidx.compose.foundation.shape.RoundedCornerShape(metrics.controlRadius) else androidx.compose.material3.ButtonDefaults.shape
}
