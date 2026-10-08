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
        let actions = OrderAction.available(for: row.status)
        if !actions.isEmpty {
          HStack {
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
