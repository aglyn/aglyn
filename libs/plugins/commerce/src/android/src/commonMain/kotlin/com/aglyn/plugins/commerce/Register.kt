package com.aglyn.plugins.commerce

import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.PosPlacement
import com.aglyn.plugins.commerce.pos.CardReadersScreen
import com.aglyn.plugins.commerce.pos.RegisterScreen

const val COMMERCE_REGISTER_SCREEN = "commerce.register"
const val COMMERCE_CARD_READERS_SCREEN = "commerce.card-readers"

/**
 * The Commerce plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json.
 *
 * Aglyn POS: the register (item grid, basket, checkout and receipt) and
 * the card readers panel. Bookings taken at the counter are the Bookings
 * plugin's own POS screen.
 *
 * Aglyn: the store screens declared for the app (orders, products, scan,
 * sales) are served by the console's own pages here until their native
 * versions land; their tabs, Home cards and quick actions stay out of the
 * app (no `apps`) rather than lead to a page that only opens the console.
 */
fun registerCommerceNative(r: NativePluginRegistrar) {
  r.screen(
    COMMERCE_REGISTER_SCREEN,
    title = "Register",
    requiresSite = true,
    apps = setOf(NativeApp.POS),
    icon = "point_of_sale",
    placement = PosPlacement.REGISTER,
  ) { context, _ -> RegisterScreen(context) }
  r.screen(
    COMMERCE_CARD_READERS_SCREEN,
    title = "Card readers",
    requiresSite = true,
    apps = setOf(NativeApp.POS),
    icon = "credit_card",
    placement = PosPlacement.MENU,
  ) { context, _ -> CardReadersScreen(context) }

  r.consoleScreen("commerce.orders", "Orders", "/products/orders")
  r.consoleScreen("commerce.order", "Order", "/products/orders")
  r.consoleScreen("commerce.products", "Products", "/products")
  r.consoleScreen("commerce.product", "Product", "/products")
  r.consoleScreen("commerce.scan", "Scan", "/products")
  r.consoleScreen("commerce.sales", "Sales", "/products/orders")
  r.deepLink("commerce.orders-page", path = "/products/orders", screen = "commerce.orders")
  r.deepLink("commerce.products-page", path = "/products", screen = "commerce.products")

  val none = emptySet<NativeApp>()
  r.tab("commerce.orders-tab", title = "Orders", icon = "receipt", screen = "commerce.orders", order = 100, apps = none)
  r.tab("commerce.products-tab", title = "Products", icon = "inventory", screen = "commerce.products", order = 110, apps = none)
  r.widget("commerce.today", title = "Today", order = 100, requiresSite = true, apps = none) { }
  r.widget("commerce.sales-trend", title = "Last 7 days", order = 110, requiresSite = true, apps = none) { }
  r.quickAction("commerce.orders-to-ship", "Ship orders", "inventory", 100, requiresSite = true, screen = "commerce.orders", apps = none)
  r.quickAction("commerce.new-product", "New product", "inventory", 110, requiresSite = true, screen = "commerce.product", apps = none)
  r.quickAction("commerce.scan", "Scan stock", "inventory", 120, requiresSite = true, screen = "commerce.scan", apps = none)
}
