package com.aglyn.plugins.accounting

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The Accounting plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/accounting.screens.json. The ids are the ones
 * plugins.config.json declares under `accounting.mobile.contributes`.
 */
fun registerAccountingNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(AccountingScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
