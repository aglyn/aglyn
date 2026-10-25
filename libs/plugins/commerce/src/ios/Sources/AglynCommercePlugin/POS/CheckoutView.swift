// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynHardware
import AglynUI
import SwiftUI

/// Taking the money for an opened sale: the total, a tip, a split, then a
/// card reader, cash, a gift card, store credit, a room charge or the QR
/// payment page; then the receipt.
struct CheckoutView: View {
  let model: RegisterModel
  let checkout: Checkout
  @State private var tendered = ""
  @State private var giftCode = ""
  @State private var creditText = ""
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
          case .credit(let providerID): credit(providerID)
          case .room: room
          case .qr(let paymentID, let url, let amount): qr(paymentID, url, amount)
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
      // "Open payment page" opens on the checkout's own stack, over the sale it belongs to.
      .aglynBrowserDestination()
    }
    .sensoryFeedback(.success, trigger: isPaid)
    // A typed card: the register's own card fields, over the checkout.
    .sheet(item: cardForm) { session in CardFieldsSheet(session: session) }
  }

  private var cardForm: Binding<CardFormSession?> {
    let presenter = model.keyedEntry as? CardFieldsPresenter
    return Binding(get: { presenter?.session }, set: { next in if next == nil { presenter?.session?.cancel() } })
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
        AglynSectionHeader("Tip") {
          if model.display.connected {
            Button(model.display.asking == .tip ? "Waiting for the customer…" : "Ask on display") {
              Task { await model.askTipOnDisplay() }
            }
            .buttonStyle(.borderless)
            .disabled(model.display.asking != nil || checkout.busy)
            .accessibilityIdentifier("tip-ask-display")
          }
        }
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
    if !checkout.sale.payments.isEmpty {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        AglynSectionHeader("Payments")
        ForEach(checkout.sale.payments) { payment in paymentRow(payment) }
      }
    }
    VStack(spacing: AglynSpace.oneAndHalf) {
      ForEach(model.readers, id: \.id) { reader in
        tenderButton("Card · \(reader.label)", systemImage: reader.kind == .smart ? "creditcard.and.123" : "wave.3.right") {
          Task { await checkout.payCard(reader) }
        }
      }
      if let keyed = model.keyedCard {
        tenderButton(keyed.label, systemImage: "creditcard") { Task { await checkout.payCard(keyed) } }
          .accessibilityIdentifier("tender-keyed-card")
      }
      tenderButton("Cash", systemImage: "banknote") { checkout.go(to: .cash) }
      tenderButton("Gift card", systemImage: "giftcard") { checkout.go(to: .giftCard) }
      tenderButton("Card (QR)", systemImage: "qrcode") { Task { await checkout.payLink() } }
        .accessibilityIdentifier("tender-qr")
      ForEach(model.context?.credits ?? []) { provider in
        tenderButton(provider.label, systemImage: "gift") {
          creditText = ""
          checkout.clearCreditLookup()
          checkout.go(to: .credit(providerID: provider.providerID))
        }
      }
      if !model.stays.isEmpty {
        tenderButton("Room", systemImage: "bed.double") { checkout.go(to: .room) }
      }
      if model.readers.isEmpty {
        Text("No card reader is connected. Pair one in Card readers.").font(AglynFont.caption).foregroundStyle(.secondary)
      }
      if checkout.lost {
        Button("Check the sale") { Task { await checkout.recheck() } }.buttonStyle(.aglynSecondary)
      }
    }
  }

  /// One payment on the sale: what it was, its status, and what can still be done with it.
  private func paymentRow(_ payment: PosSalePayment) -> some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      HStack {
        Text(describePayment(payment, money: model.money)).font(AglynFont.subheadline)
        if payment.changeCents > 0 { Text("· change \(model.money(payment.changeCents))").font(AglynFont.caption) }
        Spacer()
        StatusChip(paymentStatusLabel(payment.status), tone: paymentTone(payment.status))
      }
      if let failure = payment.failureMessage, payment.status == "failed" {
        Text(failure).font(AglynFont.caption).foregroundStyle(AglynColor.error)
      }
      if payment.status == "pending", payment.method.hasPrefix("card") {
        HStack {
          if payment.method == "card_link", payment.checkoutURL != nil {
            Button("Show QR") { checkout.showLink(payment) }.buttonStyle(.borderless)
          }
          if payment.method == "card_present", payment.livemode == false, model.context?.testMode == true {
            Button("Simulate tap") { Task { await checkout.simulateTap(payment.id) } }.buttonStyle(.borderless)
              .accessibilityIdentifier("simulate-tap")
          }
          Button("Stop that payment", role: .destructive) { Task { await checkout.cancelPending(payment.id) } }
            .buttonStyle(.borderless)
        }
        .disabled(checkout.busy)
      }
      if payment.status == "failed", payment.method == "card_present" {
        Button("Retry") { Task { await checkout.retryReaderPayment(payment.id) } }.buttonStyle(.borderless).disabled(!checkout.canTender)
      }
    }
    .padding(AglynSpace.one)
    .aglynCardSurface()
  }

  private func paymentTone(_ status: String) -> AglynTone {
    switch status {
    case "succeeded": .success
    case "failed": .error
    case "pending": .info
    case "reversed": .warning
    default: .neutral
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
    .buttonStyle(.aglynSecondary)
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
        Button("Back") { checkout.go(to: .tender) }.buttonStyle(.aglynSecondary)
        Spacer()
        Button("Take cash") {
          guard let cents = centsFromText(tendered) else { return }
          Task { await checkout.payCash(tenderedCents: cents) }
        }
        .buttonStyle(.aglynProminent)
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
        Button("Back") { checkout.go(to: .tender) }.buttonStyle(.aglynSecondary)
        Button("Check balance") { Task { await checkout.checkGiftCard(code: giftCode) } }.buttonStyle(.aglynSecondary)
        Spacer()
        Button("Apply") { Task { await checkout.payGiftCard(code: giftCode) } }
          .buttonStyle(.aglynProminent)
          .disabled(giftCode.isEmpty || checkout.busy)
      }
    }
  }

  /// Store credit another plugin keeps: the customer reads out a code, or staff find the account by email or code.
  private func credit(_ providerID: String) -> some View {
    let provider = model.context?.credits.first { $0.providerID == providerID }
    return VStack(alignment: .leading, spacing: AglynSpace.two) {
      AglynSectionHeader(provider?.label ?? "Store credit")
      TextField(provider?.lookup == true ? "Code or customer email" : "Code", text: $creditText)
        .textFieldStyle(.roundedBorder)
        .autocorrectionDisabled()
        #if os(iOS)
          .textInputAutocapitalization(.never)
        #endif
        .onChange(of: creditText) { _, _ in checkout.clearCreditLookup() }
        .onSubmit { if provider?.lookup == true { Task { await checkout.lookUpCredit(providerID: providerID, query: creditText) } } }
        .accessibilityIdentifier("credit-query")
      if let accounts = checkout.creditAccounts {
        if accounts.isEmpty {
          AglynNotice("No account matches.", tone: .info)
        } else {
          ForEach(accounts) { account in
            Button {
              Task { await checkout.payCredit(providerID: providerID, account: account) }
            } label: {
              VStack(alignment: .leading, spacing: 2) {
                Text(
                  "\(account.label)\(account.last4.isEmpty ? "" : " •• \(account.last4)") · \(model.money(account.availableCents)) available"
                )
                .font(AglynFont.headline)
                if let detail = account.detail { Text(detail).font(AglynFont.caption).foregroundStyle(.secondary) }
              }
              .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.aglynSecondary)
            .disabled(checkout.busy || account.availableCents <= 0)
          }
        }
      }
      HStack {
        Button("Back") {
          creditText = ""
          checkout.clearCreditLookup()
          checkout.go(to: .tender)
        }
        .buttonStyle(.aglynSecondary)
        if provider?.lookup == true {
          Button("Find") { Task { await checkout.lookUpCredit(providerID: providerID, query: creditText) } }
            .buttonStyle(.aglynSecondary)
            .disabled(checkout.busy || creditText.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        Spacer()
        Button("Apply code") {
          let code = creditText
          creditText = ""
          Task { await checkout.payCredit(providerID: providerID, code: code) }
        }
        .buttonStyle(.aglynProminent)
        .disabled(checkout.busy || creditText.trimmingCharacters(in: .whitespaces).isEmpty || creditText.contains("@"))
        .accessibilityIdentifier("credit-apply")
      }
    }
  }

  /// Charge to a checked-in stay's folio.
  private var room: some View {
    VStack(alignment: .leading, spacing: AglynSpace.two) {
      AglynSectionHeader("Charge to room — \(model.money(checkout.amountCents))")
      ForEach(model.stays) { stay in
        Button {
          Task { await checkout.payFolio(reservationID: stay.id) }
        } label: {
          Label(stay.name, systemImage: "bed.double").frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.aglynSecondary)
        .controlSize(.large)
        .disabled(checkout.busy)
      }
      Button("Back") { checkout.go(to: .tender) }.buttonStyle(.aglynSecondary)
    }
  }

  /// The QR payment page: the customer scans it and pays on their phone; the payment shows here as soon as it goes through.
  private func qr(_ paymentID: String, _ url: String, _ amountCents: Int) -> some View {
    VStack(spacing: AglynSpace.two) {
      Text("Scan to pay \(model.money(amountCents))").font(AglynFont.title2)
      Text("The customer scans this and pays on their phone. The payment shows here as soon as it goes through.")
        .font(AglynFont.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
      AglynQRCode(url)
      if let link = URL(string: url) { Link("Open payment page", destination: link) }
      Button("Close", role: .destructive) { Task { await checkout.cancelLink() } }.buttonStyle(.aglynSecondary).disabled(checkout.busy)
    }
    .frame(maxWidth: .infinity)
    .padding(AglynSpace.three)
    .aglynCardSurface()
    .task(id: paymentID) {
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(2))
        if Task.isCancelled { return }
        await checkout.pollLink()
      }
    }
  }

  private func card(_ label: String) -> some View {
    VStack(spacing: AglynSpace.two) {
      Image(systemName: model.cardService(labeled: label)?.kind == .keyed ? "creditcard.circle" : "wave.3.right.circle")
        .font(.system(size: 64))
        .foregroundStyle(AglynColor.tint)
        .symbolEffect(.pulse)
      Text(model.cardService(labeled: label)?.prompt ?? "Present the card on \(label)")
        .font(AglynFont.title2).multilineTextAlignment(.center)
      Text(model.money(checkout.amountCents + checkout.tipCents)).font(AglynFont.figure).monospacedDigit()
      if case .card(_, let paymentID?) = checkout.step, model.cardService(labeled: label)?.kind == .smart,
        model.context?.testMode == true
      {
        Button("Simulate a card tap (test mode)") { Task { await checkout.simulateTapOnReader(paymentID) } }
          .buttonStyle(.aglynSecondary)
          .accessibilityIdentifier("simulate-tap")
      }
      Button("Cancel payment", role: .destructive) {
        Task {
          if let reader = model.cardService(labeled: label) { await checkout.cancelCard(reader) }
        }
      }
      .buttonStyle(.aglynSecondary)
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
      if model.display.asking == .receipt {
        AglynNotice("The customer is choosing a receipt on the display…", tone: .info)
      }
      if let data = model.receipt {
        ScrollView(.horizontal, showsIndicators: false) {
          ReceiptPreviewText(document: layoutReceipt(data, ReceiptLayoutOptions(columns: PaperColumns.mm58 + 8)))
            .padding(AglynSpace.one)
        }
        .aglynCardSurface()
        .accessibilityIdentifier("receipt-preview")
      }
      TextField(model.context?.smsReceipts == true ? "Email or phone" : "Email", text: $receiptTo)
        .textFieldStyle(.roundedBorder)
        .autocorrectionDisabled()
        #if os(iOS)
          .textInputAutocapitalization(.never)
          .keyboardType(.emailAddress)
        #endif
        .onAppear { if receiptTo.isEmpty { receiptTo = model.cart.customerEmail } }
        .task { model.watchReceipt(orderID: checkout.opened.orderID) }
        .task {
          await model.askReceiptOnDisplay(checkout)
        }
        .task(id: model.receipt != nil) { await model.printReceiptByDefault(checkout) }
      HStack {
        Button(checkout.printed ? "New sale" : "No receipt") {
          // The cashier answers for the customer: the display's prompt ends with a thank-you.
          model.display.cancelAsk()
          Task { if await checkout.sendReceipt(channel: "none") { model.finished() } }
        }
          .buttonStyle(.aglynSecondary)
          .accessibilityIdentifier("receipt-none")
        if model.canPrintReceipt {
          Button("Print receipt") {
            model.display.cancelAsk()
            Task {
              switch await model.printReceipt(checkout) {
              case .printed: model.finished()
              case .canceled: break
              case .failed(let words): model.toast = CheckoutNotice(tone: .error, message: words)
              }
            }
          }
          .buttonStyle(.aglynSecondary)
          .disabled(checkout.busy || (!model.lastReceipt.hasPrinter && model.receipt == nil))
          .accessibilityIdentifier("receipt-print")
        }
        Spacer()
        Button("Send receipt") {
          let channel = isReceiptEmail(receiptTo) ? "email" : "sms"
          model.display.cancelAsk()
          Task { if await checkout.sendReceipt(channel: channel, to: receiptTo) { model.finished() } }
        }
        .buttonStyle(.aglynProminent)
        .disabled(
          !(isReceiptEmail(receiptTo) || (model.context?.smsReceipts == true && isReceiptPhone(receiptTo))) || checkout.busy)
      }
      if SystemPrinter.isAvailable, model.receipt != nil {
        // The items and the barcode a recipient returns with, and no price: printed on this device's sheet.
        Button("Gift receipt", systemImage: "gift") {
          model.display.cancelAsk()
          Task {
            if case .failed(let words) = await model.printReceipt(checkout, gift: true) {
              model.toast = CheckoutNotice(tone: .error, message: words)
            }
          }
        }
        .buttonStyle(.aglynSecondary)
        .accessibilityIdentifier("receipt-gift")
      }
    }
  }
}

