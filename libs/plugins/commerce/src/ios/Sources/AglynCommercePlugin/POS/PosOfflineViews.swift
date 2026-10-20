// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

/*
 * WHAT THE REGISTER SAYS ABOUT ITS CONNECTION (AGL-3625), and the offline cash
 * sale. The Kotlin app's `PosOfflineViews.kt`. The console's banner and offline
 * checkout, at a tablet-sized touch.
 *
 *  - offline: what still sells (cash), what does not, and how many sales wait;
 *  - back online: the sync, then what the server flagged by order number;
 *  - a sale the server would not take, kept on the device with its reason.
 */

private func plural(_ count: Int, _ one: String, _ many: String) -> String { "\(count) \(count == 1 ? one : many)" }

struct RegisterOfflineBanner: View {
  let model: RegisterModel
  @State private var removing: PosOfflineQueued?

  var body: some View {
    let offline = model.offline
    let waiting = offline.waiting
    VStack(spacing: AglynSpace.one) {
      if !model.online {
        AglynNotice(
          offline.ready
            ? "Offline. Cash sales keep ringing and are saved on this register until the connection returns. Card readers, gift cards, store credit and room charges are off."
            : "Offline. Sales are paused: \(offline.unavailableReason ?? "this register cannot sell offline."). Hold baskets and charge when you are back online.",
          tone: .warning
        )
        .overlay(alignment: .trailing) {
          Button("Retry") { model.reconnect() }
            .buttonStyle(.aglynSecondary)
            .padding(.trailing, AglynSpace.one)
            .accessibilityIdentifier("register-reconnect")
        }
        .accessibilityIdentifier("register-offline")
        if !waiting.isEmpty {
          Text("\(plural(waiting.count, "sale", "sales")) (\(model.money(offline.waitingCents))) waiting to sync.")
            .font(AglynFont.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("register-offline-waiting")
        }
      } else if !waiting.isEmpty {
        AglynNotice(
          offline.syncing
            ? "Syncing \(plural(waiting.count, "offline sale", "offline sales"))…"
            : "\(plural(waiting.count, "offline sale", "offline sales")) (\(model.money(offline.waitingCents))) waiting to sync.",
          tone: .info, actionTitle: offline.syncing ? nil : "Sync now", action: offline.syncing ? nil : { Task { await offline.syncNow() } }
        )
        .accessibilityIdentifier("register-offline-sync")
      }
      if let error = offline.syncError {
        AglynNotice("Offline sales could not sync: \(error) They stay on this register.", tone: .error)
      }
      ForEach(offline.refused) { entry in
        AglynNotice(
          "A \(model.money(entry.totalCents)) offline sale from \(Date(timeIntervalSince1970: entry.sale.soldAtMs / 1000).formatted(date: .abbreviated, time: .shortened)) did not sync: \(entry.error ?? "refused")",
          tone: .error, actionTitle: "Remove", action: { removing = entry })
      }
      if !offline.notices.isEmpty {
        VStack(alignment: .leading, spacing: 2) {
          AglynNotice(
            "Synced, with something to check", tone: .warning, onDismiss: { offline.dismissNotices() })
          ForEach(offline.notices) { notice in
            Text("Order \(notice.number.map { "#\($0)" } ?? notice.orderID): \(notice.lines.joined(separator: "; "))")
              .font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
      }
    }
    .padding(.horizontal, AglynSpace.two)
    .padding(.vertical, AglynSpace.one)
    .confirmationDialog(
      "Remove this sale from the register?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
      titleVisibility: .visible, presenting: removing
    ) { entry in
      Button("Remove", role: .destructive) { offline.discard(entry.id) }
    } message: { entry in
      Text("The \(model.money(entry.totalCents)) cash sale will not be recorded anywhere. Record it by hand first if the cash was taken.")
    }
  }
}

/// An offline cash sale: the total the register rings from its cached prices and the store's rate, the cash handed over, and, once the sale is on the device, the change.
struct OfflineCashSheet: View {
  let model: RegisterModel
  @Environment(\.dismiss) private var dismiss
  @State private var received = ""
  @State private var rung: PosOfflineRung?
  @State private var failed = false
  /// The basket as it was when the sheet opened: the sale clears it once it is on the device.
  @State private var cart: Cart

  init(model: RegisterModel) {
    self.model = model
    _cart = State(initialValue: model.cart)
  }

  var body: some View {
    let offline = model.offline
    let totals = rung?.sale.totals ?? offline.totals(for: cart)
    let owed = Int(totals?.totalCents ?? 0)
    let tendered = centsFromText(received) ?? 0
    NavigationStack {
      Form {
        if let totals {
          Section {
            AglynAmountRow("Items", amount: model.money(Int(totals.itemsCents ?? 0)))
            if (totals.discountCents ?? 0) > 0 { AglynAmountRow("Discount", amount: "−" + model.money(Int(totals.discountCents ?? 0))) }
            AglynAmountRow("Tax", amount: model.money(Int(totals.taxCents ?? 0)))
            AglynAmountRow("Total", amount: model.money(owed), emphasized: true)
          }
        } else {
          Section { AglynNotice(offline.unavailableReason ?? "This basket cannot be rung offline.", tone: .warning) }
        }
        if let rung {
          Section {
            AglynNotice(rung.changeCents > 0 ? "Change due: \(model.money(rung.changeCents))" : "No change due.", tone: .success)
              .accessibilityIdentifier("offline-change")
            Text(
              rung.hasCustomerEmail
                ? "It syncs when the register is back online, and the emailed receipt goes then."
                : "It syncs when the register is back online."
            )
            .font(AglynFont.caption).foregroundStyle(.secondary)
          }
        } else if totals != nil {
          Section {
            if offline.discountOverLimit(cart) {
              AglynNotice("This register may discount up to \(Int(offline.kit?.maxDiscountPct ?? 0))%.", tone: .error)
            }
            TextField("Cash received", text: $received)
              #if os(iOS)
                .keyboardType(.decimalPad)
              #endif
              .accessibilityIdentifier("offline-received")
            AglynWrapRow {
              ForEach(quickAmounts(owed), id: \.self) { cents in
                Button(cents == owed ? "Exact" : model.money(cents)) { received = amountText(cents) }.buttonStyle(.aglynSecondary)
              }
            }
            if tendered > 0 && tendered >= owed {
              AglynNotice("Change: \(model.money(tendered - owed))", tone: .success)
            } else if tendered > 0 {
              AglynNotice("Offline sales take the whole total in cash: \(model.money(owed - tendered)) more.", tone: .info)
            }
            if failed {
              AglynNotice("This register could not save the sale. Do not take the cash; try again.", tone: .error)
            }
          }
          Section {
            Button("Take cash") { take(tendered) }
              .disabled(tendered < owed || offline.discountOverLimit(cart))
              .accessibilityIdentifier("offline-take-cash")
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle(rung == nil ? "Cash — \(model.money(owed))" : "Sale saved on this register")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(rung == nil ? "Cancel" : "New sale") { dismiss() }.accessibilityIdentifier("offline-done")
        }
      }
    }
    .aglynSheetMinimumSize(width: 420, height: 480)
    .interactiveDismissDisabled(rung != nil)
  }

  private func take(_ tendered: Int) {
    failed = false
    guard let made = model.takeOfflineCash(cart: cart, tenderedCents: tendered) else {
      failed = true
      return
    }
    rung = made
  }

  /// Exact, and the next few round amounts a customer hands over.
  private func quickAmounts(_ owed: Int) -> [Int] {
    var seen: [Int] = []
    for value in [owed, (owed + 499) / 500 * 500, (owed + 999) / 1000 * 1000, (owed + 1999) / 2000 * 2000] where value >= owed && !seen.contains(value) {
      seen.append(value)
    }
    return Array(seen.prefix(4))
  }
}
