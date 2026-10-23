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
    case .neutral: .neutral
    case .info: .info
    case .success: .success
    case .warning: .warning
    case .error: .error
    }
  }
}

/// The site's orders: status chips, a search, newest first; in a wide
/// window the list sits beside the selected order.
struct OrdersScreen: View {
  let context: NativePluginContext
  var initialFilter: OrderFilter = .all
  /// Opened from Create new (`new=1`): its create form comes up on arrival.
  var startNew = false
  @State private var startedNew = false
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
  @State private var addingFilter = false
  /// The shell hands Orders its head's parts: on the Mac and iPad the title and create action head the list column, the
  /// breadcrumbs head the detail (Figma Orders 13:483); on a phone they are the screen's own title row (22:499).
  @Environment(\.aglynAreaHead) private var areaHead
  @Environment(\.aglynWideChrome) private var wideChrome

  var body: some View {
    searchable(
      WideLayoutReader { wide in
        if wide {
          AglynListDetailColumns(listWidth: areaHead == nil ? 380 : 440) {
            headed(list(selectable: true))
          } detail: {
            VStack(spacing: 0) {
              if let areaHead { AglynDetailCrumbs(areaHead) }
              if let selection {
                OrderDetailView(context: context, orderID: selection, titled: false)
                  .id(selection)
              } else {
                AglynSelectionPlaceholder("No order selected", systemImage: "bag")
              }
            }
          }
        } else {
          headed(list(selectable: false))
        }
      }
    )
    .navigationTitle("Orders")
    .aglynScreenTitle("Orders")
    .aglynListColumnHead(areaHead)
    .modifier(BarActions(shown: areaHead == nil, selecting: $selecting, picked: $picked, drafting: $drafting) {
      moreMenu(select: false)
    })
    .onAppear {
      guard startNew, !startedNew else { return }
      startedNew = true
      drafting = true
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
            .buttonStyle(.aglynProminent)
            .disabled(picked.isEmpty || running)
            .accessibilityIdentifier("orders-bulk-fulfill")
          // Whatever services are connected add what they can do to the ticked orders (buy their labels, say).
          if !ScreenCatalog.shared.zone("ordersBulk").isEmpty {
            Button("More…") {
              context.navigate(
                "commerce.ordersBulk",
                ["orderIds": picked.sorted().joined(separator: ","), "run": UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()])
            }
            .buttonStyle(.aglynSecondary)
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
    // The selected order leaves the detail pane once a filter or search leaves it out of the list.
    .onChange(of: model.rows.map(\.id)) { _, ids in
      if let selection, model.ready, !ids.contains(selection) { self.selection = nil }
    }
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

  /// Calm rule 3 (Figma Orders 13:483, Filter on 122:7056): a search and ONE Filter at rest; the chips show only once a
  /// filter is on. With a head in the list column the search heads the list column too; otherwise the scaffold puts it.
  @ViewBuilder
  private func searchable<V: View>(_ view: V) -> some View {
    if areaHead == nil {
      view.aglynSearchable(text: $searchText, prompt: "Order, customer or email", onSubmit: { model.search = searchText }) {
        filterMenu
      }
    } else {
      view
    }
  }

  /// The list column under its head: the title with its star, Draft order and More, then the search and the one Filter
  /// (Mac and iPad: Figma 13:483; a phone: its title row and toolbar, 22:499). Without a head, the list as it is.
  @ViewBuilder
  private func headed<V: View>(_ list: V) -> some View {
    if let areaHead {
      VStack(spacing: 0) {
        AglynListColumnHeader(areaHead, primary: selecting ? nil : draftOrder) {
          if selecting {
            Button("Done") {
              selecting = false
              picked = []
            }
            .accessibilityIdentifier("orders-select")
          } else {
            moreMenu(select: true, iconOnly: true)
          }
        }
        AglynListToolbar(
          text: $searchText, prompt: "Order, customer or email", onSubmit: { model.search = searchText },
          inset: AglynListColumnHeader<EmptyView>.inset
        ) {
          filterMenu
        }
        list
      }
    } else {
      list
    }
  }

  /// The list's one create action: a draft order to send as a payment link (the console's Draft order).
  private var draftOrder: AglynPrimaryAction {
    AglynPrimaryAction(
      id: "orders-draft", title: "Draft order", systemImage: "plus", shortcut: KeyboardShortcut("n", modifiers: .command)
    ) { drafting = true }
  }

  /// Orders' other actions in one More menu: Select (in the list column's head), the shipping export and the tracking
  /// import.
  private func moreMenu(select: Bool, iconOnly: Bool = false) -> some View {
    Menu {
      if select {
        Button {
          selecting = true
          picked = []
        } label: {
          Label("Select orders", systemImage: "checkmark.circle")
        }
        .accessibilityIdentifier("orders-select")
      }
      Section("Export for shipping") {
        ForEach(ContractValues.shared.orderShippingPresetChoices, id: \.id) { preset in
          Button {
            Task { await exportForShipping(preset.id) }
          } label: {
            Text(preset.label)
            if let description = preset.description { Text(description) }
          }
        }
      }
      if canImportProducts(context) {
        Button {
          context.navigate(coreDataImportScreen, trackingImportParams(hostID: context.hostID))
        } label: {
          Label("Import tracking", systemImage: "square.and.arrow.down")
        }
        .accessibilityIdentifier("orders-import-tracking")
      }
    } label: {
      // The list column's ⋯ is the icon alone (Figma 13:483); a label style set outside a Menu does not reach its label
      // on iPad, so it is set on the label itself.
      if iconOnly {
        Label("More", systemImage: "ellipsis").labelStyle(.iconOnly)
      } else {
        Label("More", systemImage: "ellipsis")
      }
    }
    .menuIndicator(.hidden)
    .accessibilityIdentifier("orders-export-shipping")
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

  /// Whether any filter is on: a status, or a clause from Add a filter.
  private var filtering: Bool { model.filter != .all || !model.clauses.isEmpty }

  /// The list's filters for the calm controls: the console's status filters, its sorts and its grid's fields.
  private var filterState: ListFilterState {
    ListFilterState(
      statuses: OrderFilter.allCases.map { FilterChoice($0 == .all ? "" : $0.rawValue, $0.label) },
      status: model.filter == .all ? nil : model.filter.rawValue, sorts: ContractValues.shared.orderListQuery.sorts,
      sort: model.sort, fields: ContractValues.shared.orderListQuery.fields, headers: ContractValues.shared.orderListHeaders,
      choices: orderFilterChoices(), clauses: model.clauses,
      refused: model.plan.map { filterRefusals($0, clauses: model.clauses) } ?? [], notices: model.plan?.notices ?? [])
  }

  private func setStatus(_ value: String?) { model.filter = value.flatMap(OrderFilter.init(rawValue:)) ?? .all }

  /// The list's one Filter control (in the list's toolbar on the Mac and iPad).
  private var filterMenu: some View {
    ListFilterMenu(filterState, shows: areaHead?.sections ?? [], setStatus: setStatus, setSort: { model.sort = $0 }) {
      addingFilter = true
    }
  }

  /// The filters that are on, as chips; nothing at rest when the Filter sits in the list's toolbar.
  private var chips: some View {
    ListActiveFilters(
      filterState, adding: $addingFilter, filterInToolbar: areaHead != nil, setStatus: setStatus, setSort: { model.sort = $0 },
      setClauses: { model.clauses = $0 })
  }

  @ViewBuilder
  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      chips
      // Calm rule 8: no info banner at rest; the query's notice shows while a filter or search is on.
      if let notice = model.notice, filtering || !model.search.isEmpty {
        AglynNotice(notice, tone: .info).aglynContentEdges()
      }
      if let notice {
        AglynNotice(notice, tone: .success) { self.notice = nil }.aglynContentEdges()
      }
      // Charges a shopper's bank is disputing, whatever the list is filtered to (the console's banner).
      if disputes.summary.count > 0 {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          AglynNotice(
            "\(openDisputesTitle(disputes.summary, more: disputes.more)). \(openDisputesDetail(disputes.summary))",
            tone: disputes.summary.overdue ? .error : .warning)
          if model.filter != .disputes {
            Button("Show them") { model.filter = .disputes }.buttonStyle(.aglynSecondary)
          }
        }
        .aglynContentEdges()
        .accessibilityIdentifier("orders-disputes")
      }
      if let done = outcome {
        AglynNotice(describeBulkFulfill(done), tone: done.refused.isEmpty && done.unknown.isEmpty ? .success : .warning) {
          outcome = nil
        }
        .aglynContentEdges()
      }
      content(selectable: selectable)
    }
    .background(AglynColor.page)
  }

  @ViewBuilder
  private func content(selectable: Bool) -> some View {
    if !model.ready {
      List { SkeletonRows(count: 6) }.modifier(OrderListLook(flush: flush))
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
          .buttonStyle(.aglynRow)
          .modifier(OrderRowLook(flush: flush))
          .accessibilityIdentifier("order-select-\(row.id)")
        }
        if model.hasMore {
          Button("Show more orders") { model.loadMore() }.frame(maxWidth: .infinity)
            .modifier(OrderRowLook(flush: flush))
        }
      }
      .modifier(OrderListLook(flush: flush))
      .accessibilityIdentifier("orders-list")
    } else if selectable {
      List {
        rows(selectable: true)
      }
      .onChange(of: model.rows, initial: true) { _, rows in
        if selection == nil || !rows.contains(where: { $0.id == selection }) { selection = rows.first?.id }
      }
      .sensoryFeedback(.selection, trigger: selection)
      .aglynSelectableListStyle().aglynSelectionKeys(model.rows.map(\.id), selection: $selection)
      .accessibilityIdentifier("orders-list")
    } else {
      List { rows(selectable: false) }
        .modifier(OrderListLook(flush: flush))
        .accessibilityIdentifier("orders-list")
    }
  }

  /// A phone list under Orders' own title row draws Figma 22:499's flush rows; otherwise the kit's grouped list.
  private var flush: Bool { areaHead != nil && !wideChrome }

  @ViewBuilder
  private func rows(selectable: Bool) -> some View {
    ForEach(model.rows) { row in
      Group {
        if selectable {
          OrderListRow(row: row).aglynSelectableRow(row.id, selection: $selection)
        } else {
          AglynPushLink(disclosure: !flush) {
            OrderDetailView(context: context, orderID: row.id, titled: true)
          } label: {
            OrderListRow(row: row)
          }
        }
      }
      .modifier(OrderRowLook(flush: flush && !selectable))
      .accessibilityIdentifier("order-\(row.id)")
    }
    if model.hasMore {
      Button("Show more orders") { model.loadMore() }
        .frame(maxWidth: .infinity)
        .modifier(OrderRowLook(flush: flush && !selectable))
        .accessibilityIdentifier("orders-more")
    }
  }
}

