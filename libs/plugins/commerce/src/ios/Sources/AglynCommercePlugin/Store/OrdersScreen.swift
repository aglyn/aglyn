// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynScreens
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
  var initialFilter: OrderFilter = .all
  @State private var model = OrdersModel()
  @State private var selection: OrderRow.ID?
  @State private var searchText = ""
  // Select mode: tick orders, then mark them all fulfilled in one go (the console's bulk action on the orders list).
  @State private var selecting = false
  @State private var picked: Set<OrderRow.ID> = []
  @State private var confirmingBulk = false
  @State private var running = false
  @State private var outcome: BulkFulfillResult?
  @State private var disputes = OpenDisputesModel()
  @State private var drafting = false
  @State private var exporting: TransferExportRequest?
  @State private var notice: String?

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
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button(selecting ? "Done" : "Select") {
          selecting.toggle()
          picked = []
        }
        .accessibilityIdentifier("orders-select")
      }
      ToolbarItem(placement: .primaryAction) {
        // Selling to someone directly: their order as a payment link (the console's Draft order).
        Button {
          drafting = true
        } label: {
          Label("Draft order", systemImage: "link.badge.plus")
        }
        .accessibilityIdentifier("orders-draft")
      }
      ToolbarItem(placement: .secondaryAction) {
        Menu {
          ForEach(ContractValues.shared.orderShippingPresetChoices, id: \.id) { preset in
            Button {
              Task { await exportForShipping(preset.id) }
            } label: {
              Text(preset.label)
              if let description = preset.description { Text(description) }
            }
          }
        } label: {
          Label("Export for shipping", systemImage: "shippingbox.and.arrow.backward")
        }
        .accessibilityIdentifier("orders-export-shipping")
      }
      if canImportProducts(context) {
        ToolbarItem(placement: .secondaryAction) {
          Button {
            context.navigate(coreDataImportScreen, trackingImportParams(hostID: context.hostID))
          } label: {
            Label("Import tracking", systemImage: "square.and.arrow.down")
          }
          .accessibilityIdentifier("orders-import-tracking")
        }
      }
    }
    .sheet(isPresented: $drafting) {
      DraftOrderSheet(context: context) { notice = $0 }
    }
    .sheet(item: $exporting) { request in
      TransferExportSheet(context: context, request: request) { said in
        exporting = nil
        if let said { notice = said }
      }
    }
    .safeAreaInset(edge: .bottom) {
      if selecting {
        HStack {
          Button("Mark \(picked.count) fulfilled") { confirmingBulk = true }
            .buttonStyle(.borderedProminent)
            .disabled(picked.isEmpty || running)
            .accessibilityIdentifier("orders-bulk-fulfill")
          // Whatever services are connected add what they can do to the ticked orders (buy their labels, say).
          if !ScreenCatalog.shared.zone("ordersBulk").isEmpty {
            Button("More…") {
              context.navigate(
                "commerce.ordersBulk",
                ["orderIds": picked.sorted().joined(separator: ","), "run": UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()])
            }
            .buttonStyle(.bordered)
            .disabled(picked.isEmpty || picked.count > 50)
            .accessibilityIdentifier("orders-bulk-more")
          }
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(.bar)
      }
    }
    .confirmationDialog(
      "Mark \(picked.count) \(picked.count == 1 ? "order" : "orders") fulfilled?", isPresented: $confirmingBulk, titleVisibility: .visible
    ) {
      Button("Mark fulfilled") { Task { await fulfillPicked() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Each order is checked on its own: one that cannot be fulfilled is skipped and the rest go ahead. Customers are emailed as they are for a single order.")
    }
    .searchable(text: $searchText, prompt: "Order, customer or email")
    .onSubmit(of: .search) { model.search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { model.search = "" } }
    .task(id: context.hostID) {
      if model.filter == .all { model.filter = initialFilter }
      model.start(context.firestore, hostID: context.hostID)
      disputes.start(context.firestore, hostID: context.hostID)
    }
    .onDisappear {
      model.stop()
      disputes.stop()
    }
  }

  private func exportForShipping(_ presetID: String) async {
    guard let hostID = context.hostID else { return }
    await prepareOrdersForShipping(api: context.api, hostID: hostID)
    exporting = shippingExportRequest(hostID: hostID, presetID: presetID)
  }

  private func fulfillPicked() async {
    guard let hostID = context.hostID else { return }
    running = true
    outcome = await bulkFulfillOrders(
      api: context.api, hostID: hostID, orders: model.rows.filter { picked.contains($0.id) },
      batchKey: "bulk-fulfill-\(UUID().uuidString.lowercased())")
    running = false
    picked = []
    selecting = false
    model.start(context.firestore, hostID: hostID)
  }

  private var chips: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        ForEach(OrderFilter.allCases) { filter in
          AglynChoiceChip(filter.label, selected: model.filter == filter) { model.filter = filter }
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
      if let notice {
        AglynNotice(notice, tone: .success) { self.notice = nil }.padding(.horizontal, AglynSpace.two)
      }
      // Charges a shopper's bank is disputing, whatever the list is filtered to (the console's banner).
      if disputes.summary.count > 0 {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          AglynNotice(
            "\(openDisputesTitle(disputes.summary, more: disputes.more)). \(openDisputesDetail(disputes.summary))",
            tone: disputes.summary.overdue ? .error : .warning)
          if model.filter != .disputes {
            Button("Show them") { model.filter = .disputes }.buttonStyle(.bordered)
          }
        }
        .padding(.horizontal, AglynSpace.two)
        .accessibilityIdentifier("orders-disputes")
      }
      if let done = outcome {
        AglynNotice(describeBulkFulfill(done), tone: done.refused.isEmpty && done.unknown.isEmpty ? .success : .warning) {
          outcome = nil
        }
        .padding(.horizontal, AglynSpace.two)
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
        model.filter == .all && model.search.isEmpty ? "No orders yet" : "No matching orders", systemImage: "bag",
        message: model.filter == .all && model.search.isEmpty
          ? "Orders from your store and register show up here." : "Try another filter or search.")
    } else if selecting {
      List {
        ForEach(model.rows) { row in
          Button {
            if picked.contains(row.id) { picked.remove(row.id) } else { picked.insert(row.id) }
          } label: {
            HStack {
              Image(systemName: picked.contains(row.id) ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(picked.contains(row.id) ? AglynColor.primary : .secondary)
              OrderListRow(row: row)
            }
          }
          .buttonStyle(.plain)
          .aglynListRow()
          .accessibilityIdentifier("order-select-\(row.id)")
        }
        if model.hasMore {
          Button("Show more orders") { model.loadMore() }.frame(maxWidth: .infinity)
        }
      }
      .aglynListBackground()
      .accessibilityIdentifier("orders-list")
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

/// Home's "To ship" card: paid orders not yet fully shipped.
struct OrdersToShipWidget: View {
  let context: NativePluginContext
  @State private var model = OrdersModel()

  var body: some View {
    let count = model.ready && !model.failed ? model.rows.count : nil
    MetricCard(
      "To ship", systemImage: "shippingbox",
      value: count.map { model.hasMore ? "\($0)+" : "\($0)" },
      caption: count == 1 ? "order is waiting to ship" : "orders are waiting to ship",
      actionLabel: "Open orders", failed: model.failed ? "Could not load orders." : nil
    ) {
      context.navigate(commerceOrdersScreen, ["filter": OrderFilter.unfulfilled.rawValue])
    }
    .task(id: context.hostID) {
      model.filter = .unfulfilled
      model.start(context.firestore, hostID: context.hostID)
    }
    .onDisappear { model.stop() }
  }
}
