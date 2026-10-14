// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import Foundation

/// The Loyalty plugin's native registration: its spec screens, drawn by the
/// shared spec renderer. The ids are the ones plugins.config.json declares
/// under `loyalty.mobile.contributes`.
@MainActor
public func registerLoyaltyNative(_ registrar: NativePluginRegistrar) {
  SpecScreens.register(ScreenCatalog.load(from: .module), into: registrar)
}
