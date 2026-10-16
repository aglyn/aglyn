// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * THE ORDERS LIST'S OWN ACTIONS (AGL-3841), beside the console's grid: the
 * banner for charges a shopper's bank is disputing (its own query, whatever
 * the list is filtered to), Draft order (a payment link for someone you sell to
 * directly), and the shipping tools' Export for shipping and Import tracking.
 */

/// How many open disputes the banner reads (`OPEN_DISPUTE_CEILING`).
let openDisputeCeiling = 50

/// The banner's headline (the console's words).
func openDisputesTitle(_ summary: OpenDisputeSummary, more: Bool) -> String {
  if more { return "More than \(openDisputeCeiling) charges are disputed with the shopper’s bank" }
  return summary.count == 1 ? "A shopper has disputed a charge with their bank" : "\(summary.count) charges are disputed with the shopper’s bank"
}

/// The banner's sentence: the tightest evidence deadline.
func openDisputesDetail(_ summary: OpenDisputeSummary) -> String {
  guard let left = summary.soonestDaysLeft else {
    return "Answer in the Stripe dashboard while the case is open — an unanswered dispute is decided for the shopper."
  }
  if left < 0 {
    return "The evidence deadline has passed on at least one of these. Stripe decides an unanswered dispute for the shopper."
  }
  return "Evidence is due to Stripe in \(left) day\(left == 1 ? "" : "s") on the tightest of these. An unanswered dispute is decided for the shopper."
}

/// The open disputes, read on their own query (`disputeKey == open`), as the console's banner reads them.
@MainActor
@Observable
final class OpenDisputesModel {
  private(set) var summary = OpenDisputeSummary(count: 0, soonestDueByMs: nil, soonestDaysLeft: nil, overdue: false)
  private(set) var more = false
  @ObservationIgnored private var listener: FirestoreListening?

  func start(_ reader: FirestoreReader, hostID: String?) {
    listener?.remove()
    guard let hostID else { return }
    listener = reader.listen(FirestoreQuery(ordersPath(hostID), equals: [("disputeKey", "open")], limit: openDisputeCeiling + 1)) {
      [weak self] result in
      guard let self, case .success(let docs) = result else { return }
      more = docs.count > openDisputeCeiling
      summary = summariseOpenDisputes(docs.prefix(openDisputeCeiling).map(decodeOrder))
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }
}

/// `ContractJSON` as the API's JSON.
func apiJSON(_ value: ContractJSON) -> JSONValue {
  (try? JSONEncoder().encode(value)).flatMap(JSONValue.decode) ?? .null
}

/// The orders export for a shipping tool: the open orders still to ship, in the preset's columns (`OrderShippingActions`).
func shippingExportRequest(hostID: String, presetID: String) -> TransferExportRequest {
  let values = ContractValues.shared
  return TransferExportRequest(
    resource: "commerce.orders", title: "Export orders for shipping", hostID: hostID,
    scope: .object(["kind": "filter", "filter": apiJSON(values.ordersToShipFilterValue)]), fileStem: "orders-to-ship",
    filterLabel: values.ordersToShipFilterLabel, preset: presetID)
}

/// Orders written before the shipping fields carry no `requiresShipping`; stamping the open ones first lets the export
/// find them. Best effort: the export still opens, and shows what is already stamped.
func prepareOrdersForShipping(api: ConsoleAPIClient, hostID: String) async {
  _ = try? await api.request("/api/commerce/orders-shipping-prepare", method: .post, body: .object(["hostId": .string(hostID)]))
}

/// The import screen's parameters for tracking numbers (the console's Import tracking).
func trackingImportParams(hostID: String?) -> NativeParams {
  var params: NativeParams = ["resource": "commerce.tracking", "title": "Import tracking numbers"]
  if let hostID { params["hostId"] = hostID }
  return params
}

// MARK: - Draft order

/// What the draft order route answered, or what it still needs to know.
enum DraftOrderOutcome: Equatable {
  case created(url: String)
  /// The store's rates differ by destination (or price by carrier): the link needs a country (and a postal code).
  case needsDestination(countries: [String], postalCode: Bool, message: String)
  case refused(String)
}

/// Reads the route's refusal for the destination it asks for (`needsShippingCountry`), else its words.
func draftOrderRefusal(_ body: JSONValue?, message: String) -> DraftOrderOutcome {
  guard body?["needsShippingCountry"] == .bool(true) else { return .refused(message) }
  let listed = (body?["shippingCountries"]?.arrayValue ?? []).compactMap(\.stringValue)
  return .needsDestination(
    countries: listed.isEmpty ? ContractValues.shared.checkoutShippingCountryCodes : listed,
    postalCode: body?["needsShippingPostalCode"] == .bool(true), message: message)
}

/// Draft order: a product, its variant and how many, an optional buyer email, and — once the store asks — where it
/// ships. Creates the payment link and copies it, as the console's dialog does.
struct DraftOrderSheet: View {
  let context: NativePluginContext
  let done: (String) -> Void
  @State private var products: [ProductRow] = []
  @State private var productID = ""
  @State private var variantID = ""
  @State private var quantity = "1"
  @State private var email = ""
  @State private var countries: [String] = []
  @State private var askPostal = false
  @State private var country = ""
  @State private var postal = ""
  @State private var attemptKey = UUID().uuidString
  @State private var listener: FirestoreListening?

