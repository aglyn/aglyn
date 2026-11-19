// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * THE HARDWARE SHOP A MERCHANT BUYS CARD READERS FROM (AGL-4038), as the console's Hardware card and Card readers to
 * set up card (pos-hardware-card.component.tsx, pos-hardware-waiting-card.component.tsx) have it: the catalog and its
 * prices, the basket and its summary, the two boxes, Check out on Stripe's own page, Your orders with their states,
 * a return request, and the readers bought in person that wait to be set up. Every call is the console's own route,
 * `/api/commerce/pos-hardware`, which decides each of these again. The words and small rules come from the console
 * through the native contracts (pos-hardware-shop.ts, pos-hardware.ts). Card readers are physical goods paid for on
 * Stripe's page, never an in-app purchase, so none of this waits on `StoreBilling.buying`. The Kotlin kit's
 * PosHardwareShop.kt.
 */

let posHardwareRoute = "/api/commerce/pos-hardware"
/// Who may see the shop and the site's orders: whoever works the register or may buy hardware (the route's door).
let posHardwareVisitKeys = ["managePos", "posBuyHardware"]
/// Who may start a checkout.
let posHardwareBuyKey = "posBuyHardware"
/// Who may set a reader up on a store (choose its store, mark it set up).
let posHardwareDevicesKey = "posDevices"

var posHardwareText: PosHardwareShopText { ContractValues.shared.posHardwareShopText }
var posHardwareWaitingText: PosHardwareWaitingText { ContractValues.shared.posHardwareWaitingText }

/// One item on offer.
struct PosHardwareOfferRow: Equatable, Identifiable {
  let sku: String
  let name: String
  let use: String
  let unitCents: Int
  var id: String { sku }
}

/// One shipping speed.
struct PosHardwareShipOption: Equatable, Identifiable {
  let method: String
  let label: String
  let cents: Int
  var id: String { method }
}

/// What the catalog answers: closed, or the offers, shipping speeds and whether tax is added at checkout.
struct PosHardwareCatalogAnswer: Equatable {
  let available: Bool
  let offers: [PosHardwareOfferRow]
  let shipping: [PosHardwareShipOption]
  let automaticTax: Bool

  static let closed = PosHardwareCatalogAnswer(available: false, offers: [], shipping: [], automaticTax: false)

  init(available: Bool, offers: [PosHardwareOfferRow], shipping: [PosHardwareShipOption], automaticTax: Bool) {
    self.available = available
    self.offers = offers
    self.shipping = shipping
    self.automaticTax = automaticTax
  }

  init(_ json: JSONValue?) {
    guard let json, json["available"]?.boolValue == true else {
      self = .closed
      return
    }
    available = true
    offers = (json["offers"]?.arrayValue ?? []).compactMap { offer in
      guard let sku = offer["sku"]?.stringValue else { return nil }
      return PosHardwareOfferRow(
        sku: sku, name: offer["name"]?.stringValue ?? sku, use: offer["use"]?.stringValue ?? "",
        unitCents: Int(offer["unitCents"]?.numberValue ?? 0))
    }
    shipping = (json["shipping"]?.arrayValue ?? []).compactMap { option in
      guard let method = option["method"]?.stringValue else { return nil }
      return PosHardwareShipOption(
        method: method, label: option["label"]?.stringValue ?? method, cents: Int(option["cents"]?.numberValue ?? 0))
    }
    automaticTax = json["automaticTax"]?.boolValue == true
  }
}

/// A line of an order.
struct PosHardwareOrderLine: Equatable {
  let name: String
  let quantity: Int
}

/// An order as Your orders lists it (the route's merchant view).
struct PosHardwareOrderRow: Equatable, Identifiable {
  let id: String
  let number: String
  let status: String
  let lines: [PosHardwareOrderLine]
  let totalCents: Int
  let createdAtMs: Double
  let source: String
  let returnState: String?
  let trackingNumber: String?
  let trackingURL: URL?
  /// A reader bought in person: the store it is for ("" while still to choose) and the serials taken at the sale.
  let hostID: String
  let serialsTaken: Int

  init?(_ json: JSONValue) {
    guard let id = json["id"]?.stringValue else { return nil }
    self.id = id
    number = json["number"]?.stringValue ?? ""
    status = json["status"]?.stringValue ?? ""
    lines = (json["lines"]?.arrayValue ?? []).map {
      PosHardwareOrderLine(name: $0["name"]?.stringValue ?? "", quantity: Int($0["quantity"]?.numberValue ?? 0))
    }
    totalCents = Int(json["totalCents"]?.numberValue ?? 0)
    createdAtMs = json["createdAtMs"]?.numberValue ?? 0
    source = json["source"]?.stringValue ?? "online"
    returnState = json["returnRequest"]?["state"]?.stringValue
    trackingNumber = json["tracking"]?["number"]?.stringValue
    trackingURL = json["tracking"]?["url"]?.stringValue.flatMap { URL(string: $0) }.flatMap { $0.scheme == "https" ? $0 : nil }
    hostID = json["hostId"]?.stringValue ?? ""
    serialsTaken = Int(json["serialsTaken"]?.numberValue ?? 0)
  }

