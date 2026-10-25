// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import Foundation

/// The AI plugin's native registration: its spec screens (jobs, credits,
/// per-member use, and the staffOrg and staffUser zones), their links, the
/// site's "AI jobs" quick action, what it adds to the site's setup pages, and Create with AI beside the create action of
/// Pages, Templates, Layouts, Forms and Components. The ids are the ones plugins.config.json declares under
/// `ai.mobile.contributes`.
@MainActor
public func registerAINative(_ registrar: NativePluginRegistrar) {
  SpecScreens.register(ScreenCatalog.load(from: .module), into: registrar)
  registrar.quickAction(
    "ai.open", title: "AI jobs", icon: "sparkles", order: 60, screen: "ai.jobs", requiresSite: true)
  // Setup → SEO draws this in the console's `hostSeo` slot, under the SEO check.
  registrar.widget(
    "ai.seo-audit", title: "SEO fixes", icon: "wand.and.stars", order: 80, size: .full, requiresSite: true, slot: "hostSeo"
  ) { AiSeoAuditCard(context: $0) }
  registrar.widget(
    "ai.seo-start", title: "The listing your answers describe", icon: "text.magnifyingglass", order: 90, size: .full, requiresSite: true,
    slot: "hostSeo"
  ) { AiSiteSeoStartCard(context: $0) }
  // Setup → Business profile draws this in the console's `hostBusinessProfile` slot.
  registrar.widget(
    "ai.site-memory", title: "What Aglyn AI learned", icon: "brain", order: 100, size: .full, requiresSite: true,
    slot: "hostBusinessProfile"
  ) { AiSiteMemoryCard(context: $0) }
  // Create with AI: the brief and the job it starts, and the entry in each list's create zone (the console's
  // `hostScreens`, `hostTemplates`, `hostLayouts`, `hostForms` and `hostComponents` widgets).
  registrar.screen(aiCreateScreen, title: "Create with AI", requiresSite: true, icon: "sparkles") { context, params in
    AiCreateScreen(
      context: context, kind: params["kind"].flatMap(AiCreateKind.init(rawValue:)), initialJobID: params["jobId"],
      initialBrief: params["brief"])
  }
  // Home's "Needs you" line, and the AI panel the shell docks beside every screen (a sheet on phones).
  registrar.widget("ai.needs-you", title: "Needs you", order: 40, requiresSite: true, slot: "homeNeedsYou") {
    AiNeedsYouWidget(context: $0)
  }
  registrar.widget("ai.assist-panel", title: "Assist", order: 10, slot: assistPanelSlot) { AiAssistPanel(context: $0) }
  // "Ask AI about these numbers" (the console's `hostDashboard` and `orgDashboard` tiles): on a site's Home and Analytics,
  // and on the workspace's Home; on a plan without the AI add-on the same tile opens the add-on's offer.
  registrar.widget("ai.insight-ask", title: "Ask AI about these numbers", icon: "sparkles", order: 900, size: .half, requiresSite: true) {
    AiInsightTile(context: $0, surface: .analytics)
  }
  registrar.widget(
    "ai.org-insight-ask", title: "Ask AI about these numbers", icon: "sparkles", order: 900, size: .half, slot: "orgDashboard"
  ) { AiInsightTile(context: $0, surface: .workspace) }
  for kind in AiCreateKind.allCases {
    registrar.widget(kind.widgetID, title: "Create with AI", icon: "sparkles", order: 10, requiresSite: true, slot: kind.slot) {
      AiCreateButton(context: $0, kind: kind)
    }
  }
}
