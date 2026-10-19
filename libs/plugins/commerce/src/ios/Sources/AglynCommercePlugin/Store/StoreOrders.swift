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

/// An order status's color, the console's own (`ORDER_STATUS_COLOR`, read by the Kotlin app too): paid is money in,
/// partly fulfilled wants finishing, fulfilled and delivered are information, refunded is the alarm, and pending and
/// canceled stay neutral.
func orderStatusTone(_ status: OrderStatus) -> OrderTone {
  switch ContractValues.shared.orderStatusColor[status.rawValue] {
  case .success: .success
  case .info: .info
  case .warning: .warning
  case .error: .error
  default: .neutral
  }
}

/// The console's status colors (MUI's chip colors), named for the app's tones.
enum OrderTone { case neutral, info, success, warning, error }

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

/// The chips above the list, each a set of clauses on the one query (the
/// Kotlin kit's `OrderFilter`, chip for chip).
enum OrderFilter: String, CaseIterable, Identifiable {
  case all, unfulfilled, fulfilled, pending, returns, disputes
  var id: String { rawValue }

  var label: String {
    switch self {
    case .all: "All"
    case .unfulfilled: "Unfulfilled"
    case .fulfilled: "Fulfilled"
    case .pending: "Unpaid"
    case .returns: "Canceled & refunded"
    case .disputes: "Disputes"
    }
  }

  var clauses: [ListFilterRequest] {
    switch self {
    case .all: []
    case .unfulfilled: [ListFilterRequest(field: "statusKey", op: "isAnyOf", value: "paid,partially_fulfilled")]
    case .fulfilled: [ListFilterRequest(field: "statusKey", op: "isAnyOf", value: "fulfilled,delivered")]
    case .pending: [ListFilterRequest(field: "statusKey", op: "equals", value: "pending")]
    case .returns: [ListFilterRequest(field: "statusKey", op: "isAnyOf", value: "cancelled,refunded")]
    case .disputes:
      [ContractValues.shared.openDisputeClause].map { ListFilterRequest(field: $0.field, op: $0.op, value: $0.value) }
    }
  }
}

/// The orders page's plan: a chip's clauses, the filters added, a typed word, and the sort asked (newest first by default).
func ordersPlan(_ filter: OrderFilter, search: String, clauses: [ListFilterRequest] = [], sort: ListQuerySort? = nil) -> ListQueryPlan {
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return planListQuery(
    ContractValues.shared.orderListQuery,
    ListQueryRequest(clauses: filter.clauses + clauses, search: words.isEmpty ? nil : [words], sort: sort))
}