  private var product: ProductRow? { products.first { $0.id == productID } }
  private var canCreate: Bool {
    !productID.isEmpty && (countries.isEmpty || !country.isEmpty) && (!askPostal || !postal.trimmingCharacters(in: .whitespaces).isEmpty)
  }

  var body: some View {
    AglynFormSheet("Draft order", confirm: "Create & copy link", canConfirm: canCreate, save: { try await create() }) {
      Section {
        Picker("Product", selection: $productID) {
          Text("Choose a product").tag("")
          ForEach(products) { Text($0.name).tag($0.id) }
        }
        .onChange(of: productID) { _, _ in variantID = "" }
        .accessibilityIdentifier("draft-product")
        if let product, product.item.variants.count > 1 {
          Picker("Variant", selection: $variantID) {
            Text("Choose a variant").tag("")
            ForEach(product.item.variants) { variant in
              Text("\(variant.label ?? "Default") — \(variant.unitCents.map { formatOrderMoney($0) } ?? "No price")").tag(variant.id)
            }
          }
          .accessibilityIdentifier("draft-variant")
        }
        TextField("Quantity", text: $quantity)
          .onChange(of: quantity) { _, typed in quantity = typed.filter(\.isNumber) }
          .accessibilityIdentifier("draft-quantity")
          #if os(iOS)
            .keyboardType(.numberPad)
          #endif
        TextField("Buyer email (optional)", text: $email)
          .autocorrectionDisabled()
          .accessibilityIdentifier("draft-email")
          #if os(iOS)
            .textInputAutocapitalization(.never)
            .keyboardType(.emailAddress)
          #endif
      } footer: {
        if products.isEmpty {
          Text("Add a product to this store first — a draft order is built from one.")
        }
      }
      if !countries.isEmpty {
        Section {
          Picker("Ships to", selection: $country) {
            Text("Choose a country").tag("")
            ForEach(countries, id: \.self) { code in Text(ContractValues.shared.checkoutShippingCountryNames[code] ?? code).tag(code) }
          }
          .accessibilityIdentifier("draft-country")
          if askPostal {
            TextField("Postal code", text: $postal).accessibilityIdentifier("draft-postal")
          }
        } footer: {
          Text(
            askPostal
              ? "This store prices shipping by carrier, which needs the postal code."
              : "This store’s shipping rates differ by destination, so the payment link has to be priced for one.")
        }
      }
    }
    .task(id: context.hostID) {
      listener?.remove()
      guard let hostID = context.hostID else { return }
      listener = context.firestore.listen(productsPlan(status: "active", search: "").firestoreQuery(productsPath(hostID), limit: 200)) { result in
        if case .success(let docs) = result { products = docs.map(ProductRow.init) }
      }
    }
    .onDisappear { listener?.remove() }
  }

  private func create() async throws {
    guard let hostID = context.hostID else { return }
    var body: [String: JSONValue] = [
      "hostId": .string(hostID), "productId": .string(productID), "quantity": .number(Double(Int(quantity) ?? 1).clamped(min: 1)),
    ]
    if !variantID.isEmpty { body["variantId"] = .string(variantID) }
    let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
    if !address.isEmpty { body["email"] = .string(address) }
    // A request, never an instruction: the server restricts the link's addresses to the country it prices for.
    if !country.isEmpty { body["shippingCountry"] = .string(country) }
    let code = postal.trimmingCharacters(in: .whitespacesAndNewlines)
    if !code.isEmpty { body["shippingPostalCode"] = .string(code) }
    do {
      let answer = try await context.api.request(
        "/api/commerce/draft-order", method: .post, body: .object(body), idempotencyKey: attemptKey)
      guard let url = answer?["url"]?.stringValue else { throw SheetFailure(message: "Draft order failed") }
      copyToClipboard(url)
      done("Draft created — payment link copied")
    } catch let error as ConsoleAPIError where error.status > 0 && error.status < 500 {
      attemptKey = UUID().uuidString
      switch draftOrderRefusal(error.body, message: error.message) {
      case .needsDestination(let listed, let postalCode, let message):
        countries = listed
        askPostal = postalCode
        throw SheetFailure(message: message)
      case .refused(let message), .needsDestination(_, _, let message):
        throw SheetFailure(message: message.isEmpty ? "Draft order failed" : message)
      case .created:
        return
      }
    }
  }
}

extension Double {
  fileprivate func clamped(min lower: Double) -> Double { Swift.max(lower, self) }
}
