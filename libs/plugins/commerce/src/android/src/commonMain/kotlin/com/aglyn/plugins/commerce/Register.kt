package com.aglyn.plugins.commerce

import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.PosPlacement
import com.aglyn.pluginhost.ScreenLayout
import com.aglyn.pluginhost.WidgetSize
import com.aglyn.plugins.commerce.orders.COMMERCE_ORDERS_SCREEN
import com.aglyn.plugins.commerce.orders.COMMERCE_ORDER_SCREEN
import com.aglyn.plugins.commerce.orders.OrdersScreen
import com.aglyn.plugins.commerce.orders.OrdersToShipWidget
import com.aglyn.plugins.commerce.products.COMMERCE_PRODUCTS_SCREEN
import com.aglyn.plugins.commerce.products.COMMERCE_PRODUCT_SCREEN
import com.aglyn.plugins.commerce.products.COMMERCE_SCAN_SCREEN
import com.aglyn.plugins.commerce.products.ProductsScreen
import com.aglyn.plugins.commerce.products.ScanScreen
import com.aglyn.plugins.commerce.sales.COMMERCE_SALES_SCREEN
import com.aglyn.plugins.commerce.sales.SalesScreen
import com.aglyn.plugins.commerce.sales.SalesTrendWidget
import com.aglyn.plugins.commerce.sales.TodaySalesWidget
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
 * Aglyn: the site's orders natively (list beside the picked order, ship,
 * deliver, refund, cancel, resend the receipt), an Orders tab, the
 * orders-to-ship Home card and its quick action; Sales with its Today and
 * Last 7 days Home cards; Products (the catalog beside a product's variants,
 * prices, codes and stock), its tab, and Scan stock by camera or typed code.
 * New product stays out of the app (no `apps`) until product writes land.
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

  r.screen(COMMERCE_ORDERS_SCREEN, title = "Orders", requiresSite = true, icon = "receipt", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    OrdersScreen(context, initialOrderId = params["order"])
  }
  r.screen(COMMERCE_ORDER_SCREEN, title = "Order", requiresSite = true, icon = "receipt", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    OrdersScreen(context, initialOrderId = params["order"] ?: params["orderId"])
  }
  r.screen(COMMERCE_PRODUCTS_SCREEN, title = "Products", requiresSite = true, icon = "inventory", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    ProductsScreen(context, initialProductId = params["product"])
  }
  r.screen(COMMERCE_PRODUCT_SCREEN, title = "Product", requiresSite = true, icon = "inventory", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    ProductsScreen(context, initialProductId = params["product"] ?: params["productId"])
  }
  r.screen(COMMERCE_SCAN_SCREEN, title = "Scan stock", requiresSite = true, icon = "qr_code_scanner") { context, _ -> ScanScreen(context) }
  r.screen(COMMERCE_SALES_SCREEN, title = "Sales", requiresSite = true, icon = "insights") { context, _ -> SalesScreen(context) }
  r.deepLink("commerce.orders-page", path = "/products/orders", screen = "commerce.orders")
  r.deepLink("commerce.products-page", path = "/products", screen = "commerce.products")

  val none = emptySet<NativeApp>()
  r.tab("commerce.orders-tab", title = "Orders", icon = "receipt", screen = COMMERCE_ORDERS_SCREEN, order = 100)
  r.tab("commerce.products-tab", title = "Products", icon = "inventory", screen = COMMERCE_PRODUCTS_SCREEN, order = 110)
  r.widget("commerce.today", title = "Today", order = 80, size = WidgetSize.HALF, requiresSite = true) { context -> TodaySalesWidget(context) }
  r.widget("commerce.sales-trend", title = "Last 7 days", order = 110, size = WidgetSize.FULL, requiresSite = true) { context -> SalesTrendWidget(context) }
  r.widget("commerce.to-ship", title = "To ship", order = 90, size = WidgetSize.HALF, requiresSite = true) { context -> OrdersToShipWidget(context) }
  r.quickAction("commerce.orders-to-ship", "Ship orders", "local_shipping", 100, requiresSite = true, screen = COMMERCE_ORDERS_SCREEN)
  r.quickAction("commerce.new-product", "New product", "inventory", 110, requiresSite = true, screen = "commerce.product", apps = none)
  r.quickAction("commerce.scan", "Scan stock", "qr_code_scanner", 120, requiresSite = true, screen = COMMERCE_SCAN_SCREEN)
}
