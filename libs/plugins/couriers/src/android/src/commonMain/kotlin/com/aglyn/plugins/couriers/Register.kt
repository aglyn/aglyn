package com.aglyn.plugins.couriers

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The Couriers plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/couriers.screens.json. The ids are the ones
 * plugins.config.json declares under `couriers.mobile.contributes`.
 */
fun registerCouriersNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(CouriersScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
