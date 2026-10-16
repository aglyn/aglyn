// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * THE ORDER DIALOG'S RULES AND WORDS (AGL-3841): tracking links, the Fulfill
 * items panel, the shipments list, disputes, payment risk, the refund question
 * and the tax line, from the console's pure modules (`tracking-url.ts`,
 * `order-fulfillment.ts`, `commerce-dispute.ts`, `commerce-orders.ts`,
 * `commerce-tax-decision.ts`, `payment-risk.ts`). Ported once; the Kotlin kit's
 * OrderDialogRules.kt is the same port, and both replay the console's answers
 * from function-cases.generated.json.
 */

// MARK: - Carriers and tracking links

private struct TrackingCarrier {
  let id: String
  let label: String
  let aliases: [String]
  let url: (String) -> String
}

/// `TRACKING_CARRIERS`: the carriers with a public tracker, in the console's order.
private let trackingCarriers: [TrackingCarrier] = [
  TrackingCarrier(
    id: "usps", label: "USPS", aliases: ["usps", "unitedstatespostalservice", "uspostalservice", "postalservice"],
    url: { "https://tools.usps.com/go/TrackConfirmAction?tLabels=\($0)" }),
  TrackingCarrier(
    id: "ups", label: "UPS", aliases: ["ups", "unitedparcelservice"], url: { "https://www.ups.com/track?tracknum=\($0)" }),
  TrackingCarrier(
    id: "fedex", label: "FedEx", aliases: ["fedex", "federalexpress"],
    url: { "https://www.fedex.com/fedextrack/?trknbr=\($0)" }),
  TrackingCarrier(
    id: "dhl", label: "DHL", aliases: ["dhl", "dhlexpress", "dhlecommerce"],
    url: { "https://www.dhl.com/global-en/home/tracking.html?tracking-id=\($0)" }),
  TrackingCarrier(
    id: "canada-post", label: "Canada Post", aliases: ["canadapost", "postescanada", "canpost"],
    url: { "https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=\($0)" }),
  TrackingCarrier(
    id: "royal-mail", label: "Royal Mail", aliases: ["royalmail", "parcelforce"],
    url: { "https://www.royalmail.com/track-your-item#/tracking-results/\($0)" }),
  TrackingCarrier(
    id: "australia-post", label: "Australia Post", aliases: ["australiapost", "auspost", "startrack"],
    url: { "https://auspost.com.au/mypost/track/details/\($0)" }),
]

private func squash(_ value: String) -> String {
  String(String.UnicodeScalarView(value.lowercased().unicodeScalars.filter { ("a"..."z").contains($0) || ("0"..."9").contains($0) }))
}

/// The carrier a typed name means (`carrierIdFor`): an alias, else the longest alias the name starts with.
public func carrierIdFor(_ carrier: String?) -> String? {
  let squashed = squash(carrier ?? "")
  if squashed.isEmpty { return nil }
  if let entry = trackingCarriers.first(where: { $0.aliases.contains(squashed) }) { return entry.id }
  // Longest alias first, so "uspostalservice" is tried before "ups"; ties keep the table's order.
  let byLength = trackingCarriers.flatMap { entry in entry.aliases.map { (alias: $0, id: entry.id) } }
    .enumerated().sorted { $0.element.alias.count != $1.element.alias.count ? $0.element.alias.count > $1.element.alias.count : $0.offset < $1.offset }
    .map(\.element)
  return byLength.first { squashed.hasPrefix($0.alias) }?.id
}

