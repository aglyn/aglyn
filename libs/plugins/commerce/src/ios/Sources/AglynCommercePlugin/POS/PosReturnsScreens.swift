// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

/*
 * THE RETURN SHEET (AGL-3609): the console register's Return dialog at a
 * tablet-sized touch. Find the sale, pick what came back, say why, and the
 * refund goes to the payments the sale was made with. The Kotlin app's
 * `PosReturnsScreens.kt`.
 */

struct PosReturnSheet: View {
  let model: RegisterModel
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    let returns = model.returns
    NavigationStack {
      Group {
        if let result = returns.result {
          ReturnDone(model: model, result: result)
        } else if let order = returns.order {
          ReturnPicker(model: model, order: order)
        } else {
          ReturnLookup(model: model)
        }
      }
      .navigationTitle(title(returns))
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          if returns.result == nil { Button("Cancel") { close() }.disabled(returns.busy) }
        }
        ToolbarItem(placement: .confirmationAction) {
          if returns.result != nil { Button("Done") { close() } }
        }
      }
    }
    .aglynSheetMinimumSize(width: 460, height: 560)
    .interactiveDismissDisabled(returns.busy)
    .sheet(isPresented: Binding(get: { returns.managerPrompt != nil }, set: { if !$0 { returns.cancelApproval() } })) {
      PinPadSheet(
        model: model, purpose: "manager", title: "Manager approval", prompt: returns.managerPrompt, dismissible: true
      ) { manager in Task { await returns.approve(manager) } }
    }
    .onDisappear { returns.reset() }
  }

  private func title(_ returns: PosReturnModel) -> String {
    if returns.result != nil { return "Return refunded" }
    if let order = returns.order { return "Return from \(order.label)" }
    return "Return"
  }

  private func close() {
    model.returns.reset()
    dismiss()
  }
}

private struct ReturnLookup: View {
  let model: RegisterModel

  var body: some View {
    @Bindable var returns = model.returns
    Form {
      if let error = returns.error { Section { AglynNotice(error, tone: .warning) } }
      Section {
        TextField("Order number, receipt barcode or customer email", text: $returns.text)
          .autocorrectionDisabled()
          #if os(iOS)
            .textInputAutocapitalization(.never)
          #endif
          .onSubmit { Task { await returns.find() } }
          .accessibilityIdentifier("return-text")
        Button("Find order") { Task { await returns.find() } }
          .disabled(returns.busy || returns.text.trimmingCharacters(in: .whitespaces).isEmpty)
          .accessibilityIdentifier("return-find")
      } footer: {
        Text("Scan the receipt's barcode with a scanner, or type the number printed on it.")
      }
      if let found = returns.orders {
        if found.isEmpty {
          Section { Text("No order matches. Check the number on the receipt.").foregroundStyle(.secondary) }
        } else if found.count > 1 {
          Section("Matches") {
            ForEach(found) { candidate in
              Button {
                returns.choose(candidate)
              } label: {
                VStack(alignment: .leading, spacing: 2) {
                  Text("\(candidate.label) · \(model.money(candidate.totalCents))").font(AglynFont.headline)
                  Text(
                    "\(Date(timeIntervalSince1970: candidate.createdAtMs / 1000).formatted(date: .abbreviated, time: .omitted)) · \(candidate.status)"
                  )
                  .font(AglynFont.caption).foregroundStyle(.secondary)
                }
              }
              .buttonStyle(.plain)
            }
          }
        }
      }
    }
    .formStyle(.grouped)
  }
}

private struct ReturnPicker: View {
  let model: RegisterModel
  let order: PosReturnOrder

