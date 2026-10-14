package com.aglyn.plugins.livechat

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

/**
 * The LiveChat plugin's native registration: its spec screens, drawn by the
 * shared spec renderer from screens/live-chat.screens.json. The ids are the ones
 * plugins.config.json declares under `live-chat.mobile.contributes`.
 */
fun registerLiveChatNative(registrar: NativePluginRegistrar) {
  SpecScreens.register(LiveChatScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, registrar)
}
