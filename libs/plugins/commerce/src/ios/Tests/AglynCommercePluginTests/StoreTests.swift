// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import Foundation
import XCTest

@testable import AglynCommercePlugin

final class StoreOrdersTests: XCTestCase {
  /// The status chips take the console's colors (ORDER_STATUS_COLOR), as the Kotlin app does: refunded is the alarm.
  func testStatusTonesAreTheConsoles() {
    XCTAssertEqual(orderStatusTone(.paid), .success)
    XCTAssertEqual(orderStatusTone(.partiallyFulfilled), .warning)
    XCTAssertEqual(orderStatusTone(.fulfilled), .info)
    XCTAssertEqual(orderStatusTone(.delivered), .info)
    XCTAssertEqual(orderStatusTone(.refunded), .error)
    XCTAssertEqual(orderStatusTone(.pending), .neutral)
    XCTAssertEqual(orderStatusTone(.cancelled), .neutral)
  }

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
    let summary = salesReport(orders, range: 7, now: now, calendar: calendar)
    XCTAssertEqual(summary.days.count, 7)
    XCTAssertEqual(summary.today?.orders, 1)
    XCTAssertEqual(summary.today?.cents, orderPaidCents(liftLegacyOrder(orders[0].order)))
    XCTAssertEqual(summary.current.orders, 2)
    XCTAssertEqual(summary.previous.orders, 0, "the order 30 days back is in neither week")
    XCTAssertNil(summary.revenueDeltaPct, "no baseline, no comparison")
    let month = salesReport(orders, range: 30, now: now, calendar: calendar)
    XCTAssertEqual(month.days.count, 30)
    XCTAssertEqual(month.current.orders, 2)
    XCTAssertEqual(month.previous.orders, 1)
  }

  func testAWeekIsComparedWithTheWeekBeforeAndSplitByChannelAndProduct() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let now = Date(timeIntervalSince1970: 1_791_385_200)  // 2026-10-07 15:00 UTC
    let today = calendar.startOfDay(for: now)
    let ms = { (date: Date) in date.timeIntervalSince1970 * 1000 }
    func sale(_ id: String, at: Date, cents: Double, channel: OrderChannel = .online, status: OrderStatus = .paid) -> FigureOrder {
      FigureOrder(
        id: id, livemode: true,
        order: HostOrder(
          channel: channel, createdAtMs: ms(at), lineItems: [OrderLineItem(name: "Mug", productId: "p1", quantity: 1, unitAmountCents: cents)],
          status: status, totals: OrderTotals(totalCents: cents)))
    }
    let day = 86_400.0
    let orders = [
      sale("a", at: today.addingTimeInterval(1), cents: 1000),
      sale("b", at: today.addingTimeInterval(-day + 5), cents: 500, channel: .pos),
      sale("c", at: today.addingTimeInterval(-8 * day), cents: 750),
      sale("d", at: today.addingTimeInterval(2), cents: 999, status: .pending),
    ]
    let report = salesReport(orders, range: 7, now: now, calendar: calendar)
    XCTAssertEqual(report.current.orders, 2)
    XCTAssertEqual(report.current.revenueCents, 1500)
    XCTAssertEqual(report.previous.revenueCents, 750)
    XCTAssertEqual(report.revenueDeltaPct, 100)
    XCTAssertEqual(report.days.map(\.cents), [0, 0, 0, 0, 0, 500, 1000])
    XCTAssertEqual(report.channels.map(\.label), ["Online", "POS"])
    XCTAssertEqual(report.channels.map(\.cents), [1000, 500])
    XCTAssertEqual(report.topProducts.map(\.name), ["Mug"])
    XCTAssertEqual(report.topProducts.first?.cents, 1500)
    XCTAssertNil(salesReport(orders, range: 7, now: now, calendar: calendar, capped: true).revenueDeltaPct, "a capped read makes no comparison")
    XCTAssertEqual(salesChange(100), "+100% vs the period before")
    XCTAssertEqual(salesChange(-12.5), "-12.5% vs the period before")
    XCTAssertNil(salesChange(nil))
  }

  func testEveryFigureWaitsForAPlanThatSellsCommerceAnalytics() {
    // The console shows these figures from Pro up; the app shows them to the same plans.
    XCTAssertTrue(salesAccess(["plan": "pro"]).carried)
    let starter = salesAccess(["plan": "starter"])
    XCTAssertFalse(starter.carried)
    XCTAssertEqual(starter.plan, "Pro", "the plan an upsell names is the cheapest that includes it")
    XCTAssertFalse(salesAccess(nil).carried, "a workspace that cannot be read gets no figures")
    XCTAssertTrue(
      salesAccess(["plan": "starter", "entitlements": ["features": ["commerceAnalytics": true]]]).carried,
      "a feature granted to the workspace itself counts, as it does in the console")
    XCTAssertTrue(salesLockedText(starter.plan).contains("included from Pro"))
  }
}

