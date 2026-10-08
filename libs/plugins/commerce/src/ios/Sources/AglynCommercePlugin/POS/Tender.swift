// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynHardware
import Foundation

/*
 * TAKING ONE TENDER.
 *
 * Each tender is a short, resumable sequence against the open sale, and
 * every one ends in the same four outcomes the checkout acts on:
 *
 * - settled: the server recorded the payment (the sale may still have a
 *   balance, when this was a split);
 * - canceled: nobody was charged and the same tender can be tried again;
 * - failed: declined or refused, with words to read out;
 * - unknown: the answer was lost. The cashier checks the sale again rather
 *   than pressing the tender twice; the attempt key makes even a second
 *   press safe, because the route finds the payment the first press started.
 *
 * The device never decides that money moved: a card collected on this device
 * is AUTHORIZED here and recorded by the server's own read of Stripe.
 */

enum TenderOutcome: Equatable {
  case settled(PosPaymentAnswer, PosSalePayment?)
  case canceled(PosPaymentAnswer?)
  case failed(String, PosPaymentAnswer?)
  case unknown(String)
}

let lostAnswer = "The connection dropped before the answer arrived. Check the sale before taking payment again."

/// A lost answer (no status: the network dropped) as opposed to the route's refusal.
func isLostAnswer(_ error: Error) -> Bool {
  guard let api = error as? ConsoleAPIError else { return true }
  return api.status == 0
}

private func failedOrUnknown(_ error: Error, _ fallback: String) -> TenderOutcome {
  if isLostAnswer(error) { return .unknown(lostAnswer) }
  let message = (error as? ConsoleAPIError)?.message ?? ""
  return .failed(message.isEmpty ? fallback : message, nil)
}

/// What a payment's own status means for the checkout; nil while it is still in progress.
func outcomeOfPayment(_ answer: PosPaymentAnswer) -> TenderOutcome? {
  guard let payment = answer.payment else { return nil }
  switch payment.status {
  case "succeeded": return .settled(answer, payment)
  case "canceled": return .canceled(answer)
  case "failed":
    let message = payment.failureMessage ?? ""
    return .failed(message.isEmpty ? "The card was declined." : message, answer)
  default: return nil
  }
}

/// The open sale a tender is taken against.
struct TenderDeps: Sendable {
  let api: PosSaleAPI
  let orderID: String
  var sleep: @Sendable (Int) async -> Void = { ms in try? await Task.sleep(for: .milliseconds(ms)) }
}

/// Re-reads one card payment through the server until it settles or fails.
/// A collected card is usually recorded at the first read; the retries
/// cover the moment between the reader's answer and Stripe's.
func settleCardPayment(_ deps: TenderDeps, _ paymentID: String, attempts: Int = 5) async -> TenderOutcome {
  for attempt in 0..<attempts {
    let answer: PosPaymentAnswer
    do {
      answer = try await deps.api.payment(orderID: deps.orderID, step: .status(paymentID: paymentID))
    } catch {
      if attempt == attempts - 1 { return failedOrUnknown(error, "The payment could not be confirmed.") }
      await deps.sleep(1_000)
      continue
    }
    if let outcome = outcomeOfPayment(answer) { return outcome }
    await deps.sleep(1_000 * (attempt + 1))
  }
  return .unknown("The card was read, but the payment is not confirmed yet. Check the sale in a moment.")
}

/// Stops a card payment nobody was charged for, so the balance is open again.
func cancelCardPayment(_ deps: TenderDeps, _ paymentID: String) async -> PosPaymentAnswer? {
  try? await deps.api.payment(orderID: deps.orderID, step: .cancel(paymentID: paymentID))
}

enum CardReaderKind: Equatable { case smart, device, simulated }

/// The register's card payment layer: one card tender, start to outcome, on
/// whichever reader the cashier picked: a smart reader the server drives,
/// or this device's own reader (the Stripe Terminal SDK, or the simulated
/// reader for tests and training).
@MainActor
protocol CardReaderService: AnyObject {
  var id: String { get }
  var label: String { get }
  var kind: CardReaderKind { get }
  /// What the reader asks for right now, while the customer is at it.
  var prompt: String? { get }
  /// Takes `amountCents` plus `tipCents` by card. `onWaiting` fires once the
  /// customer is at the reader, with the payment the server opened.
  func charge(
    _ deps: TenderDeps, amountCents: Int, tipCents: Int, attemptKey: String,
    onWaiting: @escaping @MainActor (String?) -> Void
  ) async -> TenderOutcome
  /// Stops the payment in flight; nobody is charged.
  func cancel(_ deps: TenderDeps, paymentID: String?) async
}

