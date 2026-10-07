// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynUI
import SwiftUI

/// Taking the money for an opened sale: the total, a tip, a split, then a
/// card reader, cash or a gift card; then the receipt.
struct CheckoutView: View {
  let model: RegisterModel
  let checkout: Checkout
  @State private var tendered = ""
  @State private var giftCode = ""
  @State private var partText = ""
  @State private var receiptTo = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: AglynSpace.three) {
          summary
          if let notice = checkout.notice {
            AglynNotice(notice.message, tone: notice.tone) { checkout.dismissNotice() }
          }
          switch checkout.step {
          case .tender: tender
          case .cash: cash
          case .giftCard: giftCard
          case .card(let label, _): card(label)
          case .receipt(let change): receipt(change)
          }
        }
        .padding(AglynSpace.three)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
      }
      .background(AglynColor.page)
      .navigationTitle(title)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        if !isPaid {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel sale", role: .destructive) {
              Task { if await checkout.void() { model.voided() } }
            }
            .disabled(checkout.busy || !checkout.inFlight.isEmpty)
          }
        }
      }
    }
    .sensoryFeedback(.success, trigger: isPaid)
  }

  private var isPaid: Bool {
    if case .receipt = checkout.step { return true }
    return false
  }

  private var title: String { isPaid ? "Paid" : "Checkout" }

  private var summary: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      if let subtotal = checkout.opened.subtotalCents { AglynAmountRow("Subtotal", amount: model.money(subtotal)) }
      if let discount = checkout.opened.discountCents, discount > 0 {
        AglynAmountRow("Discount", amount: "−\(model.money(discount))")
      }
      if let tax = checkout.opened.taxCents { AglynAmountRow("Tax", amount: model.money(tax)) }
      if checkout.sale.paidCents > 0 { AglynAmountRow("Paid", amount: model.money(checkout.sale.paidCents), tone: .success) }
      Divider()
      AglynAmountRow(
        isPaid ? "Total" : "To pay", amount: model.money(isPaid ? checkout.sale.totalCents : checkout.dueCents),
        emphasized: true)
    }
    .padding(AglynSpace.two)
    .aglynCardSurface()
  }

  @ViewBuilder private var tender: some View {
    if !checkout.tips.isEmpty {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        AglynSectionHeader("Tip")
        ScrollView(.horizontal, showsIndicators: false) {
          HStack {
            ForEach(checkout.tips) { tip in
              AglynChoiceChip(
                tip.cents > 0 ? "\(tip.label) · \(model.money(tip.cents))" : tip.label, selected: checkout.tipID == tip.id
              ) { checkout.chooseTip(tip) }
            }
          }
        }
      }
    }
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      AglynSectionHeader("Amount") {
        if checkout.isSplit { Text("Split payment").foregroundStyle(.secondary) }
      }
      TextField("Pay all of \(model.money(checkout.dueCents))", text: $partText)
        .textFieldStyle(.roundedBorder)
        #if os(iOS)
          .keyboardType(.decimalPad)
        #endif
        .onChange(of: partText) { _, text in checkout.setPart(centsFromText(text)) }
    }
    if !checkout.inFlight.isEmpty {
      ForEach(checkout.inFlight) { payment in
        AglynNotice("A card payment of \(model.money(payment.amountCents)) is still at a reader.", tone: .warning)
        Button("Stop that payment") { Task { await checkout.cancelPending(payment.id) } }
      }
    }
    VStack(spacing: AglynSpace.oneAndHalf) {
      ForEach(model.readers, id: \.id) { reader in
        tenderButton("Card · \(reader.label)", systemImage: reader.kind == .smart ? "creditcard.and.123" : "wave.3.right") {
          Task { await checkout.payCard(reader) }
        }
      }
      tenderButton("Cash", systemImage: "banknote") { checkout.go(to: .cash) }
      tenderButton("Gift card", systemImage: "giftcard") { checkout.go(to: .giftCard) }
      if model.readers.isEmpty {
        Text("No card reader is connected. Pair one in Card readers.").font(AglynFont.caption).foregroundStyle(.secondary)
      }
      if checkout.lost {
        Button("Check the sale") { Task { await checkout.recheck() } }.buttonStyle(.bordered)
      }
    }
  }

  private func tenderButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack {
        Label(title, systemImage: systemImage)
        Spacer()
        Text(model.money(checkout.amountCents + checkout.tipCents)).monospacedDigit()
      }
      .font(AglynFont.headline)
      .padding(.vertical, AglynSpace.one)
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(.bordered)
    .controlSize(.large)
    .disabled(!checkout.canTender)
  }

  private var cash: some View {
    VStack(alignment: .leading, spacing: AglynSpace.two) {
      AglynSectionHeader("Cash handed over")
      HStack {
        ForEach(cashQuickAmounts(checkout.amountCents + checkout.tipCents), id: \.self) { cents in
          AglynChoiceChip(model.money(cents), selected: centsFromText(tendered) == cents) { tendered = amountText(cents) }
        }
      }
      TextField("Amount", text: $tendered).textFieldStyle(.roundedBorder)
        #if os(iOS)
          .keyboardType(.decimalPad)
        #endif
      if let cents = centsFromText(tendered), cents > checkout.amountCents + checkout.tipCents {
        AglynAmountRow("Change", amount: model.money(cents - checkout.amountCents - checkout.tipCents), emphasized: true)
      }
      HStack {
        Button("Back") { checkout.go(to: .tender) }.buttonStyle(.bordered)
        Spacer()
        Button("Take cash") {
          guard let cents = centsFromText(tendered) else { return }
          Task { await checkout.payCash(tenderedCents: cents) }
        }
        .buttonStyle(.borderedProminent)
        .disabled(centsFromText(tendered) == nil || checkout.busy)
        .accessibilityIdentifier("take-cash")
      }
    }
  }

  private var giftCard: some View {
    VStack(alignment: .leading, spacing: AglynSpace.two) {
      AglynSectionHeader("Gift card")
      TextField("Code", text: $giftCode).textFieldStyle(.roundedBorder)
        #if os(iOS)
          .textInputAutocapitalization(.characters)
        #endif
        .autocorrectionDisabled()
      if let balance = checkout.giftBalance { Text(balance).font(AglynFont.subheadline) }
      HStack {
        Button("Back") { checkout.go(to: .tender) }.buttonStyle(.bordered)
        Button("Check balance") { Task { await checkout.checkGiftCard(code: giftCode) } }.buttonStyle(.bordered)
        Spacer()
        Button("Apply") { Task { await checkout.payGiftCard(code: giftCode) } }
          .buttonStyle(.borderedProminent)
          .disabled(giftCode.isEmpty || checkout.busy)
      }
    }
  }

  private func card(_ label: String) -> some View {
    VStack(spacing: AglynSpace.two) {
      Image(systemName: "wave.3.right.circle")
        .font(.system(size: 64))
        .foregroundStyle(AglynColor.tint)
        .symbolEffect(.pulse)
      Text(model.readers.first(where: { $0.label == label })?.prompt ?? "Present the card on \(label)")
        .font(AglynFont.title2).multilineTextAlignment(.center)
      Text(model.money(checkout.amountCents + checkout.tipCents)).font(AglynFont.figure).monospacedDigit()
      Button("Cancel payment", role: .destructive) {
        Task {
          if let reader = model.readers.first(where: { $0.label == label }) { await checkout.cancelCard(reader) }
        }
      }
      .buttonStyle(.bordered)
    }
    .frame(maxWidth: .infinity)
    .padding(AglynSpace.three)
    .aglynCardSurface()
  }

  private func receipt(_ change: Int) -> some View {
    VStack(alignment: .leading, spacing: AglynSpace.two) {
      if change > 0 {
        AglynAmountRow("Change due", amount: model.money(change), emphasized: true, tone: .success)
          .padding(AglynSpace.two)
          .aglynCardSurface()
      }
      AglynSectionHeader("Receipt")
      TextField(model.context?.smsReceipts == true ? "Email or phone" : "Email", text: $receiptTo)
        .textFieldStyle(.roundedBorder)
        .autocorrectionDisabled()
        #if os(iOS)
          .textInputAutocapitalization(.never)
          .keyboardType(.emailAddress)
        #endif
        .onAppear { if receiptTo.isEmpty { receiptTo = model.cart.customerEmail } }
      HStack {
        Button("No receipt") { Task { if await checkout.sendReceipt(channel: "none") { model.finished() } } }
          .buttonStyle(.bordered)
        Spacer()
        Button("Send receipt") {
          let channel = isReceiptEmail(receiptTo) ? "email" : "sms"
          Task { if await checkout.sendReceipt(channel: channel, to: receiptTo) { model.finished() } }
        }
        .buttonStyle(.borderedProminent)
        .disabled(
          !(isReceiptEmail(receiptTo) || (model.context?.smsReceipts == true && isReceiptPhone(receiptTo))) || checkout.busy)
      }
    }
  }
}
