// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The bookings plugin's pure rules, ported once from its model
// (booking-manage.ts, booking-price.ts, booking-in-person.ts,
// booking-service-form.ts) and held to the console's own answers by the
// function cases: a screen offers only what the route would then do, and a
// service editor stores exactly what the console's dialog stores.

private func jsRound(_ value: Double) -> Int { Int((value + 0.5).rounded(.down)) }

private func finite(_ value: Double?) -> Double { value.flatMap { $0.isFinite ? $0 : nil } ?? 0 }

/// A JavaScript `Number(value)`: numbers as they are, numeric text read, anything else NaN.
func jsNumber(_ value: Any?) -> Double {
  switch value {
  case nil, is NSNull: return 0
  case let number as NSNumber:
    return CFGetTypeID(number) == CFBooleanGetTypeID() ? (number.boolValue ? 1 : 0) : number.doubleValue
  case let number as Double: return number
  case let number as Int: return Double(number)
  case let flag as Bool: return flag ? 1 : 0
  case let text as String:
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? 0 : Double(trimmed) ?? .nan
  default: return .nan
  }
}

/// The booking's state as a reader should treat it: a lapsed payment hold is `expired`.
public func bookingState(_ booking: ManagedBooking, nowMs: Int) -> BookingState {
  switch booking.status {
  case "canceled": .canceled
  case "pendingPayment": finite(booking.expiresAtMs) < Double(nowMs) ? .expired : .pendingPayment
  default: .confirmed
  }
}

/// The label the console shows for a state (`BOOKING_STATE_LABELS`).
public func bookingStateLabel(_ state: BookingState) -> String {
  ContractValues.shared.bookingStateLabels[state.rawValue] ?? state.rawValue
}

/// The paid amount not yet refunded, in cents.
public func bookingOutstandingCents(_ booking: ManagedBooking) -> Int {
  max(0, max(0, jsRound(finite(booking.paidAmountCents))) - max(0, jsRound(finite(booking.refundedCents))))
}

/// What may be done to a booking now (`bookingActions`).
public func bookingActions(_ booking: ManagedBooking, nowMs: Int) -> BookingActions {
  let state = bookingState(booking, nowMs: nowMs)
  let confirmed = state == .confirmed
  let checkedIn = finite(booking.checkedInAtMs) > 0
  let ended = finite(booking.endsAtMs) <= Double(nowMs)
  return BookingActions(
    cancel: state != .canceled && !checkedIn, checkIn: confirmed && !checkedIn,
    refundCents: bookingOutstandingCents(booking), reschedule: confirmed && !checkedIn && !ended,
    undoCheckIn: confirmed && checkedIn)
}

/// Why a check-in (or its undo) cannot be written, or nil: the route's own refusal.
public func checkInRefusal(_ booking: ManagedBooking, checkedIn: Bool, nowMs: Int) -> String? {
  let state = bookingState(booking, nowMs: nowMs)
  if state == .canceled { return "This booking was canceled" }
  if state != .confirmed { return "This booking is not paid yet" }
  return checkedIn || finite(booking.checkedInAtMs) > 0 ? nil : "This guest is not checked in"
}

/// Why a booking cannot move to `startsAtMs`, or nil. The slot itself is checked apart.
public func rescheduleRefusal(_ booking: ManagedBooking, startsAtMs: Int, nowMs: Int) -> String? {
  let state = bookingState(booking, nowMs: nowMs)
  if state == .canceled { return "This booking was canceled" }
  if state != .confirmed { return "This booking is not paid yet" }
  if finite(booking.checkedInAtMs) > 0 { return "This guest is already checked in" }
  if finite(booking.endsAtMs) <= Double(nowMs) { return "This booking has already ended" }
  if startsAtMs <= nowMs { return "Pick a time that has not passed" }
  return nil
}

/// The booking's length, kept when it moves.
public func bookingDurationMs(_ booking: ManagedBooking, fallbackMinutes: Double) -> Int {
  let stored = finite(booking.endsAtMs) - finite(booking.startsAtMs)
  if stored > 0 { return Int(stored) }
  let minutes = fallbackMinutes.isFinite && fallbackMinutes != 0 ? fallbackMinutes : 30
  return max(5, jsRound(minutes)) * 60_000
}

/// A stored price label as one of the four; anything unrecognized is `fixed`.
public func bookingPriceDisplay(_ value: Any?) -> BookingPriceDisplay {
  switch value as? String {
  case "varies": .varies
  case "estimate": .estimate
  case "contact": .contact
  default: .fixed
  }
}

/// What booking the service charges, in dollars: its price when it states one, else 0.
public func bookingChargeUsd(priceUsd: Any?, priceDisplay: Any?) -> Double {
  guard bookingPriceDisplay(priceDisplay) == .fixed else { return 0 }
  let price = jsNumber(priceUsd)
  return price.isFinite && price > 0 ? price : 0
}

