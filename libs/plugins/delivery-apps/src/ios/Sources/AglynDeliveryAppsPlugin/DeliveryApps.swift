// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import Foundation

/*
 * DELIVERY ORDERS AT THE REGISTER (AGL-3644, AGL-3651, AGL-3652). The Kotlin
 * app's `DeliveryApps.kt`. The console's delivery queue, native: the merchant's
 * own DoorDash, Uber Eats or Grubhub orders that the services' webhooks bring to
 * the register, each with the one next step (accept or reject, ready, picked up).
 *
 * The queue and its actions go through the SAME routes the console register's
 * `DeliveryQueue` calls (`delivery-apps/queue`, `delivery-apps/order-action`),
 * as the signed-in member, so the register's own gate holds on the device: an
 * admin or editor of the site with `managePos`, the `pos` entitlement, and this
 * plugin on for the site. With no service connected the queue answers
 * `connected: false` and the register draws nothing.
 */

let deliveryQueueRoute = "/api/delivery-apps/queue"
let deliveryOrderActionRoute = "/api/delivery-apps/order-action"

/// How often the register asks for the queue again.
let deliveryQueuePoll: Duration = .seconds(10)

/// The delivery services, as the plugin names them.
enum DeliveryService: String, CaseIterable, Equatable {
  case doordash
  case uberEats = "uber-eats"
  case grubhub

  var label: String {
    switch self {
    case .doordash: "DoorDash"
    case .uberEats: "Uber Eats"
    case .grubhub: "Grubhub"
    }
  }

  /// Whether the service takes a "ready for pickup" signal from the store.
  var readySignal: Bool { self != .uberEats }
}

/// Where an order stands at the counter: `new`, `accepted`, `ready`, `picked_up`, or `rejected` / `cancelled`.
enum DeliveryOrderStatus: String, Equatable {
  case new
  case accepted
  case ready
  case pickedUp = "picked_up"
  case rejected
  case cancelled

  var label: String {
    switch self {
    case .new: "New"
    case .accepted: "Making"
    case .ready: "Ready"
    case .pickedUp: "Picked up"
    case .rejected: "Rejected"
    case .cancelled: "Canceled"
    }
  }

  var tone: AglynTone {
    switch self {
    case .new: .warning
    case .accepted: .info
    case .ready: .success
    case .pickedUp, .rejected: .neutral
    case .cancelled: .error
    }
  }
}

enum DeliveryAction: String, Equatable {
  case accept
  case reject
  case ready
  case pickedUp = "picked_up"
  case retry
}

/// A call to the service still owed, retried by the plugin's job.
enum DeliveryPendingCall: String, Equatable { case accept, reject, ready }

struct DeliveryOrderLine: Equatable {
  let name: String
  let quantity: Int
  let unitPriceCents: Int
  /// The options the buyer chose, as the service named them.
  let options: [String]
  let instructions: String?
  /// Whether the line takes stock from a product.
  let matched: Bool
}

/// One order at the counter, as the register reads it.
struct DeliveryOrder: Equatable, Identifiable {
  let id: String
  /// The service, by the id the plugin names it with; a service this app has not heard of still draws.
  let serviceID: String
  /// The short code the courier and the service show.
  let externalRef: String
  let status: DeliveryOrderStatus
  /// `courier` for the service's courier, `customer` when the buyer collects it.
  let handoff: String
  let placedAtMs: Double
  /// When the service expects it ready, when it said.
  let pickupAtMs: Double?
  let customerName: String?
  let instructions: String?
  let lines: [DeliveryOrderLine]
  let currency: String
  let totalCents: Int
  let refundedCents: Int
  /// The short number of the store order it became, once accepted.
  let displayRef: String?
  /// Units the service sold beyond the shelf, once accepted.
  let oversold: Int
  let testMode: Bool
  /// A call to the service still owed.
  let pending: DeliveryPendingCall?
  /// Why the last attempt failed.
  let error: String?

  var service: DeliveryService? { DeliveryService(rawValue: serviceID) }
  var serviceLabel: String { service?.label ?? serviceID }
}

/// The register's queue: open orders, oldest first, and the latest finished ones.
struct DeliveryQueue: Equatable {
  /// Whether any service is connected for the site; the register draws nothing otherwise.
  let connected: Bool
  let open: [DeliveryOrder]
  let recent: [DeliveryOrder]

  static let disconnected = DeliveryQueue(connected: false, open: [], recent: [])
}

/// The one next step (or two) an order offers, as the console's queue lists them.
struct DeliveryStep: Equatable, Identifiable {
  let action: DeliveryAction
  let label: String
  var primary = false
  var destructive = false
  var id: String { action.rawValue }
}

