// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * THE SITE'S ORDERS, AS THE CONSOLE'S ORDERS PAGE READS THEM.
 *
 * The list is the orders page's own query: ORDER_LIST_QUERY planned by the
 * shared planner (a status chip is its `statusKey` clause, a typed word its
 * search), newest first, a page at a time. A stored order decodes as the
 * generated `HostOrder`; a line or payment that does not decode is left out
 * rather than hiding the order. The figures come from the shared formatters,
 * which replay the console's own answers. Changes go through the console's
 * routes (fulfill-order, cancel-order), which hold the transition rules.
 */

let ordersPageSize = 50

func ordersPath(_ hostID: String) -> [String] { ["hosts", hostID, "orders"] }

struct OrderRow: Identifiable, Hashable {
  let id: String
  let order: HostOrder

  var number: String { formatOrderNumber(order, docId: id) }
  var status: OrderStatus { order.status ?? .pending }
  var statusLabel: String { orderStatusLabel(status) }
  var customer: String {
    let name = order.customerName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !name.isEmpty { return name }
    let email = order.customerEmail?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return email.isEmpty ? "Guest" : email
  }
  var totalCents: Int { Int((order.totals?.totalCents ?? order.amountCents ?? 0).rounded()) }
  var total: String { formatOrderMoney(totalCents) }
  var createdAt: Date? { order.createdAtMs.map { Date(timeIntervalSince1970: $0 / 1000) } }
  var itemCount: Int { (order.lineItems ?? []).reduce(0) { $0 + max(0, Int($1.quantity)) } }
}

func orderStatusLabel(_ status: OrderStatus) -> String {
  ContractValues.shared.orderStatusLabels[status.rawValue] ?? status.rawValue.capitalized
}

func orderStatusTone(_ status: OrderStatus) -> OrderTone {
  switch status {
  case .paid: .attention
  case .partiallyFulfilled: .attention
  case .fulfilled, .delivered: .done
  case .pending: .waiting
  case .cancelled, .refunded, .unknown: .closed
  }
}

enum OrderTone { case attention, done, waiting, closed }

/// One stored order as the contract, keeping what decodes.
func decodeOrder(_ doc: FirestoreDocument) -> HostOrder {
  var fields = doc.jsonFields
  fields["lineItems"] = keepDecodable(fields["lineItems"], as: OrderLineItem.self)
  fields["payments"] = keepDecodable(fields["payments"], as: OrderPayment.self)
  fields["timeline"] = keepDecodable(fields["timeline"], as: OrderTimelineEvent.self)
  fields["fulfillments"] = keepDecodable(fields["fulfillments"], as: OrderFulfillment.self)
  fields["unresolvedLines"] = keepDecodable(fields["unresolvedLines"], as: OrderUnresolvedLine.self)
  for key in ["dispute", "paymentRisk", "restockCheck", "receiptRequest", "customerRecord", "buyerNotifications"] {
    // Every HostOrder member is optional, so an order of this one member
    // decodes exactly when the member does.
    if let value = fields[key], (try? decodeJSONFields(HostOrder.self, [key: value])) == nil {
      fields[key] = nil
    }
  }
  if let order = try? decodeJSONFields(HostOrder.self, fields) { return order }
  // A field the contract types differently: keep what every row shows.
  return HostOrder(
    amountCents: doc.double("amountCents"), createdAtMs: doc.double("createdAtMs"),
    customerEmail: doc.string("customerEmail"), customerName: doc.string("customerName"),
    number: doc.double("number"), status: doc.string("status").map { OrderStatus(rawValue: $0) ?? .unknown })
}

/// The orders page's plan: a status (or none), a typed word, newest first.
func ordersPlan(status: OrderStatus?, search: String) -> ListQueryPlan {
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return planListQuery(
    ContractValues.shared.orderListQuery,
    ListQueryRequest(
      clauses: status.map { [ListFilterRequest(field: "statusKey", op: "equals", value: $0.rawValue)] } ?? [],
      search: words.isEmpty ? nil : [words]))
}

