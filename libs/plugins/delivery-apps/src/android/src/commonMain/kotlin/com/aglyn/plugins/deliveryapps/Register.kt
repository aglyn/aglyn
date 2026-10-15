package com.aglyn.plugins.deliveryapps

import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.WidgetSize
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The register zone this plugin's widget sits in: where the Aglyn POS register draws what other channels send to the
 * counter. The commerce plugin hosts it and names no plugin that contributes.
 */
const val POS_ORDERS_SLOT = "posOrders"

/**
 * The DeliveryApps plugin's native registration, the ids plugins.config.json declares under
 * `delivery-apps.mobile.contributes`: its spec screens (linking a store, its settings, item matches), drawn by the
 * shared spec renderer from screens/delivery-apps.screens.json, and the delivery-order queue, a widget in the
 * register's `posOrders` zone (the Aglyn POS app only).
 */
fun registerDeliveryAppsNative(r: NativePluginRegistrar) {
  SpecScreens.register(DeliveryAppsScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, r)
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
