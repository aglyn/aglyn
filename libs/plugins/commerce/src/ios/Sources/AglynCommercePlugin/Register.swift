// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynHardware
import AglynPluginHost
import SwiftUI

public let commerceRegisterScreen = "commerce.register"
public let commerceCardReadersScreen = "commerce.card-readers"

public let commerceOrdersScreen = "commerce.orders"
public let commerceOrderScreen = "commerce.order"
public let commerceProductsScreen = "commerce.products"
public let commerceProductScreen = "commerce.product"
public let commerceScanScreen = "commerce.scan"
public let commerceSalesScreen = "commerce.sales"

/// The Commerce plugin's native registration: the same ids its
/// `mobile.contributes` declares in plugins.config.json (the Android
/// registrar names the same ones).
///
/// Aglyn POS: the register (item grid, basket, checkout and receipt) and the
/// card readers screen.
///
/// Aglyn: the store, natively: orders (list, detail, fulfill, deliver,
/// cancel), products (list, detail), a barcode scan that finds a product,
/// and sales (today, the week); Home's to-ship and sales cards, and the
/// ship-orders and scan quick actions.
@MainActor
public func registerCommerceNative(_ r: NativePluginRegistrar) {
  // The device's reader, for any plugin's counter payment (a booking's).
  if DeviceCardReaders.shared == nil { DeviceCardReaders.shared = DeviceCardCollector.make() }
  r.screen(
    commerceRegisterScreen, title: "Register", requiresSite: true, apps: [.pos], icon: "cashregister",
    placement: .register
  ) { context, _ in
    RegisterScreen(context: context)
  }
  r.screen(
    commerceCardReadersScreen, title: "Card readers", requiresSite: true, apps: [.pos], icon: "creditcard",
    placement: .menu
  ) { context, _ in
    CardReadersScreen(context: context)
  }

  r.screen(commerceOrdersScreen, title: "Orders", requiresSite: true, icon: "bag") { context, params in
    OrdersScreen(context: context, initialFilter: params["filter"].flatMap(OrderFilter.init(rawValue:)) ?? .all)
  }
  r.screen(commerceOrderScreen, title: "Order", requiresSite: true, icon: "bag") { context, params in
    OrderScreen(context: context, orderID: params["orderId"] ?? "")
  }
  r.screen(commerceProductsScreen, title: "Products", requiresSite: true, icon: "shippingbox") { context, _ in
    ProductsScreen(context: context)
  }
  r.screen(commerceProductScreen, title: "Product", requiresSite: true, icon: "shippingbox") { context, params in
    ProductScreen(context: context, productID: params["productId"] ?? "")
  }
  r.screen(commerceScanScreen, title: "Scan", requiresSite: true, icon: "barcode.viewfinder") { context, _ in
    ScanScreen(context: context)
  }
  r.screen(commerceSalesScreen, title: "Sales", requiresSite: true, icon: "chart.bar") { context, _ in
    SalesScreen(context: context)
  }
  r.deepLink("commerce.orders-page", path: "/products/orders", screen: commerceOrdersScreen)
  r.deepLink("commerce.products-page", path: "/products", screen: commerceProductsScreen)

  r.tab("commerce.orders-tab", title: "Orders", icon: "bag", screen: commerceOrdersScreen, order: 100)
  r.tab("commerce.products-tab", title: "Products", icon: "shippingbox", screen: commerceProductsScreen, order: 110)
  r.widget("commerce.to-ship", title: "To ship", order: 90, size: .half, requiresSite: true) { context in
    OrdersToShipWidget(context: context)
  }
  r.widget("commerce.today", title: "Today", order: 100, size: .half, requiresSite: true) { context in
    SalesTodayWidget(context: context)
  }
  r.widget("commerce.sales-trend", title: "Last 7 days", order: 110, size: .full, requiresSite: true) { context in
    SalesTrendWidget(context: context)
  }
  r.quickAction(
    "commerce.orders-to-ship", title: "Ship orders", icon: "shippingbox", order: 100, screen: commerceOrdersScreen,
    params: ["filter": OrderFilter.unfulfilled.rawValue], requiresSite: true)
  // Hidden until product creation lands natively; the list has no create form above it.
  r.quickAction(
    "commerce.new-product", title: "New product", icon: "plus.square", order: 110, screen: commerceProductScreen,
    requiresSite: true, apps: [])
  r.quickAction(
    "commerce.scan", title: "Scan stock", icon: "barcode.viewfinder", order: 120, screen: commerceScanScreen,
    requiresSite: true)
}
