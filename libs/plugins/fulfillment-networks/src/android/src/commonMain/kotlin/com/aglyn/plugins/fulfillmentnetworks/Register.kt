package com.aglyn.plugins.fulfillmentnetworks

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The FulfillmentNetworks plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/fulfillment-networks.screens.json. The ids are the ones
 * plugins.config.json declares under `fulfillment-networks.mobile.contributes`.
 */
fun registerFulfillmentNetworksNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(FulfillmentNetworksScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
