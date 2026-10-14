// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import Foundation

/// The InventorySync plugin's native registration: its spec screens, drawn by the
/// shared spec renderer. The ids are the ones plugins.config.json declares
/// under `inventory-sync.mobile.contributes`.
@MainActor
public func registerInventorySyncNative(_ registrar: NativePluginRegistrar) {
  SpecScreens.register(ScreenCatalog.load(from: .module), into: registrar)
}
