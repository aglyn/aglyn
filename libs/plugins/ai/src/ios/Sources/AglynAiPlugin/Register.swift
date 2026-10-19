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
  for kind in AiCreateKind.allCases {
    registrar.widget(kind.widgetID, title: "Create with AI", icon: "sparkles", order: 10, requiresSite: true, slot: kind.slot) {
      AiCreateButton(context: $0, kind: kind)
    }
  }
}
