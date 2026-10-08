// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * WHAT THE TILL SELLS.
 *
 * The item grid reads the catalog the console's register reads: live, ACTIVE
 * products in name order (the products hub's PRODUCT_LIST_QUERY), with a
 * typed word as the name search and a scan as a whole-code lookup over the
 * flattened `barcodes`/`skus` arrays. A category tile is one more predicate
 * on that query (`categoryIds` contains); quick keys are the products the
 * merchant marked `posQuickKey`. Firestore takes one array clause per query,
 * so the grid offers a search, a category or the quick keys, never two.
 *
 * Reads go through the member's own Firestore access under the console's
 * rules; prices here are a preview the server re-prices when the sale opens.
 */

/// How many tiles one read fills.
let posGridPageSize = 60
/// Categories are a short taxonomy; the grid reads them whole.
let posCategoryCeiling = 200

struct PosVariant: Hashable, Identifiable {
  let id: String
  /// "Large / Blue"; nil for a product's default variant.
  let label: String?
  /// Nil while the variant has no price: the till refuses to ring it up.
  let unitCents: Int?
  let sku: String?
  let barcode: String?
  /// Tracked units, or nil when not tracked.
  let inventory: Int?

  /// Sold out by the tracked count: the till warns, the server decides.
  var soldOut: Bool { inventory.map { $0 <= 0 } ?? false }
}

struct PosItem: Hashable, Identifiable {
  let id: String
  let name: String
  let imageURL: String?
  let variants: [PosVariant]
  let categoryIDs: [String]
  let modifierGroups: [ProductModifierGroup]
  let quickKey: Bool
  /// Lowest and highest priced variant, for the tile.
  let fromCents: Int?
  let toCents: Int?

  /// A product with options or modifiers opens the item sheet; anything else goes straight in.
  var needsSheet: Bool { variants.count > 1 || !modifierGroups.isEmpty }
}

private func text(_ value: Any?) -> String? {
  guard let raw = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
  return raw
}

private func number(_ value: Any?) -> Double? {
  guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
  let double = number.doubleValue
  return double.isFinite ? double : nil
}

func variantLabel(_ options: [String: Any]?) -> String? {
  guard let options else { return nil }
  // Firestore hands a map's keys back sorted, so the label is read in key
  // order; a Swift dictionary has no order of its own.
  let label = options.keys.sorted().compactMap { text(options[$0]) }.joined(separator: " / ")
  return label.isEmpty ? nil : label
}

func posVariant(_ raw: [String: Any]) -> PosVariant {
  let price = number(raw["priceUsd"]).flatMap { $0 >= 0 ? $0 : nil }
  return PosVariant(
    id: text(raw["id"]) ?? "default",
    label: variantLabel(raw["options"] as? [String: Any]),
    unitCents: price.map { jsRound($0 * 100) },
    sku: text(raw["sku"]),
    barcode: text(raw["barcode"]),
    inventory: number(raw["inventory"]).map { Int($0) })
}

/// A product's modifier groups as stored, or none when they are malformed.
func modifierGroups(_ raw: Any?) -> [ProductModifierGroup] {
  guard let list = raw as? [Any] else { return [] }
  var groups: [ProductModifierGroup] = []
  for entry in list {
    guard let group = entry as? [String: Any], let min = number(group["min"]), let max = number(group["max"]) else {
      return []
    }
    var options: [ProductModifierOption] = []
    for item in group["options"] as? [Any] ?? [] {
      guard let option = item as? [String: Any], let price = number(option["priceCents"]) else { return [] }
      options.append(
        ProductModifierOption(id: option["id"] as? String ?? "", name: option["name"] as? String ?? "", priceCents: price))
    }
    groups.append(
      ProductModifierGroup(
        id: group["id"] as? String ?? "", max: max, min: min, name: group["name"] as? String ?? "", options: options))
  }
  return usableModifierGroups(groups)
}

/// A product document as the till sells it; a legacy product without variants has one `default`.
func posItem(_ doc: FirestoreDocument) -> PosItem {
  let data = doc.data
  let stored = (data["variants"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
  let variants =
    stored.isEmpty
    ? [
      PosVariant(
        id: "default", label: nil, unitCents: jsRound((number(data["priceUsd"]) ?? 0) * 100), sku: nil, barcode: nil,
        inventory: number(data["inventory"]).map { Int($0) })
    ]
    : stored.map(posVariant)
  let prices = variants.compactMap(\.unitCents)
  return PosItem(
    id: doc.id,
    name: text(data["name"]) ?? "Product",
    imageURL: text((data["mediaUrls"] as? [Any])?.first) ?? text(data["imageUrl"]),
    variants: variants,
    categoryIDs: (data["categoryIds"] as? [Any] ?? []).compactMap { $0 as? String },
    modifierGroups: modifierGroups(data["modifierGroups"]),
    quickKey: (data["posQuickKey"] as? Bool) == true,
    fromCents: prices.min(),
    toCents: prices.max())
}

enum PickResult: Equatable {
  case ok(CartPick)
  case problem(String)
}

/// What one variant with its modifier choices puts in the basket, or why it cannot be sold.
func pick(_ item: PosItem, _ variant: PosVariant, modifiers: [ModifierSelection] = []) -> PickResult {
  guard let unit = variant.unitCents else { return .problem("Set a price for \(item.name) before selling it.") }
  switch resolveLineModifiers(item.name, item.modifierGroups, modifiers) {
  case .refused(let error): return .problem(error)
  case .ok(let resolved, let extra):
    let label = lineLabelWithModifiers(variant.label, resolved.map(\.name))
    return .ok(
      CartPick(
        productID: item.id,
        // A product without options has one `default` variant, which the
        // server rings up when no `variantId` is sent.
        variantID: variant.id == "default" ? nil : variant.id,
        name: item.name,
        variantLabel: label.isEmpty ? nil : label,
        modifiers: resolved.map { ModifierSelection(groupId: $0.groupID, optionId: $0.optionID) },
        unitCents: unit + extra))
  }
}

/// A scanned code as the catalog stores it: separators and spaces gone, lower case (`scannedProductCode`).
func scannedProductCode(_ raw: String?) -> String? {
  let code = (raw ?? "").replacingOccurrences(of: "\u{1d}", with: "")
    .replacingOccurrences(of: "\\s+", with: "", options: .regularExpression).lowercased()
  return code.isEmpty || code.count > 64 ? nil : code
}

struct PosGridArgs: Hashable {
  /// Typed words: the name search.
  var search = ""
  /// A category tile: every product filed under it.
  var categoryID: String?
  /// The merchant's quick keys only.
  var quickKeys = false
}

func productsPath(_ hostID: String) -> [String] { ["hosts", hostID, "products"] }

/// The products hub's request for live, ACTIVE products (`productsListRequest({ filter: 'active' })`).
private func activeProductsRequest(
  search: String = "", extra: [ListQueryFilter] = [], clauses: [ListFilterRequest] = []
) -> ListQueryRequest {
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return ListQueryRequest(
    base: ContractValues.shared.productListBase + [ListQueryFilter(op: .equal, path: "status", value: .string("active"))]
      + extra,
    clauses: clauses,
    search: words.isEmpty ? nil : [words])
}

/// The grid's plan: the products hub's declaration (PRODUCT_LIST_QUERY),
/// narrowed to what the till may sell. A typed word searches the whole
/// catalog, past any category or the quick keys: a cashier who types is
/// looking for something else.
func posGridPlan(_ args: PosGridArgs) -> ListQueryPlan {
  let search = args.search.trimmingCharacters(in: .whitespacesAndNewlines)
  var narrowed: [ListQueryFilter] = []
  if search.isEmpty {
    if args.quickKeys {
      narrowed = [ListQueryFilter(op: .equal, path: "posQuickKey", value: .bool(true))]
    } else if let category = args.categoryID {
      narrowed = [ListQueryFilter(op: .arrayContains, path: "categoryIds", value: .string(category))]
    }
  }
  return planListQuery(ContractValues.shared.productListQuery, activeProductsRequest(search: search, extra: narrowed))
}

func posGridQuery(_ hostID: String, _ args: PosGridArgs, pageSize: Int = posGridPageSize) -> FirestoreQuery {
  posGridPlan(args).firestoreQuery(productsPath(hostID), limit: pageSize)
}

/// A scan looked up by one code field (`barcodes`, then `skus`), as a whole-code match.
func posCodeQuery(_ hostID: String, field: String, code: String) -> FirestoreQuery {
  planListQuery(
    ContractValues.shared.productListQuery,
    activeProductsRequest(clauses: [ListFilterRequest(field: field, op: "contains", value: code)])
  ).firestoreQuery(productsPath(hostID), limit: 1)
}

/// The variant a scanned code names: its barcode first, then its SKU.
func variantForCode(_ item: PosItem, _ code: String) -> PosVariant? {
  let needle = code.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  return item.variants.first { $0.barcode?.lowercased() == needle }
    ?? item.variants.first { $0.sku?.lowercased() == needle }
}

struct PosCategory: Hashable, Identifiable {
  let id: String
  let name: String
  let parentID: String?
  let order: Double
}

func posCategory(_ doc: FirestoreDocument) -> PosCategory {
  PosCategory(
    id: doc.id, name: text(doc.data["name"]) ?? "Category", parentID: text(doc.data["parentId"]),
    order: number(doc.data["order"]) ?? .greatestFiniteMagnitude)
}

/// The merchant's order, then the name: how the console's category tree lists them.
func sortCategories(_ categories: [PosCategory]) -> [PosCategory] {
  categories.sorted {
    if $0.order != $1.order { return $0.order < $1.order }
    let (a, b) = ($0.name.lowercased(), $1.name.lowercased())
    return a != b ? a < b : $0.id < $1.id
  }
}

/// The tiles for one level: top-level categories (orphans included), or one category's children.
func categoryLevel(_ categories: [PosCategory], parentID: String?) -> [PosCategory] {
  let ids = Set(categories.map(\.id))
  return sortCategories(
    categories.filter { category in
      guard let parentID else { return category.parentID.map { !ids.contains($0) } ?? true }
      return category.parentID == parentID
    })
}

func categoriesQuery(_ hostID: String) -> FirestoreQuery {
  FirestoreQuery(["hosts", hostID, "productCategories"], limit: posCategoryCeiling)
}
