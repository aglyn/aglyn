package com.aglyn.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aglyn.ui.resources.Res
import com.aglyn.ui.resources.robotoflex_variable
import org.jetbrains.compose.resources.Font

/** The palette in effect, for the status colors Material 3 has no role for. */
val LocalAglynPalette = staticCompositionLocalOf { AglynTokens.light }

/** The bundled Roboto Flex, at every weight the console's type scale uses. */
@Composable
fun aglynFontFamily(): FontFamily = FontFamily(
  listOf(400, 500, 700, 800, 900).map { weight -> Font(Res.font.robotoflex_variable, FontWeight(weight)) },
)

/**
 * The console's theme on Material 3: color roles, type scale and shapes all
 * from the generated tokens. Dynamic color stays off so the brand holds.
 */
@Composable
fun AglynTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
  CompositionLocalProvider(LocalAglynPalette provides if (dark) AglynTokens.dark else AglynTokens.light) {
    MaterialTheme(
      colorScheme = if (dark) AglynDarkColorScheme else AglynLightColorScheme,
      typography = aglynTypography(aglynFontFamily()),
      shapes = AglynShapes,
      content = content,
    )
  }
}

/** Spacing in units of the console's 8 dp grid. */
fun space(units: Float) = (AglynTokens.SPACING * units).dp
