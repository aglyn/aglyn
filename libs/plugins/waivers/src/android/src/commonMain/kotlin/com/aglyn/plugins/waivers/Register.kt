package com.aglyn.plugins.waivers

import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginRegistrar

/**
 * The Waivers plugin's native registration: a rider's waiver in commerce's check-in zone, as the console registers
 * `waivers-check-in-status`. The id is the one plugins.config.json declares under `waivers.mobile.contributes`.
 */
fun registerWaiversNative(registrar: NativePluginRegistrar) {
  // Both apps: the register runs in Aglyn POS as well as in Aglyn.
  registrar.widget(WAIVERS_CHECK_IN_WIDGET, title = "Waiver", order = 10, apps = setOf(NativeApp.AGLYN, NativeApp.POS), slot = WAIVERS_CHECK_IN_SLOT) { context ->
    WaiverCheckInStatus(context)
  }
}
