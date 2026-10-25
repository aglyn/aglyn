// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

#if canImport(UIKit)
  import UIKit
#elseif canImport(AppKit)
  import AppKit
#endif

/// One order: its lines and totals, the customer and where it ships, the
/// payments and its history, and the next steps the transition rules allow.
struct OrderDetailView: View {
  let context: NativePluginContext
  let orderID: String
  /// False beside the list, where the screen's own title stays.
  var titled = true
  @State private var model = OrderModel()
  @State private var busy: OrderAction?
  @State private var confirming: OrderAction?
  @State private var problem: String?
  @State private var done: String?
  @State private var refundingSheet = false
  @State private var refundKey: String?
  @State private var receiptSheet = false
  @State private var printing: String?
  @State private var fulfilling = false
  @State private var editingShipment: OrderFulfillment?
  @State private var cancelingShipment: OrderFulfillment?
  @State private var refundingLine: Int?
  @State private var lineRefundKey: String?
  @State private var working = false
  @State private var noting = false
  @Environment(\.openURL) private var openURL
  @Environment(\.aglynWideChrome) private var wide

  var body: some View {
    Group {
      if !model.ready {
        List { SkeletonRows(count: 5) }.aglynListBackground()
      } else if model.failed {
        AglynEmptyState("Could not load this order", systemImage: "exclamationmark.triangle")
      } else if let row = model.row {
        form(row)
      } else {
        AglynEmptyState("This order is not here", systemImage: "bag", message: "It may belong to another site.")
      }
    }
    .navigationTitle(titled ? (model.row?.number ?? "Order") : "Orders")
    .aglynScreenTitle(titled ? (model.row?.number ?? "Order") : "Orders")
    #if os(iOS)
      // The record's head below already shows the number large.
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .task(id: "\(context.hostID ?? ""):\(orderID)") {
      model.start(context.firestore, hostID: context.hostID, orderID: orderID)
    }
    .onDisappear { model.stop() }
  }

