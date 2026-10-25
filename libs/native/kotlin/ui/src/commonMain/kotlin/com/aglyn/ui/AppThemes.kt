package com.aglyn.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import com.aglyn.contracts.AppDensity
import com.aglyn.contracts.AppThemeName
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ThemeColors
import com.aglyn.contracts.ThemeDensity
import com.aglyn.contracts.ThemeDensityId
import com.aglyn.contracts.ThemePaletteId
import com.aglyn.contracts.themeContrast
import com.aglyn.contracts.themePalette

/*
 * Whole-app theming (AGL-3946 Phase 4). The palettes, named accents, swatches and densities are the contract's
 * (native-themes.ts, AGL-3950: Figma's Native App variables, Ocean and Warm derived from their previews), and so is the
 * accent derivation; this file only turns them into Compose colors. The brand's own theme's palette comes from the
 * console's scheme, and its "Theme" accent IS the console's primary (#00B0FF under white, #0077AD / #4DC8FF as text),
 * so the default look is the console's.
 */

/** A theme's grounds, lines, inks and status pairs, for one appearance. */
@Immutable
data class ThemeSurfaces(
  val canvas: Color,
  val surface: Color,
  val raised: Color,
  val sunken: Color,
  val rail: Color,
  val hover: Color,
  val titleBar: Color,
  val borderSubtle: Color,
  val borderStrong: Color,
  val textPrimary: Color,
  val textSecondary: Color,
  val textTertiary: Color,
  val successBg: Color,
  val successFg: Color,
  val warningBg: Color,
  val warningFg: Color,
  val dangerBg: Color,
  val dangerFg: Color,
  val infoBg: Color,
  val infoFg: Color,
  val newBg: Color,
  val newFg: Color,
  val scrim: Color,
  val dangerFill: Color,
)

/** A contract color (`#RRGGBB` or `#RRGGBBAA`) as a Compose color; transparent when it is neither. */
fun themeColor(hex: String): Color {
  val digits = hex.removePrefix("#")
  val value = digits.toLongOrNull(16) ?: return Color.Transparent
  return when (digits.length) {
    6 -> Color(0xFF000000 or value)
    8 -> Color(((value and 0xFF) shl 24) or (value ushr 8))
    else -> Color.Transparent
  }
}

private fun ThemeColors.toSurfaces() = ThemeSurfaces(
  canvas = themeColor(canvas), surface = themeColor(surface), raised = themeColor(raised), sunken = themeColor(sunken),
  rail = themeColor(rail), hover = themeColor(hover), titleBar = themeColor(titlebar), borderSubtle = themeColor(borderSubtle),
  borderStrong = themeColor(borderStrong), textPrimary = themeColor(textPrimary), textSecondary = themeColor(textSecondary),
  textTertiary = themeColor(textTertiary), successBg = themeColor(successBg), successFg = themeColor(successFg),
  warningBg = themeColor(warningBg), warningFg = themeColor(warningFg), dangerBg = themeColor(dangerBg), dangerFg = themeColor(dangerFg),
  infoBg = themeColor(infoBg), infoFg = themeColor(infoFg), newBg = themeColor(newBg), newFg = themeColor(newFg),
  scrim = themeColor(scrim), dangerFill = themeColor(dangerFill),
)

private val surfacesById: Map<ThemePaletteId, Pair<ThemeSurfaces, ThemeSurfaces>> by lazy {
  Contracts.themePalettes.associate { it.id to (it.light.toSurfaces() to it.dark.toSurfaces()) }
}

/** The theme's grounds for [dark]; an unknown theme reads as the brand's own (THEME_PALETTES.aglyn, from the console's scheme). */
fun themeSurfaces(theme: AppThemeName, dark: Boolean): ThemeSurfaces? {
  val palette = themePalette(theme.raw)
  val (light, darkSurfaces) = surfacesById[palette.id] ?: return null
  return if (dark || palette.alwaysDark == true) darkSurfaces else light
}

/** Whether [theme] is dark whatever the appearance says (Night). */
fun themeIsAlwaysDark(theme: AppThemeName): Boolean = themePalette(theme.raw).alwaysDark == true

/** The color a theme's "Theme" accent stands for: its own (Ocean's teal, Warm's rust), else the Aglyn blue. */
fun themeAccentSeed(theme: AppThemeName): Color = themeColor(themePalette(theme.raw).accent)

/** The accent swatches the Theme settings offer, in Figma's order: Aglyn blue, Sky, Violet, Pink, Green, Warm. */
val ACCENT_SWATCHES: List<Pair<String, Color>> get() = Contracts.themeAccentSwatches.map { it.label to themeColor(it.color) }

// ── Accent ──────────────────────────────────────────────────────────────────

/** An accent worked out from one color: the fill a button wears, the ink on it, its hover and pressed fills, and more. */
@Immutable
data class AccentColors(
  /** The raw color: focus rings and the rail's ring around the workspace on screen. */
  val ring: Color,
  val fill: Color,
  val onFill: Color,
  val fillHover: Color,
  val fillPressed: Color,
  /** A light wash for selected rows and chips. */
  val soft: Color,
  /** The accent as text on the page: links, the selected row's label. */
  val text: Color,
  /** The accent as an icon or an indicator (3:1). */
  val icon: Color,
)

/** WCAG contrast ratio of two opaque colors. */
fun contrastRatio(a: Color, b: Color): Float = themeContrast(a.toHex(), b.toHex()).toFloat()

