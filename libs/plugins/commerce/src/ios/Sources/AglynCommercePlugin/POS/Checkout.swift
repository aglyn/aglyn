// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynUI
import Foundation
import Observation

/*
 * CHECKOUT: the tender state machine.
 *
 * The server has priced the sale; this takes the money. A tip first when the
 * store asks for one, then a tender: a card reader, cash or a gift card. A
 * tender may cover part of the balance (a split), and the sale stays open
 * until the balance is zero. Then the receipt.
 *
 * Every press goes through here, so the rules hold in one place: one tender
 * at a time, one attempt key per press until its answer arrives, and after a
 * lost answer no tender at all until the sale has been read again.
 */

struct CheckoutNotice: Equatable {
  let tone: AglynTone
  let message: String
}

enum CheckoutStep: Equatable {
  case tender
  case cash
  case giftCard
  /// The customer is at a card reader.
  case card(readerLabel: String, paymentID: String?)
  /// Paid: the receipt is next.
  case receipt(changeCents: Int)
}

func saleFromOpened(_ opened: PosOpenedSale) -> PosSale {
  PosSale(
    orderID: opened.orderID, status: "pending", totalCents: opened.totalCents, paidCents: 0, dueCents: opened.dueCents,
    tenderableCents: opened.dueCents, tipCents: 0, payments: [])
}

@MainActor
@Observable
final class Checkout {
  let opened: PosOpenedSale
  let settings: PosRegisterSettings
  private(set) var sale: PosSale
  private(set) var step = CheckoutStep.tender
  private(set) var tipID = "none"
  private(set) var tipCents = 0
  /// Part of the balance, for a split; nil pays it all.
  private(set) var partCents: Int?
  private(set) var busy = false
  private(set) var notice: CheckoutNotice?
  /// An answer was lost: no tender until the sale is read again.
  private(set) var lost = false
  private(set) var giftBalance: String?

  @ObservationIgnored private let api: PosSaleAPI
  @ObservationIgnored private var keys: AttemptKeys
  @ObservationIgnored private let sleep: @Sendable (Int) async -> Void
  @ObservationIgnored private let formatMoney: (Int) -> String

  init(
    api: PosSaleAPI, opened: PosOpenedSale, settings: PosRegisterSettings, keys: AttemptKeys = AttemptKeys(),
    sleep: @escaping @Sendable (Int) async -> Void = { ms in try? await Task.sleep(for: .milliseconds(ms)) },
    formatMoney: @escaping (Int) -> String = { posMoney($0, currency: "usd") }
  ) {
    self.api = api
    self.opened = opened
    self.settings = settings
    self.keys = keys
    self.sleep = sleep
    self.formatMoney = formatMoney
    sale = saleFromOpened(opened)
  }

  private var deps: TenderDeps { TenderDeps(api: api, orderID: opened.orderID, sleep: sleep) }

  /// What a tender may still take.
  var dueCents: Int { sale.tenderableCents }
  /// What the next tender pays: the part, when it is less than the balance, or the balance.
  var amountCents: Int { partCents.flatMap { (1..<max(1, dueCents)).contains($0) ? $0 : nil } ?? dueCents }
  var isSplit: Bool { amountCents < dueCents }
  /// Card payments still at a reader (a sale reopened after a restart can hold one).
  var inFlight: [PosSalePayment] { sale.payments.filter { $0.status == "pending" } }
  /// Tenders are open: nothing in flight, nothing unknown, something to pay.
  var canTender: Bool {
    if case .receipt = step { return false }
    return !busy && !lost && dueCents > 0
  }

  /// The tip presets on what the next tender pays; none when the store does not ask.
  var tips: [TipChoice] { settings.tippingEnabled ? tipChoices(amountCents, settings.tipPercentages) : [] }

  func chooseTip(_ choice: TipChoice) {
    tipID = choice.id
    tipCents = choice.cents
  }

  func customTip(_ cents: Int?) {
    tipID = "custom"
    tipCents = max(0, cents ?? 0)
  }

  func setPart(_ cents: Int?) {
    partCents = cents.flatMap { $0 > 0 ? $0 : nil }
    // A new amount re-prices the percent tips on it.
    if let tip = tipChoices(amountCents, settings.tipPercentages).first(where: { $0.id == tipID }) { tipCents = tip.cents }
  }