  private func form(_ row: OrderRow) -> some View {
    let order = row.order
    // The Mac and iPad detail column is Figma's plain one (Orders 13:483); a phone keeps its grouped form.
    return AglynRecordForm {
      Section {
        // The record's head (the calmer screens): the next step for its state as the one filled button, every other
        // act in the ⋯ menu.
        // Beside the list the head's line names the customer first, as Figma's customer line does.
        AglynRecordHeader(
          row.number,
          subtitle: [
            wide ? row.customer : nil, orderChannelLabel(order.channel?.rawValue),
            row.createdAt.map { $0.formatted(date: .abbreviated, time: .shortened) },
          ]
          .compactMap { $0 }.joined(separator: " · "),
          systemImage: "bag", status: (row.statusLabel, orderStatusTone(row.status).tone),
          primary: primaryAction(row), more: moreActions(row))
        if let dispute = describeOrderDispute(order) {
          AglynNotice("\(dispute.label). \(dispute.detail)", tone: dispute.tone == "open" || dispute.tone == "lost" ? .error : .info)
            .accessibilityIdentifier("order-dispute")
        }
        if let risk = describePaymentRisk(order.paymentRisk) {
          AglynNotice("\(risk.label). \(risk.detail)", tone: .warning).accessibilityIdentifier("order-payment-risk")
        }
        if canTransitionOrder(from: row.status, to: .refunded), orderDisputeBlocksRefund(order) {
          AglynNotice(ContractValues.shared.refundBlockedByDispute, tone: .info)
        }
        if let problem { AglynNotice(problem, tone: .error) { self.problem = nil } }
        if let done { AglynNotice(done, tone: .success) { self.done = nil } }
      }

      Section {
        let lines = order.lineItems ?? []
        let states = orderLineFulfillmentStates(order)
        let canRefundLines = canTransitionOrder(from: row.status, to: .refunded) && !orderDisputeBlocksRefund(order)
        if wide { AglynRecordSectionTitle("Items") }
        if lines.isEmpty {
          Text("No items").foregroundStyle(.secondary)
        }
        ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
          let quantity = max(0, Int(line.quantity))
          // What this line is still entitled to (AGL-2454): a line refunded by itself is struck through.
          let withdrawn = orderLineRefunded(order, index)
          let fulfilled = states.indices.contains(index) ? states[index].fulfilledQuantity : 0
          if wide {
            // Figma 13:483's plain line: what was bought and how many, then its amount; the line's own refund is in
            // its context menu, the order's in the head's ⋯.
            VStack(alignment: .leading, spacing: 4) {
              HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(
                  [line.name, line.variantLabel].compactMap { $0 }.joined(separator: ", ")
                    + (quantity == 1 ? "" : " × \(quantity)")
                )
                .font(.system(size: 14)).foregroundStyle(AglynColor.textPrimary)
                Spacer(minLength: 12)
                Text(formatOrderMoney(Int(line.unitAmountCents) * quantity)).font(.system(size: 14)).monospacedDigit()
                  .strikethrough(withdrawn)
                  .foregroundStyle(withdrawn ? AglynColor.secondaryText : AglynColor.textPrimary)
              }
              if fulfilled > 0 || withdrawn {
                HStack {
                  if fulfilled > 0 { StatusChip("\(fulfilled) of \(quantity) fulfilled") }
                  if withdrawn { StatusChip("Refunded", tone: .warning) }
                }
              }
            }
            .padding(.vertical, 10)
            .contextMenu {
              if !withdrawn && canRefundLines {
                Button("Refund line", role: .destructive) { refundingLine = index }
                  .disabled(busy != nil || working)
              }
            }
            .accessibilityIdentifier("order-line-\(index)")
          } else {
            VStack(alignment: .leading, spacing: AglynSpace.one) {
              AglynRow(
                line.name, subtitle: [line.variantLabel, quantity == 1 ? nil : "\(quantity) × \(formatOrderMoney(Int(line.unitAmountCents)))"]
                  .compactMap { $0 }.joined(separator: " · "),
                systemImage: "shippingbox"
              ) {
                Text(formatOrderMoney(Int(line.unitAmountCents) * quantity)).monospacedDigit()
                  .strikethrough(withdrawn)
                  .foregroundStyle(withdrawn ? .secondary : .primary)
              }
              HStack {
                if fulfilled > 0 { StatusChip("\(fulfilled) of \(quantity) fulfilled") }
                if withdrawn {
                  StatusChip("Refunded", tone: .warning)
                } else if canRefundLines {
                  Button("Refund line", role: .destructive) { refundingLine = index }
                    .buttonStyle(.borderless)
                    .disabled(busy != nil || working)
                    .accessibilityIdentifier("order-refund-line-\(index)")
                }
              }
            }
          }
        }
        if orderRefundState(order) != .none {
          // The refund's state in words, as the console says it under the lines (AGL-2454).
          Text(orderRefundSummary(order)).font(AglynFont.caption).foregroundStyle(AglynColor.error)
            .accessibilityIdentifier("order-refund-state")
        }
      } header: {
        if !wide { Text("Items") }
      }

      Section {
        let totals = order.totals
        if let items = totals?.itemsCents { AglynAmountRow("Items", amount: formatOrderMoney(Int(items))) }
        if let discount = totals?.discountCents, discount != 0 {
          AglynAmountRow("Discount", amount: "−" + formatOrderMoney(abs(Int(discount))))
        }
        if let shipping = totals?.shippingCents, shipping != 0 {
          AglynAmountRow("Shipping", amount: formatOrderMoney(Int(shipping)))
        }
        if let tax = totals?.taxCents, tax != 0 { AglynAmountRow("Tax", amount: formatOrderMoney(Int(tax))) }
        // Optional lines the buyer took at checkout (AGL-3635), by name.
        ForEach(order.extras ?? [], id: \.id) { extra in
          AglynAmountRow(extra.label, amount: formatOrderMoney(Int(extra.amountCents)))
        }
        if let tip = totals?.tipCents, tip != 0 { AglynAmountRow("Tip", amount: formatOrderMoney(Int(tip))) }
        AglynAmountRow("Total", amount: row.total, emphasized: true)
          // Figma 13:483: the total sits under a hairline in the plain column.
          .overlay(alignment: .top) { if wide { AglynHairline() } }
        // In the plain column the notes are a row, so they line up with the totals (a footer ignores the row insets).
        if wide { totalsNotes(order).font(.system(size: 12)).foregroundStyle(AglynColor.secondaryText) }
      } header: {
        // In the plain column the totals follow the items directly, under the total's hairline (Figma 13:483).
        if !wide { Text("Totals") }
      } footer: {
        if !wide { totalsNotes(order) }
      }

