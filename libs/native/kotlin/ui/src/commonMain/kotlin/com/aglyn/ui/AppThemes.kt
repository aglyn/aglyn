package com.aglyn.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import com.aglyn.contracts.AppDensity
import com.aglyn.contracts.AppThemeName
import kotlin.math.max
import kotlin.math.min

/*
 * Whole-app theming (AGL-3946 Phase 4). The Aglyn theme is the console's generated tokens untouched; Quiet, Night and High
 * contrast carry the Figma "Aglyn / Theme" variable modes (Native App file, Themes 2:8); Ocean and Warm start from their
 * Figma previews and fill the rest from Aglyn's. Accents are worked out from one color, contrast-checked.
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
)

private fun hex(value: Long) = Color(0xFF000000 or value)
private fun hexA(value: Long) = Color(value)

private val AGLYN_LIGHT = ThemeSurfaces(
  canvas = hex(0xF5F5F5), surface = hex(0xFFFFFF), raised = hex(0xFFFFFF), sunken = hex(0xEDF0F4), rail = hex(0xE6EAF0),
  hover = hex(0xEEF1F5), titleBar = hex(0xFAFBFC), borderSubtle = hex(0xE3E7EC), borderStrong = hex(0xC8D0D9),
  textPrimary = hex(0x1F2329), textSecondary = hex(0x5E6773), textTertiary = hex(0x7A838E),
  successBg = hex(0xE5F3E6), successFg = hex(0x2E6F31), warningBg = hex(0xFFF0DA), warningFg = hex(0x85560F),
  dangerBg = hex(0xFCE6E5), dangerFg = hex(0xA8231E), infoBg = hex(0xE3F0FB), infoFg = hex(0x10548F),
  newBg = hex(0xF5E4F9), newFg = hex(0x8E2AA1), scrim = hexA(0x520F1721),
)

private val AGLYN_DARK = ThemeSurfaces(
  canvas = hex(0x161C21), surface = hex(0x1E262E), raised = hex(0x27313B), sunken = hex(0x12181D), rail = hex(0x0F1418),
  hover = hex(0x2A343E), titleBar = hex(0x1A2128), borderSubtle = hex(0x2E3944), borderStrong = hex(0x45525F),
  textPrimary = hex(0xF3F5F7), textSecondary = hex(0xB3BCC6), textTertiary = hex(0x8A96A3),
  successBg = hex(0x1B3320), successFg = hex(0x82C785), warningBg = hex(0x3A2C14), warningFg = hex(0xFFC479),
  dangerBg = hex(0x3B1A1A), dangerFg = hex(0xED7876), infoBg = hex(0x132C42), infoFg = hex(0x5DA1DC),
  newBg = hex(0x3A1E44), newFg = hex(0xE979FC), scrim = hexA(0x8C000000),
)

private val QUIET_LIGHT = AGLYN_LIGHT.copy(
  canvas = hex(0xF4F4F2), sunken = hex(0xECECE9), rail = hex(0xEAEAE7), hover = hex(0xEFEFEC), titleBar = hex(0xFAFAF8),
  borderSubtle = hex(0xE2E2DE), borderStrong = hex(0xCBCBC5), textPrimary = hex(0x222220), textSecondary = hex(0x5F5F5A),
  textTertiary = hex(0x7C7C76),
)

private val QUIET_DARK = AGLYN_DARK.copy(
  canvas = hex(0x1A1A19), surface = hex(0x222221), raised = hex(0x2B2B29), sunken = hex(0x141413), rail = hex(0x121211),
  hover = hex(0x30302E), titleBar = hex(0x1E1E1D), borderSubtle = hex(0x353533), borderStrong = hex(0x4A4A47),
  textPrimary = hex(0xF2F2EF), textSecondary = hex(0xB5B5AF), textTertiary = hex(0x8E8E88),
)

/** Night is dark in either appearance. */
private val NIGHT = ThemeSurfaces(
  canvas = hex(0x0B1120), surface = hex(0x121A2B), raised = hex(0x1A2337), sunken = hex(0x070C17), rail = hex(0x050913),
  hover = hex(0x1E2840), titleBar = hex(0x0E1525), borderSubtle = hex(0x222C42), borderStrong = hex(0x33405C),
  textPrimary = hex(0xEEF2FA), textSecondary = hex(0xA9B4CB), textTertiary = hex(0x8290AB),
  successBg = hex(0x12301F), successFg = hex(0x7BCB8F), warningBg = hex(0x352914), warningFg = hex(0xF6BE6E),
  dangerBg = hex(0x3A1820), dangerFg = hex(0xF08A8F), infoBg = hex(0x122A47), infoFg = hex(0x79B2EE),
  newBg = hex(0x36193F), newFg = hex(0xE68AF6), scrim = hexA(0x99000000),
)

