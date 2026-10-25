package com.aglyn.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
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
  /**
   * The sidebar column's ground: the surface (Plain), or with 5% of the accent blended in when the sidebar is Tinted
   * on a theme other than Aglyn's ([sidebarGround]). Only the sidebar column wears it.
   */
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

/**
 * The sidebar's ground beside the rail, the same rule as Apple's `AglynColor.sidebar`: the surface, with 5% of [accent]
 * mixed in (sRGB, opaque) when there is one to blend, that is when the sidebar style is Tinted and the theme is not the
 * console's own (the NavShell decides, [sidebarTinted]). Plain, the default, keeps the neutral surface.
 */
fun sidebarGround(surface: Color, accent: Color?): Color = if (accent == null) surface else Color(
  red = surface.red + (accent.red - surface.red) * SidebarTint,
  green = surface.green + (accent.green - surface.green) * SidebarTint,
  blue = surface.blue + (accent.blue - surface.blue) * SidebarTint,
)

/** How much of the accent a Tinted sidebar takes. */
const val SidebarTint = 0.05f

fun shellColors(scheme: ColorScheme, palette: AglynPalette, surfaces: ThemeSurfaces? = null, sidebarAccent: Color? = null): ShellColors {
  val dark = scheme.background.luminance() < 0.5f
  val rail = surfaces?.rail ?: lerp(scheme.background, palette.tertiary.main, if (dark) 0.18f else 0.07f)
  // A rail darker than the page it sits on (Ocean's) takes light ink.
  val onRail = if (rail.luminance() < 0.25f && !dark) Color.White.copy(alpha = 0.86f) else scheme.onSurfaceVariant
  return ShellColors(
    rail = rail,
    onRail = onRail,
    sidebar = sidebarGround(scheme.surfaceContainerLow, sidebarAccent),
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
  /** The sidebar's own inset around its rows (Figma Sidebar's Header and Rows padding). */
  val sidebarPad: androidx.compose.ui.unit.Dp = 8.dp,
  /** A top-level row's leading padding and the gap between its icon and text (Figma Sidebar/Row). */
  val rowPad: androidx.compose.ui.unit.Dp = 8.dp,
  val rowGap: androidx.compose.ui.unit.Dp = 8.dp,
  /** A group's rows sit this much further in than its heading, so what belongs to what reads at a glance. */
  val groupIndent: androidx.compose.ui.unit.Dp = 12.dp,
  /** A group heading's chevron, after its label. */
  val groupChevron: androidx.compose.ui.unit.Dp = 12.dp,
  /** A divider's room above and below its hairline. */
  val dividerPad: androidx.compose.ui.unit.Dp = 4.dp,
  /** A site's name in its own sidebar's title row, and a settings mode's title. */
  val siteTitleText: androidx.compose.ui.unit.TextUnit = 15.sp,
  val modeTitleText: androidx.compose.ui.unit.TextUnit = 17.sp,
  /** The workspace header's logo and its radius (Figma Sidebar, Scope = Workspace: 20 r5 Compact, 28 r8 Touch). */
  val workspaceLogo: androidx.compose.ui.unit.Dp = 20.dp,
  val workspaceLogoRadius: androidx.compose.ui.unit.Dp = 5.dp,
  /**
   * The rail's captions' line height and tracking, the hairline between its sections, the All workspaces tile (its box's
   * height, the gap to its total, the total's size and weight), the foot buttons' icon and the rail's foot padding (Figma
   * Rail 12:338: Compact 97:14728, Touch 12:295).
   */
  val railLabelLine: androidx.compose.ui.unit.TextUnit = 12.sp,
  val railLabelTracking: androidx.compose.ui.unit.TextUnit = 0.36.sp,
  val railDivider: androidx.compose.ui.unit.Dp = 24.dp,
  val allTileHeight: androidx.compose.ui.unit.Dp = 66.dp,
  val allTileGap: androidx.compose.ui.unit.Dp = 3.dp,
  val allTileTotal: androidx.compose.ui.unit.TextUnit = 10.sp,
  val allTileTotalBold: Boolean = true,
  val allTileIcon: androidx.compose.ui.unit.Dp = 16.dp,
  val utilityIcon: androidx.compose.ui.unit.Dp = 16.dp,
  val railFoot: androidx.compose.ui.unit.Dp = 12.dp,
)

val CompactShellMetrics = ShellMetrics(
  compact = true, railWidth = 56.dp, tile = 32.dp, tileRadius = 8.dp, badge = 14.dp, railLabel = 9.sp, tileGap = 8.dp, utility = 28.dp,
  sidebarWidth = 248.dp, row = 28.dp, rowText = 13.sp, rowIcon = 16.dp, pillRadius = 6.dp, rowInset = 8.dp, headerLogo = 20.dp,
  headerLogoRadius = 5.dp, titleBar = 52.dp, controlRadius = 6.dp, cardRadius = 10.dp, sheetRadius = 12.dp, barButton = 28.dp, barIcon = 16.dp,
  ringBox = 38.dp, ringRadius = 11.dp, selectionBar = 18.dp, utilityRadius = 6.dp, avatar = 24.dp, groupHeader = 24.dp, tileInitial = 13.sp,
  sidebarPad = 8.dp, rowPad = 8.dp, rowGap = 8.dp, groupIndent = 12.dp, groupChevron = 12.dp, dividerPad = 4.dp, siteTitleText = 15.sp, modeTitleText = 17.sp,
)

val TouchShellMetrics = ShellMetrics(
  compact = false, railWidth = 64.dp, tile = 40.dp, tileRadius = 10.dp, badge = 18.dp, railLabel = 11.sp, tileGap = 8.dp, utility = 36.dp,
  sidebarWidth = 248.dp, row = 36.dp, rowText = 15.sp, rowIcon = 18.dp, pillRadius = 8.dp, rowInset = 8.dp, headerLogo = 20.dp,
  headerLogoRadius = 6.dp, titleBar = 56.dp, controlRadius = 8.dp, cardRadius = 12.dp, sheetRadius = 16.dp, barButton = 40.dp, barIcon = 20.dp,
  ringBox = 48.dp, ringRadius = 14.dp, selectionBar = 24.dp, utilityRadius = 8.dp, avatar = 32.dp, groupHeader = 28.dp, tileInitial = 17.sp,
  sidebarPad = 12.dp, rowPad = 10.dp, rowGap = 10.dp, groupIndent = 12.dp, groupChevron = 14.dp, dividerPad = 6.dp, siteTitleText = 16.sp, modeTitleText = 18.sp,
  workspaceLogo = 28.dp, workspaceLogoRadius = 8.dp,
  railLabelLine = 16.sp, railLabelTracking = 0.6.sp, railDivider = 28.dp, allTileGap = 4.dp, allTileTotal = 12.sp, allTileTotalBold = false,
  allTileIcon = 18.dp, utilityIcon = 20.dp, railFoot = 16.dp,
)

val LocalShellMetrics = staticCompositionLocalOf { TouchShellMetrics }

/**
 * The shell's motion (Figma Motion 121:6163, timings 121:6714), the same on Apple and Android: drilling in and out of a scope
 * is a slide with a fade on a ~250 ms spring, a group folds in 200 ms, the selection pill moves on a 250 ms spring, another
 * workspace cross-fades in 150 ms. Reduce Motion keeps the cross-fades only.
 */
object ShellMotion {
  const val DRILL_MS = 250
  const val FOLD_MS = 200
  const val PILL_MS = 250
  const val CROSS_FADE_MS = 150
  /** How far a pushed (or uncovered) screen travels as it comes in (Figma Motion 121:6714; Apple's 40 pt, AGL-4009). */
  val PUSH_OFFSET = 40.dp
  /** How far a sheet or panel rises as it opens on the desktop, where its window does not move by itself (AGL-4013). */
  val SHEET_RISE = 16.dp
  /** The drill's spring: about 250 ms with a little bounce (SwiftUI's `.spring(duration: 0.25, bounce: 0.1)`). */
  fun <T> drill() = androidx.compose.animation.core.spring<T>(dampingRatio = 0.9f, stiffness = 632f)
  /** The pill's spring (`.spring(duration: 0.25, bounce: 0.15)`). */
  fun <T> pill() = androidx.compose.animation.core.spring<T>(dampingRatio = 0.85f, stiffness = 632f)
  fun <T> fold() = androidx.compose.animation.core.tween<T>(FOLD_MS, easing = androidx.compose.animation.core.FastOutSlowInEasing)
  fun <T> crossFade() = androidx.compose.animation.core.tween<T>(CROSS_FADE_MS)
}

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
