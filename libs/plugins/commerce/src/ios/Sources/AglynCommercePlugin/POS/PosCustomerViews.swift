// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * THE CUSTOMER ROW (AGL-3609): beside the basket, search the workspace's
 * people, attach one to the sale and see what they have bought here, or add
 * a new one. The Kotlin app's `PosCustomerViews.kt`.
 */

struct BasketCustomerRow: View {
  let model: RegisterModel

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      if let customer = model.cart.customer {
        AttachedCustomer(model: model, customer: customer)
      } else {
        CustomerSearch(model: model)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .sheet(isPresented: Binding(get: { model.customers.adding }, set: { if !$0 { model.customers.cancelAdding() } })) {
      NewCustomerSheet(model: model)
    }
  }
}

private struct AttachedCustomer: View {
  let model: RegisterModel
  let customer: PosCustomer

  var body: some View {
    let stats = model.customers.stats
    HStack(alignment: .firstTextBaseline) {
      VStack(alignment: .leading, spacing: 2) {
        Text(customer.title).font(AglynFont.body.weight(.medium)).accessibilityIdentifier("pos-customer-name")
        if !customer.name.isEmpty, let email = customer.email {
          Text(email).font(AglynFont.caption).foregroundStyle(.secondary)
        }
        if let stats {
          Text(
            stats.orderCount > 0
              ? "\(stats.orderCount) past \(stats.orderCount == 1 ? "order" : "orders") · \(model.money(stats.lifetimeSpendCents)) spent"
              : "First order here"
          )
          .font(AglynFont.caption).foregroundStyle(.secondary).accessibilityIdentifier("pos-customer-stats")
        }
      }
      Spacer()
      Button("Remove") { model.attachCustomer(nil) }.buttonStyle(.borderless).accessibilityIdentifier("pos-customer-remove")
    }
    .task(id: customer.email ?? "") { await model.customers.loadStats(email: customer.email) }
    AttachedCustomerCheckIn(model: model, customer: customer)
  }
}

/// What the attached customer has to check in today (AGL-4063), as the console's customer panel shows it: "Check in (2)"
/// while anyone waits, and the `posCheckIn` zone on a day they have anything due.
private struct AttachedCustomerCheckIn: View {
  let model: RegisterModel
  let customer: PosCustomer
  @State private var sheet: PosCheckInModel?
  @Environment(\.posPluginContext) private var context

  var body: some View {
    let due = model.checkInDue
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      if due.waiting > 0 {
        Button("Check in (\(due.waiting))") { sheet = model.makeCheckIn() }
          .buttonStyle(.bordered)
          .accessibilityIdentifier("pos-customer-check-in")
      }
      if let dayKey = due.dayKey {
        PosCheckInZone(
          params: posCheckInZoneParams(
            hostID: model.hostID, contactId: customer.kind == "contact" ? customer.id : nil, email: customer.email, dayKey: dayKey,
            name: customer.name, unitsDue: due.total, placement: "register-customer"))
      }
    }
    .task(id: customer) { await due.load(customer) }
    .sheet(item: $sheet, onDismiss: { Task { await due.load(customer) } }) { open in
      PosCheckInSheet(model: open, hostID: model.hostID, initial: checkInTarget(for: customer)) { sheet = nil }
        .environment(\.posPluginContext, context)
    }
  }
}

private struct CustomerSearch: View {
  let model: RegisterModel

  var body: some View {
    @Bindable var customers = model.customers
    HStack {
      TextField(
        customers.available ? "Customer: name, email or phone" : "Customer: email for the receipt", text: $customers.text
      )
      .autocorrectionDisabled()
      #if os(iOS)
        .textInputAutocapitalization(.never)
      #endif
      .textFieldStyle(.roundedBorder)
      .onSubmit { useTypedEmail() }
      .accessibilityIdentifier("pos-customer-search")
      Button("New") { customers.startAdding() }.accessibilityIdentifier("pos-customer-new")
    }
    .task(id: customers.text) {
      // Typing pauses before the register asks; a newer keystroke cancels this wait.
      try? await Task.sleep(for: posCustomerDebounce)
      if Task.isCancelled { return }
      await customers.search()
    }
    ForEach(customers.results, id: \.self) { found in
      Button {
        attach(found)
      } label: {
        VStack(alignment: .leading, spacing: 2) {
          Text(found.title).font(AglynFont.body)
          let detail = [found.email, found.phone].compactMap { $0 }.joined(separator: " · ")
          if !detail.isEmpty { Text(detail).font(AglynFont.caption).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .buttonStyle(.plain)
    }
    if !customers.available, let email = customers.typedEmail {
      Button("Use \(email)") { attach(.typed(email: email)) }.accessibilityIdentifier("pos-customer-use-email")
    }
  }

  private func useTypedEmail() {
    if !model.customers.available, let email = model.customers.typedEmail { attach(.typed(email: email)) }
  }

  private func attach(_ customer: PosCustomer) {
    model.attachCustomer(customer)
    model.customers.clearSearch()
  }
}

private struct NewCustomerSheet: View {
  let model: RegisterModel

  var body: some View {
    @Bindable var customers = model.customers
    AglynActionSheet(
      "New customer", message: "Adding a customer does not sign them up for marketing email.", confirmLabel: "Add customer",
      busy: customers.busy, error: customers.error, onCancel: { customers.cancelAdding() },
      onConfirm: {
        Task {
          if let added = await customers.create() {
            model.attachCustomer(added)
            customers.clearSearch()
          }
        }
      }
    ) {
      TextField("Name", text: $customers.draftName).accessibilityIdentifier("customer-name")
      TextField("Email", text: $customers.draftEmail)
        .autocorrectionDisabled()
        #if os(iOS)
          .keyboardType(.emailAddress)
          .textInputAutocapitalization(.never)
        #endif
        .accessibilityIdentifier("customer-email")
      TextField("Phone (optional)", text: $customers.draftPhone)
        #if os(iOS)
          .keyboardType(.phonePad)
        #endif
        .accessibilityIdentifier("customer-phone")
    }
  }
}
