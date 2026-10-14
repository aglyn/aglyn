// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost

/// The register zone this plugin's widget sits in: where the Aglyn POS register draws what other channels send to
/// the counter. The commerce plugin hosts it and names no plugin that contributes.
public let posOrdersSlot = "posOrders"

/// Registers the ids `plugins.config.json` declares under the plugin's `mobile.contributes`: the delivery-order
/// queue, a widget in the register's `posOrders` zone (the Aglyn POS app only).
@MainActor
public func registerDeliveryAppsNative(_ r: NativePluginRegistrar) {
  r.widget(
    "delivery-apps.pos-orders", title: "Delivery orders", icon: "bag", order: 100, size: .full, requiresSite: true,
    apps: [.pos], slot: posOrdersSlot
  ) {
    DeliveryQueueView(context: $0)
  }
}
