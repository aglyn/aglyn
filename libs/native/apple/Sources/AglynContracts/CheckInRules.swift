// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * Check-in at the window (AGL-4043): who is due on a day, who has checked in, and rain checks, as the console's
 * commerce-check-in.ts and commerce-check-in-product.ts word them. The day helpers replay the console's recorded cases;
 * the row labels are hand-ported from commerce-check-in.ts and held to its spec's answers. The route
 * (`POS_CHECK_IN_ROUTE`) does every write and reads the day. The Kotlin kit's CheckInRules.kt.
 */

private func dayKeyParts(_ value: Any?) -> (year: Int, month: Int, day: Int)? {
  guard let text = value as? String, text.count == 10 else { return nil }
  let chars = Array(text)
  guard chars[4] == "-", chars[7] == "-",
    let year = Int(String(chars[0..<4])), let month = Int(String(chars[5..<7])), let day = Int(String(chars[8..<10])),
    chars[0..<4].allSatisfy(\.isNumber), chars[5..<7].allSatisfy(\.isNumber), chars[8..<10].allSatisfy(\.isNumber)
  else { return nil }
  guard (1...12).contains(month), day >= 1 else { return nil }
  let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
  let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return day <= days ? (year, month, day) : nil
}

/// Days since 1970-01-01 for a proleptic Gregorian date.
private func epochDay(_ year: Int, _ month: Int, _ day: Int) -> Int {
  let y = month <= 2 ? year - 1 : year
  let era = (y >= 0 ? y : y - 399) / 400
  let yoe = y - era * 400
  let mp = (month + 9) % 12
  let doy = (153 * mp + 2) / 5 + day - 1
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
  return era * 146_097 + doe - 719_468
}

private func dayKey(epochDay days: Int) -> String {
  let z = days + 719_468
  let era = (z >= 0 ? z : z - 146_096) / 146_097
  let doe = z - era * 146_097
  let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  let mp = (5 * doy + 2) / 153
  let day = doy - (153 * mp + 2) / 5 + 1
  let month = mp < 10 ? mp + 3 : mp - 9
  let year = yoe + era * 400 + (month <= 2 ? 1 : 0)
  return String(format: "%04d-%02d-%02d", year, month, day)
}

/// Whether a value is a real calendar day written `YYYY-MM-DD` (`isCheckInDayKey`).
public func isCheckInDayKey(_ value: Any?) -> Bool { dayKeyParts(value) != nil }

/// The day key `days` after (or before) another (`addCheckInDays`).
public func addCheckInDays(_ key: String, _ days: Double) -> String {
  guard let parts = dayKeyParts(key) else { return key }
  return dayKey(epochDay: epochDay(parts.year, parts.month, parts.day) + Int((days + 0.5).rounded(.down)))
}

private let checkInWeekdays = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"]
private let checkInMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/// A day as the window reads it: "Sat, Nov 1" (`checkInDayLabel`).
public func checkInDayLabel(_ key: String?) -> String {
  guard let parts = dayKeyParts(key) else { return "" }
  let days = epochDay(parts.year, parts.month, parts.day)
  return "\(checkInWeekdays[((days % 7) + 7) % 7]), \(checkInMonths[parts.month - 1]) \(parts.day)"
}

/// A day key as a date a reader says: "Oct 25, 2026"; "" for a value that is not a day key. The day helpers' month
/// names, so a day reads the same wherever a screen shows one.
public func dayKeyDateLabel(_ key: String?) -> String {
  guard let parts = dayKeyParts(key) else { return "" }
  return "\(checkInMonths[parts.month - 1]) \(parts.day), \(parts.year)"
}

/// Why a chosen use day can't be had, or nil (`checkInUseDayProblem`).
public func checkInUseDayProblem(_ value: Any?, todayKey: String) -> String? {
  guard isCheckInDayKey(value), let day = value as? String else { return "Choose the day as a date." }
  if day < todayKey { return "That day has passed. Choose today or a later day." }
  if day > addCheckInDays(todayKey, Double(ContractValues.shared.checkInUseDayMaxAheadDays)) {
    return "Choose a day within the next two years."
  }
  return nil
}

// MARK: The product and variant setting (commerce-check-in-product.ts), for the product editor

/// JavaScript's `Number(value)` for a stored or typed headcount: a number as it is, text read, a true/false or blank as
/// 0 or 1, anything else NaN.
private func headcountNumber(_ value: Any?) -> Double {
  switch value {
  case nil, is NSNull: return 0
  case let number as NSNumber:
    return CFGetTypeID(number) == CFBooleanGetTypeID() ? (number.boolValue ? 1 : 0) : number.doubleValue
  case let number as Double: return number
  case let number as Int: return Double(number)
  case let text as String: return jsNumberFromText(text)
  default: return .nan
  }
}

/// A whole number of people from 1 to `CHECK_IN_MAX_HEADCOUNT`, from a stored value or what was typed; blank, zero or
/// not a number is 1 (`headcountOf`, and the product editor's `headcountFrom`).
public func checkInHeadcount(_ value: Any?) -> Int {
  let rounded = (headcountNumber(value) + 0.5).rounded(.down)
  guard rounded.isFinite, rounded >= 1 else { return 1 }
  return Int(min(rounded, Double(ContractValues.shared.checkInMaxHeadcount)))
}

