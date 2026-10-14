package com.aglyn.plugins.inventorysync

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The InventorySync plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/inventory-sync.screens.json. The ids are the ones
 * plugins.config.json declares under `inventory-sync.mobile.contributes`.
 */
fun registerInventorySyncNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(InventorySyncScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
