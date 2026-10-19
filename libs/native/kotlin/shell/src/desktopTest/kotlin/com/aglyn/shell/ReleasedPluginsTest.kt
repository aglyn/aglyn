package com.aglyn.shell

import com.aglyn.contracts.Contracts
import com.aglyn.core.WorkspaceOrgLogo
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ReleasedPluginsTest {
  private val flagged = Contracts.firstPartyPlugins.first { it.releaseFlag != null }
  private val flag = flagged.releaseFlag!!

  @Test
  fun aPluginWhoseFlagIsOffForTheWorkspaceLeavesTheLists() {
    val off = WorkspaceOrgLogo(light = null, dark = null, plan = "pro", releaseFlags = mapOf(flag to false))
    val list = releasedPlugins(listOf("pages", flagged.id), "o1", off, staff = false)
    assertFalse(flagged.id in list)
    assertTrue("pages" in list)
  }

  @Test
  fun theWorkspacesOverrideReleasesIt() {
    val on = WorkspaceOrgLogo(light = null, dark = null, plan = "pro", releaseFlags = mapOf(flag to true))
    assertTrue(flagged.id in releasedPlugins(listOf(flagged.id), "o1", on, staff = false))
  }

  @Test
  fun staffSeeEveryPlugin() {
    val off = WorkspaceOrgLogo(light = null, dark = null, plan = "pro", releaseFlags = mapOf(flag to false))
    assertTrue(flagged.id in releasedPlugins(listOf(flagged.id), "o1", off, staff = true))
  }
}
