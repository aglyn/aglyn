package com.aglyn.plugins.redirects

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.ScreenLayout
import com.aglyn.pluginhost.WidgetSize

const val REDIRECTS_LIST_SCREEN = "redirects.list"

/**
 * The Redirects plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. The site's rules as a
 * list beside the selected rule (list-detail on wide windows), a dashboard
 * count, a quick action, and the console's Redirects page opening natively.
 */
fun registerRedirectsNative(r: NativePluginRegistrar) {
  r.screen(REDIRECTS_LIST_SCREEN, title = "Redirects", requiresSite = true, icon = "alt_route", layout = ScreenLayout.LIST_DETAIL) { context, _ ->
    RedirectsListScreen(context)
  }
  r.widget("redirects.summary", title = "Redirects", order = 900, size = WidgetSize.HALF, requiresSite = true) { context ->
    RedirectsSummaryWidget(context)
  }
  r.quickAction("redirects.open", title = "Redirects", icon = "alt_route", order = 900, requiresSite = true, screen = REDIRECTS_LIST_SCREEN)
  r.deepLink("redirects.page", path = "/redirects", screen = REDIRECTS_LIST_SCREEN)
}
