package com.aglyn.shell

import com.aglyn.contracts.resolveWorkspaceColor
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

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
  fun aStoredBrandColorWithoutWhiteLabelIsNoAccent() {
    // The console reads brandingProfile.primaryColor only for a white-label workspace (its branding effects).
    assertNull(workspaceAccent("#7A5CF0", whiteLabel = false, useWorkspaceBrand = true))
  }
}