  func go(to next: CheckoutStep) {
    guard canTender || next == .tender else { return }
    step = next
    notice = nil
  }

  func dismissNotice() { notice = nil }

  private func startTender() -> Bool {
    guard canTender else { return false }
    busy = true
    notice = nil
    return true
  }

  /// A card on `reader`: the customer pays the amount plus the tip.
  func payCard(_ reader: CardReaderService) async {
    guard startTender() else { return }
    let (amount, tip) = (amountCents, tipCents)
    step = .card(readerLabel: reader.label, paymentID: nil)
    let key = keys.key(for: "card:\(reader.id):\(amount):\(tip)")
    let outcome = await reader.charge(deps, amountCents: amount, tipCents: tip, attemptKey: key) { [weak self] id in
      self?.step = .card(readerLabel: reader.label, paymentID: id)
    }
    await finish(outcome)
  }

  /// Stops the card payment the customer is at; nobody is charged.
  func cancelCard(_ reader: CardReaderService) async {
    guard case .card(_, let paymentID) = step else { return }
    await reader.cancel(deps, paymentID: paymentID)
  }

  /// Cash: `tenderedCents` handed over; the server works out the change.
  func payCash(tenderedCents: Int) async {
    guard startTender() else { return }
    let (amount, tip) = (amountCents, tipCents)
    guard tenderedCents >= amount + tip else {
      busy = false
      notice = CheckoutNotice(tone: .error, message: "The cash handed over is less than \(formatMoney(amount + tip)).")
      return
    }
    let key = keys.key(for: "cash:\(tenderedCents):\(amount):\(tip)")
    let outcome = await AglynCommercePlugin.payCash(
      deps, tenderedCents: tenderedCents, amountCents: isSplit ? amount : nil, tipCents: tip, attemptKey: key)
    await finish(outcome, changeCents: max(0, tenderedCents - amount - tip))
  }

  /// A gift card by its code: it pays what it can, up to the amount.
  func payGiftCard(code: String) async {
    guard startTender() else { return }
    let cleaned = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    guard !cleaned.isEmpty else {
      busy = false
      notice = CheckoutNotice(tone: .error, message: "Enter the gift card code.")
      return
    }
    let key = keys.key(for: "gift:\(cleaned):\(amountCents)")
    await finish(
      await AglynCommercePlugin.payGiftCard(
        deps, code: cleaned, amountCents: isSplit ? amountCents : nil, attemptKey: key))
  }

  /// Reads a gift card's balance to the customer before it is applied.
  func checkGiftCard(code: String) async {
    guard !code.trimmingCharacters(in: .whitespaces).isEmpty, !busy else { return }
    busy = true
    notice = nil
    giftBalance = nil
    let words: String
    do {
      let balance = try await api.giftCardBalance(code: code)
      words =
        balance.voided
        ? "This card was voided." : balance.frozen ? "This card is on hold." : "Available: \(formatMoney(balance.availableCents))"
    } catch {
      words = (error as? ConsoleAPIErrorMessage)?.message ?? "The balance could not be read."
    }
    busy = false
    giftBalance = words
  }

  private func finish(_ outcome: TenderOutcome, changeCents: Int = 0) async {
    apply(outcome, changeCents: changeCents)
    // A lost answer: read the sale again at once, rather than leave the
    // cashier guessing whether the money moved.
    if case .unknown = outcome { await recheck(quiet: true) }
  }

