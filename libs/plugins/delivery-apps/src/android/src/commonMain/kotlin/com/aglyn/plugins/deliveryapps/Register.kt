package com.aglyn.plugins.deliveryapps

import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.WidgetSize

/**
 * The register zone this plugin's widget sits in: where the Aglyn POS register draws what other channels send to the
 * counter. The commerce plugin hosts it and names no plugin that contributes.
 */
const val POS_ORDERS_SLOT = "posOrders"

/**
 * The Delivery apps plugin's native registration: the same ids its `mobile.contributes` declares in
 * plugins.config.json. The delivery-order queue, a widget in the register's `posOrders` zone (the Aglyn POS app only).
 */
fun registerDeliveryAppsNative(r: NativePluginRegistrar) {
  r.widget(
    "delivery-apps.pos-orders",
    title = "Delivery orders",
    order = 100,
    size = WidgetSize.FULL,
    requiresSite = true,
    apps = setOf(NativeApp.POS),
    slot = POS_ORDERS_SLOT,
  ) { context -> DeliveryQueueCard(context) }
}
