package com.aglyn.plugins.workflows

import com.aglyn.pluginhost.NativePluginRegistrar

const val AUTOMATION_SCREEN = "workflows.automation"
const val WORKFLOW_SCREEN = "workflows.workflow"
const val ACTION_SCREEN = "workflows.action"
const val WEBHOOK_SCREEN = "workflows.webhook"
const val RUNS_SCREEN = "workflows.runs"
const val ORG_AUTOMATION_SCREEN = "workflows.org-automation"

/** A screen's `id` param: an existing record's id, or `new` (or nothing) for a new one. */
private fun idParam(value: String?): String? = value?.takeIf { it.isNotBlank() && it != NEW_ID }

/**
 * The Workflows plugin's native registration: the ids its
 * `mobile.contributes` declares. Automation (a site's workflows, actions and
 * webhooks, and the organization's own automations), each editor on its own
 * screen for phones and links, and an automation's run history.
 */
fun registerWorkflowsNative(r: NativePluginRegistrar) {
  r.screen(AUTOMATION_SCREEN, title = "Automation", icon = "bolt") { context, params -> AutomationScreen(context, params) }
  r.screen(WORKFLOW_SCREEN, title = "Workflow", requiresSite = true, icon = "account_tree") { context, params ->
    StandaloneTarget(context, AutomationTarget.Workflow(idParam(params["id"])))
  }
  r.screen(ACTION_SCREEN, title = "Action", requiresSite = true, icon = "bolt") { context, params ->
    StandaloneTarget(context, AutomationTarget.Action(idParam(params["id"])))
  }
  r.screen(WEBHOOK_SCREEN, title = "Webhook", requiresSite = true, icon = "webhook") { context, _ ->
    StandaloneTarget(context, AutomationTarget.Webhook)
  }
  r.screen(RUNS_SCREEN, title = "Runs", requiresSite = true, icon = "history") { context, params ->
    val targetId = params["targetId"].orEmpty()
    StandaloneTarget(context, AutomationTarget.Runs(targetId, params["name"].orEmpty(), siteScope = params["hostScope"] == "site"))
  }
  r.screen(ORG_AUTOMATION_SCREEN, title = "Org automation", icon = "workspaces") { context, params ->
    StandaloneTarget(context, AutomationTarget.OrgAutomation(idParam(params["id"])))
  }
  r.quickAction("workflows.open", title = "Automation", icon = "bolt", order = 400, screen = AUTOMATION_SCREEN)
  r.deepLink("workflows.page", path = "/automation", screen = AUTOMATION_SCREEN)
}
