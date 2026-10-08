// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import SwiftUI

public let automationScreen = "workflows.automation"
public let workflowScreen = "workflows.workflow"
public let actionScreen = "workflows.action"
public let webhookScreen = "workflows.webhook"
public let runsScreen = "workflows.runs"
public let orgAutomationScreen = "workflows.org-automation"

/// Registers the ids `plugins.config.json` declares under the plugin's
/// `mobile.contributes`: Automation — a site's workflows, actions and
/// webhooks with their run history, and the organization's automations and
/// every site's lists — with an editor for each, natively. The Kotlin
/// registrar is the same list.
@MainActor
public func registerWorkflowsNative(_ r: NativePluginRegistrar) {
  r.screen(automationScreen, title: "Automation", icon: "bolt") { ctx, params in
    AutomationHubScreen(context: ctx, params: params)
  }
  r.screen(workflowScreen, title: "Workflow", icon: "point.3.connected.trianglepath.dotted") { ctx, params in
    WorkflowEditorScreen(context: ctx, params: params)
  }
  r.screen(actionScreen, title: "Action", icon: "bolt") { ctx, params in
    ActionEditorScreen(context: ctx, params: params)
  }
  r.screen(webhookScreen, title: "Webhook", icon: "link") { ctx, params in
    WebhookEditorScreen(context: ctx, params: params)
  }
  r.screen(runsScreen, title: "Runs", icon: "clock.arrow.circlepath") { ctx, params in
    RunHistoryScreen(context: ctx, params: params)
  }
  r.screen(orgAutomationScreen, title: "Org automation", icon: "building.2") { ctx, params in
    OrgAutomationEditorScreen(context: ctx, params: params)
  }
  r.quickAction("workflows.open", title: "Automation", icon: "bolt", order: 400, screen: automationScreen)
  r.deepLink("workflows.page", path: "/automation", screen: automationScreen)
}
