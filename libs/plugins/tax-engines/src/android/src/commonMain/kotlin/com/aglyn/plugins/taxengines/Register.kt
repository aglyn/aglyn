package com.aglyn.plugins.taxengines

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The TaxEngines plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/tax-engines.screens.json. The ids are the ones
 * plugins.config.json declares under `tax-engines.mobile.contributes`.
 */
fun registerTaxEnginesNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(TaxEnginesScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
