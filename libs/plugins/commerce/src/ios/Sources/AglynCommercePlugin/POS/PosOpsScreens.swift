// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

/*
 * THE REGISTER'S OPERATIONS (AGL-3609): who is ringing, the shift and the
 * drawer. The console draws a strip above the basket; here one "Register"
 * sheet holds the same controls at a tablet-sized touch, and a locked
 * register covers the till with the PIN pad. The Kotlin app's
 * `PosOpsScreens.kt`.
 */

/// The Register sheet: the cashier, and the shift with its drawer.
struct RegisterOpsSheet: View {
  let model: RegisterModel
  @Environment(\.dismiss) private var dismiss
  @State private var switching = false

  var body: some View {
    let cashier = model.cashier
    let shift = model.shift
    NavigationStack {
      Form {
        if let notice = shift.notice {
          Section { AglynNotice(notice, tone: .success) { shift.notice = nil } }
        }
        Section("Cashier") {
          HStack {
            Text(cashier.cashier?.name ?? "You").font(AglynFont.headline).accessibilityIdentifier("pos-cashier-name")
            Spacer()
            if cashier.cashier != nil { Button("Sign out") { cashier.signOut() } }
          }
          Button("Switch cashier") { switching = true }
            .disabled(model.register == nil)
            .accessibilityIdentifier("pos-switch-cashier")
          Button("Lock") {
            cashier.lock()
            dismiss()
          }
          .disabled(model.register == nil)
          .accessibilityIdentifier("pos-lock")
        }
        Section("Shift") { ShiftControls(model: model) }
        StaffPinsSection(model: model)
      }
      .formStyle(.grouped)
      .navigationTitle("Register")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
    .frame(minWidth: 420, minHeight: 420)
    .sheet(isPresented: $switching) {
      PinPadSheet(model: model, purpose: "cashier", title: "Switch cashier", prompt: nil, dismissible: true) {
        cashier.switchTo($0)
        switching = false
      }
    }
    .sheet(item: Binding(get: { shift.dialog.map(ShiftDialogID.init) }, set: { if $0 == nil { shift.dismiss() } })) { dialog in
      ShiftDialogSheet(model: model, dialog: dialog.value)
    }
    .task { await shift.refresh() }
  }
}

/// Staff PINs: set, change or remove your own, and a workspace admin's reset of anyone's.
private struct StaffPinsSection: View {
  let model: RegisterModel
  @State private var pins: PosStaffPinsModel?
  @State private var pin = ""
  @State private var again = ""

  var body: some View {
    Section("Staff PINs") {
      if let pins {
        if let notice = pins.notice { AglynNotice(notice, tone: .success) { pins.notice = nil } }
        if let refusal = pins.refusal {
          Text(refusal == "Not permitted" ? "Only members who can use the register have a PIN." : refusal)
            .foregroundStyle(.secondary)
        } else if let status = pins.status {
          Text(
            status.hasPin
              ? "Your PIN switches you in at a shared register. Five wrong tries lock it for 15 minutes."
              : "Set a 4–6 digit PIN to switch in at a shared register without signing anyone out."
          )
          .font(AglynFont.subheadline).foregroundStyle(.secondary)
          Button(status.hasPin ? "Change my PIN" : "Set my PIN") { open(nil) }.accessibilityIdentifier("pin-set-mine")
          if status.hasPin {
            Button("Remove my PIN", role: .destructive) { Task { await pins.remove(nil) } }.disabled(pins.busy)
          }
          ForEach(pins.roster) { member in
            HStack {
              Text(member.name)
              Spacer()
              Button("Reset") { open(member) }.buttonStyle(.borderless)
              Button("Remove", role: .destructive) { Task { await pins.remove(member) } }
                .buttonStyle(.borderless).disabled(pins.busy)
            }
          }
        } else {
          Text("Reading your PIN…").foregroundStyle(.secondary)
        }
      }
    }
    .task {
      let made = PosStaffPinsModel(api: model.opsAPI)
      pins = made
      await made.load()
    }
    .sheet(isPresented: Binding(get: { pins?.dialogOpen == true }, set: { if !$0 { pins?.closeDialog() } })) {
      if let pins {
        AglynActionSheet(
          pins.editing.map { "Reset \($0.name)'s PIN" } ?? "Your register PIN", message: nil, confirmLabel: "Save PIN",
          busy: pins.busy, error: pins.error, onCancel: { pins.closeDialog() },
          onConfirm: { Task { await pins.save(pin: pin, again: again) } }
        ) {
          SecureField("PIN", text: $pin)
            #if os(iOS)
              .keyboardType(.numberPad)
            #endif
            .onChange(of: pin) { _, text in pin = String(text.filter(\.isNumber).prefix(6)) }
            .accessibilityIdentifier("pin-new")
          SecureField("PIN again", text: $again)
            #if os(iOS)
              .keyboardType(.numberPad)
            #endif
            .onChange(of: again) { _, text in again = String(text.filter(\.isNumber).prefix(6)) }
            .accessibilityIdentifier("pin-again")
        }
      }
    }
  }