/** The contract's accent for [raw] (`deriveAccent`), the text shade for [dark]. */
fun deriveAccent(raw: Color, dark: Boolean): AccentColors {
  val accent = com.aglyn.contracts.deriveAccent(raw.toHex()) ?: com.aglyn.contracts.deriveAccent("#00b0ff")!!
  return AccentColors(
    ring = themeColor(accent.ring),
    fill = themeColor(accent.fill),
    onFill = themeColor(accent.on),
    fillHover = themeColor(accent.hover),
    fillPressed = themeColor(accent.pressed),
    soft = themeColor(accent.soft),
    text = themeColor(if (dark) accent.textDark else accent.textLight),
    icon = themeColor(accent.icon),
  )
}

// ── Density ─────────────────────────────────────────────────────────────────

/** The row and bar heights the density setting picks between (the contract's THEME_DENSITIES). */
@Immutable
data class UiDensity(
  val compact: Boolean,
  /** A sidebar or menu row. */
  val row: Float,
  /** A list row with a second line. */
  val listRow: Float,
  /** A phone list row. */
  val phoneRow: Float,
  val titleBar: Float,
)

private fun ThemeDensity.toUi() = UiDensity(
  compact = id == ThemeDensityId.COMPACT,
  row = rowHeight.toFloat(),
  listRow = listRowHeight.toFloat(),
  phoneRow = phoneRowHeight.toFloat(),
  titleBar = titlebarHeight.toFloat(),
)

val ComfortableDensity: UiDensity by lazy { Contracts.themeDensities.first { it.id == ThemeDensityId.COMFORTABLE }.toUi() }
val CompactDensity: UiDensity by lazy { Contracts.themeDensities.first { it.id == ThemeDensityId.COMPACT }.toUi() }

fun uiDensityOf(density: AppDensity): UiDensity = if (density == AppDensity.COMPACT) CompactDensity else ComfortableDensity

val LocalUiDensity = staticCompositionLocalOf { ComfortableDensity }

/** The theme's grounds in effect. */
val LocalThemeSurfaces = staticCompositionLocalOf<ThemeSurfaces?> { null }

/** The accent in effect. */
val LocalAccent = staticCompositionLocalOf<AccentColors?> { null }

/**
 * The accent AS TEXT on the page: a link, a text or outlined button's label, a tab's label (AGL-3990). It is the
 * console's `primary.dark` per scheme (#0077AD light, #4DC8FF dark for the brand blue, AGL-1186), never the fill:
 * Material's `primary` is the brand blue #00B0FF, a fill and an indicator, 2.43:1 as text on white.
 */
val aglynAccentText: Color
  @Composable @ReadOnlyComposable get() = LocalAccent.current?.text ?: MaterialTheme.colorScheme.primary

/**
 * Whether the row a view sits in is selected. A tile or a status chip on the selection's wash takes the paper with a
 * ring so it stands off the wash (Figma List/Order row Selected 11:343, AGL-3990).
 */
val LocalRowSelected = compositionLocalOf { false }

// ── On Material 3 ───────────────────────────────────────────────────────────

/** [base] with a theme's grounds (when it has its own) and an accent laid over it. */
fun themedColorScheme(base: ColorScheme, surfaces: ThemeSurfaces?, accent: AccentColors?, dark: Boolean): ColorScheme {
  var scheme = base
  if (surfaces != null) {
    scheme = scheme.copy(
      background = surfaces.canvas,
      onBackground = surfaces.textPrimary,
      surface = surfaces.canvas,
      onSurface = surfaces.textPrimary,
      surfaceVariant = surfaces.sunken,
      onSurfaceVariant = surfaces.textSecondary,
      surfaceContainerLowest = surfaces.surface,
      surfaceContainerLow = surfaces.surface,
      surfaceContainer = surfaces.raised,
      surfaceContainerHigh = surfaces.hover,
      surfaceContainerHighest = lerp(surfaces.hover, surfaces.borderSubtle, 0.5f),
      surfaceBright = surfaces.raised,
      surfaceDim = surfaces.sunken,
      outline = surfaces.borderStrong,
      outlineVariant = surfaces.borderSubtle,
      error = surfaces.dangerFill,
      errorContainer = surfaces.dangerBg,
      onErrorContainer = surfaces.dangerFg,
      scrim = surfaces.scrim,
      inverseSurface = surfaces.textPrimary,
      inverseOnSurface = surfaces.canvas,
    )
  }
  if (accent != null) {
    val ground = surfaces?.surface ?: base.surfaceContainerLowest
    scheme = scheme.copy(
      primary = accent.fill,
      onPrimary = accent.onFill,
      primaryContainer = accent.soft.compositeOver(ground),
      onPrimaryContainer = accent.text,
      inversePrimary = accent.ring,
      surfaceTint = accent.fill,
    )
  }
  return scheme
}

/** [base]'s status colors from a theme's pairs, so a badge or banner matches the theme. */
fun themedPalette(base: AglynPalette, surfaces: ThemeSurfaces?, accent: AccentColors?): AglynPalette {
  var palette = base
  if (surfaces != null) {
    palette = palette.copy(
      error = palette.error.copy(text = surfaces.dangerFg),
      warning = palette.warning.copy(text = surfaces.warningFg),
      success = palette.success.copy(text = surfaces.successFg),
      info = palette.info.copy(text = surfaces.infoFg),
      background = surfaces.canvas,
      paper = surfaces.surface,
      textPrimary = surfaces.textPrimary,
      textSecondary = surfaces.textSecondary,
      textDisabled = surfaces.textTertiary,
      divider = surfaces.borderSubtle,
    )
  }
  if (accent != null) {
    palette = palette.copy(primary = AglynIntent(main = accent.fill, contrastText = accent.onFill, text = accent.text, pressed = accent.fillPressed))
  }
  return palette
}