  var body: some View {
    @Bindable var returns = model.returns
    Form {
      if let error = returns.error { Section { AglynNotice(error, tone: .warning) } }
      Section {
        Text(
          [order.customerName, order.customerEmail, Date(timeIntervalSince1970: order.createdAtMs / 1000).formatted(date: .abbreviated, time: .omitted)]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        )
        .font(AglynFont.subheadline).foregroundStyle(.secondary)
        if !order.returnable { AglynNotice("This order is \(order.status) and cannot be returned.", tone: .warning) }
      }
      Section("Items") {
        ForEach(order.lines) { line in
          HStack {
            VStack(alignment: .leading, spacing: 2) {
              Text(line.name + (line.variantLabel.map { " (\($0))" } ?? "")).font(AglynFont.body)
              Text(caption(line)).font(AglynFont.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button {
              returns.step(line, by: -1)
            } label: {
              Image(systemName: "minus.circle")
            }
            .buttonStyle(.borderless).disabled(returns.quantity(line) <= 0)
            .accessibilityLabel("One fewer \(line.name)")
            Text("\(returns.quantity(line))").font(AglynFont.headline).frame(minWidth: 24)
              .accessibilityIdentifier("return-qty-\(line.index)")
            Button {
              returns.step(line, by: 1)
            } label: {
              Image(systemName: "plus.circle")
            }
            .buttonStyle(.borderless).disabled(returns.quantity(line) >= line.left || !order.returnable)
            .accessibilityLabel("One more \(line.name)")
            .accessibilityIdentifier("return-more-\(line.index)")
          }
        }
      }
      Section {
        Toggle("Put the items back in stock at this register's location", isOn: $returns.restock)
        Picker("Reason", selection: $returns.reasonCode) {
          ForEach(ContractValues.shared.returnReasons, id: \.rawValue) { reason in
            Text(ContractValues.shared.returnReasonLabels[reason.rawValue] ?? reason.rawValue).tag(reason.rawValue)
          }
        }
        TextField("Note (optional)", text: $returns.note)
      }
      Section("Refund \(model.money(returns.refundCents))") {
        if order.tenders.count > 1 { Toggle("Split by hand", isOn: $returns.splitByHand) }
        ForEach(order.tenders) { tender in
          if returns.splitByHand {
            TextField(
              "\(tender.label) (up to \(model.money(tender.refundableCents)))",
              text: Binding(get: { returns.split[tender.id] ?? "" }, set: { returns.split[tender.id] = $0 })
            )
            #if os(iOS)
              .keyboardType(.decimalPad)
            #endif
          } else {
            Text("\(tender.label): paid \(model.money(tender.amountCents)), \(model.money(tender.refundableCents)) refundable")
              .font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
        if !returns.splitByHand, order.tenders.count > 1 {
          Text("Cards are refunded first, then gift cards and room charges; cash comes out of the drawer last.")
            .font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
      Section {
        Button("Refund \(model.money(returns.refundCents))") { Task { await returns.submit() } }
          .disabled(!returns.canSubmit)
          .accessibilityIdentifier("return-refund")
        Button("Back") { returns.back() }.disabled(returns.busy)
      }
    }
    .formStyle(.grouped)
  }

  private func caption(_ line: PosReturnLine) -> String {
    if line.left > 0 { return "\(line.left) of \(line.quantity) can be returned" }
    return line.held > 0 ? "In an online return" : "Already returned"
  }
}

private struct ReturnDone: View {
  let model: RegisterModel
  let result: PosReturnResult

  var body: some View {
    Form {
      if result.cashOutCents > 0 {
        Section {
          AglynNotice("Give the customer \(model.money(result.cashOutCents)) from the drawer.", tone: .info)
            .accessibilityIdentifier("return-cash-out")
        }
      }
      Section("Refunded") {
        ForEach(Array(result.tenders.enumerated()), id: \.offset) { _, tender in
          AglynAmountRow(
            tender.label, amount: tender.failed ? "Failed — \(tender.error ?? "")" : model.money(tender.amountCents),
            tone: tender.failed ? .error : nil)
        }
        AglynAmountRow("Total", amount: model.money(result.refundedCents), emphasized: true)
      }
      if result.partial {
        Section {
          AglynNotice(
            "\(model.money(result.outstandingCents)) could not go back to the card. Pay it another way and note it on the order.",
            tone: .warning)
        }
      }
      if result.restockedUnits > 0 {
        Section {
          Text("\(result.restockedUnits) \(result.restockedUnits == 1 ? "unit" : "units") back in stock.")
            .font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
    }
    .formStyle(.grouped)
  }
}
