// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * UTC calendar arithmetic with no platform clock, for the texts a console
 * `datetime-local` or `date` input holds for a stored instant
 * (`toISOString().slice(0, 16)` and `.slice(0, 10)`); the Kotlin kit's
 * UtcCalendar.kt.
 */

private func floorDiv(_ a: Int64, _ b: Int64) -> Int64 {
  let q = a / b
  return (a % b != 0 && (a < 0) != (b < 0)) ? q - 1 : q
}

private func pad(_ value: Int64, _ width: Int) -> String {
  let text = String(value)
  return String(repeating: "0", count: max(0, width - text.count)) + text
}

private func civilFromDays(_ daysSinceEpoch: Int64) -> (year: Int64, month: Int64, day: Int64) {
  let z = daysSinceEpoch + 719_468
  let era = floorDiv(z, 146_097)
  let doe = z - era * 146_097
  let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  let mp = (5 * doy + 2) / 153
  let day = doy - (153 * mp + 2) / 5 + 1
  let month = mp < 10 ? mp + 3 : mp - 9
  let year = yoe + era * 400 + (month <= 2 ? 1 : 0)
  return (year, month, day)
}

private func daysFromCivil(_ year: Int64, _ month: Int64, _ day: Int64) -> Int64 {
  let y = month <= 2 ? year - 1 : year
  let era = floorDiv(y, 400)
  let yoe = y - era * 400
  let mp = (month + 9) % 12
  let doy = (153 * mp + 2) / 5 + day - 1
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
  return era * 146_097 + doe - 719_468
}

/// Epoch millis as `YYYY-MM-DDTHH:mm`, in UTC.
public func utcMinute(_ epochMillis: Int64) -> String {
  let days = floorDiv(epochMillis, 86_400_000)
  let ofDay = epochMillis - days * 86_400_000
  let (year, month, day) = civilFromDays(days)
  let hour = ofDay / 3_600_000
  let minute = (ofDay / 60_000) % 60
  return "\(pad(year, 4))-\(pad(month, 2))-\(pad(day, 2))T\(pad(hour, 2)):\(pad(minute, 2))"
}

/// `YYYY-MM-DDTHH:mm` (UTC) back to epoch millis; nil when it is not one.
public func parseUtcMinute(_ text: String) -> Int64? {
  let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
  guard let match = trimmed.range(of: #"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})"#, options: .regularExpression) else { return nil }
  let parts = trimmed[match].split(whereSeparator: { $0 == "-" || $0 == "T" || $0 == ":" }).compactMap { Int64($0) }
  guard parts.count == 5 else { return nil }
  let (y, mo, d, h, mi) = (parts[0], parts[1], parts[2], parts[3], parts[4])
  guard (1...12).contains(mo), (1...31).contains(d), h <= 23, mi <= 59 else { return nil }
  return daysFromCivil(y, mo, d) * 86_400_000 + h * 3_600_000 + mi * 60_000
}

/// Epoch millis as `YYYY-MM-DD`, in UTC.
public func utcDay(_ epochMillis: Int64) -> String { String(utcMinute(epochMillis).prefix(10)) }

/// `YYYY-MM-DD` back to its UTC midnight; nil when it is not one.
public func parseUtcDay(_ text: String) -> Int64? {
  parseUtcMinute(String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(10)) + "T00:00")
}
