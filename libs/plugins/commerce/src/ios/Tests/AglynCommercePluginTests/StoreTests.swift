// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import Foundation
import XCTest

@testable import AglynCommercePlugin

final class StoreOrdersTests: XCTestCase {
  func testAStoredOrderDecodesAndAMalformedLineIsLeftOut() {
    let doc = FirestoreDocument(
      id: "o1",
      data: [
        "number": 1042, "status": "paid", "customerName": "Ada", "createdAtMs": 1_760_000_000_000,
        "createdAt": Date(timeIntervalSince1970: 1_760_000_000),
        "totals": ["totalCents": 2500, "itemsCents": 2500],
        "lineItems": [
          ["name": "Mug", "productId": "p1", "quantity": 2, "unitAmountCents": 1250],
          ["name": "Broken line with no price"],
        ],
      ])
    let row = OrderRow(id: doc.id, order: decodeOrder(doc))
    XCTAssertEqual(row.number, "#1042")
    XCTAssertEqual(row.status, .paid)
    XCTAssertEqual(row.order.lineItems?.count, 1)
    XCTAssertEqual(row.itemCount, 2)
    XCTAssertEqual(row.total, formatOrderMoney(2500))
    XCTAssertEqual(row.customer, "Ada")
  }

  func testAMistypedMemberIsDroppedNotTheOrder() {
    let doc = FirestoreDocument(
      id: "o2", data: ["number": 7, "status": "fulfilled", "dispute": "not an object", "customerEmail": "a@b.co"])
    let order = decodeOrder(doc)
    XCTAssertEqual(order.number, 7)
    XCTAssertNil(order.dispute)
    XCTAssertEqual(OrderRow(id: "o2", order: order).customer, "a@b.co")
  }

  func testTheStatusChipIsTheOrdersPagesClause() {
    let plan = ordersPlan(status: .paid, search: "")
    XCTAssertTrue(plan.refused.isEmpty)
    XCTAssertTrue(plan.constraints.contains { $0.path == "status" && $0.value as? String == "paid" })
    XCTAssertEqual(plan.orderBy.path, "createdAtMs")
  }

  func testOnlyTheTransitionsTheRulesAllowAreOffered() {
    XCTAssertEqual(OrderAction.available(for: .paid), [.fulfill, .cancel])
    XCTAssertEqual(OrderAction.available(for: .fulfilled), [.deliver])
    XCTAssertEqual(OrderAction.available(for: .refunded), [])
  }

  func testSalesCountPaidOrdersByLocalDayLessRefunds() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Chicago")!
    let now = Date(timeIntervalSince1970: 1_760_000_000)
    let ms = { (date: Date) in date.timeIntervalSince1970 * 1000 }
    let orders = [
      HostOrder(createdAtMs: ms(now), refundedCents: 500, status: .paid, totals: OrderTotals(totalCents: 3000)),
      HostOrder(createdAtMs: ms(now), status: .pending, totals: OrderTotals(totalCents: 9999)),
      HostOrder(createdAtMs: ms(now.addingTimeInterval(-86_400 * 2)), status: .fulfilled, totals: OrderTotals(totalCents: 1000)),
      HostOrder(createdAtMs: ms(now.addingTimeInterval(-86_400 * 30)), status: .paid, totals: OrderTotals(totalCents: 7000)),
    ]
    let summary = summarizeSales(orders, now: now, calendar: calendar)
    XCTAssertEqual(summary.days.count, 7)
    XCTAssertEqual(summary.today?.cents, 2500)
    XCTAssertEqual(summary.today?.orders, 1)
    XCTAssertEqual(summary.weekCents, 3500)
    XCTAssertEqual(summary.weekOrders, 2)
  }
}

@MainActor
final class CommerceRegistrationTests: XCTestCase {
  func testEveryDeclaredIDRegistersNativelyAndNothingOpensTheConsole() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(
      screens: [
        "commerce.card-readers", "commerce.order", "commerce.orders", "commerce.product", "commerce.products",
        "commerce.register", "commerce.sales", "commerce.scan",
      ],
      tabs: ["commerce.orders-tab", "commerce.products-tab"],
      widgets: ["commerce.sales-trend", "commerce.today"],
      quickActions: ["commerce.new-product", "commerce.orders-to-ship", "commerce.scan"],
      deepLinks: ["commerce.orders-page", "commerce.products-page"])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "commerce", contributes: declared, register: registerCommerceNative)],
      into: registry)
    XCTAssertEqual(result.loaded, ["commerce"])
    XCTAssertTrue(registry.quickActions(for: .aglyn).allSatisfy { $0.besignerPath == nil })
    XCTAssertEqual(registry.tabs(for: .aglyn).map(\.id), ["commerce.orders-tab", "commerce.products-tab"])
    XCTAssertEqual(registry.resolve("/acme/hosts/shop/products/orders"), .screen("commerce.orders", ["orgSlug": "acme", "hostSlug": "shop"]))
    XCTAssertEqual(registry.screens(for: .pos).map(\.id), ["commerce.card-readers", "commerce.register"])
  }
}
