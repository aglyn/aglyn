package com.aglyn.plugins.deliveryapps

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The DeliveryApps plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/delivery-apps.screens.json. The ids are the ones
 * plugins.config.json declares under `delivery-apps.mobile.contributes`.
 */
fun registerDeliveryAppsNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(DeliveryAppsScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