/// How a carrier names itself, or what was typed (`carrierLabelFor`).
public func carrierLabelFor(_ carrier: String?) -> String {
  let id = carrierIdFor(carrier)
  return trackingCarriers.first { $0.id == id }?.label ?? (carrier ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
}

/// JavaScript's `encodeURIComponent`.
public func encodeURIComponent(_ value: String) -> String {
  var allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
  allowed.insert(charactersIn: "-_.!~*'()")
  return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
}

/// The carrier's public tracking link for a number (`trackingUrlFor`), whitespace taken out, or nil.
public func trackingUrlFor(_ carrier: String?, _ trackingNumber: String?) -> String? {
  let number = String((trackingNumber ?? "").filter { !$0.isWhitespace })
  if number.isEmpty { return nil }
  let id = carrierIdFor(carrier)
  return trackingCarriers.first { $0.id == id }.map { $0.url(encodeURIComponent(number)) }
}

/// A shipment's tracking link (`fulfillmentTrackingUrl`): the stored https link, else the carrier's.
public func fulfillmentTrackingUrl(carrier: String?, trackingNumber: String?, trackingUrl: String?) -> String? {
  let stored = (trackingUrl ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if stored.range(of: #"^https://[^\s]+$"#, options: [.regularExpression, .caseInsensitive]) != nil { return stored }
  return trackingUrlFor(carrier, trackingNumber)
}

// MARK: - Fulfillment

/// The carrier select's value for a typed carrier (`fulfillmentCarrierChoice`): empty, a named carrier, or Other.
public func fulfillmentCarrierChoice(_ carrier: String?) -> String {
  guard let carrier, !carrier.isEmpty else { return "" }
  let label = carrierLabelFor(carrier)
  let values = ContractValues.shared
  return values.fulfillmentCarrierChoices.contains(label) ? label : values.fulfillmentOtherCarrier
}

/// Whether the order's shipments may still be edited or cancelled (`orderFulfillmentsEditable`).
public func orderFulfillmentsEditable(_ status: OrderStatus?) -> Bool {
  status == .paid || status == .partiallyFulfilled || status == .fulfilled
}

/// "2× Mug, 1× Shirt" (`describeFulfillmentLines`).
public func describeFulfillmentLines(_ order: HostOrder, _ lines: [(lineItemID: Int, quantity: Int)]) -> String {
  let items = order.lineItems ?? []
  return lines.map { entry in
    "\(entry.quantity)× \(items.indices.contains(entry.lineItemID) ? items[entry.lineItemID].name : "line \(entry.lineItemID)")"
  }.joined(separator: ", ")
}

/// The lines one shipment covers, for the shipments list.
public func fulfillmentLines(_ order: HostOrder, _ fulfillment: OrderFulfillment) -> [(lineItemID: Int, quantity: Int)] {
  fulfillmentLineQuantities(order, fulfillment).map { (lineItemID: $0.0, quantity: $0.1) }
}

private let trackingStatusLabels = [
  "pre_transit": "Label created", "in_transit": "In transit", "out_for_delivery": "Out for delivery", "delivered": "Delivered",
  "exception": "Delivery problem", "returned": "Returned to sender",
]

/// The words for a shipment's tracking status (`trackingStatusLabel`).
public func trackingStatusLabel(_ status: String?) -> String {
  guard let status, !status.isEmpty else { return "" }
  return trackingStatusLabels[status] ?? status
}

/// Fulfill items' starting count for each line (`fulfillItemsStartQuantities`).
public func fulfillItemsStartQuantities(_ order: HostOrder) -> [Int] {
  let states = orderLineFulfillmentStates(order)
  let physicalLeft = states.contains { $0.requiresShipping && $0.remainingQuantity > 0 }
  return states.map { physicalLeft ? ($0.requiresShipping ? $0.remainingQuantity : 0) : $0.remainingQuantity }
}

/// The units picked, by line index (`fulfillItemsSelection`).
public func fulfillItemsSelection(_ quantities: [Double]) -> [(lineItemID: Int, quantity: Int)] {
  quantities.enumerated().compactMap { index, quantity in
    let whole = quantity.isFinite ? max(0, Int(quantity.rounded(.down))) : 0
    return whole > 0 ? (lineItemID: index, quantity: whole) : nil
  }
}

/// Whether the picked units are everything still to ship (`fulfillItemsIsEverything`).
public func fulfillItemsIsEverything(_ order: HostOrder, _ selection: [(lineItemID: Int, quantity: Int)]) -> Bool {
  let remaining = remainingFulfillmentLines(order)
  return !remaining.isEmpty && remaining.count == selection.count
    && zip(remaining, selection).allSatisfy { $0.lineItemID == $1.lineItemID && $0.remainingQuantity == $1.quantity }
}

/// How many minor units a currency has (`currencyMinorDigits`): 2 for USD, 0 for JPY, 2 for a code it does not know.
public func currencyMinorDigits(_ currency: String?) -> Int {
  let code = (currency?.isEmpty == false ? currency! : "USD").uppercased()
  return currencyDigits(code) ?? 2
}

/// What was typed in Shipping cost, read in the store's currency (`parseShippingCostInput`).
public enum ShippingCostInput: Equatable, Sendable {
  /// Whole minor units; nil when the field was left empty (not known, which is not 0).
  case cents(Int?)
  case error(String)
}

public func parseShippingCostInput(_ input: String, currency: String?) -> ShippingCostInput {
  let digits = currencyMinorDigits(currency)
  let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty { return .cents(nil) }
  // `.replace(/^[^\d.-]+/, '')`, then the thousands commas out.
  var cleaned = Substring(trimmed)
  while let first = cleaned.unicodeScalars.first, !("0"..."9").contains(first), first != ".", first != "-" {
    cleaned = cleaned.dropFirst()
  }
  let text = cleaned.replacingOccurrences(of: ",", with: "")
  if text.hasPrefix("-") { return .error("Shipping cost cannot be negative") }
  let pattern = digits > 0 ? "^[0-9]*(\\.[0-9]{0,\(digits)})?$" : "^[0-9]+$"
  if text.isEmpty || text == "." || text.range(of: pattern, options: .regularExpression) == nil {
    return .error(digits > 0 ? "Enter an amount like 8.45" : "Enter a whole amount, like 850")
  }
  let parts = text.split(separator: ".", omittingEmptySubsequences: false)
  let whole = Double(parts[0].isEmpty ? "0" : String(parts[0])) ?? 0
  let fraction = parts.count > 1 ? String(parts[1]) : ""
  let padded = fraction.padding(toLength: digits, withPad: "0", startingAt: 0)
  let cents = whole * pow(10, Double(digits)) + (Double(padded.isEmpty ? "0" : padded) ?? 0)
  if cents > Double(ContractValues.shared.shippingCostMaxCents) { return .error("Shipping cost is too large") }
  return .cents(Int(cents))
}

// MARK: - Disputes

/// Whether the order has a dispute still running (`orderHasOpenDispute`).
public func orderHasOpenDispute(_ order: HostOrder) -> Bool { isOrderDisputeOpen(order.dispute) }

/// The dispute chip (`describeOrderDispute`): its tone, label and sentence, and while open the evidence deadline.
public struct OrderDisputeBadge: Equatable, Sendable {
  /// `open`, `lost`, `won` or `settled`.
  public let tone: String
  public let label: String
  public let detail: String
  public let evidenceDueByMs: Int64?
  public let evidenceDaysLeft: Int?
}

private func isoDay(_ ms: Double) -> String {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = TimeZone(identifier: "UTC")
  formatter.dateFormat = "yyyy-MM-dd"
  return formatter.string(from: Date(timeIntervalSince1970: ms / 1000))
}

private func disputeUsd(_ cents: Double) -> String { String(format: "$%.2f", max(0, cents) / 100) }

private func humanReason(_ reason: String?) -> String {
  (reason ?? "").replacingOccurrences(of: "_", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
}

/// Whole days to `dueByMs`, rounded up as `Math.ceil` does.
private func daysLeft(_ dueByMs: Double, _ nowMs: Double) -> Int { Int(((dueByMs - nowMs) / 86_400_000).rounded(.up)) }

public func describeOrderDispute(_ order: HostOrder, nowMs: Double = Date().timeIntervalSince1970 * 1000) -> OrderDisputeBadge? {
  guard let dispute = order.dispute else { return nil }
  let reason = humanReason(dispute.reason)
  let because = reason.isEmpty ? "" : " (\(reason))"
  if isOrderDisputeOpen(dispute) {
    let dueBy = dispute.evidenceDueByMs ?? 0
    let left = dueBy > 0 ? daysLeft(dueBy, nowMs) : nil
    var detail = "\(disputeUsd(dispute.amountCents)) disputed\(because), opened \(isoDay(dispute.openedAtMs)). "
    if dueBy > 0 {
      detail += "Evidence is due to Stripe by \(isoDay(dueBy))"
      if let left, left >= 0 {
        detail += " — \(left) day\(left == 1 ? "" : "s") left."
      } else {
        detail += " — that deadline has passed."
      }
    } else {
      detail += "Respond in the Stripe dashboard while the case is open."
    }
    return OrderDisputeBadge(
      tone: "open", label: "Chargeback open", detail: detail, evidenceDueByMs: dueBy > 0 ? Int64(dueBy) : nil,
      evidenceDaysLeft: dueBy > 0 ? left : nil)
  }
  let outcome = dispute.outcome ?? dispute.status
  let closed = (dispute.closedAtMs ?? 0) != 0 ? " on \(isoDay(dispute.closedAtMs ?? 0))" : ""
  if outcome == "lost" {
    let reversed = dispute.reversedCents ?? 0
    return OrderDisputeBadge(
      tone: "lost", label: "Charged back",
      detail: "Dispute lost\(closed). \(disputeUsd(reversed)) was taken back\(because)"
        + (reversed < dispute.amountCents
          ? " (of \(disputeUsd(dispute.amountCents)) disputed — the rest was already refunded)." : "."),
      evidenceDueByMs: nil, evidenceDaysLeft: nil)
  }
  if outcome == "won" {
    return OrderDisputeBadge(
      tone: "won", label: "Dispute won", detail: "Dispute won\(closed)\(because) — no money was reversed.", evidenceDueByMs: nil,
      evidenceDaysLeft: nil)
  }
  return OrderDisputeBadge(
    tone: "settled", label: "Dispute closed",
    detail: "Dispute closed\(closed)\(because)" + (outcome.isEmpty ? "" : " as \(humanReason(outcome))") + " — no money was reversed.",
    evidenceDueByMs: nil, evidenceDaysLeft: nil)
}

/// The open disputes across orders (`summariseOpenDisputes`), for the orders list's warning.
public struct OpenDisputeSummary: Equatable, Sendable {
  public let count: Int
  public let soonestDueByMs: Int64?
  public let soonestDaysLeft: Int?
  public let overdue: Bool

  public init(count: Int, soonestDueByMs: Int64? = nil, soonestDaysLeft: Int? = nil, overdue: Bool = false) {
    self.count = count
    self.soonestDueByMs = soonestDueByMs
    self.soonestDaysLeft = soonestDaysLeft
    self.overdue = overdue
  }
}

public func summariseOpenDisputes(_ orders: [HostOrder], nowMs: Double = Date().timeIntervalSince1970 * 1000) -> OpenDisputeSummary {
  var count = 0
  var soonest: Double?
  for order in orders where orderHasOpenDispute(order) {
    count += 1
    let dueBy = order.dispute?.evidenceDueByMs ?? 0
    if dueBy > 0, soonest == nil || dueBy < soonest! { soonest = dueBy }
  }
  guard let soonest else { return OpenDisputeSummary(count: count, soonestDueByMs: nil, soonestDaysLeft: nil, overdue: false) }
  return OpenDisputeSummary(
    count: count, soonestDueByMs: Int64(soonest), soonestDaysLeft: daysLeft(soonest, nowMs), overdue: soonest < nowMs)
}

/// What the merchant refunded and what a lost chargeback took (`splitOrderReversal`).
public func splitOrderReversal(_ order: HostOrder) -> (refundedCents: Int, chargedBackCents: Int) {
  let total = max(0, Int((order.refundedCents ?? 0).rounded()))
  let chargedBack = min(total, max(0, Int((order.dispute?.reversedCents ?? 0).rounded())))
  return (total - chargedBack, chargedBack)
}

// MARK: - Refunds

/// Whether a line's goods were taken back (`orderLineRefunded`).
public func orderLineRefunded(_ order: HostOrder, _ lineIndex: Int) -> Bool {
  (order.refundedLineItemIds ?? []).contains { Int($0) == lineIndex }
}

/// What refunding these lines returns (`orderLineRefundCents`): each line's share of the discount taken off its value.
public func orderLineRefundCents(_ order: HostOrder, _ lineIndexes: [Int]) -> Int {
  let lines = order.lineItems ?? []
  let gross = lines.map { line in max(0, wholeCents(line.unitAmountCents) * max(1, wholeCents(line.quantity))) }
  let shares = apportionCents(gross, totalCents: max(0, wholeCents(order.totals?.discountCents ?? 0)))
  var cents = 0
  for index in Set(lineIndexes) where index >= 0 && index < lines.count { cents += gross[index] - shares[index] }
  return max(0, cents)
}

private func dialogUsd(_ cents: Double) -> String { String(format: "$%.2f", cents / 100) }

/// The order dialog's refund question (`orderRefundPrompt`): the whole order or the named lines.
public func orderRefundPrompt(_ order: HostOrder, lineItemIDs: [Int] = []) -> (title: String, text: String) {
  let lines = order.lineItems ?? []
  let scoped = !lineItemIDs.isEmpty
  var text: String
  if scoped {
    let names = lineItemIDs.map { lines.indices.contains($0) ? lines[$0].name : "line \($0)" }.joined(separator: ", ")
    text =
      "Refunds \(dialogUsd(Double(orderLineRefundCents(order, lineItemIDs)))) for \(names) through Stripe, and withdraws that line's "
      + "downloads, license keys and gated content. A license key already sent to the buyer is retired, not returned to your pool "
      + "— they still hold the string, so reissuing it would give two people one working key."
  } else {
    text = "Refunds \(dialogUsd((order.totals?.totalCents ?? order.amountCents ?? 0) - (order.refundedCents ?? 0))) to the buyer through Stripe."
  }
  if orderHasOpenDispute(order), !orderDisputeBlocksRefund(order) {
    text += " An inquiry is open on this charge — a full refund resolves it before it can become a chargeback."
  }
  return (scoped ? "Refund this line?" : "Refund this order?", text)
}

// MARK: - Tax and payment risk

/// How the order's tax was calculated (`describeOrderTaxMode`); an absent mode is "not recorded", never "no tax".
public func describeOrderTaxMode(_ mode: String?) -> String {
  switch mode {
  case "stripe-automatic": "Calculated automatically by Stripe Tax at checkout, from the shopper’s address."
  case "manual": "Calculated from this store’s own configured tax rate."
  case "none": "No sales tax was calculated on this order."
  default: "How this tax was calculated was not recorded on this order."
  }
}

private let paymentRiskLabels = ["early-fraud-warning": "Fraud warning", "radar-review": "Held for review", "dispute": "Chargeback"]
private let paymentRiskAdvice = [
  "early-fraud-warning":
    "The card issuer reported this payment as possibly fraudulent. It is not a chargeback yet; refunding it in Stripe now usually prevents one. Hold anything not yet shipped or delivered until you are sure.",
  "radar-review": "Stripe Radar is holding this payment for review. Approve or refund it in Stripe; it stays held until you do.",
  "dispute": "The cardholder disputed this payment. Respond in Stripe with your evidence before the deadline, or accept it.",
]

/// The payment-risk chip for the latest signal (`describePaymentRisk`), always saying nothing was refunded.
public func describePaymentRisk(_ risk: PaymentRisk?) -> (label: String, detail: String)? {
  guard let latest = risk?.signals.last else { return nil }
  let kind = latest.kind.rawValue
  let outcome = latest.outcome.map { " (\($0.replacingOccurrences(of: "_", with: " ")))" } ?? ""
  let why = latest.detail.map { " Stripe says: \($0.replacingOccurrences(of: "_", with: " "))." } ?? ""
  return ("\(paymentRiskLabels[kind] ?? kind)\(outcome)", "\(paymentRiskAdvice[kind] ?? "")\(why) \(ContractValues.shared.nothingMoved)")
}
