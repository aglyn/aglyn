package com.aglyn.plugins.adconversions

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The AdConversions plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/ad-conversions.screens.json. The ids are the ones
 * plugins.config.json declares under `ad-conversions.mobile.contributes`.
 */
fun registerAdConversionsNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(AdConversionsScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
