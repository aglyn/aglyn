// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import Foundation

/// The AI plugin's native registration: its spec screens (jobs, credits,
/// per-member use, and the staffOrg and staffUser zones), their links, and
/// the site's "AI jobs" quick action. The ids are the ones plugins.config.json
/// declares under `ai.mobile.contributes`.
@MainActor
public func registerAINative(_ registrar: NativePluginRegistrar) {
  SpecScreens.register(ScreenCatalog.load(from: .module), into: registrar)
  registrar.quickAction(
    "ai.open", title: "AI jobs", icon: "sparkles", order: 60, screen: "ai.jobs", requiresSite: true)
}
