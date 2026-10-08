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
/// `mobile.contributes`. The Kotlin registrar is the same list.
@MainActor
public func registerWorkflowsNative(_ r: NativePluginRegistrar) {
  r.screen(automationScreen, title: "Automation", icon: "bolt") { _, _ in
    Text("Automation")
  }
  r.quickAction("workflows.open", title: "Automation", icon: "bolt", order: 400, screen: automationScreen)
  r.deepLink("workflows.page", path: "/automation", screen: automationScreen)
}