/// The receipt as the paper prints it: a monospaced line each, a double-size line (TOTAL) at twice the size so it
/// spans the paper with its amount right-aligned.
struct ReceiptPreviewText: View {
  let document: PrintDocument

  var body: some View {
    let base = AglynFont.size(AglynTokens.Typography.caption)
    let lines = renderPreviewLines(document)
    let first = lines.firstIndex { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty } ?? 0
    let last = lines.lastIndex { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty } ?? (lines.count - 1)
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(lines.enumerated()).filter { $0.offset >= first && $0.offset <= last }, id: \.offset) { _, line in
        let font = Font.system(size: line.double ? base * 2 : base, weight: line.bold ? .bold : .regular, design: .monospaced)
        if line.double, let (label, amount) = receiptColumns(line.text) {
          // The system face tracks a large size tighter than a small one, so twice the size over half the columns
          // falls short of the paper's edge: the amount is pinned to the right edge instead of padded to it.
          HStack(spacing: 0) {
            Text(label)
            Spacer(minLength: base)
            Text(amount)
          }
          .font(font)
          .lineLimit(1)
          .frame(maxWidth: .infinity)
        } else {
          Text(line.text.isEmpty ? " " : line.text).font(font).lineLimit(1)
        }
      }
    }
    .fixedSize(horizontal: true, vertical: false)
    .accessibilityElement(children: .combine)
  }
}

/// A two-column receipt line split where its padding is (`TOTAL      $12.00` is `TOTAL` and `$12.00`); nil for a line
/// with no gap of two or more spaces between words.
func receiptColumns(_ line: String) -> (String, String)? {
  let trimmed = line.trimmingCharacters(in: .whitespaces)
  guard let gap = trimmed.range(of: " {2,}", options: [.regularExpression, .backwards]) else { return nil }
  let label = String(trimmed[..<gap.lowerBound])
  let amount = String(trimmed[gap.upperBound...])
  return label.isEmpty || amount.isEmpty ? nil : (label, amount)
}
