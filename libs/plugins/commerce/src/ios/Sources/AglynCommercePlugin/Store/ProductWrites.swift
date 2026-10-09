// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * PRODUCT WRITES FROM THE AGLYN APP (AGL-3651): New product, Edit and Adjust
 * stock, the Kotlin kit's ProductWrites.kt.
 *
 * The console computes a save's derived fields in the browser (search keys,
 * stock verdict, price, image, smart-collection membership); the app sends
 * the product to `commerce/products/save` and a stock change to
 * `commerce/products/stock`, which run the console's own computation
 * (`model/product-write.ts`) under the gate the Firestore rules apply. No
 * derived field is worked out here.
 *
 * An edit is the console's full replace, so the app sends the WHOLE stored
 * product with its edits on top, never just the fields it shows: a field the
 * app does not know about survives. Stored timestamps are left out (the route
 * keeps the stored ones); everything else round-trips as JSON.
 */

let productSaveRoute = "/api/commerce/products/save"
let productStockRoute = "/api/commerce/products/stock"

/// The reasons Adjust stock offers, as the console's dialog names them.
let stockReasons: [(value: String, label: String)] = [
  ("restock", "Restock"), ("correction", "Correction"), ("damage", "Damaged"), ("refund", "Refund return"),
]

/// A stored value as JSON; nil for a timestamp (the route keeps the stored one) or anything JSON cannot hold.
func storedJSON(_ value: Any) -> JSONValue? {
  switch value {
  case is NSNull: return .null
  case is Date: return nil
  case let text as String: return .string(text)
  case let number as NSNumber:
    if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
    return number.doubleValue.isFinite ? .number(number.doubleValue) : nil
  case let list as [Any]: return .array(list.compactMap(storedJSON))
  case let record as [String: Any]: return .object(record.compactMapValues(storedJSON))
  default: return nil
  }
}

/// A stored product document as the JSON a save sends.
func storedProductJSON(_ data: [String: Any]) -> [String: JSONValue] { data.compactMapValues(storedJSON) }

/// One variant as the editor shows it.
struct VariantDraft: Identifiable, Equatable {
  var id: String
  var label: String
  var price = ""
  var compareAt = ""
  var sku = ""
  var barcode = ""
  /// Starting stock; a new product only (an edit adjusts stock separately).
  var stock = ""
}

/// What the editor edits.
struct ProductDraft: Equatable {
  var productID: String
  var create: Bool
  var name = ""
  var description = ""
  var status: ProductStatus = .draft
  var type: ProductType = .physical
  var variants: [VariantDraft] = [VariantDraft(id: "default", label: "Default")]
}

/// A fresh product id, minted here so a retried create finds its own product.
func newProductID() -> String {
  "p" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(19)
}

private func moneyText(_ dollars: Any?) -> String {
  guard let number = dollars as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite
  else { return "" }
  return amountText(jsRound(number.doubleValue * 100))
}

