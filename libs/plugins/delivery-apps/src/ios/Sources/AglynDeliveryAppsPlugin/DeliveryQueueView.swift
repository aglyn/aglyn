// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynUI
import SwiftUI

/// The register's delivery orders, above the till: each open DoorDash, Uber Eats or Grubhub order with what to make and
/// the one next step (accept or reject, ready, picked up), the latest finished ones folded beneath. It asks again every
/// few seconds, and draws nothing until the site has a service connected, or for anyone the register's gate turns away.
struct DeliveryQueueView: View {
  @State private var model: DeliveryQueueModel

  init(context: NativePluginContext) {
    let host = context.hostID
    _model = State(initialValue: DeliveryQueueModel(api: ConsoleDeliveryAppsAPI(api: context.api), hostID: { host }))
  }

  var body: some View {
    VStack(spacing: 0) {
      if let queue = model.queue, queue.connected {
        card(queue)
      }
    }
    .task {
      while !Task.isCancelled {
        await model.refresh()
        try? await Task.sleep(for: deliveryQueuePoll)
      }
    }
  }

  private func card(_ queue: DeliveryQueue) -> some View {
    VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
      HStack {
        Text("Delivery orders").font(AglynFont.headline)
        if model.waiting > 0 { StatusChip("\(model.waiting)", tone: .warning) }
        Spacer()
        if !queue.recent.isEmpty {
          Button(model.showRecent ? "Hide finished" : "Finished") { model.showRecent.toggle() }
            .buttonStyle(.borderless)
            .accessibilityIdentifier("delivery-finished")
        }
      }
      if let announcement = model.announcement {
        AglynNotice(announcement, tone: .info) { model.announcement = nil }
      }
      if let notice = model.notice {
        AglynNotice(notice.message, tone: notice.isError ? .error : .info) { model.notice = nil }
      }
      if queue.open.isEmpty {
        Text("No delivery orders open.").font(AglynFont.subheadline).foregroundStyle(.secondary)
      }
      ForEach(queue.open) { order in
        Divider()
        orderRow(order)
      }
      if model.showRecent {
        ForEach(queue.recent) { order in
          Divider()
          HStack(spacing: AglynSpace.one) {
            StatusChip(order.status.label, tone: order.status.tone)
            Text("\(order.serviceLabel) \(order.externalRef)\(order.customerName.map { " · \($0)" } ?? "")")
              .font(AglynFont.subheadline)
            Spacer()
            Text(order.displayRef ?? deliveryMoney(order.totalCents, currency: order.currency))
              .font(AglynFont.subheadline).foregroundStyle(.secondary)
          }
        }
      }
    }
    .padding(AglynSpace.two)
    .aglynCardSurface()
    .aglynContentEdges()
    .padding(.vertical, AglynSpace.one)
    .confirmationDialog(
      model.rejecting.map { "Reject \($0.serviceLabel) \($0.externalRef)?" } ?? "Reject order?",
      isPresented: Binding(get: { model.rejecting != nil }, set: { if !$0 { model.rejecting = nil } }),
      titleVisibility: .visible, presenting: model.rejecting
    ) { order in
      ForEach(deliveryRejectReasons, id: \.self) { reason in
        Button(reason, role: .destructive) { Task { await model.reject(order, reason: reason) } }
      }
      Button("Keep it", role: .cancel) {}
    } message: { _ in
      Text("The service tells the customer and refunds them. Nothing is taken off your shelf.")
    }
  }

  private func orderRow(_ order: DeliveryOrder) -> some View {
    let busy = model.busy == order.id
    return VStack(alignment: .leading, spacing: AglynSpace.one) {
      HStack(spacing: AglynSpace.one) {
        StatusChip(order.status.label, tone: order.status.tone)
        if order.testMode { StatusChip("Test", tone: .info) }
        Text("\(order.serviceLabel) \(order.externalRef)\(order.customerName.map { " · \($0)" } ?? "")")
          .font(AglynFont.headline)
        Spacer()
        Text(deliveryMoney(order.totalCents, currency: order.currency)).font(AglynFont.headline).monospacedDigit()
      }
      Text(detailLine(order)).font(AglynFont.caption).foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 2) {
        ForEach(Array(order.lines.enumerated()), id: \.offset) { _, line in
          Text(lineText(line)).font(AglynFont.subheadline)
        }
      }
      if let instructions = order.instructions { AglynNotice(instructions, tone: .info) }
      if order.oversold > 0 { AglynNotice("\(order.oversold) sold beyond what was in stock.", tone: .warning) }
      if order.refundedCents > 0 {
        Text("\(deliveryMoney(order.refundedCents, currency: order.currency)) refunded by \(order.serviceLabel)")
          .font(AglynFont.caption).foregroundStyle(.secondary)
      }
      if let error = order.error {
        AglynNotice(error, tone: order.pending == nil ? .error : .warning)
        if order.pending != nil {
          Button("Send again") { Task { await model.act(order, .retry) } }
            .buttonStyle(.aglynSecondary).disabled(busy)
        }
      }
      let steps = deliverySteps(order)
      if !steps.isEmpty {
        HStack {
          ForEach(steps) { step in
            let button = Button(step.label, role: step.destructive ? .destructive : nil) {
              Task { await model.act(order, step.action) }
            }
            // A filled step: the brand blue under white (the console's contained button), red to undo; the others are
            // secondary (outlined) buttons.
            Group {
              if step.primary || step.destructive { button.buttonStyle(.aglynProminent) } else { button.buttonStyle(.aglynSecondary) }
            }
              .controlSize(.large)
              .disabled(busy)
              .accessibilityIdentifier("delivery-\(step.action.rawValue)-\(order.id)")
          }
        }
      }
    }
    .accessibilityIdentifier("delivery-order-\(order.id)")
  }

  private func detailLine(_ order: DeliveryOrder) -> String {
    var parts = ["Placed \(clock(order.placedAtMs))"]
    if let pickup = order.pickupAtMs {
      parts.append("\(order.handoff == "customer" ? "Customer collects" : "Courier") at \(clock(pickup))")
    }
    if let ref = order.displayRef { parts.append("Order \(ref)") }
    return parts.joined(separator: " · ")
  }

  private func lineText(_ line: DeliveryOrderLine) -> String {
    var text = "\(line.quantity) × \(line.name)"
    if !line.options.isEmpty { text += " — \(line.options.joined(separator: ", "))" }
    if let note = line.instructions { text += " · “\(note)”" }
    return text
  }

  private func clock(_ ms: Double) -> String {
    Date(timeIntervalSince1970: ms / 1000).formatted(date: .omitted, time: .shortened)
  }
}
