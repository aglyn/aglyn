package com.aglyn.plugins.bookings

import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.PosPlacement

const val BOOKINGS_COUNTER_SCREEN = "bookings.counter"

/**
 * The Bookings plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. In Aglyn POS, today's
 * bookings open from the register's menu and take payment at the counter.
 */
fun registerBookingsNative(r: NativePluginRegistrar) {
  r.screen(
    BOOKINGS_COUNTER_SCREEN,
    title = "Today's bookings",
    requiresSite = true,
    apps = setOf(NativeApp.POS),
    icon = "event",
    placement = PosPlacement.MENU,
  ) { context, _ -> CounterBookingsScreen(context) }
}