/// The Home card's low-stock count: the products at or under their alert, as the console's card counts them.
final class GlanceTests: XCTestCase {
  private func product(_ id: String, threshold: Int?, stock: Int?, deleted: Bool = false) -> FirestoreDocument {
    var variant: [String: Any] = ["id": "default", "priceUsd": 10.0]
    if let stock { variant["inventory"] = stock }
    var data: [String: Any] = ["name": "Mug \(id)", "variants": [variant]]
    if let threshold { data["lowStockThreshold"] = threshold }
    if deleted { data["deletedAt"] = 1 }
    return FirestoreDocument(id: id, data: data)
  }

  func testAProductIsLowAtOrUnderItsAlertWhenItTracksStockAndHasOne() {
    let docs = [
      product("a", threshold: 5, stock: 5), product("b", threshold: 5, stock: 6), product("c", threshold: nil, stock: 0),
      product("d", threshold: 5, stock: nil), product("e", threshold: 2, stock: 0), product("f", threshold: 5, stock: 1, deleted: true),
    ]
    XCTAssertEqual(glanceLowStock(docs), 2, "at the alert counts; above it, no alert, untracked and deleted do not")
  }

  func testOnlyTheFirstTwoHundredFiftyProductsAreCounted() {
    let docs = (1...300).map { product("p\($0)", threshold: 10, stock: 1) }
    XCTAssertEqual(glanceLowStock(docs), glanceProductCeiling)
  }
}

@MainActor
final class CommerceRegistrationTests: XCTestCase {
  /// What `plugins.config.json` declares for commerce under `mobile.contributes`: the screens grow with every spec, and the
  /// plugin is held to exactly the list it declares, so the test reads the declaration rather than restating it.
  private func declared() throws -> NativeContributionDeclaration {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
    let data = try Data(contentsOf: root.appendingPathComponent("plugins.config.json"))
    let plugins = try XCTUnwrap((try JSONSerialization.jsonObject(with: data) as? [String: Any])?["plugins"] as? [[String: Any]])
    let commerce = try XCTUnwrap(plugins.first { $0["id"] as? String == "commerce" })
    let contributes = try XCTUnwrap((commerce["mobile"] as? [String: Any])?["contributes"] as? [String: [String]])
    return NativeContributionDeclaration(
      screens: contributes["screens"] ?? [], tabs: contributes["tabs"] ?? [], widgets: contributes["widgets"] ?? [],
      quickActions: contributes["quickActions"] ?? [], deepLinks: contributes["deepLinks"] ?? [])
  }

  func testEveryDeclaredIDRegistersNativelyAndNothingOpensTheConsole() throws {
    let registry = NativePluginRegistry()
    let declared = try declared()
    XCTAssertTrue(declared.screens.count > 9, "the declaration was read")
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "commerce", contributes: declared, register: registerCommerceNative)],
      into: registry)
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(result.loaded, ["commerce"])
    XCTAssertTrue(registry.quickActions(for: .aglyn).allSatisfy { registry.screen($0.screen) != nil })
    XCTAssertEqual(registry.tabs(for: .aglyn).map(\.id), ["commerce.orders-tab", "commerce.products-tab"])
    XCTAssertEqual(registry.resolve("/acme/hosts/shop/products/orders"), .screen("commerce.orders", ["orgSlug": "acme", "hostSlug": "shop"]))
    XCTAssertEqual(registry.screens(for: .pos).map(\.id), ["commerce.card-readers", "commerce.display", "commerce.kiosk", "commerce.register"])
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
