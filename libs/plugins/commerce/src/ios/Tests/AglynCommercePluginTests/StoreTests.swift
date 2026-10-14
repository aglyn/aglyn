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

  func testEachChipIsAPlanTheOrdersPageServes() {
    for filter in OrderFilter.allCases {
      XCTAssertTrue(ordersPlan(filter, search: "").refused.isEmpty, filter.rawValue)
    }
    let plan = ordersPlan(.unfulfilled, search: "")
    XCTAssertTrue(plan.constraints.contains { $0.path == "status" && ($0.value as? [Any])?.count == 2 })
    XCTAssertEqual(plan.orderBy.path, "createdAtMs")
  }

  func testOnlyTheTransitionsTheRulesAllowAreOffered() {
    XCTAssertEqual(OrderAction.available(for: .paid), [.fulfill, .cancel])
    XCTAssertEqual(OrderAction.available(for: .fulfilled), [.deliver])
    XCTAssertEqual(OrderAction.available(for: .refunded), [])
  }

  func testARefundIsOfferedOnlyWhileSomethingIsLeftToRefund() {
    XCTAssertTrue(orderCanRefund(HostOrder(status: .paid, totals: OrderTotals(totalCents: 2500))))
    XCTAssertFalse(orderCanRefund(HostOrder(status: .pending, totals: OrderTotals(totalCents: 2500))))
    XCTAssertFalse(orderCanRefund(HostOrder(refundedCents: 2500, status: .paid, totals: OrderTotals(totalCents: 2500))))
    XCTAssertEqual(
      orderRefundableCents(HostOrder(refundedCents: 500, status: .fulfilled, totals: OrderTotals(totalCents: 2500))), 2000)
  }

  func testSalesAreTheConsolesFiguresByLocalDay() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Chicago")!
    let now = Date(timeIntervalSince1970: 1_760_000_000)
    let ms = { (date: Date) in date.timeIntervalSince1970 * 1000 }
    let live = { (order: HostOrder) in FigureOrder(id: "o", livemode: true, order: order) }
    let orders = [
      live(HostOrder(createdAtMs: ms(now), refundedCents: 500, status: .paid, totals: OrderTotals(totalCents: 3000))),
      live(HostOrder(createdAtMs: ms(now), status: .pending, totals: OrderTotals(totalCents: 9999))),
      FigureOrder(id: "cs_test_1", livemode: nil, order: HostOrder(createdAtMs: ms(now), status: .paid, totals: OrderTotals(totalCents: 4000))),
      live(HostOrder(createdAtMs: ms(now.addingTimeInterval(-86_400 * 2)), status: .fulfilled, totals: OrderTotals(totalCents: 1000))),
      live(HostOrder(createdAtMs: ms(now.addingTimeInterval(-86_400 * 30)), status: .paid, totals: OrderTotals(totalCents: 7000))),
    ]
    let summary = summarizeSales(orders, now: now, calendar: calendar)
    XCTAssertEqual(summary.days.count, 7)
    XCTAssertEqual(summary.today?.orders, 1)
    XCTAssertEqual(summary.today?.cents, orderPaidCents(liftLegacyOrder(orders[0].order)))
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
      widgets: ["commerce.sales-trend", "commerce.to-ship", "commerce.today"],
      quickActions: ["commerce.new-product", "commerce.orders-to-ship", "commerce.scan"],
      deepLinks: ["commerce.orders-page", "commerce.products-page"])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "commerce", contributes: declared, register: registerCommerceNative)],
      into: registry)
    XCTAssertEqual(result.loaded, ["commerce"])
    XCTAssertTrue(registry.quickActions(for: .aglyn).allSatisfy { registry.screen($0.screen) != nil })
    XCTAssertEqual(registry.tabs(for: .aglyn).map(\.id), ["commerce.orders-tab", "commerce.products-tab"])
    XCTAssertEqual(registry.resolve("/acme/hosts/shop/products/orders"), .screen("commerce.orders", ["orgSlug": "acme", "hostSlug": "shop"]))
    XCTAssertEqual(registry.screens(for: .pos).map(\.id), ["commerce.card-readers", "commerce.register"])
  }
}

/// A refund of part of an order, and a receipt by text (the Kotlin kit's checkRefundAmount and checkReceiptRecipient).
final class RefundAndReceiptTests: XCTestCase {
  func testARefundAmountMustBeAboveZeroAndNoMoreThanIsLeft() {
    XCTAssertEqual(checkRefundAmount(nil, refundableCents: 2000), "Enter an amount above zero")
    XCTAssertEqual(checkRefundAmount(0, refundableCents: 2000), "Enter an amount above zero")
    XCTAssertEqual(checkRefundAmount(2001, refundableCents: 2000), "That is more than is left to refund")
    XCTAssertNil(checkRefundAmount(2000, refundableCents: 2000))
    XCTAssertNil(checkRefundAmount(1, refundableCents: 2000))
  }

  func testTypedMoneyBecomesCents() {
    XCTAssertEqual(centsFromText("12.50"), 1250)
    XCTAssertEqual(centsFromText("$12.5"), 1250)
    XCTAssertEqual(centsFromText("12"), 1200)
    XCTAssertNil(centsFromText("twelve"))
  }

  func testAReceiptRecipientIsCheckedForItsChannel() {
    XCTAssertNil(checkReceiptRecipient(.email, "buyer@example.com"))
    XCTAssertEqual(checkReceiptRecipient(.email, "buyer"), "Enter an email address")
    XCTAssertNil(checkReceiptRecipient(.sms, "+1 (512) 555-0100"))
    XCTAssertEqual(checkReceiptRecipient(.sms, "12"), "Enter a phone number")
    XCTAssertEqual(ReceiptChannel.sms.label, "Text")
    XCTAssertEqual(ReceiptChannel.allCases.map(\.rawValue), ["email", "sms"])
  }
}
