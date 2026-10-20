package com.aglyn.shell

import androidx.compose.ui.graphics.Color
import com.aglyn.contracts.AppSidebarStyle
import com.aglyn.contracts.AppThemeName
import com.aglyn.contracts.Contracts
import com.aglyn.ui.sidebarGround
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The sidebar's ground follows Apple's `AglynColor.sidebar` (AGL-4000): Plain by default on every theme; Tinted blends 5%
 * of the accent in force into the surface, on themes other than Aglyn's only.
 */
class SidebarStyleTest {
  private val plainDefault = Contracts.defaultAppTheme

  @Test
  fun theDefaultIsPlainSoNoThemeTintsTheSidebar() {
    assertEquals(AppSidebarStyle.PLAIN, plainDefault.sidebarStyle)
    for (name in Contracts.appThemeNames) assertFalse(sidebarTinted(plainDefault.copy(theme = name)), "$name tinted by default")
  }

  @Test
  fun tintedTintsEveryThemeButAglyns() {
    val tinted = plainDefault.copy(sidebarStyle = AppSidebarStyle.TINTED)
    assertFalse(sidebarTinted(tinted.copy(theme = AppThemeName.AGLYN)))
    assertFalse(sidebarTinted(tinted.copy(theme = AppThemeName.UNKNOWN)))
    for (name in Contracts.appThemeNames.filter { it != AppThemeName.AGLYN }) assertTrue(sidebarTinted(tinted.copy(theme = name)), "$name not tinted")
  }

  @Test
  fun tintedIsFivePercentOfTheAccentAndPlainIsTheSurface() {
    val surface = Color(0xFFFFFFFF)
    val accent = Color(0xFF00B0FF)
    assertEquals(surface, sidebarGround(surface, null))
    val ground = sidebarGround(surface, accent)
    // 255 + (0 - 255) * 0.05 = 242.25; 255 + (176 - 255) * 0.05 = 251.05; blue stays 255.
    assertEquals(242, (ground.red * 255).toInt())
    assertEquals(251, (ground.green * 255).toInt())
    assertEquals(255, Math.round(ground.blue * 255))
    assertEquals(1f, ground.alpha)
  }
}