private val HIGH_CONTRAST_LIGHT = ThemeSurfaces(
  canvas = hex(0xFFFFFF), surface = hex(0xFFFFFF), raised = hex(0xFFFFFF), sunken = hex(0xF0F0F0), rail = hex(0xEFEFEF),
  hover = hex(0xE4E4E4), titleBar = hex(0xFFFFFF), borderSubtle = hex(0x6B6B6B), borderStrong = hex(0x000000),
  textPrimary = hex(0x000000), textSecondary = hex(0x1F1F1F), textTertiary = hex(0x3D3D3D),
  successBg = hex(0xDDF3DE), successFg = hex(0x0B4D10), warningBg = hex(0xFFE9C7), warningFg = hex(0x5C3A00),
  dangerBg = hex(0xFADBD9), dangerFg = hex(0x7A0F0B), infoBg = hex(0xDDEBFA), infoFg = hex(0x0A3A66),
  newBg = hex(0xF1DDF6), newFg = hex(0x5E0F70), scrim = hexA(0x80000000),
)

private val HIGH_CONTRAST_DARK = ThemeSurfaces(
  canvas = hex(0x000000), surface = hex(0x000000), raised = hex(0x0A0A0A), sunken = hex(0x141414), rail = hex(0x0F0F0F),
  hover = hex(0x262626), titleBar = hex(0x000000), borderSubtle = hex(0x9A9A9A), borderStrong = hex(0xFFFFFF),
  textPrimary = hex(0xFFFFFF), textSecondary = hex(0xEDEDED), textTertiary = hex(0xC7C7C7),
  successBg = hex(0x0B2A0E), successFg = hex(0x9BE7A0), warningBg = hex(0x2E2000), warningFg = hex(0xFFD08A),
  dangerBg = hex(0x330B0A), dangerFg = hex(0xFF9E9B), infoBg = hex(0x0A2340), infoFg = hex(0x9CCBFF),
  newBg = hex(0x2E0B38), newFg = hex(0xF2A8FF), scrim = hexA(0xB2000000),
)

/** Ocean and Warm from their four preview colors (canvas, surface, rail, accent); everything else leans on Aglyn's. */
private fun fromPreview(base: ThemeSurfaces, canvas: Color, surface: Color, rail: Color, dark: Boolean): ThemeSurfaces {
  val ground = if (dark) lerp(base.canvas, rail, 0.22f) else canvas
  val top = if (dark) lerp(base.surface, rail, 0.18f) else surface
  return base.copy(
    canvas = ground,
    surface = top,
    raised = if (dark) lerp(base.raised, rail, 0.18f) else surface,
    sunken = lerp(ground, rail, if (dark) 0.35f else 0.25f),
    rail = if (dark) lerp(base.rail, rail, 0.45f) else rail,
    hover = lerp(top, rail, 0.10f),
    titleBar = lerp(top, ground, 0.35f),
    borderSubtle = lerp(base.borderSubtle, rail, 0.18f),
    borderStrong = lerp(base.borderStrong, rail, 0.22f),
  )
}

private val OCEAN_LIGHT = fromPreview(AGLYN_LIGHT, hex(0xE3EEF4), hex(0xF2F8FB), hex(0x0B3954), dark = false)
private val OCEAN_DARK = fromPreview(AGLYN_DARK, hex(0xE3EEF4), hex(0xF2F8FB), hex(0x0B3954), dark = true)
private val WARM_LIGHT = fromPreview(AGLYN_LIGHT, hex(0xF5ECE0), hex(0xFFFAF3), hex(0xE9DCCB), dark = false)
private val WARM_DARK = fromPreview(AGLYN_DARK, hex(0xF5ECE0), hex(0xFFFAF3), hex(0x7A5634), dark = true)

/** The theme's grounds for [dark], or null for Aglyn, which is the console's generated scheme as it is. */
fun themeSurfaces(theme: AppThemeName, dark: Boolean): ThemeSurfaces? = when (theme) {
  AppThemeName.QUIET -> if (dark) QUIET_DARK else QUIET_LIGHT
  AppThemeName.NIGHT -> NIGHT
  AppThemeName.OCEAN -> if (dark) OCEAN_DARK else OCEAN_LIGHT
  AppThemeName.WARM -> if (dark) WARM_DARK else WARM_LIGHT
  AppThemeName.HIGH_CONTRAST -> if (dark) HIGH_CONTRAST_DARK else HIGH_CONTRAST_LIGHT
  else -> null
}

/** Whether [theme] is dark whatever the appearance says (Night). */
fun themeIsAlwaysDark(theme: AppThemeName): Boolean = theme == AppThemeName.NIGHT

/** The color a theme's "Theme" accent stands for: its own, where the theme has one. */
fun themeAccentSeed(theme: AppThemeName): Color = when (theme) {
  AppThemeName.OCEAN -> hex(0x087E8B)
  AppThemeName.WARM -> hex(0xC2571A)
  else -> hex(0x00B0FF)
}