      let shipments = order.fulfillments ?? []
      if !shipments.isEmpty {
        AglynFoldedSection("Shipments", count: shipments.count, identifier: "order-fold-shipments") {
          ForEach(shipments, id: \.id) { shipment in shipmentRow(shipment, order: order, number: row.number) }
        }
      }

      if order.channel == .pos {
        OrderReceiptActionsSection(context: context, orderID: orderID, raw: model.raw, number: row.number) { message, failure in
          done = message
          problem = failure
        }
      }

      if row.status == .pending, let link = order.paymentLinkUrl, !link.isEmpty {
        Section {
          Button {
            copyToClipboard(link)
            done = "Payment link copied"
          } label: {
            Label("Copy payment link", systemImage: "link")
          }
          .accessibilityIdentifier("order-copy-payment-link")
          if let url = URL(string: link) {
            ShareLink(item: url) { Label("Share payment link", systemImage: "square.and.arrow.up") }
          }
        } footer: {
          Text("The buyer pays this draft order through the link.")
        }
      }

      // Figma 13:483's folded rows: Customer details, then Timeline and notes. The console's order has no payments
      // section; its refunds are captions under the totals (above).
      AglynFoldedSection("Customer details", identifier: "order-fold-customer") {
        LabeledContent("Name", value: row.customer)
        if let email = order.customerEmail, !email.isEmpty { LabeledContent("Email", value: email) }
        if let phone = order.customerPhone, !phone.isEmpty { LabeledContent("Phone", value: phone) }
        if let address = order.shippingAddress, let text = addressText(address) {
          LabeledContent("Ships to") { Text(text).multilineTextAlignment(.trailing) }
        }
        if let note = order.note, !note.isEmpty { LabeledContent("Note", value: note) }
      }

