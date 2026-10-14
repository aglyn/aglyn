package com.aglyn.plugins.shipping

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The Shipping plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/shipping.screens.json. The ids are the ones
 * plugins.config.json declares under `shipping.mobile.contributes`.
 */
fun registerShippingNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(ShippingScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
