// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

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
    .task(id: "\(context.hostID ?? ""):\(orderID)") {
      model.start(context.firestore, hostID: context.hostID, orderID: orderID)
    }
    .onDisappear { model.stop() }
  }

  private func form(_ row: OrderRow) -> some View {
    let order = row.order
    return Form {
      Section {
        HStack(alignment: .firstTextBaseline) {
          VStack(alignment: .leading, spacing: 4) {
            Text(row.number).font(AglynFont.title2)
            Text(
              [orderChannelLabel(order.channel?.rawValue), row.createdAt.map { $0.formatted(date: .abbreviated, time: .shortened) }]
                .compactMap { $0 }.joined(separator: " · ")
            )
            .font(AglynFont.subheadline).foregroundStyle(.secondary)
          }
          Spacer()
          StatusChip(row.statusLabel, tone: orderStatusTone(row.status).tone)
        }
        if let problem { AglynNotice(problem, tone: .error) { self.problem = nil } }
        if let done { AglynNotice(done, tone: .success) { self.done = nil } }
        let actions = OrderAction.available(for: row.status)
        if !actions.isEmpty {
          // One row when the labels fit whole, otherwise one button per line:
          // a phone never breaks "Refund" into "Ref / und".
          let buttons = Group {
            if orderCanRefund(order) {
              Button(role: .destructive) { refundingSheet = true } label: {
                Label("Refund", systemImage: "arrow.uturn.backward")
              }
              .buttonStyle(.bordered)
              .disabled(busy != nil)
              .accessibilityIdentifier("order-action-refund")
            }
            ForEach(actions) { action in
              Button(role: action == .cancel ? .destructive : nil) {
                if action == .cancel { confirming = action } else { Task { await run(action) } }
              } label: {
                if busy == action { ProgressView() } else { Label(action.title, systemImage: action.systemImage) }
              }
              .buttonStyle(.bordered)
              .disabled(busy != nil)
              .accessibilityIdentifier("order-action-\(action.rawValue)")
            }
          }
          .lineLimit(1)
          .fixedSize(horizontal: true, vertical: false)
          ViewThatFits(in: .horizontal) {
            HStack { buttons }
            VStack(alignment: .leading) { buttons }
          }
        }
      }

      Section("Items") {
        let lines = order.lineItems ?? []
        if lines.isEmpty {
          Text("No items").foregroundStyle(.secondary)
        }
        ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
          let quantity = max(0, Int(line.quantity))
          AglynRow(
            line.name, subtitle: [line.variantLabel, quantity == 1 ? nil : "\(quantity) × \(formatOrderMoney(Int(line.unitAmountCents)))"]
              .compactMap { $0 }.joined(separator: " · "),
            systemImage: "shippingbox"
          ) {
            Text(formatOrderMoney(Int(line.unitAmountCents) * quantity)).monospacedDigit()
          }
        }
      }

      Section("Totals") {
        let totals = order.totals
        if let items = totals?.itemsCents { AglynAmountRow("Items", amount: formatOrderMoney(Int(items))) }
        if let discount = totals?.discountCents, discount != 0 {
          AglynAmountRow("Discount", amount: "−" + formatOrderMoney(abs(Int(discount))))
        }
        if let shipping = totals?.shippingCents, shipping != 0 {
          AglynAmountRow("Shipping", amount: formatOrderMoney(Int(shipping)))
        }
        if let tax = totals?.taxCents, tax != 0 { AglynAmountRow("Tax", amount: formatOrderMoney(Int(tax))) }
        if let tip = totals?.tipCents, tip != 0 { AglynAmountRow("Tip", amount: formatOrderMoney(Int(tip))) }
        AglynAmountRow("Total", amount: row.total, emphasized: true)
        if orderRefundState(order) != .none {
          AglynAmountRow("Refunded", amount: orderRefundSummary(order), tone: .warning)
        }
      }

      Section("Customer") {
        LabeledContent("Name", value: row.customer)
        if let email = order.customerEmail, !email.isEmpty { LabeledContent("Email", value: email) }
        if let phone = order.customerPhone, !phone.isEmpty { LabeledContent("Phone", value: phone) }
        if let address = order.shippingAddress, let text = addressText(address) {
          LabeledContent("Ships to") { Text(text).multilineTextAlignment(.trailing) }
        }
        if let note = order.note, !note.isEmpty { LabeledContent("Note", value: note) }
      }

      if row.status != .pending {
        Section {
          Button {
            receiptSheet = true
          } label: {
            Label("Send the receipt", systemImage: "envelope")
          }
          .accessibilityIdentifier("order-receipt")
        } header: {
          Text("Receipt")
        } footer: {
          Text("Sends the receipt again, by email or text.")
        }
      }

      if let payments = order.payments, !payments.isEmpty {
        Section("Payments") {
          ForEach(payments, id: \.id) { payment in
            AglynRow(
              paymentLabel(payment), subtitle: payment.status.rawValue.replacingOccurrences(of: "_", with: " ").capitalized,
              systemImage: payment.method == .cash ? "banknote" : "creditcard"
            ) {
              Text(formatOrderMoney(Int(payment.amountCents))).monospacedDigit()
            }
          }
        }
      }

      // Pickup and delivery steps, returns on this order, shipping labels and the services the store has connected.
      Section {
        Button {
          context.navigate("commerce.orderServices", ["orderId": orderID])
        } label: {
          AglynRow(
            "Pickup, returns and services", subtitle: "Pickup and delivery steps, returns, labels and connected services",
            systemImage: "puzzlepiece.extension"
          ) {
            Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
          }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("order-more")
      }

      OrderAnnotationSections(context: context, orderID: orderID, order: order)
    }
    .formStyle(.grouped)
    .aglynListBackground()
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
    .sheet(isPresented: $receiptSheet) {
      ReceiptSheet(context: context, order: order, orderID: orderID, number: row.number) { done = "The receipt is on its way." }
    }
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

  private func paymentLabel(_ payment: OrderPayment) -> String {
    let method = payment.method.rawValue.replacingOccurrences(of: "_", with: " ").capitalized
    if let brand = payment.cardBrand, let last4 = payment.last4 { return "\(brand.capitalized) •••• \(last4)" }
    return method
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
