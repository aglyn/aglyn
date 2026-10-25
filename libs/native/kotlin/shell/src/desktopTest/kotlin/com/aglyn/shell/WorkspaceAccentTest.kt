package com.aglyn.shell

import com.aglyn.contracts.resolveWorkspaceColor
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Zach's decision 5: only a white-label workspace's brand color becomes the accent, and only while the setting is on. */
class WorkspaceAccentTest {
  @Test
  fun aWhiteLabelBrandColorIsTheAccentWhileTheSettingIsOn() {
    assertEquals("#7A5CF0", workspaceAccent("#7A5CF0", whiteLabel = true, useWorkspaceBrand = true))
  }

  @Test
  fun withTheSettingOffTheAccountAccentStays() {
    assertNull(workspaceAccent("#7A5CF0", whiteLabel = true, useWorkspaceBrand = false))
  }

  @Test
  fun aPickedOrLogoColorOnlyColorsTheTile() {
    // Juniper Street Co.: no brand color, a green logo. Its color is its rail tile's, never the accent; and no surface
    // wears a wash of it (AGL-4000: "this looks green"; NavShellUiTest holds the sidebar's ground).
    val logo = resolveWorkspaceColor(picked = null, brandColor = null, logoColor = "#2E7D32", useWorkspaceBrand = true)
    assertEquals("#2E7D32", logo.color)
    assertNull(workspaceAccent(brandColor = null, whiteLabel = true, useWorkspaceBrand = true))
    // A picked color, even on a white-label workspace, is the tile's; the brand color stays the accent.
    val picked = resolveWorkspaceColor(picked = "#E040FB", brandColor = "#7A5CF0", logoColor = null, useWorkspaceBrand = true)
    assertEquals("#E040FB", picked.color)
    assertEquals("#7A5CF0", workspaceAccent("#7A5CF0", whiteLabel = true, useWorkspaceBrand = true))
  }

  @Test
  fun anAccentThePersonPickedWinsOverAWhiteLabelBrand() {
    // Apple's ThemeApplier.accent: your own accent first, then a white-label brand, then the theme's.
    assertNull(workspaceAccent("#7A5CF0", whiteLabel = true, useWorkspaceBrand = true, pickedAccent = "#E040FB"))
    assertEquals("#7A5CF0", workspaceAccent("#7A5CF0", whiteLabel = true, useWorkspaceBrand = true, pickedAccent = "theme"))
  }

  @Test
  fun aStoredBrandColorWithoutWhiteLabelIsNoAccent() {
    // The console reads brandingProfile.primaryColor only for a white-label workspace (its branding effects).
    assertNull(workspaceAccent("#7A5CF0", whiteLabel = false, useWorkspaceBrand = true))
  }

  @Test
  fun aWorkspaceWithNoColorOfItsOwnGetsItsStableColorOnItsTileOnly() {
    // Two workspaces with one initial and no pick, brand or logo still differ on the rail (AGL-4000, the contract's
    // workspaceStableColor): the color comes from the id, from the generated palette, and never tints the app.
    val palette = com.aglyn.contracts.Contracts.workspaceStableColors
    val stable = resolveWorkspaceColor(picked = null, brandColor = null, logoColor = null, useWorkspaceBrand = true, orgId = "org-acme-builders")
    assertEquals(com.aglyn.contracts.WorkspaceColorSource.STABLE, stable.source)
    assertTrue(stable.color in palette, "${stable.color} is a palette color")
    assertEquals(false, stable.tintsApp)
    assertEquals(stable.color, resolveWorkspaceColor(null, null, null, true, orgId = "org-acme-builders").color, "the same id, the same color")
    // Picked > brand > logo > stable.
    assertEquals("#2E7D32", resolveWorkspaceColor(null, null, "#2E7D32", true, orgId = "org-acme-builders").color)
    assertEquals("#E040FB", resolveWorkspaceColor("#E040FB", null, "#2E7D32", true, orgId = "org-acme-builders").color)
    // Without an id there is no stable color: the tile is the neutral slate.
    assertNull(resolveWorkspaceColor(null, null, null, true).color)
  }

  @OptIn(androidx.compose.ui.test.ExperimentalTestApi::class)
  @Test
  fun everyStableColorCarriesItsInitialAtFourPointFiveToOne() = androidx.compose.ui.test.runComposeUiTest {
    // In the ink the tile draws its initial in (readableOn), light and dark.
    val ratios = mutableListOf<Pair<String, Float>>()
    setContent {
      for (dark in listOf(false, true)) {
        com.aglyn.ui.AglynTheme(dark = dark) {
          for (hex in com.aglyn.contracts.Contracts.workspaceStableColors) {
            val fill = com.aglyn.ui.colorOfHex(hex)!!
            ratios += "$hex dark=$dark" to com.aglyn.ui.contrastRatio(com.aglyn.ui.readableOn(fill), fill)
          }
        }
      }
    }
    waitForIdle()
    assertTrue(ratios.size >= 16, "both modes: $ratios")
    for ((name, ratio) in ratios) assertTrue(ratio >= 4.5f, "$name: the initial at $ratio:1")
  }
}
