// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import Observation

/*
 * THE CUSTOMER AT THE REGISTER (AGL-3609, AGL-3651, AGL-3652): search the
 * workspace's people by name, email or phone, see what they have bought here
 * before, attach them to the sale, or add a new one in a few taps. Where the
 * workspace keeps no people, the register falls back to an email typed for
 * the receipt. The Kotlin app's `PosCustomers.kt`, line for line.
 *
 * The app calls the SAME route the console register's customer lookup calls,
 * `commerce/pos-customer` (`search`, `stats`, `create`), as the signed-in
 * member. The sale then carries the customer the way the console's does:
 * `customer` {kind, id, name, email, phone} plus `customerEmail`.
 */

let posCustomerRoute = "/api/commerce/pos-customer"

/// A search needs this many characters before the register asks.
let posCustomerSearchMinimum = 2

/// How long typing pauses before the register asks.
let posCustomerDebounce: Duration = .milliseconds(250)

/// The customer a sale is rung for. `id` is empty (and `kind` "none") when no record system keeps people.
struct PosCustomer: Equatable, Hashable, Codable {
  var kind: String
  var id: String
  var name: String
  var email: String?
  var phone: String?

  /// What the basket calls them.
  var title: String {
    if !name.isEmpty { return name }
    if let email, !email.isEmpty { return email }
    return "Customer"
  }

  /// Only an email typed for the receipt, with no record behind it.
  static func typed(email: String) -> PosCustomer {
    PosCustomer(kind: "none", id: "", name: "", email: email.lowercased(), phone: nil)
  }

  var json: JSONValue {
    var record: [String: JSONValue] = ["kind": .string(kind), "id": .string(id), "name": .string(name)]
    if let email { record["email"] = .string(email) }
    if let phone { record["phone"] = .string(phone) }
    return .object(record)
  }

  static func read(_ element: JSONValue?) -> PosCustomer? {
    guard let record = element?.objectValue, let kind = record["kind"]?.stringValue else { return nil }
    return PosCustomer(
      kind: kind, id: record["id"]?.stringValue ?? "", name: record["name"]?.stringValue ?? "",
      email: record["email"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 },
      phone: record["phone"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 })
  }
}

struct PosCustomerSearch: Equatable {
  /// False when the workspace keeps no people: the register takes an email instead.
  let available: Bool
  let customers: [PosCustomer]
}

struct PosCustomerStats: Equatable {
  let orderCount: Int
  let lifetimeSpendCents: Int
}

/// A text that is an email address, the same test the console uses.
func isCustomerEmail(_ text: String) -> Bool {
  text.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) != nil
}

/// The customer route, as the signed-in member.
protocol PosCustomersAPI: Sendable {
  func search(_ text: String) async throws -> PosCustomerSearch
  func stats(email: String) async throws -> PosCustomerStats
  func create(name: String, email: String, phone: String) async throws -> PosCustomer
}

struct ConsolePosCustomersAPI: PosCustomersAPI {
  let api: ConsoleAPIClient
  let hostID: String

  private func call(_ action: String, _ extra: [String: JSONValue] = [:]) async throws -> JSONValue? {
    var body: [String: JSONValue] = ["hostId": .string(hostID), "action": .string(action)]
    body.merge(extra) { _, given in given }
    return try await api.request(posCustomerRoute, method: .post, body: .object(body))
  }

  func search(_ text: String) async throws -> PosCustomerSearch {
    let answer = try await call("search", ["text": .string(text)])
    return PosCustomerSearch(
      available: answer?["available"]?.boolValue ?? true,
      customers: (answer?["customers"]?.arrayValue ?? []).compactMap { PosCustomer.read($0) })
  }

  func stats(email: String) async throws -> PosCustomerStats {
    let answer = try await call("stats", ["email": .string(email)])
    return PosCustomerStats(
      orderCount: answer?["orderCount"]?.cents ?? 0, lifetimeSpendCents: answer?["lifetimeSpendCents"]?.cents ?? 0)
  }

  func create(name: String, email: String, phone: String) async throws -> PosCustomer {
    let answer = try await call(
      "create",
      [
        "name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
        "email": .string(email.trimmingCharacters(in: .whitespacesAndNewlines)),
        "phone": .string(phone.trimmingCharacters(in: .whitespacesAndNewlines)),
      ])
    guard let customer = PosCustomer.read(answer?["customer"]) else {
      throw ConsoleAPIError(status: 502, message: "The register did not answer with a customer.")
    }
    return customer
  }
}

/// The customer route where there is no console to ask: every call finds it unreachable.
struct OfflinePosCustomers: PosCustomersAPI {
  private func unreachable() -> ConsoleAPIError {
    ConsoleAPIError(status: 0, message: "The register is offline. Check the connection and try again.")
  }
  func search(_ text: String) async throws -> PosCustomerSearch { throw unreachable() }
  func stats(email: String) async throws -> PosCustomerStats { throw unreachable() }
  func create(name: String, email: String, phone: String) async throws -> PosCustomer { throw unreachable() }
}

/// The lookup beside the basket: the search, the quick-add form and the attached customer's history.
@MainActor
@Observable
final class PosCustomerModel {
  var text = ""
  private(set) var results: [PosCustomer] = []
  private(set) var available = true
  private(set) var stats: PosCustomerStats?
  private(set) var error: String?
  private(set) var busy = false
  /// The quick-add form is open.
  private(set) var adding = false
  var draftName = ""
  var draftEmail = ""
  var draftPhone = ""

  @ObservationIgnored private let api: PosCustomersAPI
  /// Latest search wins: an answer for older text is dropped.
  @ObservationIgnored private var ticket = 0

  init(api: PosCustomersAPI) { self.api = api }

  /// The text is an email the cashier can use as it is.
  var typedEmail: String? {
    let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return isCustomerEmail(typed) ? typed.lowercased() : nil
  }

  /// Asks the route for the typed text; the view waits out the debounce first.
  func search() async {
    let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard typed.count >= posCustomerSearchMinimum else {
      results = []
      return
    }
    ticket += 1
    let mine = ticket
    do {
      let answer = try await api.search(typed)
      guard mine == ticket else { return }
      available = answer.available
      results = answer.customers
    } catch {
      guard mine == ticket else { return }
      results = []
    }
  }

  /// Reads what the attached customer has bought here; nothing for a customer with no email.
  func loadStats(email: String?) async {
    stats = nil
    guard let email, isCustomerEmail(email) else { return }
    if let read = try? await api.stats(email: email) { stats = read }
  }

  /// A customer was attached: the search starts over.
  func clearSearch() {
    ticket += 1
    text = ""
    results = []
  }

  func startAdding() {
    draftName = ""
    draftEmail = typedEmail ?? ""
    draftPhone = ""
    error = nil
    adding = true
  }

  func cancelAdding() {
    if busy { return }
    adding = false
    error = nil
  }

  /// Adds the customer through the route; nil (with the reason in `error`) when it refused.
  func create() async -> PosCustomer? {
    if busy { return nil }
    guard isCustomerEmail(draftEmail.trimmingCharacters(in: .whitespacesAndNewlines)) else {
      error = "Add the customer’s email address."
      return nil
    }
    busy = true
    error = nil
    defer { busy = false }
    do {
      let customer = try await api.create(name: draftName, email: draftEmail, phone: draftPhone)
      adding = false
      return customer
    } catch {
      self.error = (error as? ConsoleAPIError)?.message ?? "Could not add the customer."
      return nil
    }
  }
}