  /// Applies one tender's outcome to the sale and the screen.
  func apply(_ outcome: TenderOutcome, changeCents: Int = 0) {
    busy = false
    if case .unknown(let message) = outcome {
      lost = true
      step = .tender
      notice = CheckoutNotice(tone: .warning, message: message)
      return
    }
    keys.answered()
    lost = false
    giftBalance = nil
    switch outcome {
    case .settled(let answer, let payment):
      sale = answer.sale
      tipID = "none"
      tipCents = 0
      partCents = nil
      if answer.completed || answer.sale.dueCents <= 0 {
        let change = payment.map(\.changeCents).flatMap { $0 > 0 ? $0 : nil } ?? changeCents
        step = .receipt(changeCents: change)
        notice = nil
      } else {
        step = .tender
        notice = CheckoutNotice(
          tone: .success,
          message: "Paid \(formatMoney(payment?.amountCents ?? 0)). \(formatMoney(answer.sale.dueCents)) is left to pay.")
      }
    case .canceled(let answer):
      if let answer { sale = answer.sale }
      step = .tender
      notice = CheckoutNotice(tone: .warning, message: "The payment was canceled. Nobody was charged.")
    case .failed(let message, let answer):
      if let answer { sale = answer.sale }
      step = .tender
      notice = CheckoutNotice(tone: .error, message: message)
    case .unknown: break
    }
  }

  /// Reads the sale again: after a lost answer, or when the app reopens on it.
  func recheck(quiet: Bool = false) async {
    if !quiet && busy { return }
    busy = true
    do {
      var answer = try await api.payment(orderID: opened.orderID, step: .sale)
      // A card payment still at a reader is read from the processor, not just the ledger.
      for pending in answer.sale.payments where pending.status == "pending" {
        answer = try await api.payment(orderID: opened.orderID, step: .status(paymentID: pending.id))
      }
      let paid = answer.completed || answer.sale.status == "paid"
      if paid { keys.answered() }
      busy = false
      lost = false
      sale = answer.sale
      notice =
        paid ? nil : CheckoutNotice(tone: .info, message: "The sale is up to date: \(formatMoney(answer.sale.dueCents)) is left to pay.")
      step = paid ? .receipt(changeCents: answer.sale.payments.reduce(0) { $0 + $1.changeCents }) : .tender
    } catch {
      busy = false
      lost = true
      notice = CheckoutNotice(tone: .warning, message: "Still offline. The sale is safe; check it again when you reconnect.")
    }
  }

  /// Stops a card payment left at a reader, so its amount can be tendered again.
  func cancelPending(_ paymentID: String) async {
    guard !busy else { return }
    busy = true
    notice = nil
    let answer = await cancelCardPayment(deps, paymentID)
    busy = false
    if let answer { sale = answer.sale } else {
      notice = CheckoutNotice(tone: .error, message: "The payment could not be stopped. Check the sale again.")
    }
  }

  /// Cancels the unpaid sale; the basket stays for another try. True when it was voided.
  func void() async -> Bool {
    guard !busy else { return false }
    busy = true
    notice = nil
    do {
      _ = try await api.payment(orderID: opened.orderID, step: .void)
      busy = false
      return true
    } catch {
      busy = false
      notice = CheckoutNotice(tone: .error, message: (error as? ConsoleAPIErrorMessage)?.message ?? "The sale could not be canceled.")
      return false
    }
  }

  /// Sends (or records) the receipt: `email` or `sms` to `to`, `print` when
  /// it printed here, `none` when the customer declined. "No receipt" never
  /// holds the next customer, so its note is best-effort. True when the sale is done.
  func sendReceipt(channel: String, to: String? = nil) async -> Bool {
    guard !busy else { return false }
    if channel == "none" || channel == "print" {
      _ = try? await api.payment(orderID: opened.orderID, step: .receipt(channel: channel, to: nil))
      return true
    }
    busy = true
    notice = nil
    do {
      _ = try await api.payment(
        orderID: opened.orderID,
        step: .receipt(channel: channel, to: to?.trimmingCharacters(in: .whitespacesAndNewlines)))
      busy = false
      notice = CheckoutNotice(tone: .success, message: channel == "sms" ? "Receipt texted." : "Receipt emailed.")
      return true
    } catch {
      busy = false
      notice = CheckoutNotice(tone: .error, message: (error as? ConsoleAPIErrorMessage)?.message ?? "The receipt could not be sent.")
      return false
    }
  }
}

/// An error with words for the cashier (the console API's refusals).
protocol ConsoleAPIErrorMessage { var message: String { get } }

func isReceiptEmail(_ text: String) -> Bool {
  text.trimmingCharacters(in: .whitespaces).range(of: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", options: .regularExpression) != nil
}

func isReceiptPhone(_ text: String) -> Bool { text.filter(\.isNumber).count >= 7 }