/// A smart reader on the counter: the server pushes the intent to it and reads the result.
@MainActor
final class SmartReaderService: CardReaderService {
  let reader: PosSmartReader
  private let pollMilliseconds: Int
  /// How long the customer has at the reader before the register asks to check the sale.
  private let maxPolls: Int

  init(_ reader: PosSmartReader, pollMilliseconds: Int = 2_000, maxPolls: Int = 90) {
    self.reader = reader
    self.pollMilliseconds = pollMilliseconds
    self.maxPolls = maxPolls
  }

  var id: String { reader.id }
  var label: String { reader.label }
  var kind: CardReaderKind { .smart }

  func charge(
    _ deps: TenderDeps, amountCents: Int, tipCents: Int, attemptKey: String,
    onWaiting: @escaping @MainActor (String?) -> Void
  ) async -> TenderOutcome {
    let started: PosPaymentAnswer
    do {
      started = try await deps.api.payment(
        orderID: deps.orderID, step: .cardPresent(readerID: reader.id, amountCents: amountCents, tipCents: tipCents),
        attemptKey: attemptKey)
    } catch {
      return failedOrUnknown(error, "The card reader could not start the payment.")
    }
    if let outcome = outcomeOfPayment(started) { return outcome }
    guard let payment = started.payment else {
      return .failed("The card reader could not start the payment.", started)
    }
    onWaiting(payment.id)
    for _ in 0..<maxPolls {
      await deps.sleep(pollMilliseconds)
      if Task.isCancelled { break }
      if let outcome = await poll(deps, payment.id) { return outcome }
    }
    return .unknown("The reader has not answered yet. Check the sale before taking payment again.")
  }

  /// One read of the payment; nil while the customer is still at the reader.
  func poll(_ deps: TenderDeps, _ paymentID: String) async -> TenderOutcome? {
    do {
      return outcomeOfPayment(try await deps.api.payment(orderID: deps.orderID, step: .status(paymentID: paymentID)))
    } catch {
      return isLostAnswer(error) ? nil : failedOrUnknown(error, "The payment could not be read.")
    }
  }

  func cancel(_ deps: TenderDeps, paymentID: String?) async {
    if let paymentID { _ = await cancelCardPayment(deps, paymentID) }
  }
}

extension CardReaderService {
  var prompt: String? { nil }
}

/// This device's own reader: the server makes the intent (`card-present-sdk`),
/// the collector takes the card, the server records it (`status`). Before
/// the card is asked for, the answer is checked: the client secret must name
/// the same intent, and the amount must be the amount plus the tip the
/// register asked for, so a mismatched intent is never collected.
@MainActor
final class DeviceReaderService: CardReaderService {
  let collector: CardCollector

  init(_ collector: CardCollector) { self.collector = collector }

  var id: String { "device" }
  var label: String {
    if case .connected(let label, _, _) = collector.state { return label }
    return "This device"
  }
  var kind: CardReaderKind {
    if case .connected(_, .simulated, _) = collector.state { return .simulated }
    return .device
  }
  var prompt: String? { collector.prompt }

  func charge(
    _ deps: TenderDeps, amountCents: Int, tipCents: Int, attemptKey: String,
    onWaiting: @escaping @MainActor (String?) -> Void
  ) async -> TenderOutcome {
    let started: PosPaymentAnswer
    do {
      started = try await deps.api.payment(
        orderID: deps.orderID, step: .cardPresentSDK(amountCents: amountCents, tipCents: tipCents),
        attemptKey: attemptKey)
    } catch {
      return failedOrUnknown(error, "The card payment could not be started.")
    }
    // A retried press whose first attempt already settled or failed.
    if let already = outcomeOfPayment(started) {
      if case .canceled = already {} else { return already }
    }
    guard let payment = started.payment, let secret = started.clientSecret, let intent = started.paymentIntentID else {
      return .failed(started.payment?.failureMessage ?? "The card payment could not be started.", started)
    }
    let request = CardCollectRequest(
      paymentIntentID: intent, clientSecret: secret, amountCents: payment.amountCents + payment.tipCents)
    let problem =
      request.problem
      ?? (payment.amountCents + payment.tipCents != amountCents + tipCents
        ? "The amount to charge does not match the register. Start the payment again." : nil)
    if let problem {
      return .failed(problem, await cancelCardPayment(deps, payment.id) ?? started)
    }
    onWaiting(payment.id)
    switch await collector.collect(request) {
    case .canceled:
      return .canceled(await cancelCardPayment(deps, payment.id) ?? started)
    case .failed(_, let message, _):
      // The intent stays open on the server; releasing it lets the cashier
      // try another card or another tender.
      return .failed(message, await cancelCardPayment(deps, payment.id) ?? started)
    case .collected:
      return await settleCardPayment(deps, payment.id)
    }
  }