func deliverySteps(_ order: DeliveryOrder) -> [DeliveryStep] {
  switch order.status {
  case .new:
    return [
      DeliveryStep(action: .accept, label: "Accept", primary: true),
      DeliveryStep(action: .reject, label: "Reject", destructive: true),
    ]
  case .accepted where order.pending != .accept:
    if order.service?.readySignal ?? true {
      return [
        DeliveryStep(action: .ready, label: "Ready for pickup", primary: true),
        DeliveryStep(action: .pickedUp, label: "Picked up"),
      ]
    }
    return [DeliveryStep(action: .pickedUp, label: "Picked up", primary: true)]
  case .ready:
    return [DeliveryStep(action: .pickedUp, label: "Picked up", primary: true)]
  default:
    return []
  }
}

/// Why a cashier turns an order down, in the words the service is sent.
let deliveryRejectReasons = [
  "An item is out of stock",
  "The kitchen is too busy",
  "The store is closing",
  "The store cannot make this order",
]

/// Minor units as money, in the order's currency.
func deliveryMoney(_ cents: Int, currency: String) -> String {
  let code = currency.isEmpty ? "USD" : currency.uppercased()
  return (Double(cents) / 100).formatted(.currency(code: code))
}

private extension JSONValue? {
  var text: String? { self?.stringValue.flatMap { $0.isEmpty ? nil : $0 } }
  var whole: Int { self?.numberValue.map { Int($0.rounded()) } ?? 0 }
  var flag: Bool { self?.boolValue ?? false }
  var list: [JSONValue] { if case .array(let values)? = self { return values }; return [] }
}

func readDeliveryOrder(_ element: JSONValue) -> DeliveryOrder? {
  guard let id = element["id"].text, let status = element["status"].text.flatMap(DeliveryOrderStatus.init(rawValue:)) else {
    return nil
  }
  return DeliveryOrder(
    id: id, serviceID: element["service"].text ?? "", externalRef: element["externalRef"].text ?? "", status: status,
    handoff: element["handoff"].text ?? "courier", placedAtMs: element["placedAtMs"]?.numberValue ?? 0,
    pickupAtMs: element["pickupAtMs"]?.numberValue, customerName: element["customerName"].text,
    instructions: element["instructions"].text,
    lines: element["lines"].list.map { line in
      DeliveryOrderLine(
        name: line["name"].text ?? "Item", quantity: max(1, line["quantity"].whole), unitPriceCents: line["unitPriceCents"].whole,
        options: line["options"].list.compactMap { $0.stringValue }, instructions: line["instructions"].text,
        matched: line["matched"].flag)
    },
    currency: element["currency"].text ?? "USD", totalCents: element["totalCents"].whole,
    refundedCents: element["refundedCents"].whole, displayRef: element["displayRef"].text,
    oversold: element["oversold"].whole, testMode: element["testMode"].flag,
    pending: element["pending"].text.flatMap(DeliveryPendingCall.init(rawValue:)), error: element["error"].text)
}

func readDeliveryQueue(_ body: JSONValue?) -> DeliveryQueue {
  guard let body, body["connected"].flag else { return .disconnected }
  return DeliveryQueue(
    connected: true, open: body["open"].list.compactMap(readDeliveryOrder),
    recent: body["recent"].list.compactMap(readDeliveryOrder))
}

/// What an action answered: the route's own sentence for the cashier, and the order as it now stands.
struct DeliveryActionResult: Equatable {
  let message: String?
  let order: DeliveryOrder?
}

/// The queue's routes for one site; tests answer them from a script.
protocol DeliveryAppsAPI: Sendable {
  func queue(hostID: String) async throws -> DeliveryQueue
  func act(hostID: String, orderID: String, action: DeliveryAction, reason: String?) async throws -> DeliveryActionResult
}

/// The queue's routes over the console API, as the signed-in member.
struct ConsoleDeliveryAppsAPI: DeliveryAppsAPI {
  let api: ConsoleAPIClient

  func queue(hostID: String) async throws -> DeliveryQueue {
    readDeliveryQueue(try await api.request(deliveryQueueRoute, query: [("hostId", hostID)]))
  }

  func act(hostID: String, orderID: String, action: DeliveryAction, reason: String?) async throws -> DeliveryActionResult {
    var body: [String: JSONValue] = [
      "hostId": .string(hostID), "orderId": .string(orderID), "action": .string(action.rawValue),
    ]
    if let reason, !reason.isEmpty { body["reason"] = .string(reason) }
    let answer = try await api.request(deliveryOrderActionRoute, method: .post, body: .object(body))
    return DeliveryActionResult(message: answer?["message"].text, order: answer?["order"].flatMap(readDeliveryOrder))
  }
}
