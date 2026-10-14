package com.aglyn.plugins.loyalty

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The Loyalty plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/loyalty.screens.json. The ids are the ones
 * plugins.config.json declares under `loyalty.mobile.contributes`.
 */
fun registerLoyaltyNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(LoyaltyScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
