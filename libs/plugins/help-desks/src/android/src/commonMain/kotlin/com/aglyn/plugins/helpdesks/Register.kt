package com.aglyn.plugins.helpdesks

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The Help desks plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/help-desks.screens.json. The ids are the ones
 * plugins.config.json declares under `help-desks.mobile.contributes`.
 */
fun registerHelpDesksNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(HelpDesksScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