  private func open(_ member: PosRosterMember?) {
    pin = ""
    again = ""
    pins?.startEdit(member)
  }
}

private struct ShiftDialogID: Identifiable {
  let value: ShiftDialog
  var id: String { "\(value)" }
}

private struct ShiftControls: View {
  let model: RegisterModel

  var body: some View {
    let shift = model.shift
    if !shift.loaded {
      Text("Reading the shift…").foregroundStyle(.secondary)
    } else if let open = shift.shift {
      StatusChip("Shift open since \(openedTime(open.shift.openedAtMs))", tone: .success)
        .accessibilityIdentifier("pos-shift-status")
      Button("Cash in/out") { shift.open(.cash) }.accessibilityIdentifier("pos-shift-cash")
      Button("X report") { shift.open(.report) }.accessibilityIdentifier("pos-shift-report")
      Button("Close shift") { shift.open(.close) }.accessibilityIdentifier("pos-shift-close")
    } else {
      StatusChip("No shift open", tone: .neutral).accessibilityIdentifier("pos-shift-status")
      if model.context?.ops.requireOpenShift == true {
        Text("This site asks for an open shift before a sale.").font(AglynFont.caption).foregroundStyle(.secondary)
      }
      Button("Open shift") { shift.open(.open) }
        .disabled(model.register == nil)
        .accessibilityIdentifier("pos-shift-open")
    }
  }

  private func openedTime(_ ms: Double) -> String {
    Date(timeIntervalSince1970: ms / 1000).formatted(date: .omitted, time: .shortened)
  }
}

private struct ShiftDialogSheet: View {
  let model: RegisterModel
  let dialog: ShiftDialog
  @State private var amount = ""
  @State private var reason = ""
  @State private var note = ""
  @State private var cashType = PosCashEventType.paidOut