      OrderAnnotationSections(context: context, orderID: orderID, order: order, noting: $noting)
    }
    .confirmationDialog(
      "Cancel this order?", isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
      titleVisibility: .visible
    ) {
      Button("Cancel order", role: .destructive) { Task { await run(.cancel) } }
    } message: {
      Text("The buyer is not refunded automatically. Refund first if they paid.")
    }
    .sheet(isPresented: $refundingSheet) {
      RefundSheet(order: order, number: row.number) { amount in
        try await refund(amountCents: amount)
      }
    }
    .sheet(isPresented: $fulfilling) {
      FulfillItemsSheet(context: context, order: order, orderID: orderID) { done = $0 }
    }
    .sheet(item: $editingShipment) { shipment in
      EditTrackingSheet(context: context, orderID: orderID, fulfillment: shipment) { done = $0 }
    }
    .confirmationDialog(
      "Cancel this shipment?", isPresented: Binding(get: { cancelingShipment != nil }, set: { if !$0 { cancelingShipment = nil } }),
      titleVisibility: .visible, presenting: cancelingShipment
    ) { shipment in
      Button("Cancel shipment", role: .destructive) { Task { await cancel(shipment) } }
    } message: { _ in
      Text("Its items go back to unfulfilled and can be shipped again. The buyer is not told.")
    }
    .confirmationDialog(
      refundingLine.map { orderRefundPrompt(order, lineItemIDs: [$0]).title } ?? "Refund this line?",
      isPresented: Binding(get: { refundingLine != nil }, set: { if !$0 { refundingLine = nil } }),
      titleVisibility: .visible, presenting: refundingLine
    ) { index in
      Button("Refund", role: .destructive) { Task { await refundLine(index) } }
    } message: { index in
      Text(orderRefundPrompt(order, lineItemIDs: [index]).text)
    }
    .sheet(isPresented: $receiptSheet) {
      ReceiptSheet(context: context, order: order, orderID: orderID, number: row.number) { done = "The receipt is on its way." }
    }
  }

  /// The one filled button: the order's next step (Fulfill, then Mark delivered), none once it has none.
  private func primaryAction(_ row: OrderRow) -> AglynRecordAction? {
    let offer = OrderAction.available(for: row.status)
    if offer.contains(.fulfill) {
      return AglynRecordAction("order-action-fulfill", "Fulfill", systemImage: OrderAction.fulfill.systemImage, enabled: busy == nil) {
        fulfilling = true
      }
    }
    if offer.contains(.deliver) {
      return AglynRecordAction(
        "order-action-deliver", OrderAction.deliver.title, systemImage: OrderAction.deliver.systemImage, enabled: busy == nil,
        busy: busy == .deliver
      ) { Task { await run(.deliver) } }
    }
    return nil
  }

  /// Every other act on the order, in the ⋯ menu: the receipt, its printouts, a note, the customer's CRM record, the
  /// order's services, then Refund and Cancel order.
  private func moreActions(_ row: OrderRow) -> [AglynRecordAction] {
    let order = row.order
    var out: [AglynRecordAction] = []
    if row.status != .pending {
      out.append(AglynRecordAction("order-receipt", "Send receipt", systemImage: "envelope") { receiptSheet = true })
    }
    // The console's Packing slip and Invoice: its own pages, on this device's print sheet.
    for kind in OrderPrintKind.allCases {
      out.append(
        AglynRecordAction(
          "order-print-\(kind.rawValue)", kind.title, systemImage: kind.systemImage, enabled: printing == nil,
          busy: printing == kind.rawValue
        ) { Task { await printPage(kind) } })
    }
    out.append(AglynRecordAction("order-add-note", "Add a note", systemImage: "square.and.pencil") { noting = true })
    // Their CRM record, which the order fed (the console's "View customer in CRM").
    if let link = customerCrmLink(orgSlug: context.orgSlug, hostSlug: context.hostSlug, email: order.customerEmail) {
      out.append(AglynRecordAction("order-customer-crm", "View customer in CRM", systemImage: "person.crop.circle") {
        context.openLink(link)
      })
    }
    // Pickup and delivery steps, returns on this order, shipping labels and the services the store has connected.
    out.append(AglynRecordAction("order-more", "Pickup, returns and services", systemImage: "puzzlepiece.extension") {
      context.navigate("commerce.orderServices", ["orderId": orderID])
    })
    if orderCanRefund(order) {
      out.append(
        AglynRecordAction("order-action-refund", "Refund", systemImage: "arrow.uturn.backward", destructive: true, enabled: busy == nil) {
          refundingSheet = true
        })
    }
    if OrderAction.available(for: row.status).contains(.cancel) {
      out.append(
        AglynRecordAction(
          "order-action-cancel", OrderAction.cancel.title, systemImage: OrderAction.cancel.systemImage, destructive: true,
          enabled: busy == nil, busy: busy == .cancel
        ) { confirming = .cancel })
    }
    return out
  }

  private func run(_ action: OrderAction) async {
    guard let hostID = context.hostID else { return }
    busy = action
    problem = nil
    defer { busy = nil }
    do {
      try await performOrderAction(action, api: context.api, hostID: hostID, orderID: orderID)
    } catch let error as ConsoleAPIError where error.status == 409 {
      problem = error.message.isEmpty ? "This order can no longer be changed that way." : error.message
    } catch let error as ConsoleAPIError where error.status == 0 || error.status >= 500 {
      problem = "It is not known whether that went through. The order updates here when it does; trying again is safe."
    } catch {
      problem = error.localizedDescription
    }
  }

  /// Refunds the order (all of it when `amountCents` is nil). Throws what the sheet shows.
  private func refund(amountCents: Int?) async throws {
    guard let hostID = context.hostID else { return }
    let key = refundKey ?? UUID().uuidString
    refundKey = key
    problem = nil
    do {
      try await refundOrder(api: context.api, hostID: hostID, orderID: orderID, amountCents: amountCents, attemptKey: key)
      refundKey = nil
      done = "Refund issued."
    } catch let error as ConsoleAPIError where error.status > 0 && error.status < 500 {
      // A definitive refusal: the next press is a new refund.
      refundKey = nil
      throw SheetFailure(message: error.message)
    } catch {
      // Not known whether it went through: the same key dedupes the next press.
      throw SheetFailure(message: "It is not known whether the refund went through. Trying again is safe; it will not refund twice.")
    }
  }

  @ViewBuilder
  private func shipmentRow(_ shipment: OrderFulfillment, order: HostOrder, number: String) -> some View {
    let active = fulfillmentIsActive(shipment)
    let editable = active && orderFulfillmentsEditable(order.status)
    let carrier = shipment.carrier.map { carrierLabelFor($0) } ?? ""
    let link = fulfillmentTrackingUrl(carrier: shipment.carrier, trackingNumber: shipment.trackingNumber, trackingUrl: shipment.trackingUrl)
    let described = describeFulfillmentLines(order, fulfillmentLines(order, shipment))
    let status = trackingStatusLabel(shipment.trackingStatus)
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      AglynRow(
        described.isEmpty ? "Fulfilled" : described,
        subtitle: [
          formatReceiptTime(Int64(shipment.atMs)),
          shipment.trackingNumber.map { "\(carrier.isEmpty ? "Tracking" : carrier) \($0)" },
          status.isEmpty ? nil : status,
        ].compactMap { $0 }.joined(separator: " · "),
        systemImage: "shippingbox"
      ) {
        if !active { StatusChip("Canceled") }
      }
      .strikethrough(!active)
      HStack {
        if active, let link, let url = URL(string: link) {
          Button("Track") { openURL(url) }.buttonStyle(.aglynSecondary)
        }
        if active, let label = shipment.labelUrl, !label.isEmpty {
          Button {
            Task { await printLabel(label, shipmentID: shipment.id, number: number) }
          } label: {
            if printing == shipment.id { ProgressView() } else { Label("Print label", systemImage: "printer") }
          }
          .buttonStyle(.aglynSecondary)
          .disabled(printing != nil)
          .accessibilityIdentifier("order-print-label-\(shipment.id)")
        }
        if editable {
          Button("Edit tracking") { editingShipment = shipment }
            .buttonStyle(.aglynSecondary)
            .disabled(busy != nil || working)
            .accessibilityIdentifier("order-edit-tracking-\(shipment.id)")
          Button("Cancel shipment", role: .destructive) { cancelingShipment = shipment }
            .buttonStyle(.aglynSecondary)
            .disabled(busy != nil || working)
            .accessibilityIdentifier("order-cancel-shipment-\(shipment.id)")
        }
      }
      .lineLimit(1)
    }
  }

  private func cancel(_ shipment: OrderFulfillment) async {
    guard let hostID = context.hostID else { return }
    working = true
    problem = nil
    defer { working = false }
    do {
      done = try await cancelShipment(api: context.api, hostID: hostID, orderID: orderID, fulfillmentID: shipment.id)
    } catch let error as ConsoleAPIError where error.status > 0 && error.status < 500 {
      problem = error.message
    } catch {
      problem = "It is not known whether the shipment was canceled. Retrying is safe; the server writes it once."
    }
  }

  /// Refunds one line, as the console's Refund line: the route works the amount out from the line.
  private func refundLine(_ index: Int) async {
    guard let hostID = context.hostID else { return }
    let key = lineRefundKey ?? UUID().uuidString
    lineRefundKey = key
    working = true
    problem = nil
    defer { working = false }
    do {
      try await refundOrderLines(api: context.api, hostID: hostID, orderID: orderID, lineItemIDs: [index], attemptKey: key)
      lineRefundKey = nil
      done = "Refund issued"
    } catch let error as ConsoleAPIError where error.status > 0 && error.status < 500 {
      // A definitive refusal: the next press is a new refund.
      lineRefundKey = nil
      problem = error.message.isEmpty ? "Refund failed" : error.message
    } catch {
      // Not known whether it went through: the same key dedupes the next press.
      problem = "It is not known whether the refund went through. Trying again is safe; it will not refund twice."
    }
  }

  private func printPage(_ kind: OrderPrintKind) async {
    guard let hostID = context.hostID else { return }
    printing = kind.rawValue
    problem = nil
    defer { printing = nil }
    if let message = await printOrderPage(api: context.api, hostID: hostID, orderID: orderID, kind: kind) { problem = message }
  }

  private func printLabel(_ link: String, shipmentID: String, number: String) async {
    printing = shipmentID
    problem = nil
    defer { printing = nil }
    switch await printShippingLabel(link, number: number) {
    case .done: break
    case .openInstead: if let url = URL(string: link) { openURL(url) }
    case .failed(let message): problem = message
    }
  }

  /// Under the totals, as the console's order says it: how the tax was computed (AGL-2451; absent means not recorded,
  /// never "no tax"), then what was refunded and what a lost chargeback took, two doors said apart (AGL-1787), in the
  /// error color.
  private func totalsNotes(_ order: HostOrder) -> some View {
    let reversal = splitOrderReversal(order)
    return VStack(alignment: .leading, spacing: 2) {
      Text(describeOrderTaxMode(order.taxMode?.rawValue))
      if reversal.refundedCents > 0 {
        Text("Refunded \(formatOrderMoney(reversal.refundedCents))").foregroundStyle(AglynColor.error)
      }
      if reversal.chargedBackCents > 0 {
        Text("Charged back \(formatOrderMoney(reversal.chargedBackCents))").foregroundStyle(AglynColor.error)
      }
    }
  }

  private func addressText(_ address: OrderAddress) -> String? {
    let lines = [
      address.name, address.line1, address.line2,
      [address.city, address.state, address.postalCode].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", "),
      address.country,
    ].compactMap { $0 }.filter { !$0.isEmpty }
    return lines.isEmpty ? nil : lines.joined(separator: "\n")
  }
}

