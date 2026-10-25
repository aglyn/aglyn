package com.aglyn.contracts

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/*
 * The native themes' arithmetic (native-themes.ts, AGL-3950): colors as `#RRGGBB` strings, so every app derives the same
 * byte. The palettes, named accents, swatches and densities are the generated values (Contracts.themePalettes…).
 */

private val HEX = Regex("^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$")

private fun channels(color: String?): DoubleArray? {
  val match = HEX.matchEntire(color ?: return null) ?: return null
  val value = match.groupValues[1]
  return doubleArrayOf(value.substring(0, 2).toInt(16).toDouble(), value.substring(2, 4).toInt(16).toDouble(), value.substring(4, 6).toInt(16).toDouble())
}

private fun hexOf(rgb: DoubleArray): String = "#" + rgb.joinToString("") { min(255.0, max(0.0, it)).roundToInt().toString(16).padStart(2, '0') }

/** Whether a value is `#RRGGBB`. */
fun isThemeColor(value: Any?): Boolean = value is String && Regex("^#[0-9a-fA-F]{6}$").matches(value)

private fun linear(channel: Double): Double {
  val value = channel / 255
  return if (value <= 0.03928) value / 12.92 else ((value + 0.055) / 1.055).pow(2.4)
}

private fun luminance(rgb: DoubleArray): Double = 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])

/** WCAG 2 contrast between two `#RRGGBB` colors, as the console's `contrastRatio` measures it. */
fun themeContrast(a: String, b: String): Double {
  val x = channels(a) ?: return 1.0
  val y = channels(b) ?: return 1.0
  val high = max(luminance(x), luminance(y))
  val low = min(luminance(x), luminance(y))
  return (high + 0.05) / (low + 0.05)
}

private fun toHsl(rgb: DoubleArray): DoubleArray {
  val red = rgb[0] / 255
  val green = rgb[1] / 255
  val blue = rgb[2] / 255
  val maxC = max(red, max(green, blue))
  val minC = min(red, min(green, blue))
  val lightness = (maxC + minC) / 2
  if (maxC == minC) return doubleArrayOf(0.0, 0.0, lightness)
  val delta = maxC - minC
  val saturation = if (lightness > 0.5) delta / (2 - maxC - minC) else delta / (maxC + minC)
  val hue = when (maxC) {
    red -> (green - blue) / delta + (if (green < blue) 6 else 0)
    green -> (blue - red) / delta + 2
    else -> (red - green) / delta + 4
  }
  return doubleArrayOf(hue / 6, saturation, lightness)
}

private fun fromHsl(hue: Double, saturation: Double, lightness: Double): String {
  val l = min(1.0, max(0.0, lightness))
  if (saturation == 0.0) return hexOf(doubleArrayOf(l * 255, l * 255, l * 255))
  val q = if (l < 0.5) l * (1 + saturation) else l + saturation - l * saturation
  val p = 2 * l - q
  fun channel(t: Double): Double {
    var x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    return when {
      x < 1.0 / 6 -> p + (q - p) * 6 * x
      x < 1.0 / 2 -> q
      x < 2.0 / 3 -> p + (q - p) * (2.0 / 3 - x) * 6
      else -> p
    }
  }
  return hexOf(doubleArrayOf(channel(hue + 1.0 / 3) * 255, channel(hue) * 255, channel(hue - 1.0 / 3) * 255))
}

/** [color] with its HSL lightness moved by [delta] (−1 to 1). */
fun themeShiftLightness(color: String, delta: Double): String {
  val rgb = channels(color) ?: return color
  val hsl = toHsl(rgb)
  return fromHsl(hsl[0], hsl[1], hsl[2] + delta)
}

/** [color] walked in 2% lightness steps (darker, or lighter) until it reaches [minContrast] on [against]; the pole when nothing does. */
private fun walkToContrast(color: String, against: String, minContrast: Double, direction: Int): String {
  var candidate = color
  for (step in 0..50) {
    candidate = themeShiftLightness(color, direction * 0.02 * step)
    if (themeContrast(candidate, against) >= minContrast) return candidate
  }
  return candidate
}

/** [from] moved [amount] (0–1) of the way to [to], per sRGB channel. */
fun themeLerp(from: String, to: String, amount: Double): String {
  val a = channels(from) ?: return from
  val b = channels(to) ?: return from
  return hexOf(DoubleArray(3) { a[it] + (b[it] - a[it]) * amount })
}

private fun withAlpha(color: String, alpha: Double): String {
  val rgb = channels(color) ?: return color
  return hexOf(rgb) + (alpha * 255).roundToInt().toString(16).padStart(2, '0')
}

