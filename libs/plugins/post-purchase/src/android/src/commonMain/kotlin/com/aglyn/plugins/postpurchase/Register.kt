package com.aglyn.plugins.postpurchase

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The PostPurchase plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/post-purchase.screens.json. The ids are the ones
 * plugins.config.json declares under `post-purchase.mobile.contributes`.
 */
fun registerPostPurchaseNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(PostPurchaseScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
