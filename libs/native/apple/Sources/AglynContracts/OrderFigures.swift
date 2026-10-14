// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * How the console reads a stored order before it counts or shows it, the
 * sales figures it adds up, what an order has shipped, and whether a dispute
 * refuses a refund: ported once from libs/plugins/commerce/src/lib/model/
 * {commerce-orders,order-figures,order-fulfillment,commerce-dispute}.ts and
 * libs/aglyn/src/lib/app-utils/stripe-deployment-mode.ts, as the Kotlin kit
 * ports them. The cases in function-cases.generated.json are the
 * TypeScript's own answers, and the tests replay every one.
 */

/// An order as the console reads it: a modern order (it has line items) is
/// `paid` unless it says otherwise; a pre-line-item order also gets a
/// channel, one line from its `productId`, and totals from its `amountCents`.
public func liftLegacyOrder(_ raw: HostOrder) -> HostOrder {
  var order = raw
  order.status = raw.status ?? .paid
  if let lines = raw.lineItems, !lines.isEmpty { return order }
  let amount = raw.amountCents ?? 0
  order.channel = raw.channel ?? .online
  order.lineItems =
    raw.productId.map { [OrderLineItem(name: "Product", productId: $0, quantity: 1, unitAmountCents: amount)] } ?? []
  order.totals =
    raw.totals
    ?? OrderTotals(
      discountCents: 0, feeCents: raw.feeCents ?? 0, itemsCents: amount, shippingCents: 0, taxCents: 0,
      totalCents: amount)
  return order
}

