// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/*
 * THE REGISTER'S ROUTES.
 *
 * The app sells through the SAME routes the console register sells through,
 * with the member's ID token, so every gate the console has (a site role
 * that may sell, `managePos`, the `pos` entitlement, the register's plan
 * seat, the discount ceiling) holds on the device unchanged:
 *
 * - `commerce/pos-order` with `payment: 'open'` prices the basket on the
 *   server and opens a PENDING sale with an empty tender ledger;
 * - `commerce/pos-payment` takes each tender against it (`card-present` for
 *   a smart reader, `card-present-sdk` for this device's reader, `cash`,
 *   `gift-card`), re-reads a card payment (`status`), stops one (`cancel`),
 *   voids an unpaid sale (`void`) and sends the receipt (`receipt`).
 *
 * Every money-moving call carries an Idempotency-Key the caller keeps for
 * that one press, so a retry after a lost answer finds the payment the first
 * press started instead of taking the money twice.
 */

let posOrderRoute = "/api/commerce/pos-order"
let posPaymentRoute = "/api/commerce/pos-payment"

enum ReceiptDefault: Equatable { case ask, print, none }

struct PosRegisterSettings: Equatable {
  var tippingEnabled = false
  var tipPercentages: [Double] = []
  var receiptDefault = ReceiptDefault.ask
}

struct PosSmartReader: Equatable, Identifiable {
  let id: String
  let label: String
  let registerID: String?
  let status: String
  let livemode: Bool
  var online: Bool { status == "online" }
}

struct PosContext: Equatable {
  let settings: PosRegisterSettings
  /// Card readers are offered on this deployment at all.
  let terminalAvailable: Bool
  let testMode: Bool
  /// The site's smart (internet) readers, driven through the server.
  let readers: [PosSmartReader]
  let smsReceipts: Bool
  /// The site's register rules: shifts, the idle lock, the refund limit.
  var ops = PosOpsSettings()
}

struct PosSalePayment: Equatable, Identifiable {
  let id: String
  let method: String
  let amountCents: Int
  let tipCents: Int
  let status: String
  let cardBrand: String?
  let last4: String?
  let changeCents: Int
  let readerID: String?
  let failureMessage: String?
}

struct PosSale: Equatable {
  let orderID: String
  let status: String
  let totalCents: Int
  let paidCents: Int
  let dueCents: Int
  /// What a tender may still take: the due amount less payments in flight.
  let tenderableCents: Int
  let tipCents: Int
  let payments: [PosSalePayment]
}

struct PosOpenedSale: Equatable {
  let orderID: String
  let subtotalCents: Int?
  let discountCents: Int?
  let taxCents: Int?
  let totalCents: Int
  let dueCents: Int
  let stockWarnings: [String]
}

struct PosPaymentAnswer: Equatable {
  let sale: PosSale
  let paymentID: String?
  let completed: Bool
  let clientSecret: String?
  let paymentIntentID: String?

  /// The payment this answer started or re-read.
  var payment: PosSalePayment? { sale.payments.first { $0.id == paymentID } }
}

struct GiftCardBalance: Equatable {
  let availableCents: Int
  let frozen: Bool
  let voided: Bool
  let last4: String
}

extension JSONValue {
  var objectValue: [String: JSONValue] {
    if case .object(let record) = self { return record }
    return [:]
  }
  var arrayValue: [JSONValue] {
    if case .array(let values) = self { return values }
    return []
  }
  var numberValue: Double? {
    switch self {
    case .number(let value): return value.isFinite ? value : nil
    case .string(let text): return Double(text)
    default: return nil
    }
  }
  var flag: Bool { self == .bool(true) }
  var cents: Int { numberValue.map(jsRound) ?? 0 }
}

private extension Optional where Wrapped == JSONValue {
  var object: [String: JSONValue] { self?.objectValue ?? [:] }
  var array: [JSONValue] { self?.arrayValue ?? [] }
  var text: String? { self?.stringValue }
  var number: Double? { self?.numberValue }
  var flag: Bool { self?.flag ?? false }
  var cents: Int { self?.cents ?? 0 }
}

