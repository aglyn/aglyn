// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import Foundation

/// The Domains plugin's native registration: the workspace's Domains page and a page per name, drawn by the shared spec
/// renderer from Resources/domains.screens.json. The ids are the ones plugins.config.json declares under
/// `domains.mobile.contributes`.
@MainActor
public func registerDomainsNative(_ registrar: NativePluginRegistrar) {
  SpecScreens.register(domainsScreenSpecs(), into: registrar)
}

/// The plugin's spec screens, as its Resources hold them.
func domainsScreenSpecs() -> [ScreenSpec] { ScreenCatalog.load(from: .module) }
