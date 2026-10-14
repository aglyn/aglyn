package com.aglyn.plugins.zapier

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The Zapier plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/zapier.screens.json. The ids are the ones
 * plugins.config.json declares under `zapier.mobile.contributes`.
 */
fun registerZapierNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(ZapierScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