@MainActor
@Observable
final class OrdersModel {
  private(set) var rows: [OrderRow] = []
  private(set) var ready = false
  private(set) var failed = false
  private(set) var notice: String?
  private(set) var hasMore = false
  var status: OrderStatus? { didSet { if oldValue != status { restart() } } }
  var search = "" { didSet { if oldValue != search { restart() } } }

  @ObservationIgnored private var reader: FirestoreReader?
  @ObservationIgnored private var hostID: String?
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var limit = ordersPageSize

  func start(_ reader: FirestoreReader, hostID: String?) {
    self.reader = reader
    self.hostID = hostID
    restart()
  }

  func loadMore() {
    guard hasMore else { return }
    limit += ordersPageSize
    listen()
  }

  func stop() {
    listener?.remove()
    listener = nil
  }

  private func restart() {
    limit = ordersPageSize
    rows = []
    ready = false
    listen()
  }

  private func listen() {
    listener?.remove()
    failed = false
    guard let reader, let hostID else { return }
    let plan = ordersPlan(status: status, search: search)
    notice = plan.refused.isEmpty ? plan.notices.first : "This search cannot run with that filter. Clear one of them."
    // One probe row past the page tells whether another page exists.
    let window = limit
    listener = reader.listen(plan.firestoreQuery(ordersPath(hostID), limit: window + 1)) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.hasMore = docs.count > window
        self.rows = docs.prefix(window).map { OrderRow(id: $0.id, order: decodeOrder($0)) }
      case .failure:
        self.failed = true
      }
      self.ready = true
    }
  }
}

/// One order, live.
@MainActor
@Observable
final class OrderModel {
  private(set) var row: OrderRow?
  private(set) var ready = false
  private(set) var missing = false
  private(set) var failed = false
  @ObservationIgnored private var listener: FirestoreListening?

  func start(_ reader: FirestoreReader, hostID: String?, orderID: String) {
    listener?.remove()
    ready = false
    guard let hostID, !orderID.isEmpty else {
      missing = true
      ready = true
      return
    }
    listener = reader.listenDocument(ordersPath(hostID) + [orderID]) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let doc?):
        self.row = OrderRow(id: doc.id, order: decodeOrder(doc))
        self.missing = false
      case .success(nil): self.missing = true
      case .failure: self.failed = true
      }
      self.ready = true
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }
}

/// What a member can do to an order next, by the console's transition rules.
enum OrderAction: String, CaseIterable, Identifiable {
  case fulfill, deliver, cancel
  var id: String { rawValue }

  var title: String {
    switch self {
    case .fulfill: "Mark fulfilled"
    case .deliver: "Mark delivered"
    case .cancel: "Cancel order"
    }
  }

  var systemImage: String {
    switch self {
    case .fulfill: "shippingbox"
    case .deliver: "checkmark.seal"
    case .cancel: "xmark.circle"
    }
  }

  var target: OrderStatus {
    switch self {
    case .fulfill: .fulfilled
    case .deliver: .delivered
    case .cancel: .cancelled
    }
  }

  static func available(for status: OrderStatus) -> [OrderAction] {
    allCases.filter { canTransitionOrder(from: status, to: $0.target) }
  }
}

/// Runs one action through the console's own route. The routes write once,
/// so a retry after a lost answer is safe.
func performOrderAction(_ action: OrderAction, api: ConsoleAPIClient, hostID: String, orderID: String) async throws {
  var body: [String: JSONValue] = ["hostId": .string(hostID), "orderId": .string(orderID)]
  switch action {
  case .fulfill:
    body["to"] = "fulfilled"
    _ = try await api.request("/api/commerce/fulfill-order", method: .post, body: .object(body))
  case .deliver:
    body["to"] = "delivered"
    _ = try await api.request("/api/commerce/fulfill-order", method: .post, body: .object(body))
  case .cancel:
    _ = try await api.request("/api/commerce/cancel-order", method: .post, body: .object(body))
  }
}