/// A stored check-in setting made safe, or nil when it says nothing (`normalizeProductCheckIn`): on carries its people
/// per item and whether the buyer is asked which day; off carries nothing else.
public func normalizeProductCheckIn(_ value: Any?) -> ProductCheckIn? {
  guard let raw = value as? [String: Any], let flag = raw["enabled"] as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID()
  else { return nil }
  guard flag.boolValue else { return ProductCheckIn(enabled: false) }
  let asks = (raw["askUseDate"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() && $0.boolValue } ?? false
  return ProductCheckIn(askUseDate: asks ? true : nil, enabled: true, headcount: Double(checkInHeadcount(raw["headcount"])))
}

/// Whether a row is an open rain check still waiting to be used (`checkInRainCheckIsOpen`).
public func checkInRainCheckIsOpen(_ row: HostCheckIn) -> Bool { row.rainCheckOpen == true && row.status == .expected }

/// A day's totals (`checkInDayTotals`): open rain checks are not expected on the day.
public func checkInDayTotals(_ rows: [HostCheckIn]) -> CheckInDayTotals {
  let rainChecks = rows.filter(checkInRainCheckIsOpen).count
  return CheckInDayTotals(
    checkedIn: Double(rows.filter { $0.status == .checkedIn }.count), expected: Double(rows.count - rainChecks),
    rainChecks: Double(rainChecks))
}

/// A wristband as the window prints it: "Blue #214" (`describeWristband`).
public func describeWristband(_ wristband: CheckInWristband?) -> String {
  guard let wristband else { return "" }
  let number = wristband.number.flatMap { $0.isEmpty ? nil : "#" + ($0.hasPrefix("#") ? String($0.dropFirst()) : $0) }
  return [wristband.color.flatMap { $0.isEmpty ? nil : $0 }, number].compactMap { $0 }.joined(separator: " ")
}

/// The item and which unit it is: "Day pass · Adult (2 of 3)" (`checkInItemLabel`).
public func checkInItemLabel(_ row: HostCheckIn) -> String {
  let item = row.variantLabel.flatMap { $0.isEmpty ? nil : "\(row.itemName) · \($0)" } ?? row.itemName
  return row.unitCount > 1 && row.unitIndex < row.unitCount ? "\(item) (\(Int(row.unitIndex) + 1) of \(Int(row.unitCount)))" : item
}

/// "Rain check: moved from … to …", "Rain check from …, used …" or "Rain check from …: good on any later day".
public func rainCheckLabel(_ row: HostCheckIn) -> String {
  guard let rainCheck = row.rainCheck else { return "" }
  let from = checkInDayLabel(rainCheck.fromDayKey)
  if rainCheck.kind == .date { return "Rain check: moved from \(from) to \(checkInDayLabel(rainCheck.toDayKey))" }
  if let claimed = rainCheck.claimedDayKey, !claimed.isEmpty { return "Rain check from \(from), used \(checkInDayLabel(claimed))" }
  return "Rain check from \(from): good on any later day"
}

/// "Checked in", "Rain check" or "Expected" (`checkInStatusLabel`).
public func checkInStatusLabel(_ row: HostCheckIn) -> String {
  if row.status == .checkedIn { return "Checked in" }
  return checkInRainCheckIsOpen(row) ? "Rain check" : "Expected"
}

/// Why a rain check can't be given, or nil (`rainCheckProblem`). `kind` is `open` or `date`.
public func rainCheckProblem(_ row: HostCheckIn, kind: String, dayKey: String?, todayKey: String) -> String? {
  if row.source != .order { return "Only passes can be rain-checked. Change a stay’s dates on the Reservations card." }
  if row.status != .expected { return "They are already checked in. Undo the check-in first." }
  if kind == "open" { return nil }
  guard isCheckInDayKey(dayKey), let dayKey else { return "Choose the new day as a date." }
  if dayKey <= row.dayKey { return "Choose a day after the one the pass is on." }
  return checkInUseDayProblem(dayKey, todayKey: todayKey)
}

/// "Already checked in at 9:05 AM by Sam" (`alreadyCheckedInLabel`); `timeLabel` is the check-in's time in the store's
/// zone.
public func alreadyCheckedInLabel(timeLabel: String, byName: String?) -> String {
  "Already checked in" + (timeLabel.isEmpty ? "" : " at \(timeLabel)")
    + (byName.flatMap { $0.isEmpty ? nil : " by \($0)" } ?? "")
}

/// The stays setting's three choices, in the console's words.
public let stayCheckInModeLabels: [(mode: String, label: String)] = [
  ("resource", "As each resource is set"), ("stay", "One per stay"), ("guest", "One per guest"),
]

// MARK: A stay's guests (commerce-reservations.ts), for the window's Guests dialog

/// The most guests a stay's resource sleeps, else the platform's ceiling (`resourceGuestCeiling`).
public func resourceGuestCeiling(capacity: Double?) -> Int {
  let ceiling = ContractValues.shared.maxReservationGuests
  guard let sleeps = capacity.map({ $0.rounded(.down) }), sleeps.isFinite, sleeps >= 1 else { return ceiling }
  return min(Int(sleeps), ceiling)
}

/// A stay's guests, at least one (`reservationGuests`).
public func reservationGuests(_ guests: Double?) -> Int {
  guard let count = guests.map({ $0.rounded(.down) }), count.isFinite, count >= 1 else { return 1 }
  return min(Int(count), ContractValues.shared.maxReservationGuests)
}

/// Why a guest count can't be stored, or nil (`reservationGuestsProblem`); a blank count says nothing.
public func reservationGuestsProblem(_ guests: Double?, capacity: Double?) -> String? {
  guard let guests else { return nil }
  let ceiling = resourceGuestCeiling(capacity: capacity)
  if guests != guests.rounded(.down) || guests < 1 || guests > Double(ceiling) {
    return ceiling == 1 ? "This stay sleeps 1 guest" : "Guests must be a whole number from 1 to \(ceiling)"
  }
  return nil
}
