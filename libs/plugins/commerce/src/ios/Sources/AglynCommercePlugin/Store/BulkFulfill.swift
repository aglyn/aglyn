// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * Mark several orders fulfilled at once, from the orders list (the console's `bulkFulfillOrders`, AGL-3611).
 *
 * One request per order through the same `fulfill-order` route the order screen uses, one after another, so each order gets
 * its own transition check and its own answer: a refunded order in the selection is refused on its own and the rest still
 * ship. Each carries a key derived from this batch and the order, so running the same batch again after a lost answer
 * writes nothing twice.
 */

struct BulkFulfillResult: Equatable {
  struct Refusal: Equatable {
    let orderID: String
    let error: String
  }

  var fulfilled = 0
  var already = 0
  var refused: [Refusal] = []
  /// Orders whose answer never came back: it is not known whether they shipped.
  var unknown: [String] = []
}

/// The statuses a fulfil can move; the rest are skipped without a request.
let bulkFulfillableStatuses: Set<OrderStatus> = [.paid, .partiallyFulfilled]

func bulkFulfillOrders(api: ConsoleAPIClient, hostID: String, orders: [OrderRow], batchKey: String) async -> BulkFulfillResult {
  var result = BulkFulfillResult()
  for row in orders {
    guard bulkFulfillableStatuses.contains(row.status) else {
      result.refused.append(.init(orderID: row.id, error: "Orders in \"\(row.status.rawValue)\" cannot be fulfilled"))
      continue
    }
    do {
      let answer = try await api.request(
        "/api/commerce/fulfill-order", method: .post,
        body: .object(["hostId": .string(hostID), "orderId": .string(row.id), "to": "fulfilled"]),
        idempotencyKey: "\(batchKey):\(row.id)")
      if answer?["already"] == .bool(true) { result.already += 1 } else { result.fulfilled += 1 }
    } catch let error as ConsoleAPIError {
      // Below 500 the route answered: it refused this order. Otherwise it is not known whether it shipped.
      if (400..<500).contains(error.status), !error.message.isEmpty {
        result.refused.append(.init(orderID: row.id, error: error.message))
      } else {
        result.unknown.append(row.id)
      }
    } catch {
      result.unknown.append(row.id)
    }
  }
  return result
}

/// One line for the banner: what happened, then what did not.
func describeBulkFulfill(_ result: BulkFulfillResult) -> String {
  var parts: [String] = []
  let done = result.fulfilled + result.already
  if done > 0 { parts.append("\(done) \(done == 1 ? "order" : "orders") fulfilled") }
  if let first = result.refused.first {
    parts.append("\(result.refused.count) skipped (\(first.error.lowercased())\(result.refused.count > 1 ? ", …" : ""))")
  }
  if !result.unknown.isEmpty {
    parts.append(
      "\(result.unknown.count) not confirmed — reopen \(result.unknown.count == 1 ? "it" : "them") to check; running it again is safe")
  }
  return parts.isEmpty ? "Nothing to fulfill" : parts.joined(separator: "; ")
}
