package com.aglyn.plugins.workflows

import androidx.compose.material3.Text
import com.aglyn.pluginhost.NativePluginRegistrar

const val AUTOMATION_SCREEN = "workflows.automation"
const val WORKFLOW_SCREEN = "workflows.workflow"
const val ACTION_SCREEN = "workflows.action"
const val WEBHOOK_SCREEN = "workflows.webhook"
const val RUNS_SCREEN = "workflows.runs"
const val ORG_AUTOMATION_SCREEN = "workflows.org-automation"

/** The Workflows plugin's native registration: the ids its `mobile.contributes` declares. */
fun registerWorkflowsNative(r: NativePluginRegistrar) {
  r.screen(AUTOMATION_SCREEN, title = "Automation", icon = "bolt") { _, _ -> Text("Automation") }
  r.quickAction("workflows.open", title = "Automation", icon = "bolt", order = 400, screen = AUTOMATION_SCREEN)
  r.deepLink("workflows.page", path = "/automation", screen = AUTOMATION_SCREEN)
}