/// A Stripe id from test mode: `cs_test_…`, or another prefix with the `_test_` infix.
public func stripeIDIsTestMode(_ id: String?) -> Bool {
  let trimmed = (id ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed.range(of: "^[a-z]+_test_", options: .regularExpression) != nil
}

/// A test-mode order: Stripe's `livemode` when stored, else a test-mode
/// checkout session id, on the order or as its document id.
public func orderIsTestMode(_ order: HostOrder, docID: String? = nil, livemode: Bool? = nil) -> Bool {
  if let livemode { return !livemode }
  return stripeIDIsTestMode(order.checkoutSessionId) || stripeIDIsTestMode(docID)
}

/// One stored order as the figures read it: its document id, `livemode`, and the order itself, unlifted.
public struct FigureOrder: Sendable {
  public let id: String?
  public let livemode: Bool?
  public let order: HostOrder

  public init(id: String?, livemode: Bool?, order: HostOrder) {
    self.id = id
    self.livemode = livemode
    self.order = order
  }
}

/// Money taken: not pending or cancelled, and not a test.
public func orderCountsAsSale(_ source: FigureOrder) -> Bool {
  let lifted = liftLegacyOrder(source.order)
  return lifted.status != .pending && lifted.status != .cancelled
    && !orderIsTestMode(lifted, docID: source.id, livemode: source.livemode)
}

public struct OrderWindowFigures: Equatable, Sendable {
  public let orders: Int
  public let revenueCents: Int
  public let averageCents: Int
}

/// The sales in [startMs, endMs): how many, what they brought in, and the average, in whole cents.
public func orderWindowFigures(_ orders: [FigureOrder], startMs: Double, endMs: Double) -> OrderWindowFigures {
  let counted = orders.filter { source in
    guard let at = source.order.createdAtMs, at.isFinite else { return false }
    return at >= startMs && at < endMs && orderCountsAsSale(source)
  }
  let revenue = counted.reduce(0) { $0 + orderPaidCents(liftLegacyOrder($1.order)) }
  let average = counted.isEmpty ? 0 : Int((Double(revenue) / Double(counted.count) + 0.5).rounded(.down))
  return OrderWindowFigures(orders: counted.count, revenueCents: revenue, averageCents: average)
}

public struct ProductSales: Equatable, Sendable {
  public let productID: String
  public let name: String
  public let units: Double
  public let cents: Double
}

/// Units and money per product over the sales, most money first, then by
/// name. Reads the stored lines, unlifted.
public func productSales(_ orders: [FigureOrder]) -> [ProductSales] {
  var order: [String] = []
  var byProduct: [String: ProductSales] = [:]
  for source in orders where orderCountsAsSale(source) {
    for line in source.order.lineItems ?? [] where !line.productId.isEmpty {
      let entry = byProduct[line.productId] ?? ProductSales(productID: line.productId, name: line.name, units: 0, cents: 0)
      if byProduct[line.productId] == nil { order.append(line.productId) }
      let units = line.quantity.isFinite ? line.quantity : 0
      let cents = line.unitAmountCents.isFinite && line.quantity.isFinite ? line.unitAmountCents * line.quantity : 0
      byProduct[line.productId] = ProductSales(
        productID: entry.productID, name: entry.name, units: entry.units + units, cents: entry.cents + cents)
    }
  }
  return order.compactMap { byProduct[$0] }.sorted { a, b in a.cents != b.cents ? a.cents > b.cents : a.name < b.name }
}

// MARK: - Fulfillment

/// One order line's shipping state; `lineItemID` is its index in `lineItems`.
public struct OrderLineFulfillmentState: Equatable, Sendable {
  public let lineItemID: Int
  public let quantity: Int
  public let fulfilledQuantity: Int
  public let remainingQuantity: Int
  public let requiresShipping: Bool
}

/// Digital goods and services are delivered by other means; an untyped line is physical.
public func lineRequiresShipping(_ line: OrderLineItem) -> Bool {
  line.productType != .digital && line.productType != .service
}

private func wholeUnits(_ value: Double?) -> Int {
  let units = (value ?? 0).rounded(.down)
  return units.isFinite && units > 0 ? Int(units) : 0
}

/// A cancelled fulfillment ships nothing.
public func fulfillmentIsActive(_ fulfillment: OrderFulfillment) -> Bool { fulfillment.status != .cancelled }

/// The units one fulfillment covers per line; a legacy one (no `lines`) covers each named line whole.
func fulfillmentLineQuantities(_ order: HostOrder, _ fulfillment: OrderFulfillment) -> [(Int, Int)] {
  let lines = order.lineItems ?? []
  if let explicit = fulfillment.lines, !explicit.isEmpty {
    return explicit.compactMap { item in
      let index = Int(item.lineItemId.rounded())
      let units = wholeUnits(item.quantity)
      return index >= 0 && index < lines.count && units > 0 ? (index, units) : nil
    }
  }
  return fulfillment.lineItemIds.compactMap { id in
    let index = Int(id.rounded())
    guard index >= 0, index < lines.count else { return nil }
    let units = wholeUnits(lines[index].quantity)
    return units > 0 ? (index, units) : nil
  }
}

/// Each line's units, shipped and left, over every active fulfillment.
public func orderLineFulfillmentStates(_ order: HostOrder) -> [OrderLineFulfillmentState] {
  var fulfilled: [Int: Int] = [:]
  for fulfillment in order.fulfillments ?? [] where fulfillmentIsActive(fulfillment) {
    for (index, units) in fulfillmentLineQuantities(order, fulfillment) { fulfilled[index, default: 0] += units }
  }
  return (order.lineItems ?? []).enumerated().map { index, line in
    let quantity = wholeUnits(line.quantity)
    let done = min(quantity, fulfilled[index] ?? 0)
    return OrderLineFulfillmentState(
      lineItemID: index, quantity: quantity, fulfilledQuantity: done, remainingQuantity: quantity - done,
      requiresShipping: lineRequiresShipping(line))
  }
}

/// The lines still to ship, with how many units of each.
public func remainingFulfillmentLines(_ order: HostOrder) -> [OrderLineFulfillmentState] {
  orderLineFulfillmentStates(order).filter { $0.requiresShipping && $0.remainingQuantity > 0 }
}

// MARK: - Disputes

private let settledDisputeStatuses: Set<String> = ["won", "lost", "warning_closed"]
private let openInquiryStatuses: Set<String> = ["warning_needs_response", "warning_under_review"]

/// A dispute Stripe has not decided yet.
public func isOrderDisputeOpen(_ dispute: OrderDispute?) -> Bool {
  guard let dispute else { return false }
  return (dispute.outcome ?? "").isEmpty && (dispute.closedAtMs ?? 0) == 0
    && !settledDisputeStatuses.contains(dispute.status)
}

/// An open dispute refuses a refund, except an inquiry (a warning), which a refund may settle.
public func orderDisputeBlocksRefund(_ order: HostOrder) -> Bool {
  isOrderDisputeOpen(order.dispute) && !openInquiryStatuses.contains(order.dispute?.status ?? "")
}
