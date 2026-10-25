// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import AglynUI
import SwiftUI

/*
 * WHAT THE REGISTER SAYS ABOUT ITS CONNECTION (AGL-3625), and the offline sale:
 * cash, or a card on this device's own reader (AGL-4039). The Kotlin app's `PosOfflineViews.kt`. The console's banner and offline
 * checkout, at a tablet-sized touch.
 *
 *  - offline: what still sells (cash, and cards on this device's reader), what
 *    does not, and how many sales wait, cards to charge among them;
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
          !offline.ready
            ? "Offline. Sales are paused: \(offline.unavailableReason ?? "this register cannot sell offline."). Hold baskets and charge when you are back online."
            : model.offlineCardsReady
              ? "Offline. Cash and card sales keep ringing and are saved on this register until the connection returns; cards are charged then. Gift cards, store credit and room charges are off."
              : "Offline. Cash sales keep ringing and are saved on this register until the connection returns. Card readers, gift cards, store credit and room charges are off.",
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
          Text(waitingSummary(model))
            .font(AglynFont.caption).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("register-offline-waiting")
        }
      } else if !waiting.isEmpty {
        AglynNotice(
          offline.syncing
            ? "Syncing \(plural(waiting.count, "offline sale", "offline sales"))…"
            : waitingSummary(model),
          tone: .info, actionTitle: offline.syncing ? nil : "Sync now", action: offline.syncing ? nil : { Task { await offline.syncNow() } }
        )
        .accessibilityIdentifier("register-offline-sync")
      }
      // Cards stored on this device wait for a connection: Stripe recommends reconnecting within a day (AGL-4039).
      if let oldest = offline.oldestCardOnDeviceMs {
        AglynNotice(reconnectMessage(oldestMs: oldest, model: model), tone: offline.cardsWaitedTooLong ? .error : .warning)
          .accessibilityIdentifier("register-offline-cards-reconnect")
      }
      if let error = offline.syncError {
        AglynNotice("Offline sales could not sync: \(error) They stay on this register.", tone: .error)
      }
      ForEach(offline.refused) { entry in
        AglynNotice(
          "A \(model.money(entry.totalCents)) offline sale from \(Date(timeIntervalSince1970: entry.sale.soldAtMs / 1000).formatted(date: .abbreviated, time: .shortened)) did not sync: \(entry.error ?? "refused")",
          tone: .error, actionTitle: "Remove", action: { removing = entry })
      }
      // A card the bank declined after the sale stands on its own: the order is unpaid (AGL-4039).
      ForEach(offline.notices.filter(\.cardUnpaid)) { notice in
        AglynNotice(declinedCardMessage(notice, model: model), tone: .error, onDismiss: { offline.dismissNotice(notice.saleKey) })
          .accessibilityIdentifier("register-offline-card-declined")
      }
      let checks = offline.notices.filter { !$0.cardUnpaid || !$0.lines.isEmpty }
      if !checks.isEmpty {
        VStack(alignment: .leading, spacing: 2) {
          AglynNotice(
            "Synced, with something to check", tone: .warning, onDismiss: { offline.dismissNotices() })
          ForEach(checks) { notice in
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
      Text(
        entry.isCard
          ? "The \(model.money(entry.totalCents)) card sale will not be recorded anywhere. Record it by hand first."
          : "The \(model.money(entry.totalCents)) cash sale will not be recorded anywhere. Record it by hand first if the cash was taken.")
    }
  }
}

/// "3 sales ($74.37) waiting to sync, 1 of them a card to charge ($24.79)."
@MainActor
private func waitingSummary(_ model: RegisterModel) -> String {
  let offline = model.offline
  let waiting = offline.waiting
  let cards = offline.waitingCards
  let head = "\(plural(waiting.count, "sale", "sales")) (\(model.money(offline.waitingCents))) waiting to sync"
  guard !cards.isEmpty else { return head + "." }
  let tail = cards.count == waiting.count
    ? (cards.count == 1 ? "a card to charge" : "all cards to charge")
    : "\(cards.count) of them \(cards.count == 1 ? "a card" : "cards") to charge (\(model.money(offline.waitingCardCents)))"
  return "\(head), \(tail)."
}

/// Reconnect soon: the cards on this device are charged only once Stripe has them.
@MainActor
private func reconnectMessage(oldestMs: Double, model: RegisterModel) -> String {
  let count = model.offline.queue.filter(\.cardOnDevice).count
  let cards = count == 1 ? "1 card taken offline is" : "\(count) cards taken offline are"
  if model.offline.cardsWaitedTooLong {
    return "\(cards) still on this device after more than a day. Reconnect now so they can be charged."
  }
  let by = Date(timeIntervalSince1970: (oldestMs + ContractValues.shared.posOfflineCardReconnectWithinMs) / 1000)
    .formatted(date: .abbreviated, time: .shortened)
  return "\(cards) saved on this device and charged once it reconnects. Reconnect within a day, by \(by)."
}

/// The words for a card taken offline that was never paid.
@MainActor
private func declinedCardMessage(_ notice: PosOfflineSyncNotice, model: RegisterModel) -> String {
  let card = offlineCardLabel(brand: notice.card?.brand, last4: notice.card?.last4)
  let when = Date(timeIntervalSince1970: notice.soldAtMs / 1000).formatted(date: .abbreviated, time: .shortened)
  let order = notice.number.map { "Order #\($0)" } ?? "The order"
  let what = notice.flags.contains(.cardDeclined) ? "was declined when it was charged" : "could not be charged"
  return "A \(model.money(notice.totalCents)) card sale (\(card)) rung offline \(when) \(what). \(order) is unpaid: collect it another way."
}

/// An offline sale (AGL-3625, AGL-4039): the total the register rings from
/// its cached prices and the store's rate, then cash (the change) or a card
/// on this device's own reader (saved on the device and charged when the
/// connection returns).
struct OfflineSaleSheet: View {
  enum Tender: Hashable { case cash, card }

  let model: RegisterModel
  @Environment(\.dismiss) private var dismiss
  @State private var tender: Tender = .cash
  @State private var received = ""
  @State private var rung: PosOfflineRung?
  @State private var failed: String?
  @State private var taking = false
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
          saved(rung)
        } else if totals != nil {
          Section {
            Picker("Payment", selection: $tender) {
              Text("Cash").tag(Tender.cash)
              Text("Card").tag(Tender.card)
            }
            .pickerStyle(.segmented)
            .disabled(taking)
            .accessibilityIdentifier("offline-tender")
          }
          switch tender {
          case .cash: cashSections(owed: owed)
          case .card: cardSections(owed: owed)
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle(rung == nil ? "Offline sale — \(model.money(owed))" : "Sale saved on this register")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(rung == nil ? "Cancel" : "New sale") { dismiss() }
            .disabled(taking)
            .accessibilityIdentifier("offline-done")
        }
      }
    }
    .aglynSheetMinimumSize(width: 420, height: 480)
    .interactiveDismissDisabled(rung != nil || taking)
  }

  @ViewBuilder private func saved(_ rung: PosOfflineRung) -> some View {
    Section {
      if let card = rung.card {
        AglynNotice(
          "Card saved: \(offlineCardLabel(brand: card.brand, last4: card.last4)). "
            + (card.forward == .forwarded ? "Stripe has it; it is charged when the sale syncs." : "It is charged when the register is back online."),
          tone: .success
        )
        .accessibilityIdentifier("offline-card-saved")
        Text("If the bank declines the card then, the order is marked unpaid and this register tells you.")
          .font(AglynFont.caption).foregroundStyle(.secondary)
      } else {
        AglynNotice(rung.changeCents > 0 ? "Change due: \(model.money(rung.changeCents))" : "No change due.", tone: .success)
          .accessibilityIdentifier("offline-change")
        Text(
          rung.hasCustomerEmail
            ? "It syncs when the register is back online, and the emailed receipt goes then."
            : "It syncs when the register is back online."
        )
        .font(AglynFont.caption).foregroundStyle(.secondary)
      }
    }
  }

  @ViewBuilder private func cashSections(owed: Int) -> some View {
    let offline = model.offline
    let tendered = centsFromText(received) ?? 0
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
      if let failed {
        AglynNotice(failed, tone: .error)
      }
    }
    Section {
      Button("Take cash") { takeCash(tendered) }
        .disabled(tendered < owed || offline.discountOverLimit(cart))
        .accessibilityIdentifier("offline-take-cash")
    }
  }

  @ViewBuilder private func cardSections(owed: Int) -> some View {
    let refusal = model.offlineCardRefusal(cart)
    let perSale = Int(model.offline.kit?.card?.maxSaleCents ?? 0)
    let perDay = Int(model.offline.kit?.card?.maxDeviceDailyCents ?? 0)
    Section {
      LabeledContent("Card reader") { Text(readerName).foregroundStyle(.secondary) }
      if taking {
        HStack(spacing: AglynSpace.one) {
          ProgressView()
          Text(model.collector?.prompt ?? "Present the card.")
        }
        .accessibilityIdentifier("offline-card-prompt")
      } else if let refusal {
        AglynNotice(refusal, tone: .warning).accessibilityIdentifier("offline-card-refusal")
      } else {
        AglynNotice(offlineCardLimitsNote(perSaleCents: perSale, perDayCents: perDay, money: model.money), tone: .info)
      }
      if let failed {
        AglynNotice(failed, tone: .error)
      }
    }
    Section {
      if taking {
        Button("Cancel the card", role: .destructive) { Task { await model.collector?.cancel() } }
      } else {
        Button("Take card") { takeCard() }
          .disabled(refusal != nil)
          .accessibilityIdentifier("offline-take-card")
      }
    }
  }

  private var readerName: String {
    if case .connected(let label, _, _) = model.collector?.state { return label }
    return "Not connected"
  }

  private func takeCash(_ tendered: Int) {
    failed = nil
    guard let made = model.takeOfflineCash(cart: cart, tenderedCents: tendered) else {
      failed = "This register could not save the sale. Do not take the cash; try again."
      return
    }
    rung = made
  }

  private func takeCard() {
    failed = nil
    taking = true
    Task {
      let result = await model.takeOfflineCard(cart: cart)
      taking = false
      switch result {
      case .rung(let made): rung = made
      case .canceled: break
      case .failed(let message): failed = message
      }
    }
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
