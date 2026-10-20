// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Observation
import SwiftUI

/*
 * THE STORE AT A GLANCE (the console's Commerce card on the dashboard): how many products are at or under their low-stock
 * alert, and the five latest orders. Like every sales figure it waits for a plan that sells commerce analytics, and like the
 * console's card it says nothing for a site with no products and no orders.
 */

/// The most products the low-stock count reads; past it the count is a floor.
let glanceProductCeiling = 250

/// The latest orders the card lists.
let glanceLatestOrders = 5

/// Products at or under their alert among the first `glanceProductCeiling` stored (a deleted one is not a product).
func glanceLowStock(_ docs: [FirestoreDocument]) -> Int {
  docs.prefix(glanceProductCeiling).filter { doc in
    guard doc.data["deletedAt"] == nil, let product = try? decodeJSONFields(HostProduct.self, doc.jsonFields) else { return false }
    return isLowStock(liftLegacyProduct(product))
  }.count
}

@MainActor
@Observable
final class GlanceModel {
  private(set) var access: SalesAccess?
  private(set) var lowStock: Int?
  private(set) var capped = false
  private(set) var latest: [OrderRow] = []
  private(set) var failed = false
  private(set) var hasProducts = false
  @ObservationIgnored private var listeners: [FirestoreListening] = []

  func start(_ reader: FirestoreReader, hostID: String?, orgID: String?) {
    stop()
    access = nil
    lowStock = nil
    latest = []
    failed = false
    guard let hostID, let orgID else { return }
    let plan = reader.listenDocument(["orgs", orgID]) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let doc):
        let next = salesAccess(doc?.data)
        self.access = next
        if next.carried, self.listeners.count == 1 { self.listen(reader, hostID: hostID) }
      case .failure:
        self.failed = true
      }
    }
    listeners = [plan]
  }

  private func listen(_ reader: FirestoreReader, hostID: String) {
    listeners.append(
      reader.listen(FirestoreQuery(productsPath(hostID), limit: glanceProductCeiling + 1)) { [weak self] result in
        guard let self else { return }
        if case .success(let docs) = result {
          self.lowStock = glanceLowStock(docs)
          self.capped = docs.count > glanceProductCeiling
          self.hasProducts = !docs.isEmpty
        } else {
          self.failed = true
        }
      })
    listeners.append(
      reader.listen(FirestoreQuery(ordersPath(hostID), order: [.init("createdAtMs", descending: true)], limit: glanceLatestOrders)) {
        [weak self] result in
        guard let self else { return }
        if case .success(let docs) = result {
          self.latest = docs.map { OrderRow(id: $0.id, order: decodeOrder($0)) }
        } else {
          self.failed = true
        }
      })
  }

  func stop() {
    listeners.forEach { $0.remove() }
    listeners = []
  }
}

/// Home's "At a glance" card.
struct GlanceWidget: View {
  let context: NativePluginContext
  @State private var model = GlanceModel()

  var body: some View {
    // A stack, not a Group: until the plan is read nothing is drawn, and the task still needs a view to start it on.
    VStack(spacing: 0) {
      if let access = model.access, !access.carried {
        AglynCard("At a glance", systemImage: "square.grid.2x2") {
          Text("Included from \(access.plan ?? "a higher plan").").foregroundStyle(.secondary)
        }
      } else if model.access?.carried == true, model.hasProducts || !model.latest.isEmpty {
        AglynCard("At a glance", systemImage: "square.grid.2x2") {
          VStack(alignment: .leading, spacing: AglynSpace.one) {
            if let low = model.lowStock, low > 0 {
              Button {
                context.navigate(commerceProductsScreen)
              } label: {
                LabeledContent("Low stock", value: model.capped ? "\(low)+" : "\(low)")
              }
              .buttonStyle(.plain)
              .accessibilityIdentifier("glance-low-stock")
            }
            ForEach(model.latest) { row in
              Button {
                context.navigate(commerceOrderScreen, ["orderId": row.id])
              } label: {
                HStack {
                  Text("\(row.number) \u{00B7} \(row.customer)").lineLimit(1)
                  Spacer()
                  Text(row.total).monospacedDigit()
                  StatusChip(row.statusLabel, tone: orderStatusTone(row.status).tone)
                }
              }
              .buttonStyle(.plain)
            }
          }
        }
      }
    }
    .task(id: context.hostID) { model.start(context.firestore, hostID: context.hostID, orgID: context.orgID) }
    .onDisappear { model.stop() }
  }
}