/// The price as a visitor reads it: `$120`, `Free`, or the service's label.
public func bookingPriceText(priceUsd: Any?, priceDisplay: Any?) -> String {
  let display = bookingPriceDisplay(priceDisplay)
  if display != .fixed { return ContractValues.shared.bookingPriceLabels[display.rawValue] ?? display.rawValue }
  let charge = bookingChargeUsd(priceUsd: priceUsd, priceDisplay: priceDisplay)
  return charge > 0 ? "$\(jsNumberText(charge))" : "Free"
}

/// A stored ask as one of the three; anything else is `off`.
public func bookingFieldAsk(_ value: Any?) -> BookingFieldAsk {
  switch value as? String {
  case "optional": .optional
  case "required": .required
  default: .off
  }
}

// MARK: The service dialog (booking-service-form.ts)

/// "09:00-12:00, 13:00-17:00" → open intervals in minutes; anything unreadable is skipped.
public func parseBookingWindows(_ input: String) -> [BookingWindow] {
  input.split(separator: ",", omittingEmptySubsequences: false).compactMap { chunk in
    let text = chunk.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let match = text.wholeMatch(of: #/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/#) else { return nil }
    let start = Int(match.1)! * 60 + Int(match.2)!
    let end = Int(match.3)! * 60 + Int(match.4)!
    return end > start && end <= 24 * 60 ? BookingWindow(end: end, start: start) : nil
  }
}

/// Open intervals → "09:00-12:00, 13:00-17:00".
public func formatBookingWindows(_ windows: [BookingWindow]?) -> String {
  func pad(_ minutes: Int) -> String { String(format: "%02d:%02d", minutes / 60, minutes % 60) }
  return (windows ?? []).map { "\(pad($0.start))-\(pad($0.end))" }.joined(separator: ", ")
}

/// A new service's dialog: thirty minutes, free, open nine to five on weekdays.
public func newBookingServiceDraft(timeZone: String) -> BookingServiceDraft {
  BookingServiceDraft(
    askAddress: .off, askPhone: .off, crmFollowUpTask: false, crmMeetingActivity: true, description: "",
    durationMinutes: "30", name: "", priceDisplay: .fixed, priceUsd: "0", timezone: timeZone.isEmpty ? "UTC" : timeZone,
    windowText: (0...6).map { (1...5).contains($0) ? "09:00-17:00" : "" })
}

private func text(_ value: Any?) -> String {
  switch value {
  case let text as String: return text
  case let number as NSNumber where CFGetTypeID(number) != CFBooleanGetTypeID(): return jsNumberText(number.doubleValue)
  case let number as Double: return jsNumberText(number)
  case let number as Int: return String(number)
  case nil: return ""
  default: return "\(value!)"
  }
}

/// The dialog seeded from a stored service (its Firestore fields).
public func bookingServiceDraftFrom(_ service: [String: Any]) -> BookingServiceDraft {
  let windows = service["windows"] as? [String: Any]
  func bool(_ key: String) -> Bool? {
    if let number = service[key] as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue }
    return service[key] as? Bool
  }
  return BookingServiceDraft(
    askAddress: bookingFieldAsk(service["askAddress"]), askPhone: bookingFieldAsk(service["askPhone"]),
    crmFollowUpTask: bool("crmFollowUpTask") == true, crmMeetingActivity: bool("crmMeetingActivity") != false,
    description: service["description"] as? String ?? "",
    durationMinutes: text(service["durationMinutes"] ?? 30), name: service["name"] as? String ?? "",
    priceDisplay: bookingPriceDisplay(service["priceDisplay"]), priceUsd: text(service["priceUsd"] ?? 0),
    timezone: service["timezone"] as? String ?? "UTC",
    windowText: (0...6).map { day in
      let list = windows?[String(day)] as? [[String: Any]]
      return formatBookingWindows(
        list?.compactMap { window in
          guard let start = (window["start"] as? NSNumber)?.intValue, let end = (window["end"] as? NSNumber)?.intValue
          else { return nil }
          return BookingWindow(end: end, start: start)
        })
    })
}

/// Why the dialog cannot save, or nil.
public func bookingServiceDraftProblem(name: String) -> String? {
  name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "A service needs a name." : nil
}