  /// What Status reads.
  var statusLabel: String { ContractValues.shared.posHardwareStatusLabels[status] ?? status }
  /// What Return reads once one was asked for.
  var returnLabel: String? { returnState.map { ContractValues.shared.posHardwareReturnLabels[$0] ?? "" } }
  var returnOffered: Bool { posHardwareReturnOffered(status: status, source: source, asked: returnState != nil) }
}

/// A store a waiting reader may be for.
struct PosHardwareStoreChoice: Equatable, Identifiable {
  let hostID: String
  let name: String
  let hasLocation: Bool
  var id: String { hostID }
}

/// The readers bought in person that wait to be set up, as `waiting` answers.
struct PosHardwareWaiting: Equatable {
  let posPlan: Bool
  let stores: [PosHardwareStoreChoice]
  let orders: [PosHardwareOrderRow]

  static let none = PosHardwareWaiting(posPlan: false, stores: [], orders: [])

  init(posPlan: Bool, stores: [PosHardwareStoreChoice], orders: [PosHardwareOrderRow]) {
    self.posPlan = posPlan
    self.stores = stores
    self.orders = orders
  }

  init(_ json: JSONValue?) {
    posPlan = json?["posPlan"]?.boolValue == true
    stores = (json?["stores"]?.arrayValue ?? []).compactMap { store in
      guard let id = store["hostId"]?.stringValue else { return nil }
      return PosHardwareStoreChoice(
        hostID: id, name: store["name"]?.stringValue ?? id, hasLocation: store["hasLocation"]?.boolValue == true)
    }
    orders = (json?["orders"]?.arrayValue ?? []).compactMap(PosHardwareOrderRow.init)
  }
}

// MARK: - The console's rules (pos-hardware-shop.ts, pos-hardware.ts), replayed by the function cases.

/// Dollars and cents as the card shows them (`formatPosHardwareCents`).
func formatPosHardwareCents(_ cents: Int) -> String {
  let formatter = NumberFormatter()
  formatter.locale = Locale(identifier: "en_US")
  formatter.numberStyle = .currency
  formatter.currencyCode = "USD"
  return formatter.string(from: NSNumber(value: Double(cents) / 100)) ?? "$0.00"
}

/// The prompt to add the point of sale (`posPlanPrompt`): never a refusal.
func posHardwarePlanPrompt(arrived: [String] = []) -> String {
  let adds = ContractValues.shared.posPlanAdds
  if !arrived.isEmpty {
    let one = arrived.count == 1
    return
      "\(arrived.joined(separator: ", ")) \(one ? "has" : "have") arrived. To take payments with \(one ? "it" : "them"), add the point of sale: \(adds)."
  }
  return "You can buy readers on any plan. To take payments with them, add the point of sale: \(adds)."
}

/// Whether an order offers "Request a return" (`posHardwareReturnOffered`).
func posHardwareReturnOffered(status: String, source: String?, asked: Bool) -> Bool {
  if asked { return false }
  return status == "delivered" || status == "registered" || ((source ?? "online") != "in_person" && status == "shipped")
}

/// The arrived orders bought from the shop, by number (`posHardwareArrivedNumbers`).
func posHardwareArrivedNumbers(_ orders: [(number: String, status: String, source: String?)]) -> [String] {
  orders.filter { ($0.source ?? "online") == "online" && ($0.status == "delivered" || $0.status == "registered") }
    .map(\.number)
}

/// `Name × 2, …` (`posHardwareOrderItems`).
func posHardwareOrderItems(_ lines: [PosHardwareOrderLine]) -> String {
  lines.map { "\($0.name) × \($0.quantity)" }.joined(separator: ", ")
}

/// `2 × Name, …` (`posHardwareWaitingItems`).
func posHardwareWaitingItems(_ lines: [PosHardwareOrderLine]) -> String {
  lines.map { "\($0.quantity) × \($0.name)" }.joined(separator: ", ")
}

/// What a waiting reader still needs once its store is chosen (`posHardwareWaitingNote`).
func posHardwareWaitingNote(storeName: String, serialsTaken: Int, hasLocation: Bool) -> String {
  let base =
    serialsTaken > 0
    ? "For \(storeName). Add it on the POS devices card with the code it shows, and it is set up: we know its serial number."
    : "For \(storeName). Add it on the POS devices card with the code it shows, then mark it set up."
  return hasLocation ? base : "\(base) The first reader asks for the store’s address."
}

/// `Return HW-…?` (`posHardwareReturnTitle`).
func posHardwareReturnTitle(_ number: String) -> String { "Return \(number)?" }

/// A reason long enough to send (`posHardwareReturnReasonReady`).
func posHardwareReturnReasonReady(_ reason: String) -> Bool {
  reason.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3
}

