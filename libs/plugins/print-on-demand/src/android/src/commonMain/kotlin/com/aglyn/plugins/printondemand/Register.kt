package com.aglyn.plugins.printondemand

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The PrintOnDemand plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/print-on-demand.screens.json. The ids are the ones
 * plugins.config.json declares under `print-on-demand.mobile.contributes`.
 */
fun registerPrintOnDemandNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(PrintOnDemandScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
