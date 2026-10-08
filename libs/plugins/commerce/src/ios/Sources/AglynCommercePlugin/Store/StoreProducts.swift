// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * THE SITE'S PRODUCTS, AS THE CONSOLE'S PRODUCTS HUB READS THEM.
 *
 * PRODUCT_LIST_QUERY over live products (PRODUCT_LIST_BASE), a status chip
 * as its `status` clause and a typed word as the name search, in name order.
 * A scan is a whole-code lookup over the flattened `barcodes`/`skus`, the
 * same lookup the register makes, at any status.
 */

let productsPageSize = 50

struct ProductRow: Identifiable, Hashable {
  let id: String
  let item: PosItem
  let status: String
  let type: String?
  let description: String?

  init(_ doc: FirestoreDocument) {
    id = doc.id
    item = posItem(doc)
    status = doc.string("status") ?? "draft"
    type = doc.string("type")
    let text = doc.string("description")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    description = text.isEmpty ? nil : text
  }

  var name: String { item.name }
  var statusLabel: String {
    ContractValues.shared.productListOptions["status"]?.first { $0.value == status }?.label ?? status.capitalized
  }
  var typeLabel: String? {
    guard let type else { return nil }
    return ContractValues.shared.productListOptions["type"]?.first { $0.value == type }?.label ?? type.capitalized
  }
  var price: String {
    guard let from = item.fromCents else { return "No price" }
    let low = formatOrderMoney(from)
    guard let to = item.toCents, to != from else { return low }
    return "\(low) – \(formatOrderMoney(to))"
  }
  /// Units on hand across variants that count stock; nil when none does.
  var stock: Int? {
    let counted = item.variants.compactMap(\.inventory)
    return counted.isEmpty ? nil : counted.reduce(0, +)
  }
}


func productsPlan(status: String?, search: String) -> ListQueryPlan {
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return planListQuery(
    ContractValues.shared.productListQuery,
    ListQueryRequest(
      base: ContractValues.shared.productListBase,
      clauses: status.map { [ListFilterRequest(field: "status", op: "equals", value: $0)] } ?? [],
      search: words.isEmpty ? nil : [words]))
}

/// A scanned or typed code as a lookup over one code field, any status.
func productCodeQuery(_ hostID: String, field: String, code: String) -> FirestoreQuery {
  planListQuery(
    ContractValues.shared.productListQuery,
    ListQueryRequest(
      base: ContractValues.shared.productListBase,
      clauses: [ListFilterRequest(field: field, op: "contains", value: code)])
  ).firestoreQuery(productsPath(hostID), limit: 1)
}

@MainActor
@Observable
final class ProductsModel {
  private(set) var rows: [ProductRow] = []
  private(set) var ready = false
  private(set) var failed = false
  private(set) var hasMore = false
  var status: String? { didSet { if oldValue != status { restart() } } }
  var search = "" { didSet { if oldValue != search { restart() } } }

  @ObservationIgnored private var reader: FirestoreReader?
  @ObservationIgnored private var hostID: String?
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var limit = productsPageSize

  func start(_ reader: FirestoreReader, hostID: String?) {
    self.reader = reader
    self.hostID = hostID
    restart()
  }

  func loadMore() {
    guard hasMore else { return }
    limit += productsPageSize
    listen()
  }

  func stop() {
    listener?.remove()
    listener = nil
  }

  private func restart() {
    limit = productsPageSize
    rows = []
    ready = false
    listen()
  }

  private func listen() {
    listener?.remove()
    failed = false
    guard let reader, let hostID else { return }
    let window = limit
    let query = productsPlan(status: status, search: search).firestoreQuery(productsPath(hostID), limit: window + 1)
    listener = reader.listen(query) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.hasMore = docs.count > window
        self.rows = docs.prefix(window).map(ProductRow.init)
      case .failure:
        self.failed = true
      }
      self.ready = true
    }
  }
}

@MainActor
@Observable
final class ProductModel {
  private(set) var row: ProductRow?
  private(set) var ready = false
  private(set) var failed = false
  @ObservationIgnored private var listener: FirestoreListening?

  func start(_ reader: FirestoreReader, hostID: String?, productID: String) {
    listener?.remove()
    ready = false
    guard let hostID, !productID.isEmpty else {
      ready = true
      return
    }
    listener = reader.listenDocument(productsPath(hostID) + [productID]) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let doc): self.row = doc.map(ProductRow.init)
      case .failure: self.failed = true
      }
      self.ready = true
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }
}