/// Orders' navigation-bar actions where it has no head of its own (opened outside its area): Draft order as the
/// primary, Select and More beside it.
private struct BarActions<More: View>: ViewModifier {
  let shown: Bool
  @Binding var selecting: Bool
  @Binding var picked: Set<OrderRow.ID>
  @Binding var drafting: Bool
  @ViewBuilder let more: () -> More

  func body(content: Content) -> some View {
    if shown {
      content
        .aglynPrimaryAction(id: "orders-draft", "Draft order", systemImage: "link.badge.plus") { drafting = true }
        .aglynScreenToolbar(id: "orders") {
          Button(selecting ? "Done" : "Select") {
            selecting.toggle()
            picked = []
          }
          .accessibilityIdentifier("orders-select")
          more()
        }
    } else {
      content
    }
  }
}

/// A row of the orders list: flush on a phone under Orders' own head (Figma 22:499), on the paper surface otherwise.
private struct OrderRowLook: ViewModifier {
  let flush: Bool

  func body(content: Content) -> some View {
    if flush { content.aglynFlushRow() } else { content.aglynListRow() }
  }
}

/// The orders list on a phone: flush under Orders' own head, the kit's grouped list otherwise.
private struct OrderListLook: ViewModifier {
  let flush: Bool

  func body(content: Content) -> some View {
    if flush { content.aglynFlushList() } else { content.aglynListBackground() }
  }
}