  var body: some View {
    let shift = model.shift
    switch dialog {
    case .open:
      AglynActionSheet(
        "Open a shift", message: "Count the cash in the drawer before the first sale. Every sale and cash movement until you close is counted against it.",
        confirmLabel: "Open shift", busy: shift.busy, error: shift.error, onCancel: { shift.dismiss() },
        onConfirm: { Task { await shift.submitOpen(amount) } }
      ) {
        TextField("Starting cash, like 150.00", text: $amount)
          #if os(iOS)
            .keyboardType(.decimalPad)
          #endif
          .accessibilityIdentifier("shift-float")
      }
    case .cash:
      AglynActionSheet(
        "Cash in or out", message: cashHint, confirmLabel: "Record", busy: shift.busy, error: shift.error,
        onCancel: { shift.dismiss() }, onConfirm: { Task { await shift.submitCash(cashType, amount: amount, reason: reason) } }
      ) {
        Picker("What happened", selection: $cashType) {
          ForEach(posCashTypes, id: \.self) { type in
            Text(ContractValues.shared.posCashEventLabels[type.rawValue] ?? type.rawValue).tag(type)
          }
        }
        TextField("Amount", text: $amount)
          #if os(iOS)
            .keyboardType(.decimalPad)
          #endif
          .accessibilityIdentifier("shift-cash-amount")
        TextField(cashType == .drop ? "Note (optional)" : "Reason", text: $reason)
          .accessibilityIdentifier("shift-cash-reason")
      }
    case .report:
      NavigationStack {
        Form {
          if let error = shift.error { Section { AglynNotice(error, tone: .warning) } }
          if let report = shift.report {
            Section { ShiftReportView(report: report, shift: nil, currency: model.currency) }
          } else if shift.error == nil {
            Section { Text("Reading the shift…").foregroundStyle(.secondary) }
          }
        }
        .formStyle(.grouped)
        .navigationTitle("X report")
        #if os(iOS)
          .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Print") { Task { await shift.print(shiftID: shift.shift?.id) } }
              .disabled(shift.report == nil || shift.busy)
          }
          ToolbarItem(placement: .confirmationAction) { Button("Done") { shift.dismiss() } }
        }
      }
      .frame(minWidth: 420, minHeight: 480)
    case .close:
      if let frozen = shift.closed {
        NavigationStack {
          Form {
            if let report = frozen.report {
              Section { ShiftReportView(report: report, shift: frozen.shift.shift, currency: model.currency) }
            }
          }
          .formStyle(.grouped)
          .navigationTitle("Z report")
          #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
          #endif
          .toolbar {
            ToolbarItem(placement: .cancellationAction) {
              Button("Print") { Task { await shift.print(shiftID: frozen.shift.id) } }.disabled(shift.busy)
            }
            ToolbarItem(placement: .confirmationAction) { Button("Done") { shift.dismiss() } }
          }
        }
        .frame(minWidth: 420, minHeight: 480)
      } else {
        AglynActionSheet(
          "Close the shift", message: "Count the drawer, then enter what is in it.", confirmLabel: "Close shift",
          busy: shift.busy, error: shift.error, onCancel: { shift.dismiss() },
          onConfirm: { Task { await shift.submitClose(counted: amount, note: note) } }
        ) {
          TextField("Cash counted", text: $amount)
            #if os(iOS)
              .keyboardType(.decimalPad)
            #endif
            .accessibilityIdentifier("shift-counted")
          if let expected = shift.report?.expectedCashCents, let counted = centsFromText(amount) {
            let variance = Int(posCashVarianceCents(counted: Double(counted), expected: expected))
            AglynNotice(
              "Expected \(posMoney(Int(expected), currency: model.currency)) · "
                + (variance == 0
                  ? "balanced"
                  : variance < 0
                    ? "short \(posMoney(-variance, currency: model.currency))"
                    : "over \(posMoney(variance, currency: model.currency))"),
              tone: variance == 0 ? .success : .info
            )
            .accessibilityIdentifier("shift-variance")
          }
          TextField("Note (optional)", text: $note, axis: .vertical).lineLimit(2...4)
        }
      }
    }
  }

  private var cashHint: String {
    switch cashType {
    case .paidIn: "Cash added to the drawer."
    case .paidOut: "Cash taken for an expense."
    default: "Cash moved to the safe."
    }
  }
}

/// The X or Z report: sales by tender, refunds, and the drawer from float to expected cash.
struct ShiftReportView: View {
  let report: PosShiftReport
  let shift: PosShift?
  let currency: String

  private func m(_ cents: Double) -> String { posMoney(Int(cents), currency: currency) }

  var body: some View {
    VStack(spacing: AglynSpace.half) {
      AglynAmountRow("Sales (\(Int(report.orderCount)))", amount: m(report.grossSalesCents))
      if report.discountsCents > 0 { AglynAmountRow("Discounts", amount: m(report.discountsCents)) }
      if report.taxCents > 0 { AglynAmountRow("Tax", amount: m(report.taxCents)) }
      if report.tipsCents > 0 { AglynAmountRow("Tips", amount: m(report.tipsCents)) }
      ForEach(report.salesByTender.sorted(by: { $0.key < $1.key }), id: \.key) { method, cents in
        AglynAmountRow(ContractValues.shared.posTenderLabels[method] ?? method, amount: m(cents))
      }
      AglynAmountRow("Refunds (\(Int(report.refundCount)))", amount: "−" + m(report.refundsCents))
      AglynAmountRow("Net sales", amount: m(report.netSalesCents), emphasized: true)
      Divider()
      AglynAmountRow("Opening float", amount: m(report.openingFloatCents))
      AglynAmountRow("Cash sales", amount: m(report.cashSalesCents))
      if report.paidInCents > 0 { AglynAmountRow("Paid in", amount: m(report.paidInCents)) }
      if report.paidOutCents > 0 { AglynAmountRow("Paid out", amount: "−" + m(report.paidOutCents)) }
      if report.dropsCents > 0 { AglynAmountRow("Safe drops", amount: "−" + m(report.dropsCents)) }
      if report.cashRefundsCents > 0 { AglynAmountRow("Cash refunds", amount: "−" + m(report.cashRefundsCents)) }
      AglynAmountRow("Expected cash", amount: m(report.expectedCashCents), emphasized: true)
      if let counted = shift?.countedCashCents {
        AglynAmountRow("Counted", amount: m(counted))
        let variance = shift?.varianceCents ?? 0
        AglynAmountRow(
          variance == 0 ? "Balanced" : variance < 0 ? "Short" : "Over", amount: m(abs(variance)), emphasized: true)
      }
      if report.truncated == true {
        Text("This shift has more sales than a report reads; the figures are partial.")
          .font(AglynFont.caption).foregroundStyle(.secondary)
      }
    }
    .accessibilityIdentifier("shift-report-view")
  }
}

