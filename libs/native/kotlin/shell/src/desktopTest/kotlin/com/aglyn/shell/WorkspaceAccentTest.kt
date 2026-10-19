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
  fun aPickedOrLogoColorOnlyWashesTheSidebar() {
    // Juniper Street Co.: no brand color, a green logo. Its color tints the rail tile and the sidebar wash, not the accent.
    val logo = resolveWorkspaceColor(picked = null, brandColor = null, logoColor = "#2E7D32", useWorkspaceBrand = true)
    assertTrue(logo.tintsApp)
    assertNull(workspaceAccent(brandColor = null, whiteLabel = true, useWorkspaceBrand = true))
    // A picked color, even on a white-label workspace, is the wash; the brand color stays the accent.
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
