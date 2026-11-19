package com.aglyn.plugins.workflows

import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import kotlin.test.Test
import kotlin.test.assertEquals

class RegisterTest {
  @Test
  fun registersEveryDeclaredId() {
    val registry = NativePluginRegistry()
    val declared = mapOf(
      "screens" to listOf(
        ACTION_SCREEN, AUTOMATION_SCREEN, ORG_AUTOMATION_SCREEN, RUNS_SCREEN, WEBHOOK_SCREEN, WORKFLOW_SCREEN,
        "workflows.staffSiteAutomations", "workflows.staffOrgAutomations", "workflows.staffAutomation",
      ),
      "quickActions" to listOf("workflows.open"),
      "deepLinks" to listOf("workflows.page"),
    )
    val result = registry.load(listOf(NativePluginManifestEntry("workflows", declared, ::registerWorkflowsNative)))
    assertEquals(listOf("workflows"), result.loaded, result.failed.toString())
    assertEquals(false, registry.screen(AUTOMATION_SCREEN)!!.requiresSite)
    assertEquals(true, registry.screen(WORKFLOW_SCREEN)!!.requiresSite)
    assertEquals("/automation", registry.deepLinks().single().path)
  }

  /** The staff pages' read-only Automations cards (AGL-3379): the staff site's and the staff organization's zones. */
  @Test
  fun theStaffAutomationScreensSitInTheStaffZones() {
    val specs = WorkflowsScreenJson.files.flatMap { com.aglyn.screens.ScreenSpec.parseFile(it) }.associateBy { it.id }
    assertEquals(listOf("staffSite"), specs.getValue("workflows.staffSiteAutomations").zones)
    assertEquals(listOf("staffOrg"), specs.getValue("workflows.staffOrgAutomations").zones)
    assertEquals(emptyList(), specs.getValue("workflows.staffAutomation").zones)
  }
}