func readPosContext(_ body: JSONValue?) -> PosContext {
  let record = body.object
  let settings = record["settings"].object
  let terminal = record["terminal"].object
  let receipt: ReceiptDefault =
    switch settings["receiptDefault"].text {
    case "print": .print
    case "none": .none
    default: .ask
    }
  return PosContext(
    settings: PosRegisterSettings(
      tippingEnabled: settings["tippingEnabled"].flag,
      tipPercentages: Array(settings["tipPercentages"].array.compactMap(\.numberValue).filter { $0 > 0 }.prefix(4)),
      receiptDefault: receipt),
    terminalAvailable: terminal["available"].flag,
    testMode: terminal["testMode"].flag,
    readers: record["readers"].array.compactMap { entry in
      let reader = entry.objectValue
      guard let id = reader["id"].text else { return nil }
      return PosSmartReader(
        id: id, label: reader["label"].text ?? "Card reader", registerID: reader["registerId"].text,
        status: reader["status"].text ?? "offline", livemode: reader["livemode"].flag)
    },
    smsReceipts: record["smsReceipts"].flag,
    ops: readPosOpsSettings(record["ops"]))
}

func readSalePayment(_ element: JSONValue) -> PosSalePayment? {
  let payment = element.objectValue
  guard let id = payment["id"].text else { return nil }
  return PosSalePayment(
    id: id, method: payment["method"].text ?? "", amountCents: payment["amountCents"].cents,
    tipCents: payment["tipCents"].cents, status: payment["status"].text ?? "", cardBrand: payment["cardBrand"].text,
    last4: payment["last4"].text, changeCents: payment["changeCents"].cents, readerID: payment["readerId"].text,
    failureMessage: payment["failureMessage"].text)
}

func readPaymentAnswer(_ body: JSONValue?) -> PosPaymentAnswer {
  let record = body.object
  let sale = record["sale"].object
  return PosPaymentAnswer(
    sale: PosSale(
      orderID: sale["orderId"].text ?? "", status: sale["status"].text ?? "", totalCents: sale["totalCents"].cents,
      paidCents: sale["paidCents"].cents, dueCents: sale["dueCents"].cents,
      tenderableCents: sale["tenderableCents"].cents, tipCents: sale["tipCents"].cents,
      payments: sale["payments"].array.compactMap(readSalePayment)),
    paymentID: record["paymentId"].text,
    completed: record["completed"].flag,
    clientSecret: record["clientSecret"].text,
    paymentIntentID: record["paymentIntentId"].text)
}

func readOpenedSale(_ body: JSONValue?) -> PosOpenedSale {
  let record = body.object
  let totals = record["totals"].object
  let total = totals["totalCents"].cents
  return PosOpenedSale(
    orderID: record["orderId"].text ?? "",
    subtotalCents: (totals["subtotalCents"].number ?? totals["itemsCents"].number).map(jsRound),
    discountCents: totals["discountCents"].number.map(jsRound),
    taxCents: totals["taxCents"].number.map(jsRound),
    totalCents: total,
    dueCents: record["dueCents"].number.map(jsRound) ?? total,
    stockWarnings: record["stockWarnings"].array.compactMap { entry in
      let warning = entry.objectValue
      guard let name = warning["name"].text else { return nil }
      return warning["available"].number.map { "\(name): \(Int($0)) left" } ?? name
    })
}

/// A sale step: what `pos-payment` is asked to do. A payment-starting step needs its attempt key.
enum SaleStep: Equatable {
  case cardPresentSDK(amountCents: Int, tipCents: Int)
  case cardPresent(readerID: String, amountCents: Int, tipCents: Int)
  case cash(tenderedCents: Int, tipCents: Int, amountCents: Int?)
  case giftCard(code: String, amountCents: Int?)
  case status(paymentID: String)
  case cancel(paymentID: String)
  case sale
  case void
  case receipt(channel: String, to: String?)

  var action: String {
    switch self {
    case .cardPresentSDK: "card-present-sdk"
    case .cardPresent: "card-present"
    case .cash: "cash"
    case .giftCard: "gift-card"
    case .status: "status"
    case .cancel: "cancel"
    case .sale: "sale"
    case .void: "void"
    case .receipt: "receipt"
    }
  }

  var startsPayment: Bool {
    switch self {
    case .cardPresentSDK, .cardPresent, .cash, .giftCard: true
    default: false
    }
  }

