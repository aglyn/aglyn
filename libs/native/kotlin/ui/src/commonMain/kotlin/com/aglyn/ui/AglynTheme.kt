package com.aglyn.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.AppDensity
import com.aglyn.contracts.AppTextSize
import com.aglyn.contracts.AppThemeName
import com.aglyn.contracts.AppThemePrefs
import com.aglyn.ui.resources.Res
import com.aglyn.ui.resources.robotoflex_variable
import org.jetbrains.compose.resources.Font

/** The palette in effect, for the status colors Material 3 has no role for. */
val LocalAglynPalette = staticCompositionLocalOf { AglynTokens.light }

/** The bundled Roboto Flex, at every weight the console's type scale uses. */
@Composable
fun aglynFontFamily(): FontFamily = FontFamily(
  listOf(400, 500, 600, 700, 800, 900).map { weight -> Font(Res.font.robotoflex_variable, FontWeight(weight)) },
)

/**
 * The console's theme on Material 3: color roles, type scale and shapes all from the generated tokens. Dynamic color
 * stays off so the brand holds. [appTheme] lays the account's theme over it (its grounds, accent and density); [brand]
 * is a workspace's color that tints the app while it is on screen, which stands in for the accent; [textScale] scales
 * text where the app sets its own size (desktop).
 */
@Composable
fun AglynTheme(
  dark: Boolean = isSystemInDarkTheme(),
  appTheme: AppThemePrefs? = null,
  brand: Color? = null,
  textScale: Float = 1f,
  content: @Composable () -> Unit,
) {
  val theme = appTheme?.theme ?: AppThemeName.AGLYN
  val isDark = dark || themeIsAlwaysDark(theme)
  val surfaces = themeSurfaces(theme, isDark)
  val base = if (isDark) AglynDarkColorScheme else AglynLightColorScheme
  val basePalette = if (isDark) AglynTokens.dark else AglynTokens.light
  val customAccent = appTheme?.accent?.let(::colorOfHex)
  // Every theme, Aglyn's too, takes its accent from its seed through the contract: the Aglyn theme's #00B0FF is the
  // console's primary, a #00B0FF fill under white with #0077AD (light) / #4DC8FF (dark) as its text (AGL-3990).
  val seed = brand ?: customAccent ?: themeAccentSeed(theme)
  val accent = seed?.let { deriveAccent(it, isDark) }
  val scheme = themedColorScheme(base, surfaces, accent, isDark)
  val palette = themedPalette(basePalette, surfaces, accent)
  val density = LocalDensity.current
  CompositionLocalProvider(
    LocalAglynPalette provides palette,
    LocalThemeSurfaces provides surfaces,
    LocalAccent provides accent,
    LocalUiDensity provides uiDensityOf(appTheme?.density ?: AppDensity.COMFORTABLE),
    LocalDensity provides if (textScale == 1f) density else Density(density.density, density.fontScale * textScale),
    LocalAglynDark provides isDark,
  ) {
    MaterialTheme(
      colorScheme = scheme,
      typography = aglynTypography(aglynFontFamily()),
      shapes = AglynShapes,
      content = content,
    )
  }
}

/** The factor a desktop's own Text size setting scales text by; system on phones and tablets. */
fun textScaleOf(size: AppTextSize): Float = when (size) {
  AppTextSize.SMALL -> 0.9f
  AppTextSize.LARGE -> 1.12f
  AppTextSize.EXTRA_LARGE -> 1.25f
  else -> 1f
}

/** Spacing in units of the console's 8 dp grid. */
fun space(units: Float) = (AglynTokens.SPACING * units).dp
