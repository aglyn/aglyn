package com.aglyn.plugins.saleschannels

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The SalesChannels plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/sales-channels.screens.json. The ids are the ones
 * plugins.config.json declares under `sales-channels.mobile.contributes`.
 */
fun registerSalesChannelsNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(SalesChannelsScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