  func body(hostID: String, orderID: String) -> JSONValue {
    var record: [String: JSONValue] = [
      "hostId": .string(hostID), "orderId": .string(orderID), "action": .string(action),
    ]
    func put(_ key: String, _ cents: Int) { record[key] = .number(Double(cents)) }
    switch self {
    case .cardPresentSDK(let amount, let tip):
      put("amountCents", amount)
      put("tipCents", tip)
    case .cardPresent(let reader, let amount, let tip):
      record["readerId"] = .string(reader)
      put("amountCents", amount)
      put("tipCents", tip)
    case .cash(let tendered, let tip, let amount):
      put("tenderedCents", tendered)
      put("tipCents", tip)
      if let amount, amount > 0 { put("amountCents", amount) }
    case .giftCard(let code, let amount):
      record["code"] = .string(code)
      if let amount, amount > 0 { put("amountCents", amount) }
    case .status(let id), .cancel(let id): record["paymentId"] = .string(id)
    case .receipt(let channel, let to):
      record["channel"] = .string(channel)
      if let to { record["to"] = .string(to) }
    case .sale, .void: break
    }
    return .object(record)
  }
}

/// The register's calls for one site; tests answer them from a script.
protocol PosSaleAPI: Sendable {
  var hostID: String { get }
  func context() async throws -> PosContext
  /// Opens the sale: the server prices the basket and holds it pending.
  func openSale(registerID: String, locationID: String?, cart: Cart, attemptKey: String) async throws -> PosOpenedSale
  /// One call to the payment route; a payment-starting step needs its attempt key.
  func payment(orderID: String, step: SaleStep, attemptKey: String?) async throws -> PosPaymentAnswer
  /// A gift card's spendable balance, to read to the customer.
  func giftCardBalance(code: String) async throws -> GiftCardBalance
}

extension PosSaleAPI {
  func payment(orderID: String, step: SaleStep) async throws -> PosPaymentAnswer {
    try await payment(orderID: orderID, step: step, attemptKey: nil)
  }
}

/// The cashier a PIN switched in, readable from the routes' `Sendable` calls.
final class CashierAssertionBox: @unchecked Sendable {
  private let lock = NSLock()
  private var value: String?
  var assertion: String? {
    get { lock.withLock { value } }
    set { lock.withLock { value = newValue } }
  }
}

/// The register's calls over the console API, as the signed-in member.
struct ConsolePosSaleAPI: PosSaleAPI {
  let api: ConsoleAPIClient
  let hostID: String
  /// The cashier a PIN switched in, if any; the sale and each payment it starts name them.
  var cashier = CashierAssertionBox()

  func context() async throws -> PosContext {
    readPosContext(try await api.request(posPaymentRoute, query: [("hostId", hostID), ("action", "context")]))
  }

  func openSale(registerID: String, locationID: String?, cart: Cart, attemptKey: String) async throws -> PosOpenedSale {
    var body: [String: JSONValue] = [
      "hostId": .string(hostID), "registerId": .string(registerID), "payment": "open", "lines": cart.saleLines,
    ]
    if let locationID { body["locationId"] = .string(locationID) }
    if cart.discountPct > 0 { body["discountPct"] = .number(Double(cart.discountPct)) }
    if !cart.customerEmail.isEmpty { body["customerEmail"] = .string(cart.customerEmail) }
    if let assertion = cashier.assertion { body["cashierAssertion"] = .string(assertion) }
    return readOpenedSale(
      try await api.request(posOrderRoute, method: .post, body: .object(body), idempotencyKey: attemptKey))
  }

  func payment(orderID: String, step: SaleStep, attemptKey: String?) async throws -> PosPaymentAnswer {
    precondition(!step.startsPayment || attemptKey?.isEmpty == false, "A payment needs its attempt key.")
    var body = step.body(hostID: hostID, orderID: orderID)
    if step.startsPayment, let assertion = cashier.assertion, case .object(var record) = body {
      record["cashierAssertion"] = .string(assertion)
      body = .object(record)
    }
    return readPaymentAnswer(
      try await api.request(posPaymentRoute, method: .post, body: body, idempotencyKey: attemptKey))
  }

  func giftCardBalance(code: String) async throws -> GiftCardBalance {
    let body = try await api.request(
      posPaymentRoute, method: .post,
      body: [
        "hostId": .string(hostID), "action": "gift-card-balance",
        "code": .string(code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()),
      ]
    ).object
    return GiftCardBalance(
      availableCents: body["availableCents"].cents, frozen: body["frozen"].flag, voided: body["voided"].flag,
      last4: body["last4"].text ?? "")
  }
}

extension ConsoleAPIError: ConsoleAPIErrorMessage {}