/// A refusal a form sheet shows in place.
struct SheetFailure: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

/// Refund: all of what is left, or part of it (the console's dialog).
struct RefundSheet: View {
  let order: HostOrder
  let number: String
  let refund: (Int?) async throws -> Void
  @State private var full = true
  @State private var amount = ""

  private var refundable: Int { orderRefundableCents(order) }
  private var cents: Int? { full ? refundable : centsFromText(amount) }
  private var problem: String? { full ? nil : checkRefundAmount(cents, refundableCents: refundable) }

  var body: some View {
    AglynFormSheet(
      "Refund \(number)", confirm: cents.flatMap { problem == nil ? "Refund \(formatOrderMoney($0))" : nil } ?? "Refund",
      destructive: true, canConfirm: problem == nil,
      save: { try await refund(full ? nil : cents) }
    ) {
      Section {
        Picker("Refund", selection: $full) {
          Text("Full refund").tag(true)
          Text("Part of it").tag(false)
        }
        .pickerStyle(.segmented)
        if !full {
          LabeledContent("Amount") {
            TextField("0.00", text: $amount)
              .multilineTextAlignment(.trailing)
              .monospacedDigit()
              .accessibilityIdentifier("refund-amount")
              #if os(iOS)
                .keyboardType(.decimalPad)
              #endif
          }
          if let problem, !amount.isEmpty { Text(problem).font(AglynFont.caption).foregroundStyle(.red) }
        }
      } footer: {
        Text("\(formatOrderMoney(refundable)) is left to refund on this order, through Stripe.")
      }
    }
  }
}

