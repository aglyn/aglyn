// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import Foundation

/// The register zone this plugin's widget sits in: where the Aglyn POS register draws what other channels send to
/// the counter. The commerce plugin hosts it and names no plugin that contributes.
public let posOrdersSlot = "posOrders"

/// The DeliveryApps plugin's native registration, the ids plugins.config.json declares under
/// `delivery-apps.mobile.contributes`: its spec screens (linking a store, its settings, item matches), drawn by the
/// shared spec renderer, and the delivery-order queue, a widget in the register's `posOrders` zone (the Aglyn POS
/// app only).
@MainActor
public func registerDeliveryAppsNative(_ r: NativePluginRegistrar) {
  SpecScreens.register(ScreenCatalog.load(from: .module), into: r)
  r.widget(
    "delivery-apps.pos-orders", title: "Delivery orders", icon: "bag", order: 100, size: .full, requiresSite: true,
    apps: [.pos], slot: posOrdersSlot
  ) {
    DeliveryQueueView(context: $0)
  }
}
