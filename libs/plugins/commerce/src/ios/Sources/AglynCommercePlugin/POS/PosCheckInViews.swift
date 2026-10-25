// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * CHECK-IN AT THE WINDOW (AGL-4063): the register's check-in sheet and the `posCheckIn` zone. The console's
 * `PosCheckInDialog`, in its words; the Kotlin app's `PosCheckInViews.kt`.
 */

/// The register's own plugin context, for the zones it draws below the toolbar (the customer panel's check-in zone).
extension EnvironmentValues {
  @Entry var posPluginContext: NativePluginContext? = nil
}

/// The zone other plugins draw in for one customer on one day (`posCheckIn`): a status the customer needs for the day, or
/// a button that starts the plugin's own flow. The plugins are never named, and an empty zone draws nothing.
let commercePosCheckInSlot = "posCheckIn"

struct PosCheckInZone: View {
  @Environment(\.posPluginContext) private var context
  let params: [String: String]

  var body: some View {
    if let context {
      let widgets = context.slotWidgets(commercePosCheckInSlot)
      if !widgets.isEmpty {
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          ForEach(widgets) { $0.make(context) }
        }
        .environment(\.aglynSlotParams, params)
        .accessibilityIdentifier("pos-check-in-zone-\(params["placement"] ?? "")")
      }
    }
  }
}

/// Check-in at the window: find the customer, see what their passes, camping and stays cover today, and check each person
/// in with an optional wristband number and color. Opens on one customer when the register's customer panel names them.
struct PosCheckInSheet: View {
  @State private var model: PosCheckInModel
  let hostID: String
  let initial: PosCheckInTarget?
  let onClose: () -> Void

  init(model: PosCheckInModel, hostID: String, initial: PosCheckInTarget? = nil, onClose: @escaping () -> Void) {
    _model = State(initialValue: model)
    self.hostID = hostID
    self.initial = initial
    self.onClose = onClose
  }

  var body: some View {
    NavigationStack {
      Form {
        if model.customer != nil {
          customerSection
        } else {
          searchSection
        }
        if !model.notice.isEmpty {
          Section { AglynNotice(model.notice, tone: .info) }
        }
        if !model.error.isEmpty {
          Section { AglynNotice(model.error, tone: .warning) }
        }
      }
      .formStyle(.grouped)
      .navigationTitle(model.title)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        if model.customer != nil {
          ToolbarItem(placement: .cancellationAction) {
            Button("Back to search") { model.backToSearch() }.accessibilityIdentifier("pos-check-in-back")
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { onClose() }.accessibilityIdentifier("pos-check-in-done")
        }
        if model.customer != nil, model.waiting.count > 1 {
          ToolbarItem(placement: .primaryAction) {
            Button("Check in all \(model.waiting.count)") { Task { await model.checkIn(model.waiting) } }
              .disabled(model.busy)
              .accessibilityIdentifier("pos-check-in-all")
          }
        }
      }
    }
    .task {
      if let initial, !initial.isEmpty { await model.open(initial) }
    }
  }

  @ViewBuilder private var searchSection: some View {
    Section {
      TextField("Find a customer", text: $model.text, prompt: Text("Name, email, phone or order number"))
        .autocorrectionDisabled()
        #if os(iOS)
          .textInputAutocapitalization(.never)
        #endif
        .accessibilityIdentifier("pos-check-in-search")
      if !model.customers.isEmpty {
        ForEach(model.customers, id: \.customerKey) { one in
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            Button {
              Task { await model.open(PosCheckInTarget(customerKey: one.customerKey)) }
            } label: {
              VStack(alignment: .leading, spacing: 2) {
                Text([one.name, one.email].compactMap { $0 }.first { !$0.isEmpty } ?? "Customer").font(AglynFont.body)
                Text(checkInCustomerLine(one)).font(AglynFont.caption).foregroundStyle(.secondary)
              }
              .frame(maxWidth: .infinity, alignment: .leading)
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("pos-check-in-customer-\(one.customerKey ?? "")")
            if let day = model.day {
              PosCheckInZone(
                params: posCheckInZoneParams(
                  hostID: hostID, contactId: one.contactId, email: one.email, dayKey: day.dayKey, name: one.name,
                  unitsDue: one.unitsDue ?? 0, placement: "check-in-row"))
            }
          }
        }
      } else if model.searched {
        Text("Nobody with that name, email, phone or order number has anything to check in today.")
          .font(AglynFont.subheadline).foregroundStyle(.secondary)
      } else {
        Text("Passes, camping and stays bought online or at the register show up here on the day they are for.")
          .font(AglynFont.subheadline).foregroundStyle(.secondary)
      }
    }
  }

  @ViewBuilder private var customerSection: some View {
    if let customer = model.customer {
      Section {
        AglynWrapRow {
          if let email = customer.email, !email.isEmpty {
            Text(email).font(AglynFont.subheadline).foregroundStyle(.secondary)
          }
          StatusChip(
            "\(model.checkedInCount) of \(model.rows.count) checked in",
            tone: !model.rows.isEmpty && model.waiting.isEmpty ? .success : .neutral)
        }
        if let day = model.day {
          PosCheckInZone(
            params: posCheckInZoneParams(
              hostID: hostID, contactId: customer.contactId, email: customer.email, dayKey: day.dayKey, name: customer.name,
              unitsDue: model.rows.count, placement: "check-in-customer"))
        }
      }
      Section {
        ForEach(model.rows) { row in
          PosCheckInRowView(model: model, row: row)
        }
      }
    }
  }
}

private struct PosCheckInRowView: View {
  @Bindable var model: PosCheckInModel
  let row: CheckInRow

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      VStack(alignment: .leading, spacing: 2) {
        Text(checkInItemLabel(row.record)).font(AglynFont.body)
        let detail = model.detail(row)
        if !detail.isEmpty { Text(detail).font(AglynFont.caption).foregroundStyle(.secondary) }
      }
      if row.checkedIn {
        Button("Undo") { Task { await model.undo(row) } }
          .buttonStyle(.borderless)
          .disabled(model.busy)
          .accessibilityIdentifier("pos-check-in-undo-\(row.id)")
      } else {
        ViewThatFits(in: .horizontal) {
          HStack(spacing: AglynSpace.one) { fields }
          VStack(alignment: .leading, spacing: AglynSpace.one) { fields }
        }
      }
    }
    .padding(.vertical, AglynSpace.half)
  }

  @ViewBuilder private var fields: some View {
    let draft = Binding(
      get: { model.drafts[row.id] ?? PosWristbandDraft() }, set: { model.drafts[row.id] = $0 })
    TextField("Wristband number", text: draft.number)
      .textFieldStyle(.roundedBorder)
      .autocorrectionDisabled()
      #if os(iOS)
        .textInputAutocapitalization(.characters)
      #endif
      .frame(minWidth: 140)
      .accessibilityIdentifier("pos-check-in-band-\(row.id)")
    Picker("Color", selection: draft.color) {
      Text("None").tag("")
      ForEach(ContractValues.shared.checkInWristbandColors, id: \.self) { Text($0).tag($0) }
    }
    .pickerStyle(.menu)
    .accessibilityIdentifier("pos-check-in-color-\(row.id)")
    Button("Check in") { Task { await model.checkIn([row]) } }
      .buttonStyle(.borderedProminent)
      .controlSize(.large)
      .disabled(model.busy)
      .accessibilityIdentifier("pos-check-in-\(row.id)")
  }
}