/** The accent swatches the Theme settings offer, in order: Aglyn blue (the theme's own), Sky, Violet, Pink, Green, Warm. */
val ACCENT_SWATCHES: List<Pair<String, Color>> = listOf(
  "Sky" to hex(0x00B0FF),
  "Violet" to hex(0x7A5CF0),
  "Pink" to hex(0xE040FB),
  "Green" to hex(0x2E7D5B),
  "Warm" to hex(0xC2571A),
)

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
  /** The accent as text or an icon on the page: links, the selected row's label. */
  val text: Color,
)

/** WCAG contrast ratio of two opaque colors. */
fun contrastRatio(a: Color, b: Color): Float {
  val la = a.luminance() + 0.05f
  val lb = b.luminance() + 0.05f
  return max(la, lb) / min(la, lb)
}

private data class Hsl(val h: Float, val s: Float, val l: Float)

private fun Color.toHsl(): Hsl {
  val maxC = max(red, max(green, blue))
  val minC = min(red, min(green, blue))
  val l = (maxC + minC) / 2f
  if (maxC == minC) return Hsl(0f, 0f, l)
  val d = maxC - minC
  val s = if (l > 0.5f) d / (2f - maxC - minC) else d / (maxC + minC)
  val h = when (maxC) {
    red -> ((green - blue) / d + (if (green < blue) 6f else 0f))
    green -> ((blue - red) / d + 2f)
    else -> ((red - green) / d + 4f)
  } / 6f
  return Hsl(h, s, l)
}

private fun hslToColor(hsl: Hsl, alpha: Float = 1f): Color {
  val (h, s, l) = hsl
  if (s == 0f) return Color(l, l, l, alpha)
  fun hue(p: Float, q: Float, t0: Float): Float {
    var t = t0
    if (t < 0f) t += 1f
    if (t > 1f) t -= 1f
    return when {
      t < 1f / 6f -> p + (q - p) * 6f * t
      t < 1f / 2f -> q
      t < 2f / 3f -> p + (q - p) * (2f / 3f - t) * 6f
      else -> p
    }
  }
  val q = if (l < 0.5f) l * (1f + s) else l + s - l * s
  val p = 2f * l - q
  return Color(hue(p, q, h + 1f / 3f), hue(p, q, h), hue(p, q, h - 1f / 3f), alpha)
}

/** [color] with its HSL lightness moved by [delta] (−1…1). */
fun shiftLightness(color: Color, delta: Float): Color {
  val hsl = color.toHsl()
  return hslToColor(hsl.copy(l = (hsl.l + delta).coerceIn(0f, 1f)), color.alpha)
}

private val WHITE = Color.White

/**
 * The accent from one color, contrast-checked: the fill is darkened (in 2% steps of lightness) until white text on it
 * reaches 4.5:1; hover and pressed sit 4% and 8% darker; the wash is the raw color at 16%; the accent as text is
 * darkened (light) or lightened (dark) until it reads 4.5:1 on [page].
 */
fun deriveAccent(raw: Color, dark: Boolean, page: Color): AccentColors {
  var fill = raw.copy(alpha = 1f)
  var steps = 0
  while (contrastRatio(WHITE, fill) < 4.5f && steps < 50) {
    fill = shiftLightness(fill, -0.02f)
    steps++
  }
  var text = raw.copy(alpha = 1f)
  steps = 0
  while (contrastRatio(text, page) < 4.5f && steps < 50) {
    text = shiftLightness(text, if (dark) 0.02f else -0.02f)
    steps++
  }
  return AccentColors(
    ring = raw.copy(alpha = 1f),
    fill = fill,
    onFill = WHITE,
    fillHover = shiftLightness(fill, -0.04f),
    fillPressed = shiftLightness(fill, -0.08f),
    soft = raw.copy(alpha = 0.16f),
    text = text,
  )
}

// ── Density ─────────────────────────────────────────────────────────────────

/** The row and bar heights the density setting picks between (Figma "Aglyn / Density"). */
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
  /** The spacing scale: 1 for comfortable, 0.75 for compact. */
  val spacing: Float,
)

val ComfortableDensity = UiDensity(compact = false, row = 36f, listRow = 60f, phoneRow = 52f, titleBar = 52f, spacing = 1f)
val CompactDensity = UiDensity(compact = true, row = 30f, listRow = 48f, phoneRow = 44f, titleBar = 44f, spacing = 0.75f)

fun uiDensityOf(density: AppDensity): UiDensity = if (density == AppDensity.COMPACT) CompactDensity else ComfortableDensity

val LocalUiDensity = staticCompositionLocalOf { ComfortableDensity }

/** The theme's grounds in effect, or null under Aglyn (the generated scheme). */
val LocalThemeSurfaces = staticCompositionLocalOf<ThemeSurfaces?> { null }

/** The accent in effect. */
val LocalAccent = staticCompositionLocalOf<AccentColors?> { null }

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
      error = surfaces.dangerFg,
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