/// The editor opened on a stored product: its own fields, its variants with their prices and codes.
func productDraft(_ doc: FirestoreDocument) -> ProductDraft {
  let data = doc.data
  let stored = (data["variants"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
  let variants: [VariantDraft] =
    stored.isEmpty
    ? [VariantDraft(id: "default", label: "Default", price: moneyText(data["priceUsd"]))]
    : stored.enumerated().map { index, raw in
      let id = (raw["id"] as? String) ?? "default"
      return VariantDraft(
        id: id,
        label: variantLabel(raw["options"] as? [String: Any]) ?? (stored.count == 1 ? "Default" : "Variant \(index + 1)"),
        price: moneyText(raw["priceUsd"]), compareAt: moneyText(raw["compareAtPriceUsd"]),
        sku: raw["sku"] as? String ?? "", barcode: raw["barcode"] as? String ?? "")
    }
  return ProductDraft(
    productID: doc.id, create: false, name: doc.string("name") ?? "", description: doc.string("description") ?? "",
    status: doc.string("status").flatMap(ProductStatus.init(rawValue:)) ?? .active,
    type: doc.string("type").flatMap(ProductType.init(rawValue:)) ?? .physical, variants: variants)
}

/// Why the draft cannot be sent, or nil. The route validates again.
func checkProductDraft(_ draft: ProductDraft) -> String? {
  if draft.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Product name is required" }
  for variant in draft.variants {
    if centsFromText(variant.price) == nil { return "Enter a price for \(variant.label)" }
    if !variant.compareAt.trimmingCharacters(in: .whitespaces).isEmpty, centsFromText(variant.compareAt) == nil {
      return "Enter a compare-at price for \(variant.label), or leave it empty"
    }
    let stock = variant.stock.trimmingCharacters(in: .whitespaces)
    if draft.create, !stock.isEmpty, (Int(stock).map { $0 < 0 } ?? true) {
      return "Enter a whole number of units, or leave stock empty"
    }
  }
  return nil
}

/// The product a save sends: the stored product (or the console's blank one)
/// with the editor's fields on top. Codes and compare-at prices left empty
/// are removed, as the console's editor removes them.
func productSaveJSON(_ draft: ProductDraft, stored: [String: Any]?) -> JSONValue {
  var base: [String: JSONValue] =
    stored.map(storedProductJSON) ?? [
      "name": "", "slug": "", "type": .string(ProductType.physical.rawValue),
      "status": .string(ProductStatus.draft.rawValue),
    ]
  var storedVariants: [JSONValue] = []
  if case .array(let list)? = base["variants"] { storedVariants = list }
  func dollars(_ text: String) -> JSONValue { .number(Double(centsFromText(text) ?? 0) / 100) }
  func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
  let variants: [JSONValue] = draft.variants.map { edit in
    var fields: [String: JSONValue] = ["id": .string(edit.id)]
    if let match = storedVariants.first(where: { $0["id"]?.stringValue == edit.id }), case .object(let record) = match {
      fields = record
    }
    // JSONValue is ExpressibleByNilLiteral, so `fields[key] = nil` (or a
    // ternary with a nil branch) writes null; an empty field is removed here.
    func put(_ key: String, _ text: String, _ value: (String) -> JSONValue) {
      if trimmed(text).isEmpty { fields.removeValue(forKey: key) } else { fields[key] = value(trimmed(text)) }
    }
    fields["priceUsd"] = dollars(edit.price)
    put("compareAtPriceUsd", edit.compareAt, dollars)
    put("sku", edit.sku) { .string($0) }
    put("barcode", edit.barcode) { .string($0) }
    if draft.create { fields["inventory"] = Int(trimmed(edit.stock)).map { .number(Double($0)) } ?? .null }
    return .object(fields)
  }
  base["name"] = .string(draft.name)
  base["description"] = .string(draft.description)
  base["status"] = .string(draft.status.rawValue)
  base["type"] = .string(draft.type.rawValue)
  base["variants"] = .array(variants)
  if draft.create { base["slug"] = .string(commerceSlug(draft.name)) }
  return .object(base)
}

/// Units from the typed change (`+3`, `-2`, `5`), or nil.
func stockDelta(_ text: String) -> Int? {
  var raw = text.trimmingCharacters(in: .whitespaces)
  if raw.hasPrefix("+") { raw.removeFirst() }
  guard let delta = Int(raw), delta != 0 else { return nil }
  return delta
}

/// The two product routes, as the app calls them.
protocol ProductWriteAPI: Sendable {
  func save(hostID: String, productID: String, create: Bool, product: JSONValue, attemptKey: String) async throws
  func adjustStock(
    hostID: String, productID: String, variantID: String, delta: Int, reason: String, attemptKey: String
  ) async throws
}

struct ConsoleProductWriteAPI: ProductWriteAPI {
  let api: ConsoleAPIClient

  func save(hostID: String, productID: String, create: Bool, product: JSONValue, attemptKey: String) async throws {
    _ = try await api.request(
      productSaveRoute, method: .post,
      body: .object([
        "hostId": .string(hostID), "productId": .string(productID), "create": .bool(create), "product": product,
      ]),
      idempotencyKey: attemptKey)
  }

  func adjustStock(
    hostID: String, productID: String, variantID: String, delta: Int, reason: String, attemptKey: String
  ) async throws {
    _ = try await api.request(
      productStockRoute, method: .post,
      body: .object([
        "hostId": .string(hostID), "productId": .string(productID), "variantId": .string(variantID),
        "delta": .number(Double(delta)), "reason": .string(reason),
      ]),
      idempotencyKey: attemptKey)
  }
}

/// A write's refusal in words a sheet shows: the route's own when it answered
/// definitively, else that it is not known whether it went (retrying is safe:
/// the same product id or attempt key dedupes it).
struct ProductWriteProblem: LocalizedError {
  let errorDescription: String?
}

func productWriteProblem(_ error: Error) -> ProductWriteProblem {
  if let refusal = error as? ConsoleAPIError, refusal.status > 0, refusal.status < 500 {
    return ProductWriteProblem(errorDescription: refusal.message)
  }
  return ProductWriteProblem(
    errorDescription: "It is not known whether that went through. Trying again is safe; it will not happen twice.")
}

/// One stock change being entered.
struct StockDraft: Equatable {
  var productID: String
  var variantID: String
  var change = ""
  var reason = "restock"
}

/// One write's attempt key, kept until the route answers definitively, so a
/// press after a lost answer dedupes instead of writing twice.
@MainActor
final class WriteAttempt {
  private var key = UUID().uuidString

  /// Runs `write` with the key; throws what a sheet shows.
  func run(_ write: (String) async throws -> Void) async throws {
    do {
      try await write(key)
      key = UUID().uuidString
    } catch {
      if let refusal = error as? ConsoleAPIError, refusal.status > 0, refusal.status < 500 { key = UUID().uuidString }
      throw productWriteProblem(error)
    }
  }
}

/// The product editor: New product or Edit, over the stored product.
@MainActor
@Observable
final class ProductEditorModel: Identifiable {
  var draft: ProductDraft
  @ObservationIgnored private let stored: [String: Any]?
  @ObservationIgnored private let attempt = WriteAttempt()

  init(draft: ProductDraft, stored: [String: Any]?) {
    self.draft = draft
    self.stored = stored
  }

  static func creating() -> ProductEditorModel {
    ProductEditorModel(draft: ProductDraft(productID: newProductID(), create: true), stored: nil)
  }

  static func editing(_ doc: FirestoreDocument) -> ProductEditorModel {
    ProductEditorModel(draft: productDraft(doc), stored: doc.data)
  }

  /// Saves the draft; throws what the sheet shows.
  func save(_ api: ProductWriteAPI, hostID: String) async throws {
    if let problem = checkProductDraft(draft) { throw ProductWriteProblem(errorDescription: problem) }
    let draft = draft
    let body = productSaveJSON(draft, stored: stored)
    try await attempt.run {
      try await api.save(hostID: hostID, productID: draft.productID, create: draft.create, product: body, attemptKey: $0)
    }
  }
}

/// Adjust stock on one product.
@MainActor
@Observable
final class StockAdjustModel {
  var draft: StockDraft
  @ObservationIgnored private let attempt = WriteAttempt()

  init(productID: String, variantID: String) {
    draft = StockDraft(productID: productID, variantID: variantID)
  }

  /// Applies the change; throws what the sheet shows.
  func apply(_ api: ProductWriteAPI, hostID: String) async throws {
    guard let delta = stockDelta(draft.change) else {
      throw ProductWriteProblem(errorDescription: "Enter a number of units, like +5 or -2")
    }
    let asked = draft
    try await attempt.run {
      try await api.adjustStock(
        hostID: hostID, productID: asked.productID, variantID: asked.variantID, delta: delta, reason: asked.reason,
        attemptKey: $0)
    }
  }
}