/// The basket and its summary (`posHardwareBasket`).
struct PosHardwareBasket: Equatable {
  let lines: [(sku: String, quantity: Int)]
  let itemsCents: Int
  let totalCents: Int
  let totalLabel: String

  static func == (a: Self, b: Self) -> Bool {
    a.lines.map(\.sku) == b.lines.map(\.sku) && a.lines.map(\.quantity) == b.lines.map(\.quantity)
      && a.itemsCents == b.itemsCents && a.totalCents == b.totalCents && a.totalLabel == b.totalLabel
  }
}

func posHardwareBasket(
  offers: [(sku: String, unitCents: Int)], quantities: [String: Int], shippingCents: Int?, automaticTax: Bool
) -> PosHardwareBasket {
  let lines = offers.map { (sku: $0.sku, quantity: max(0, quantities[$0.sku] ?? 0)) }.filter { $0.quantity > 0 }
  let items = lines.reduce(0) { sum, line in
    sum + (offers.first { $0.sku == line.sku }?.unitCents ?? 0) * line.quantity
  }
  return PosHardwareBasket(
    lines: lines, itemsCents: items, totalCents: items + (shippingCents ?? 0),
    totalLabel: automaticTax ? posHardwareText.totalBeforeTax : posHardwareText.total)
}

/// Check out's reason when blocked, and whether it can be pressed (`posHardwareCheckoutState`).
func posHardwareCheckoutState(
  canBuy: Bool, termsAccepted: Bool, businessUse: Bool, hasLines: Bool, hasShipping: Bool
) -> (blockedReason: String?, enabled: Bool) {
  let reason: String? =
    !canBuy ? posHardwareText.buyKeyReason : (!termsAccepted || !businessUse) ? posHardwareText.termsReason : nil
  return (reason, reason == nil && hasLines && hasShipping)
}

/// The day an order was placed, as Placed reads it (`Nov 19, 2026`).
func posHardwarePlacedOn(_ ms: Double) -> String {
  guard ms > 0 else { return "—" }
  return Date(timeIntervalSince1970: ms / 1000).formatted(.dateTime.month(.abbreviated).day().year())
}

// MARK: - The route

/// The shop's calls, through the console's own route under the same gate.
struct PosHardwareAPI {
  let api: ConsoleAPIClient
  let hostID: String

  private func call(_ action: String, _ extra: [String: JSONValue] = [:], attemptKey: String? = nil) async throws
    -> JSONValue?
  {
    var body: [String: JSONValue] = ["action": .string(action), "hostId": .string(hostID)]
    body.merge(extra) { _, new in new }
    return try await api.request(posHardwareRoute, method: .post, body: .object(body), idempotencyKey: attemptKey)
  }

  func catalog() async throws -> PosHardwareCatalogAnswer { PosHardwareCatalogAnswer(try await call("catalog")) }

  func orders() async throws -> [PosHardwareOrderRow] {
    let answer = try await call("orders")
    let rows: [JSONValue] = answer?["orders"]?.arrayValue ?? []
    return rows.compactMap(PosHardwareOrderRow.init)
  }

  /// Starts Stripe Checkout for the basket; the page it answers takes the card and the address.
  func checkout(lines: [(sku: String, quantity: Int)], shippingMethod: String, attemptKey: String) async throws -> URL? {
    let answer = try await call(
      "checkout",
      [
        "lines": .array(lines.map { .object(["sku": .string($0.sku), "quantity": .number(Double($0.quantity))]) }),
        "shippingMethod": .string(shippingMethod),
        "hardwareTerms": .object(["accepted": .bool(true), "businessUse": .bool(true)]),
      ], attemptKey: attemptKey)
    guard let text = answer?["url"]?.stringValue, let url = URL(string: text), url.scheme == "https" else { return nil }
    return url
  }

  func requestReturn(orderID: String, reason: String) async throws {
    _ = try await call(
      "request-return",
      ["orderId": .string(orderID), "reason": .string(reason.trimmingCharacters(in: .whitespacesAndNewlines))])
  }

  func waiting() async throws -> PosHardwareWaiting { PosHardwareWaiting(try await call("waiting")) }

  /// Chooses the store a reader bought in person is for: the call is made as that store (`hostId`).
  func chooseStore(_ storeID: String, orderID: String) async throws {
    _ = try await PosHardwareAPI(api: api, hostID: storeID).call("choose-store", ["orderId": .string(orderID)])
  }

  /// Marks a reader set up, on the store it is for.
  func markSetUp(storeID: String, orderID: String) async throws {
    _ = try await PosHardwareAPI(api: api, hostID: storeID).call("mark-set-up", ["orderId": .string(orderID)])
  }
}

/// The route's own words for a refusal, or `fallback` when there are none (no connection).
func posHardwareRefusal(_ error: Error, fallback: String) -> String {
  (error as? ConsoleAPIError).flatMap { $0.status == 0 ? nil : $0.message } ?? fallback
}
