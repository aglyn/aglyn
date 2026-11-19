package com.aglyn.plugins.domains

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The Domains plugin's native registration: the workspace's Domains page and a page per name, drawn by the shared spec
 * renderer from screens/domains.screens.json. The ids are the ones plugins.config.json declares under
 * `domains.mobile.contributes`.
 */
fun registerDomainsNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(DomainsScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