  func cancel(_ deps: TenderDeps, paymentID: String?) async {
    await collector.cancel()
    if let paymentID { _ = await cancelCardPayment(deps, paymentID) }
  }
}

/// Cash: the server works out the change from what the customer handed over.
func payCash(_ deps: TenderDeps, tenderedCents: Int, amountCents: Int?, tipCents: Int, attemptKey: String) async
  -> TenderOutcome
{
  do {
    let answer = try await deps.api.payment(
      orderID: deps.orderID, step: .cash(tenderedCents: tenderedCents, tipCents: tipCents, amountCents: amountCents),
      attemptKey: attemptKey)
    return outcomeOfPayment(answer) ?? .settled(answer, answer.payment)
  } catch {
    return failedOrUnknown(error, "The cash payment could not be recorded.")
  }
}

/// A gift card: the server takes the smaller of its balance and what is left to pay.
func payGiftCard(_ deps: TenderDeps, code: String, amountCents: Int?, attemptKey: String) async -> TenderOutcome {
  do {
    let answer = try await deps.api.payment(
      orderID: deps.orderID,
      step: .giftCard(code: code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(), amountCents: amountCents),
      attemptKey: attemptKey)
    return outcomeOfPayment(answer) ?? .settled(answer, answer.payment)
  } catch {
    return failedOrUnknown(error, "The gift card could not be used.")
  }
}

struct TipChoice: Equatable, Identifiable {
  let id: String
  let label: String
  let cents: Int
}

/// The merchant's tip presets on what is being paid, plus no tip.
func tipChoices(_ baseCents: Int, _ percentages: [Double]) -> [TipChoice] {
  [TipChoice(id: "none", label: "No tip", cents: 0)]
    + percentages.map { percent in
      let text = percent == percent.rounded(.down) ? String(Int(percent)) : String(percent)
      return TipChoice(id: "pct-\(text)", label: "\(text)%", cents: posTipFromPercent(baseCents, percent))
    }
}

/// The bills a customer is likely to hand over: exact, then the next $5, $10, $20, $50, $100.
func cashQuickAmounts(_ dueCents: Int) -> [Int] {
  let due = max(0, dueCents)
  guard due > 0 else { return [] }
  var amounts: Set<Int> = [due]
  for step in [500, 1_000, 2_000, 5_000, 10_000] {
    let next = (due + step - 1) / step * step
    if next > due { amounts.insert(next) }
  }
  return Array(amounts.sorted().prefix(5))
}

/// One attempt key per tender press, kept until an answer arrives. Pressing
/// the same tender again after a lost answer reuses the key, so the route
/// finds the payment the first press started; any answer (settled,
/// canceled, failed) retires it, and the next press is a new attempt.
struct AttemptKeys {
  var mint: () -> String = { newAttemptKey() }
  private var current: (tender: String, key: String)?

  init(mint: @escaping () -> String = { newAttemptKey() }) { self.mint = mint }

  /// The key for `tender` (what is being paid, how, and how much).
  mutating func key(for tender: String) -> String {
    if let current, current.tender == tender { return current.key }
    let minted = mint()
    current = (tender, minted)
    return minted
  }

  /// The key still waiting on an answer, if any.
  var pending: String? { current?.key }

  /// An answer arrived: the next press is a new attempt.
  mutating func answered() { current = nil }
}

func newAttemptKey(_ prefix: String = "pos-app") -> String { "\(prefix)-\(UUID().uuidString.lowercased())" }