/** A theme by id, Aglyn for anything unknown. */
fun themePalette(id: Any?): ThemePalette {
  val palettes = Contracts.themePalettes
  return palettes.firstOrNull { it.id.raw == id || it.id == id } ?: palettes.first()
}

private val aglynLight: ThemeColors get() = Contracts.themePalettes.first { it.id == ThemePaletteId.AGLYN }.light
private val aglynDark: ThemeColors get() = Contracts.themePalettes.first { it.id == ThemePaletteId.AGLYN }.dark

/**
 * A theme's palette from Figma's four-color preview (`deriveThemeFromPreview`), over Figma's own Aglyn modes
 * (THEME_FIGMA_BASE): light keeps the preview's canvas, surface and rail and blends the rest toward the rail; dark tints
 * the base's dark mode toward [darkRailSeed].
 */
fun deriveThemeFromPreview(preview: ThemePreview, darkRailSeed: String): ThemeColorsPair {
  val light = Contracts.themeFigmaBase.light
  val dark = Contracts.themeFigmaBase.dark
  return ThemeColorsPair(
    light = light.copy(
      canvas = preview.canvas,
      surface = preview.surface,
      raised = preview.surface,
      rail = preview.rail,
      sunken = themeLerp(preview.canvas, preview.rail, 0.25),
      hover = themeLerp(preview.surface, preview.rail, 0.1),
      titlebar = themeLerp(preview.surface, preview.canvas, 0.35),
      borderSubtle = themeLerp(light.borderSubtle, preview.rail, 0.18),
      borderStrong = themeLerp(light.borderStrong, preview.rail, 0.22),
    ),
    dark = dark.copy(
      canvas = themeLerp(dark.canvas, darkRailSeed, 0.22),
      surface = themeLerp(dark.surface, darkRailSeed, 0.18),
      raised = themeLerp(dark.raised, darkRailSeed, 0.18),
      rail = themeLerp(dark.rail, darkRailSeed, 0.45),
    ),
  )
}

/**
 * Every control's shade of one accent color (`deriveAccent`): a retired blue reads as the color that replaced it
 * (`THEME_RETIRED_ACCENTS`), a Figma accent's ring answers with that mode exactly; any
 * other color keeps its fill when white reads on it at 3:1 and is darkened in 2% steps until white reads at 4.5:1
 * otherwise; the content on the fill is always white. Null for anything that is not `#RRGGBB`.
 */
fun deriveAccent(color: String?): ThemeAccent? {
  if (!isThemeColor(color)) return null
  val raw = color!!.lowercase().let { Contracts.themeRetiredAccents[it] ?: it }
  Contracts.themeAccents.firstOrNull { it.accent.ring == raw }?.let { return it.accent }
  val white = "#ffffff"
  val text = Contracts.themeTextContrast
  val nonText = Contracts.themeNonTextContrast.toDouble()
  val fill = if (themeContrast(raw, white) >= nonText) raw else walkToContrast(raw, white, text, -1)
  return ThemeAccent(
    fill = fill,
    hover = themeShiftLightness(fill, -0.04),
    icon = walkToContrast(raw, aglynLight.surface, nonText, -1),
    on = white,
    pressed = themeShiftLightness(fill, -0.08),
    ring = raw,
    soft = withAlpha(raw, 0.16),
    textDark = walkToContrast(raw, aglynDark.surface, text, 1),
    textLight = walkToContrast(raw, aglynLight.surface, text, -1),
  )
}

/**
 * A member's permissions as the console resolves them (`rolePermissions`): their role's grants over every catalog key,
 * then a custom role's values, then their own overrides; keys outside the catalog are ignored.
 */
fun rolePermissions(catalog: OrgRoleGrants, role: String?, customRole: OrgPermissionLayer? = null, overrides: OrgPermissionLayer? = null): Map<String, Boolean> {
  val keys = catalog.permissions.map { it.key }
  val held = catalog.grants[role ?: "viewer"].orEmpty().toSet()
  val out = LinkedHashMap<String, Boolean>()
  for (key in keys) out[key] = key in held
  for (layer in listOf(customRole, overrides)) {
    val values = layer?.permissions ?: continue
    for (key in keys) values[key]?.let { out[key] = it }
  }
  return out
}

/** [rolePermissions] on the catalog this build carries. */
fun rolePermissions(role: String?, customRole: OrgPermissionLayer? = null, overrides: OrgPermissionLayer? = null): Map<String, Boolean> =
  rolePermissions(Contracts.orgRoleGrants, role, customRole, overrides)