/// The PIN pad: pick your name, tap your PIN. Every key a full-size touch target.
struct PinPadSheet: View {
  let model: RegisterModel
  let purpose: String
  let title: String
  let prompt: String?
  let dismissible: Bool
  let onVerified: (PosStaffAssertion) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var pad: PosPinPadModel?

  init(
    model: RegisterModel, purpose: String, title: String, prompt: String?, dismissible: Bool,
    onVerified: @escaping (PosStaffAssertion) -> Void
  ) {
    self.model = model
    self.purpose = purpose
    self.title = title
    self.prompt = prompt
    self.dismissible = dismissible
    self.onVerified = onVerified
  }

  var body: some View {
    NavigationStack {
      Group {
        if let pad { content(pad) } else { ProgressView() }
      }
      .navigationTitle(title)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        if dismissible || pad?.nobodyHasAPin == true {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { close() } }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(purpose == "manager" ? "Approve" : "Continue") { Task { await pad?.submit() } }
            .disabled(pad?.canSubmit != true)
            .accessibilityIdentifier("pin-submit")
        }
      }
    }
    .frame(minWidth: 360, minHeight: 520)
    .interactiveDismissDisabled(!(dismissible || pad?.nobodyHasAPin == true))
    .task {
      let made = PosPinPadModel(api: model.opsAPI, registerID: model.register?.id ?? "", purpose: purpose) { assertion in
        onVerified(assertion)
      }
      pad = made
      await made.load()
    }
  }

  private func close() {
    if !dismissible { model.cashier.unlock() }
    dismiss()
  }

  @ViewBuilder
  private func content(_ pad: PosPinPadModel) -> some View {
    VStack(spacing: AglynSpace.two) {
      if let prompt { Text(prompt).font(AglynFont.subheadline).foregroundStyle(.secondary) }
      if pad.nobodyHasAPin {
        AglynNotice("Nobody has a register PIN on this site yet. Set yours from the Register sheet, under Staff PINs.", tone: .info)
      }
      ScrollView(.horizontal, showsIndicators: false) {
        HStack {
          ForEach(pad.members ?? []) { member in
            AglynChoiceChip(member.name, selected: member.uid == pad.memberUID) { pad.pick(member.uid) }
          }
        }
      }
      Text(String(repeating: "•", count: pad.pin.count).isEmpty ? " " : String(repeating: "•", count: pad.pin.count))
        .font(AglynFont.title).frame(maxWidth: .infinity).accessibilityLabel("PIN entered").accessibilityIdentifier("pos-pin-dots")
      if let error = pad.error { AglynNotice(error, tone: .warning) }
      Grid(horizontalSpacing: AglynSpace.one, verticalSpacing: AglynSpace.one) {
        ForEach([["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["clear", "0", "back"]], id: \.self) { row in
          GridRow {
            ForEach(row, id: \.self) { key in
              Button {
                pad.press(key)
              } label: {
                Text(key == "back" ? "⌫" : key == "clear" ? "Clear" : key)
                  .font(AglynFont.title2).frame(maxWidth: .infinity, minHeight: 52)
              }
              .buttonStyle(.bordered)
              .disabled(pad.busy || pad.memberUID.isEmpty)
              .accessibilityIdentifier("pin-\(key)")
            }
          }
        }
      }
      Spacer(minLength: 0)
    }
    .padding(AglynSpace.two)
  }
}

/// Covers the till while the register is locked, until a PIN opens it.
struct LockedRegister: View {
  let model: RegisterModel
  @State private var entering = true

  var body: some View {
    ZStack {
      Rectangle().fill(AglynColor.page)
      VStack(spacing: AglynSpace.two) {
        Image(systemName: "lock.fill").font(.largeTitle).foregroundStyle(.secondary)
        Text("Register locked").font(AglynFont.title2)
        Button("Enter PIN") { entering = true }.buttonStyle(.borderedProminent)
      }
    }
    .accessibilityIdentifier("pos-locked")
    .sheet(isPresented: $entering) {
      PinPadSheet(
        model: model, purpose: "cashier", title: "Register locked", prompt: "Enter your PIN to use the register.",
        dismissible: false
      ) {
        model.cashier.switchTo($0)
        entering = false
      }
    }
  }
}
