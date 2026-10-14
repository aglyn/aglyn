package com.aglyn.plugins.marketingplatforms

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The MarketingPlatforms plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/marketing-platforms.screens.json. The ids are the ones
 * plugins.config.json declares under `marketing-platforms.mobile.contributes`.
 */
fun registerMarketingPlatformsNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(MarketingPlatformsScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