/// What one save stores: every editable key, all seven weekdays, written explicitly.
public func bookingServiceFields(_ draft: BookingServiceDraft) -> BookingServiceFields {
  var duration = jsNumber(draft.durationMinutes)
  if duration.isNaN || duration == 0 { duration = 30 }
  var price = jsNumber(draft.priceUsd)
  if price.isNaN { price = 0 }
  let values = ContractValues.shared
  let trimmedName = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
  let trimmedDescription = draft.description.trimmingCharacters(in: .whitespacesAndNewlines)
  let zone = draft.timezone.trimmingCharacters(in: .whitespacesAndNewlines)
  return BookingServiceFields(
    askAddress: draft.askAddress, askPhone: draft.askPhone, crmFollowUpTask: draft.crmFollowUpTask,
    crmMeetingActivity: draft.crmMeetingActivity,
    description: String(trimmedDescription.utf16.prefix(values.bookingServiceDescriptionMax)) ?? "",
    durationMinutes: max(5, min(480, jsRound(duration))),
    name: String(trimmedName.utf16.prefix(values.bookingServiceNameMax)) ?? "",
    priceDisplay: draft.priceDisplay, priceUsd: max(0, jsRound(price)), timezone: zone.isEmpty ? "UTC" : zone,
    windows: Dictionary(uniqueKeysWithValues: (0...6).map { day in
      (String(day), parseBookingWindows(day < draft.windowText.count ? draft.windowText[day] : ""))
    }))
}

/// The Firestore fields a save writes, from the dialog's answer.
public func bookingServiceFirestoreFields(_ fields: BookingServiceFields) -> [String: Any] {
  [
    "name": fields.name, "durationMinutes": fields.durationMinutes, "priceUsd": fields.priceUsd,
    "timezone": fields.timezone, "description": fields.description,
    "windows": fields.windows.mapValues { $0.map { ["start": $0.start, "end": $0.end] } },
    "crmMeetingActivity": fields.crmMeetingActivity, "crmFollowUpTask": fields.crmFollowUpTask,
    "askPhone": fields.askPhone.rawValue, "askAddress": fields.askAddress.rawValue,
    "priceDisplay": fields.priceDisplay.rawValue,
  ]
}

// MARK: Payment at the counter (booking-in-person.ts)

/// Nil when `serviceCents` is an amount staff may charge; otherwise why not.
public func bookingInPersonAmountProblem(_ serviceCents: Int?) -> String? {
  guard let serviceCents else { return "Enter the amount to charge." }
  if serviceCents < ContractValues.shared.bookingInPersonMinCents { return "Card payments start at $0.50." }
  if serviceCents > ContractValues.shared.bookingInPersonMaxCents { return "Charge at most $10,000 at a time." }
  return nil
}

/// The amount to suggest: the service's fixed price, when it has one.
public func bookingSuggestedCents(priceUsd: Any?, priceDisplay: Any?) -> Int? {
  if let display = priceDisplay as? String, !display.isEmpty, display != "fixed" { return nil }
  let cents = jsNumber(priceUsd) * 100
  guard cents.isFinite else { return nil }
  let rounded = jsRound(cents)
  return rounded >= ContractValues.shared.bookingInPersonMinCents ? rounded : nil
}

/// Where a booking stands for payment at the counter (`bookingInPersonState`).
public func bookingInPersonState(_ booking: [String: Any], nowMs: Int) -> BookingInPersonState {
  let inPerson = booking["inPersonPayment"] as? [String: Any]
  let paidCents = jsNumber(booking["paidAmountCents"])
  let paid =
    jsRound(paidCents.isNaN ? 0 : paidCents) > 0 || !((booking["paymentIntentId"] as? String) ?? "").isEmpty
    || inPerson?["status"] as? String == "paid"
  if paid { return .paid }
  if booking["status"] as? String == "canceled" { return .canceled }
  if booking["status"] as? String == "pendingPayment" {
    let expires = jsNumber(booking["expiresAtMs"])
    return (expires.isNaN ? 0 : expires) < Double(nowMs) ? .canceled : .awaitingOnline
  }
  if inPerson?["status"] as? String == "pending" { return .collecting }
  return .payable
}

/// The fields the manage rules read, from a booking document.
public func managedBooking(_ data: [String: Any]) -> ManagedBooking {
  func number(_ key: String) -> Double? { (data[key] as? NSNumber)?.doubleValue }
  return ManagedBooking(
    checkedInAtMs: number("checkedInAtMs"), endsAtMs: number("endsAtMs"), expiresAtMs: number("expiresAtMs"),
    paidAmountCents: number("paidAmountCents"), refundedCents: number("refundedCents"),
    startsAtMs: number("startsAtMs"), status: data["status"] as? String)
}

/// Whether this reminder pass would mail `booking` (its Firestore fields): the console card's count.
public func isBookingReminderDue(_ booking: [String: Any], nowMs: Int) -> Bool {
  let raw = jsNumber(booking["startsAtMs"])
  let starts = raw.isNaN ? 0 : raw
  let hour = 3_600_000.0
  let sentValue = booking["reminderSentAt"]
  let sent: Bool =
    switch sentValue {
    case nil, is NSNull: false
    case let text as String: !text.isEmpty
    case let number as NSNumber: number.doubleValue != 0
    default: true
    }
  let values = ContractValues.shared
  return booking["status"] as? String != "canceled" && !sent && !((booking["email"] as? String) ?? "").isEmpty
    && starts >= Double(nowMs) + Double(values.reminderWindowStartHours) * hour
    && starts <= Double(nowMs) + Double(values.reminderWindowEndHours) * hour
}
