// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

extension OrderTone {
  var tone: AglynTone {
    switch self {
    case .attention: .warning
    case .done: .success
    case .waiting: .info
    case .closed: .neutral
    }
  }
}

/// The site's orders: status chips, a search, newest first; in a wide
/// window the list sits beside the selected order.
struct OrdersScreen: View {
  let context: NativePluginContext
  var initialStatus: OrderStatus? = nil
  @State private var model = OrdersModel()
  @State private var selection: OrderRow.ID?
  @State private var searchText = ""

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          list(selectable: true).frame(minWidth: 320, idealWidth: 380, maxWidth: 440)
          Divider()
          Group {
            if let selection {
              OrderDetailView(context: context, orderID: selection, titled: false)
                .id(selection)
            } else {
              AglynEmptyState("Pick an order", systemImage: "bag")
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        list(selectable: false)
      }
    }
    .navigationTitle("Orders")
    .searchable(text: $searchText, prompt: "Order, customer or email")
    .onSubmit(of: .search) { model.search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { model.search = "" } }
    .task(id: context.hostID) {
      if let initialStatus, model.status == nil { model.status = initialStatus }
      model.start(context.firestore, hostID: context.hostID)
    }
    .onDisappear { model.stop() }
  }

  private var chips: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        AglynChoiceChip("All", selected: model.status == nil) { model.status = nil }
        ForEach(ContractValues.shared.orderStatusOptions, id: \.value) { option in
          let status = OrderStatus(rawValue: option.value) ?? .unknown
          AglynChoiceChip(option.label, selected: model.status == status) { model.status = status }
        }
      }
      .padding(.horizontal, AglynSpace.two)
      .padding(.vertical, AglynSpace.one)
    }
    .accessibilityIdentifier("orders-status-chips")
  }

  @ViewBuilder
  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      chips
      if let notice = model.notice {
        AglynNotice(notice, tone: .info).padding(.horizontal, AglynSpace.two)
      }
      content(selectable: selectable)
    }
    .background(AglynColor.page)
  }

  @ViewBuilder
  private func content(selectable: Bool) -> some View {
    if !model.ready {
      List { SkeletonRows(count: 6) }.aglynListBackground()
    } else if model.failed {
      AglynEmptyState("Could not load orders", systemImage: "exclamationmark.triangle") {
        Button("Try again") { model.start(context.firestore, hostID: context.hostID) }
      }
    } else if model.rows.isEmpty {
      AglynEmptyState(
        model.status == nil && model.search.isEmpty ? "No orders yet" : "No matching orders", systemImage: "bag",
        message: model.status == nil && model.search.isEmpty
          ? "Orders from your store and register show up here." : "Try another status or search.")
    } else if selectable {
      List(selection: $selection) {
        rows(selectable: true)
      }
      .onChange(of: model.rows, initial: true) { _, rows in
        if selection == nil || !rows.contains(where: { $0.id == selection }) { selection = rows.first?.id }
      }
      .sensoryFeedback(.selection, trigger: selection)
      .aglynListBackground()
      .accessibilityIdentifier("orders-list")
    } else {
      List { rows(selectable: false) }
        .aglynListBackground()
        .accessibilityIdentifier("orders-list")
    }
  }

  @ViewBuilder
  private func rows(selectable: Bool) -> some View {
    ForEach(model.rows) { row in
      Group {
        if selectable {
          OrderListRow(row: row).tag(row.id)
        } else {
          NavigationLink {
            OrderDetailView(context: context, orderID: row.id, titled: true)
          } label: {
            OrderListRow(row: row)
          }
        }
      }
      .aglynListRow()
      .accessibilityIdentifier("order-\(row.id)")
    }
    if model.hasMore {
      Button("Show more orders") { model.loadMore() }
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("orders-more")
    }
  }
}

struct OrderListRow: View {
  let row: OrderRow

  var body: some View {
    AglynRow(
      "\(row.number) · \(row.customer)",
      subtitle: [
        row.itemCount == 1 ? "1 item" : "\(row.itemCount) items",
        orderChannelLabel(row.order.channel?.rawValue),
        row.createdAt.map { relativeTime($0) },
      ].compactMap { $0 }.joined(separator: " · "),
      systemImage: "bag"
    ) {
      VStack(alignment: .trailing, spacing: 4) {
        Text(row.total).font(AglynFont.strongSubheadline).monospacedDigit()
        StatusChip(row.statusLabel, tone: orderStatusTone(row.status).tone)
      }
    }
  }
}

/// The order screen on its own (a link, a notification, a phone's stack).
struct OrderScreen: View {
  let context: NativePluginContext
  let orderID: String

  var body: some View {
    OrderDetailView(context: context, orderID: orderID, titled: true)
  }
}