/// Send the receipt: by email, or by text where the store has texts on.
struct ReceiptSheet: View {
  let context: NativePluginContext
  let order: HostOrder
  let orderID: String
  let number: String
  let sent: () -> Void
  @State private var channels: [ReceiptChannel] = [.email]
  @State private var channel: ReceiptChannel = .email
  @State private var to = ""

  private var problem: String? { checkReceiptRecipient(channel, to) }

  var body: some View {
    AglynFormSheet(
      "Send the receipt", confirm: "Send", canConfirm: problem == nil,
      save: {
        guard let hostID = context.hostID else { return }
        do {
          try await resendOrderReceipt(api: context.api, hostID: hostID, orderID: orderID, channel: channel, to: to)
        } catch let error as ConsoleAPIError where error.status > 0 && error.status < 500 {
          throw SheetFailure(message: error.message)
        } catch {
          throw SheetFailure(message: "It is not known whether the receipt went. Check the order's history before sending again.")
        }
        sent()
      }
    ) {
      Section {
        if channels.count > 1 {
          Picker("Send by", selection: $channel) {
            ForEach(channels) { Text($0.label).tag($0) }
          }
          .pickerStyle(.segmented)
        }
        TextField(channel == .email ? "Email address" : "Phone number", text: $to)
          .autocorrectionDisabled()
          .accessibilityIdentifier("order-receipt-to")
          #if os(iOS)
            .textInputAutocapitalization(.never)
            .keyboardType(channel == .email ? .emailAddress : .phonePad)
          #endif
        if let problem, !to.isEmpty { Text(problem).font(AglynFont.caption).foregroundStyle(.red) }
      } footer: {
        Text("The receipt for \(number).")
      }
    }
    .task {
      to = order.customerEmail ?? ""
      guard let hostID = context.hostID else { return }
      channels = await orderReceiptChannels(api: context.api, hostID: hostID)
      if !channels.contains(channel) { channel = channels.first ?? .email }
    }
    .onChange(of: channel) { _, next in
      to = (next == .email ? order.customerEmail : order.customerPhone) ?? ""
    }
  }
}

/// Puts `text` on the device's clipboard.
@MainActor
func copyToClipboard(_ text: String) {
  #if canImport(UIKit)
    UIPasteboard.general.string = text
  #elseif canImport(AppKit)
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  #endif
}

extension OrderFulfillment: @retroactive Identifiable {}
