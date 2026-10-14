package com.aglyn.plugins.marketplaces

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The Marketplaces plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/marketplaces.screens.json. The ids are the ones
 * plugins.config.json declares under `marketplaces.mobile.contributes`.
 */
fun registerMarketplacesNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(MarketplacesScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
