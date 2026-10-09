package com.aglyn.plugins.funnels

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.ScreenLayout

const val FUNNELS_LIST_SCREEN = "funnels.list"

/**
 * The Funnels plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. The console shows
 * Funnels as a card on the Analytics page; the app gives it a screen of its
 * own, the funnel beside its results on wide windows, and a quick action.
 */
fun registerFunnelsNative(r: NativePluginRegistrar) {
  r.screen(FUNNELS_LIST_SCREEN, title = "Funnels", requiresSite = true, icon = "filter_alt", layout = ScreenLayout.LIST_DETAIL) { context, _ ->
    FunnelsScreen(context)
  }
  r.quickAction("funnels.open", title = "Funnels", icon = "filter_alt", order = 905, requiresSite = true, screen = FUNNELS_LIST_SCREEN)
  r.deepLink("funnels.page", path = "/funnels", screen = FUNNELS_LIST_SCREEN)
}