struct OrderListRow: View {
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif
  let row: OrderRow

  var body: some View {
    #if os(iOS)
      let phone = sizeClass == .compact
    #else
      let phone = false
    #endif
    // Figma List/Order row 11:358 (64 points; 68 on a phone).
    AglynRecordRow(
      "\(row.number) · \(row.customer)",
      detail: [
        row.itemCount == 1 ? "1 item" : "\(row.itemCount) items",
        orderChannelLabel(row.order.channel?.rawValue),
        row.createdAt.map { relativeTime($0) },
      ].compactMap { $0 }.joined(separator: " · "),
      systemImage: "bag"
    ) {
      AglynRecordRow<EmptyView>.total(row.total, phone: phone)
      StatusChip(row.statusLabel, tone: orderStatusTone(row.status).tone)
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

/// Home's "Needs you" lines for a store (`commerce.needs-you`): paid orders still to get ready, and disputes waiting on
/// an answer, each opening Orders on its chip. Nothing is drawn for nothing.
struct OrdersNeedsYouWidget: View {
  let context: NativePluginContext
  @State private var toFulfill = OrdersModel()
  @State private var disputes = OrdersModel()

  var body: some View {
    VStack(spacing: 0) {
      if toFulfill.ready && !toFulfill.rows.isEmpty {
        let count = toFulfill.rows.count
        AglynNeedsYouLine(
          id: "orders-to-fulfill", systemImage: "bag",
          text: "\(toFulfill.hasMore ? "\(count)+" : "\(count)") \(count == 1 ? "order" : "orders") to get ready", place: "Orders"
        ) {
          context.navigate(commerceOrdersScreen, ["filter": OrderFilter.unfulfilled.rawValue])
        }
      }
      if disputes.ready && !disputes.rows.isEmpty {
        let count = disputes.rows.count
        AglynNeedsYouLine(
          id: "orders-disputed", systemImage: "exclamationmark.bubble",
          text: "\(count) \(count == 1 ? "dispute needs" : "disputes need") an answer", place: "Orders", tone: .error
        ) {
          context.navigate(commerceOrdersScreen, ["filter": OrderFilter.disputes.rawValue])
        }
      }
    }
    .task(id: context.hostID) {
      toFulfill.filter = .unfulfilled
      toFulfill.start(context.firestore, hostID: context.hostID)
      disputes.filter = .disputes
      disputes.start(context.firestore, hostID: context.hostID)
    }
    .onDisappear {
      toFulfill.stop()
      disputes.stop()
    }
  }
}
