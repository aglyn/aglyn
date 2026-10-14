// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import Foundation

/// The AI plugin's native registration: its spec screens (jobs, credits,
/// per-member use, and the staffOrg and staffUser zones), their links, the
/// site's "AI jobs" quick action and what it adds to the site's setup pages. The ids are the ones plugins.config.json
/// declares under `ai.mobile.contributes`.
@MainActor
public func registerAINative(_ registrar: NativePluginRegistrar) {
  SpecScreens.register(ScreenCatalog.load(from: .module), into: registrar)
  registrar.quickAction(
    "ai.open", title: "AI jobs", icon: "sparkles", order: 60, screen: "ai.jobs", requiresSite: true)
  // Setup → SEO draws this in the console's `hostSeo` slot, under the SEO check.
  registrar.widget(
    "ai.seo-start", title: "The listing your answers describe", icon: "text.magnifyingglass", order: 90, size: .full, requiresSite: true,
    slot: "hostSeo"
  ) { AiSiteSeoStartCard(context: $0) }
  // Setup → Business profile draws this in the console's `hostBusinessProfile` slot.
  registrar.widget(
    "ai.site-memory", title: "What Aglyn AI learned", icon: "brain", order: 100, size: .full, requiresSite: true,
    slot: "hostBusinessProfile"
  ) { AiSiteMemoryCard(context: $0) }
}
