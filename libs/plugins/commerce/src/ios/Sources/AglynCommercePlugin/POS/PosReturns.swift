// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * RETURNS AT THE REGISTER (AGL-3609, AGL-3651, AGL-3652): find the sale by its
 * number (typed or scanned off the receipt), its id or the customer's email,
 * pick what came back, and refund it to the payments the sale was made with.
 * The Kotlin app's `PosReturns.kt`, line for line.
 *
 * The app calls the SAME route the console register's Return dialog calls,
 * `commerce/pos-return`, as the signed-in member, so every gate holds on the
 * device unchanged: the role, the cashier refund limit (above it the route
 * asks for a manager's PIN), the open-shift rule for cash out of the drawer,
 * the open-chargeback refusal and the attempt claim. The server prices the
 * refund, splits it across the sale's payments and restocks; this only
 * previews the figure the same way the console dialog does.
 */

let posReturnRoute = "/api/commerce/pos-return"

/// One line of the sale, as the return lookup lists it.
struct PosReturnLine: Equatable, Identifiable {
  let index: Int
  let name: String
  let variantLabel: String?
  let quantity: Int
  /// Units the register already took back.
  let returned: Int
  /// Units an online return holds or already took.
  let held: Int
  /// What the whole line is worth in a refund (discounts and tax shared in).
  let valueCents: Int

  var id: Int { index }
  /// Units that can still come back.
  var left: Int { max(0, quantity - returned - held) }

  /// What returning `count` more units refunds, by the server's cumulative split.
  func refundCents(returning count: Int) -> Int {
    guard count > 0, quantity > 0 else { return 0 }
    let value = Double(valueCents)
    return jsRound(value * Double(returned + count) / Double(quantity)) - jsRound(value * Double(returned) / Double(quantity))
  }
}

/// A payment on the sale, with what it can still take back.
struct PosReturnTender: Equatable, Identifiable {
  let id: String
  let method: String
  let label: String
  let amountCents: Int
  let refundableCents: Int
}

struct PosReturnOrder: Equatable, Identifiable {
  let id: String
  let label: String
  let status: String
  let createdAtMs: Double
  let customerEmail: String?
  let customerName: String?
  let totalCents: Int
  let refundedCents: Int
  let returnable: Bool
  let lines: [PosReturnLine]
  let tenders: [PosReturnTender]

  /// What the order can still give back in all.
  var remainingCents: Int { max(0, totalCents - refundedCents) }
}

struct PosReturnPick: Equatable {
  let index: Int
  let quantity: Int
}

struct PosReturnSplit: Equatable {
  let paymentID: String
  let amountCents: Int
}

struct PosReturnRequest: Equatable {
  let orderID: String
  let picks: [PosReturnPick]
  let restock: Bool
  let reasonCode: String
  let note: String
  /// Named only when the cashier splits the refund by hand.
  let split: [PosReturnSplit]?
}

struct PosReturnTenderResult: Equatable {
  let label: String
  let amountCents: Int
  let failed: Bool
  let error: String?
}

struct PosReturnResult: Equatable {
  let returnID: String
  let refundedCents: Int
  /// Money a card could not take back; the cashier pays it another way.
  let outstandingCents: Int
  let partial: Bool
  /// Cash to hand over from the drawer.
  let cashOutCents: Int
  let restockedUnits: Int
  let tenders: [PosReturnTenderResult]
}

func readReturnOrder(_ element: JSONValue?) -> PosReturnOrder? {
  guard let record = element?.objectValue, let id = record["id"]?.stringValue else { return nil }
  let lines = (record["lines"]?.arrayValue ?? []).compactMap { line -> PosReturnLine? in
    guard let index = line["index"]?.numberValue else { return nil }
    return PosReturnLine(
      index: jsRound(index), name: line["name"]?.stringValue ?? "", variantLabel: line["variantLabel"]?.stringValue,
      quantity: max(1, line["quantity"]?.cents ?? 1), returned: line["returned"]?.cents ?? 0,
      held: line["held"]?.cents ?? 0, valueCents: line["valueCents"]?.cents ?? 0)
  }
  let tenders = (record["tenders"]?.arrayValue ?? []).compactMap { tender -> PosReturnTender? in
    guard let tenderID = tender["id"]?.stringValue else { return nil }
    return PosReturnTender(
      id: tenderID, method: tender["method"]?.stringValue ?? "", label: tender["label"]?.stringValue ?? "Payment",
      amountCents: tender["amountCents"]?.cents ?? 0, refundableCents: tender["refundableCents"]?.cents ?? 0)
  }
  return PosReturnOrder(
    id: id, label: record["label"]?.stringValue ?? id, status: record["status"]?.stringValue ?? "",
    createdAtMs: record["createdAtMs"]?.numberValue ?? 0, customerEmail: record["customerEmail"]?.stringValue,
    customerName: record["customerName"]?.stringValue, totalCents: record["totalCents"]?.cents ?? 0,
    refundedCents: record["refundedCents"]?.cents ?? 0, returnable: record["returnable"]?.flag ?? false,
    lines: lines, tenders: tenders)
}

func readReturnResult(_ element: JSONValue?) -> PosReturnResult? {
  guard let record = element?.objectValue, record["refundedCents"] != nil else { return nil }
  let tenders = (record["tenders"]?.arrayValue ?? []).map { tender in
    PosReturnTenderResult(
      label: tender["label"]?.stringValue ?? "Payment", amountCents: tender["amountCents"]?.cents ?? 0,
      failed: tender["status"]?.stringValue == "failed", error: tender["error"]?.stringValue)
  }
  return PosReturnResult(
    returnID: record["returnId"]?.stringValue ?? "", refundedCents: record["refundedCents"]?.cents ?? 0,
    outstandingCents: record["outstandingCents"]?.cents ?? 0, partial: record["partial"]?.flag ?? false,
    cashOutCents: record["cashOutCents"]?.cents ?? 0, restockedUnits: record["restockedUnits"]?.cents ?? 0,
    tenders: tenders)
}

/// The return route, as the signed-in member.
protocol PosReturnsAPI: Sendable {
  func find(_ text: String) async throws -> [PosReturnOrder]
  func refund(
    registerID: String, assertion: String?, managerAssertion: String?, request: PosReturnRequest, attemptKey: String
  ) async throws -> PosReturnResult
}

struct ConsolePosReturnsAPI: PosReturnsAPI {
  let api: ConsoleAPIClient
  let hostID: String

  func find(_ text: String) async throws -> [PosReturnOrder] {
    let answer = try await api.request(
      posReturnRoute, method: .post,
      body: .object(["hostId": .string(hostID), "action": "find", "text": .string(text)]))
    return (answer?["orders"]?.arrayValue ?? []).compactMap(readReturnOrder)
  }

  func refund(
    registerID: String, assertion: String?, managerAssertion: String?, request: PosReturnRequest, attemptKey: String
  ) async throws -> PosReturnResult {
    var body: [String: JSONValue] = [
      "hostId": .string(hostID), "registerId": .string(registerID), "action": "refund",
      "orderId": .string(request.orderID),
      "lines": .array(
        request.picks.map { .object(["index": .number(Double($0.index)), "quantity": .number(Double($0.quantity))]) }),
      "restock": .bool(request.restock), "reasonCode": .string(request.reasonCode),
    ]
    let note = request.note.trimmingCharacters(in: .whitespacesAndNewlines)
    if !note.isEmpty { body["reason"] = .string(note) }
    if let split = request.split {
      body["tenders"] = .array(
        split.map { .object(["paymentId": .string($0.paymentID), "amountCents": .number(Double($0.amountCents))]) })
    }
    if let assertion { body["cashierAssertion"] = .string(assertion) }
    if let managerAssertion { body["managerAssertion"] = .string(managerAssertion) }
    let answer = try await api.request(posReturnRoute, method: .post, body: .object(body), idempotencyKey: attemptKey)
    guard let result = readReturnResult(answer) else {
      throw ConsoleAPIError(status: 502, message: "The register did not answer with a refund.")
    }
    return result
  }
}

/// The return route where there is no console to ask: every call finds it unreachable.
struct OfflinePosReturns: PosReturnsAPI {
  private func unreachable() -> ConsoleAPIError {
    ConsoleAPIError(status: 0, message: "The register is offline. Check the connection and try again.")
  }
  func find(_ text: String) async throws -> [PosReturnOrder] { throw unreachable() }
  func refund(
    registerID: String, assertion: String?, managerAssertion: String?, request: PosReturnRequest, attemptKey: String
  ) async throws -> PosReturnResult { throw unreachable() }
}

/// A return being rung: the lookup, the picks, the refund and what the cashier does next.
@MainActor
@Observable
final class PosReturnModel {
  /// Every order the lookup found; nil before it ran.
  private(set) var orders: [PosReturnOrder]?
  private(set) var order: PosReturnOrder?
  private(set) var picked: [Int: Int] = [:]
  var text = ""
  var restock = true
  var reasonCode = "no_longer_needed"
  var note = ""
  var splitByHand = false
  var split: [String: String] = [:]
  private(set) var error: String?
  private(set) var busy = false
  private(set) var result: PosReturnResult?
  /// Set while the route wants a manager's PIN, with its words.
  private(set) var managerPrompt: String?

  @ObservationIgnored private let api: PosReturnsAPI
  @ObservationIgnored private let registerID: () -> String?
  @ObservationIgnored private let assertion: () -> String?
  @ObservationIgnored private let mintKey: () -> String
  /// One attempt per return: a retried tap or the manager's approval reuses it.
  @ObservationIgnored private var attempt = ""

  init(
    api: PosReturnsAPI, registerID: @escaping () -> String?, assertion: @escaping () -> String?,
    mintKey: @escaping () -> String = { newAttemptKey("pos-return") }
  ) {
    self.api = api
    self.registerID = registerID
    self.assertion = assertion
    self.mintKey = mintKey
  }

  /// Back to an empty lookup (a sheet that closes, or "Done").
  func reset() {
    text = ""
    orders = nil
    order = nil
    picked = [:]
    restock = true
    reasonCode = "no_longer_needed"
    note = ""
    splitByHand = false
    split = [:]
    error = nil
    result = nil
    managerPrompt = nil
    attempt = ""
  }

  func find() async {
    let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty, !busy else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      let found = try await api.find(query)
      orders = found
      if found.count == 1 { choose(found[0]) }
    } catch {
      self.error = describe(error, "Could not look the order up.")
    }
  }

  func choose(_ next: PosReturnOrder) {
    order = next
    picked = [:]
    split = [:]
    attempt = ""
    error = nil
  }

  /// Back from the picks: to the list when the lookup found several, else to the lookup.
  func back() {
    if busy { return }
    if (orders?.count ?? 0) > 1 {
      order = nil
      picked = [:]
      error = nil
    } else {
      reset()
    }
  }

  func quantity(_ line: PosReturnLine) -> Int { picked[line.index] ?? 0 }

  func step(_ line: PosReturnLine, by delta: Int) {
    guard let order, order.returnable else { return }
    let next = min(line.left, max(0, quantity(line) + delta))
    picked[line.index] = next
    attempt = ""
  }

  var picks: [PosReturnPick] {
    picked.filter { $0.value > 0 }.map { PosReturnPick(index: $0.key, quantity: $0.value) }.sorted { $0.index < $1.index }
  }

  /// What the picks refund, by the console dialog's own figure.
  var refundCents: Int {
    guard let order else { return 0 }
    let asked = picks.reduce(0) { sum, pick in
      sum + (order.lines.first { $0.index == pick.index }?.refundCents(returning: pick.quantity) ?? 0)
    }
    return min(asked, order.remainingCents)
  }

  var canSubmit: Bool { !busy && order?.returnable == true && !picks.isEmpty && refundCents > 0 }

  /// What the hand split names, one entry per payment given an amount.
  private var handSplit: [PosReturnSplit]? {
    guard splitByHand, let order else { return nil }
    return order.tenders.compactMap { tender in
      guard let cents = centsFromText(split[tender.id]), cents > 0 else { return nil }
      return PosReturnSplit(paymentID: tender.id, amountCents: cents)
    }
  }

  func submit(managerAssertion: String? = nil) async {
    guard let order, !picks.isEmpty, !busy, let register = registerID() else { return }
    if attempt.isEmpty { attempt = mintKey() }
    let request = PosReturnRequest(
      orderID: order.id, picks: picks, restock: restock, reasonCode: reasonCode, note: note, split: handSplit)
    busy = true
    error = nil
    defer { busy = false }
    do {
      result = try await api.refund(
        registerID: register, assertion: assertion(), managerAssertion: managerAssertion, request: request,
        attemptKey: attempt)
      managerPrompt = nil
    } catch let failure as ConsoleAPIError {
      if failure.status == 403, failure.body?["needsManager"]?.flag == true {
        managerPrompt = failure.message
        return
      }
      // A refusal moved no money; a new tap is a new attempt.
      attempt = ""
      error = failure.message
    } catch {
      attempt = ""
      self.error = "The return could not be refunded."
    }
  }

  /// A manager's PIN approved the refund: send it again as the same attempt.
  func approve(_ manager: PosStaffAssertion) async {
    managerPrompt = nil
    await submit(managerAssertion: manager.assertion)
  }

  func cancelApproval() { managerPrompt = nil }

  private func describe(_ failure: Error, _ fallback: String) -> String {
    (failure as? ConsoleAPIError)?.message ?? fallback
  }
}
