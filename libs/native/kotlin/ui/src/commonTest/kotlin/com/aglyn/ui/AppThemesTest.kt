package com.aglyn.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import com.aglyn.contracts.AppThemeName
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/** Whole-app theming (AGL-3946): every theme's grounds, and accents that always read. */
class AppThemesTest {
  private val colors = listOf(0xFF00B0FF, 0xFF7A5CF0, 0xFFE040FB, 0xFF2E7D5B, 0xFFC2571A, 0xFFFFEB3B, 0xFF0B1120, 0xFFFFFFFF).map { Color(it) }

  @Test
  fun anAccentsFillAlwaysCarriesWhiteTextAndItsTextReadsOnThePage() {
    for (raw in colors) {
      for (dark in listOf(false, true)) {
        val page = if (dark) Color(0xFF1E262E) else Color.White
        val accent = deriveAccent(raw, dark)
        // White on every fill (AGL-3990), at the large-text bar at least: the console's own pairing for a brand color.
        assertEquals(Color.White.toHex(), accent.onFill.toHex(), "on of $raw")
        assertTrue(contrastRatio(accent.onFill, accent.fill) >= 2.4f, "fill of $raw")
        assertTrue(contrastRatio(accent.text, page) >= 4.5f, "text of $raw on dark=$dark")
        assertTrue(accent.fillPressed.luminance() <= accent.fillHover.luminance() && accent.fillHover.luminance() <= accent.fill.luminance())
        assertEquals(raw.toHex(), accent.ring.toHex())
      }
    }
  }

  @Test
  fun theBrandBlueIsTheConsolesPrimary() {
    // #00B0FF under white; #0077AD as text on light, #4DC8FF on dark (AGL-3990, the console's primary.dark).
    val light = deriveAccent(Color(0xFF00B0FF), false)
    val dark = deriveAccent(Color(0xFF00B0FF), true)
    assertEquals(Color(0xFF00B0FF).toHex(), light.fill.toHex())
    assertEquals(Color.White.toHex(), light.onFill.toHex())
    assertEquals(Color(0xFF0077AD).toHex(), light.text.toHex())
    assertEquals(Color(0xFF4DC8FF).toHex(), dark.text.toHex())
    // An accent saved from the retired #0073AE swatch reads as the brand blue.
    assertEquals(light, deriveAccent(Color(0xFF0073AE), false))
  }

  @Test
  fun aColorThatAlreadyReadsIsLeftAsItIs() {
    val green = Color(0xFF2E7D5B)
    assertEquals(green.toHex(), deriveAccent(green, false).fill.toHex())
  }

  @Test
  fun aglynIsTheGeneratedSchemeAndTheOthersHaveTheirOwnGrounds() {
    // The brand's own theme is the console's scheme.
    assertEquals(AglynLightColorScheme.background.toHex(), themeSurfaces(AppThemeName.AGLYN, false)!!.canvas.toHex())
    assertEquals(themeSurfaces(AppThemeName.AGLYN, true), themeSurfaces(AppThemeName.UNKNOWN, true))
    for (name in AppThemeName.entries.filter { it != AppThemeName.UNKNOWN }) {
      val light = themeSurfaces(name, false)!!
      val dark = themeSurfaces(name, true)!!
      // Text reads on each theme's page.
      assertTrue(contrastRatio(light.textPrimary, light.canvas) >= 7f, "$name light")
      assertTrue(contrastRatio(dark.textPrimary, dark.canvas) >= 7f, "$name dark")
      assertTrue(contrastRatio(light.textSecondary, light.surface) >= 4.5f, "$name light secondary")
    }
    assertEquals(themeSurfaces(AppThemeName.NIGHT, false), themeSurfaces(AppThemeName.NIGHT, true))
    assertTrue(themeIsAlwaysDark(AppThemeName.NIGHT))
  }

  @Test
  fun aThemeLaysItsGroundsAndAccentOverTheScheme() {
    val surfaces = themeSurfaces(AppThemeName.QUIET, false)
    val accent = deriveAccent(Color(0xFF7A5CF0), false)
    val scheme = themedColorScheme(AglynLightColorScheme, surfaces!!, accent, dark = false)
    assertEquals(surfaces.canvas, scheme.background)
    assertEquals(accent.fill, scheme.primary)
    assertNotEquals(AglynLightColorScheme.primary, scheme.primary)
    // No theme, no accent: the generated scheme untouched.
    assertEquals(AglynLightColorScheme, themedColorScheme(AglynLightColorScheme, null, null, dark = false))
  }

  @Test
  fun aPhoneInTheBrandsLookDrawsTheBoldGrounds() {
    // Figma Theme mode 223:0 (AGL-3990): a sky-tinted ground under white panels in light, navy in dark.
    assertEquals("#EDF9FF", phoneBoldSurfaces(dark = false).canvas.toHex().uppercase())
    assertEquals(Color.White.toHex(), phoneBoldSurfaces(dark = false).surface.toHex())
    assertEquals("#07181F", phoneBoldSurfaces(dark = true).canvas.toHex().uppercase())
    // Only the Aglyn theme in the brand blue (a retired blue reads as it); a picked accent or another theme keeps its own.
    assertTrue(isBrandLook(AppThemeName.AGLYN, null))
    assertTrue(isBrandLook(AppThemeName.AGLYN, "#00B0FF"))
    assertTrue(isBrandLook(AppThemeName.AGLYN, "#0073AE"))
    assertEquals(false, isBrandLook(AppThemeName.AGLYN, "#7A5CF0"))
    assertEquals(false, isBrandLook(AppThemeName.QUIET, null))
    for (dark in listOf(false, true)) {
      val s = phoneBoldSurfaces(dark)
      for (ground in listOf(s.canvas, s.surface, s.raised, s.sunken)) {
        assertTrue(contrastRatio(s.textPrimary, ground) >= 4.5f && contrastRatio(s.textTertiary, ground) >= 4.5f, "text on $ground dark=$dark")
      }
    }
  }

  @Test
  fun densityAndTextSize() {
    assertTrue(uiDensityOf(com.aglyn.contracts.AppDensity.COMPACT).row < uiDensityOf(com.aglyn.contracts.AppDensity.COMFORTABLE).row)
    assertEquals(1f, textScaleOf(com.aglyn.contracts.AppTextSize.SYSTEM))
    assertTrue(textScaleOf(com.aglyn.contracts.AppTextSize.EXTRA_LARGE) > textScaleOf(com.aglyn.contracts.AppTextSize.LARGE))
  }
}
