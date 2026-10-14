// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import Observation

/*
 * THE REGISTER'S DELIVERY QUEUE: the state behind the card. It asks the route
 * for the queue on a steady beat, says once when a new order has arrived (the
 * first look aside), and sends the cashier's one step on an order, then asks
 * again so the card shows where the order now stands.
 */
@MainActor
@Observable
final class DeliveryQueueModel {
  /// Nil until the first answer; `connected: false` once a look finds no service (or turns the cashier away).
  private(set) var queue: DeliveryQueue?
  /// The order a step is on its way for.
  private(set) var busy: String?
  /// A new order arrived since the last look, said once.
  var announcement: String?
  /// The route's own sentence about the last step, or why it did not go through.
  var notice: DeliveryNotice?
  var showRecent = false
  /// The order the cashier is about to turn down (the reason is asked first).
  var rejecting: DeliveryOrder?

  @ObservationIgnored private let api: DeliveryAppsAPI
  @ObservationIgnored private let hostID: () -> String?
  @ObservationIgnored private var seen: Set<String>?

  init(api: DeliveryAppsAPI, hostID: @escaping () -> String?) {
    self.api = api
    self.hostID = hostID
  }

  /// Orders waiting for the cashier to accept or reject.
  var waiting: Int { queue?.open.filter { $0.status == .new }.count ?? 0 }

  func refresh() async {
    guard let host = hostID() else { return }
    do {
      let answer = try await api.queue(hostID: host)
      // A new order since the last look is announced once, the first look aside.
      let known = seen
      let fresh = answer.open.filter { order in
        guard let known else { return false }
        return order.status == .new && !known.contains(order.id)
      }
      seen = Set(answer.open.map(\.id))
      if let first = fresh.first {
        announcement =
          fresh.count == 1 ? "New \(first.serviceLabel) order \(first.externalRef)" : "\(fresh.count) new delivery orders"
      }
      queue = answer
    } catch {
      // Turned away, or no service here: the register shows nothing.
      queue = queue ?? .disconnected
    }
  }

  /// The cashier's step on an order. Rejecting asks for a reason first (`reject(_:reason:)`).
  func act(_ order: DeliveryOrder, _ action: DeliveryAction, reason: String? = nil) async {
    guard let host = hostID(), busy == nil else { return }
    if action == .reject, reason == nil {
      rejecting = order
      return
    }
    busy = order.id
    notice = nil
    do {
      let answer = try await api.act(hostID: host, orderID: order.id, action: action, reason: reason)
      if let message = answer.message { notice = DeliveryNotice(message: message, isError: false) }
    } catch {
      let words = (error as? ConsoleAPIError)?.message ?? ""
      notice = DeliveryNotice(message: words.isEmpty ? "That did not go through. Try again in a moment." : words, isError: true)
    }
    busy = nil
    await refresh()
  }

  func reject(_ order: DeliveryOrder, reason: String) async {
    rejecting = nil
    await act(order, .reject, reason: reason)
  }
}

struct DeliveryNotice: Equatable {
  let message: String
  let isError: Bool
}