@MainActor
@Observable
final class OrdersModel {
  private(set) var rows: [OrderRow] = []
  private(set) var ready = false
  private(set) var failed = false
  private(set) var notice: String?
  private(set) var hasMore = false
  var filter: OrderFilter = .all { didSet { if oldValue != filter { restart() } } }
  var search = "" { didSet { if oldValue != search { restart() } } }
  /// The filters added in the filter bar, beside the chip's.
  var clauses: [ListFilterRequest] = [] { didSet { if oldValue != clauses { restart() } } }
  /// The header sort asked; nil is newest first.
  var sort: ListQuerySort? { didSet { if oldValue != sort { restart() } } }
  /// The plan the list ran, for its refusals and notices.
  private(set) var plan: ListQueryPlan?

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
    let plan = ordersPlan(filter, search: search, clauses: clauses, sort: sort)
    self.plan = plan
    notice = plan.refused.isEmpty || !clauses.isEmpty ? nil : "This search cannot run with that filter. Clear one of them."
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
  /// The order as stored, for what reads it field by field (a register sale's receipt).
  @ObservationIgnored private(set) var raw: [String: Any] = [:]
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
        self.raw = doc.data
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
    case .fulfill: "Fulfill…"
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

/// Refunds what is left of a paid order through the console's refund route.
/// The attempt key is kept until the route answers definitively (below 500),
/// so pressing Refund again after a lost answer dedupes instead of sending a
/// second refund, as the console's order dialog does.
func refundOrder(api: ConsoleAPIClient, hostID: String, orderID: String, amountCents: Int? = nil, attemptKey: String) async throws {
  var body: [String: JSONValue] = ["hostId": .string(hostID), "orderId": .string(orderID)]
  if let amountCents { body["amountCents"] = .number(Double(amountCents)) }
  _ = try await api.request("/api/commerce/refund", method: .post, body: .object(body), idempotencyKey: attemptKey)
}

/// Why a refund amount cannot be sent, or nil. The route checks again.
func checkRefundAmount(_ amountCents: Int?, refundableCents: Int) -> String? {
  guard let amountCents, amountCents > 0 else { return "Enter an amount above zero" }
  if amountCents > refundableCents { return "That is more than is left to refund" }
  return nil
}

/// Whether the order has anything left to refund by the transition rules.
func orderCanRefund(_ order: HostOrder) -> Bool {
  let status = order.status ?? .pending
  return canTransitionOrder(from: status, to: .refunded) && orderRefundState(order) != .full
    && !orderDisputeBlocksRefund(order)
}

/// The paid amount still refundable, for the confirmation's words.
func orderRefundableCents(_ order: HostOrder) -> Int {
  max(0, Int((order.totals?.totalCents ?? order.amountCents ?? 0).rounded()) - Int((order.refundedCents ?? 0).rounded()))
}

/// Where a receipt can go. The Commerce settings say which channels the store has switched on.
enum ReceiptChannel: String, CaseIterable, Identifiable {
  case email, sms
  var id: String { rawValue }
  var label: String { self == .email ? "Email" : "Text" }
}

/// Why a receipt cannot go to `to`, or nil. The route checks again.
func checkReceiptRecipient(_ channel: ReceiptChannel, _ to: String) -> String? {
  let value = to.trimmingCharacters(in: .whitespacesAndNewlines)
  switch channel {
  case .sms:
    return value.range(of: #"^\+?[\d\s().-]{7,}$"#, options: .regularExpression) != nil ? nil : "Enter a phone number"
  case .email:
    return value.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil ? nil : "Enter an email address"
  }
}

/// The channels the store sends receipts on, as the console's order dialog asks. When the route cannot say, email
/// is offered and the route checks again.
func orderReceiptChannels(api: ConsoleAPIClient, hostID: String) async -> [ReceiptChannel] {
  let answer = try? await api.request(
    "/api/commerce/order-receipt-send", query: [("hostId", hostID)])
  let on = ReceiptChannel.allCases.filter { answer?[$0.rawValue] == .bool(true) }
  return on.isEmpty ? [.email] : on
}

/// Sends the order's receipt again, by email or text, through the console's route.
func resendOrderReceipt(
  api: ConsoleAPIClient, hostID: String, orderID: String, channel: ReceiptChannel = .email, to recipient: String
) async throws {
  _ = try await api.request(
    "/api/commerce/order-receipt-send", method: .post,
    body: .object([
      "hostId": .string(hostID), "orderId": .string(orderID), "channel": .string(channel.rawValue),
      "to": .string(recipient.trimmingCharacters(in: .whitespacesAndNewlines)),
    ]))
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

/// The console link to the customer's CRM record (`pluginRecordByEmailHref('contact', …)`): the Contacts list asked
/// to open the one person with this address. Nil for a guest with no address, or before the site's slugs are known.
func customerCrmLink(orgSlug: String?, hostSlug: String?, email: String?) -> String? {
  let address = (email ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  guard let orgSlug, !orgSlug.isEmpty, let hostSlug, !hostSlug.isEmpty, !address.isEmpty else { return nil }
  var allowed = CharacterSet.alphanumerics
  allowed.insert(charactersIn: "-._~")
  let encoded = address.addingPercentEncoding(withAllowedCharacters: allowed) ?? address
  return "/\(orgSlug)/hosts/\(hostSlug)/crm/contacts?email=\(encoded)"
}
