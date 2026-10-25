// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// Check-in at the window (AGL-4043), ported once from libs/plugins/commerce/src/lib/model/commerce-check-in.ts: the
// labels the register prints for a person, a wristband and a time, and the wristband rule the route applies.
// function-cases.generated.json holds the answers the TypeScript gives, and FunctionCasesTests replays every one.
// The record (`HostCheckIn`), the customer row (`CheckInCustomer`) and the limits are generated contracts.

/// One check-in as the route answers it: the stored record and its document id.
public struct CheckInRow: Hashable, Sendable, Identifiable {
  public let id: String
  public var record: HostCheckIn

  public init(id: String, record: HostCheckIn) {
    self.id = id
    self.record = record
  }

  private struct Identity: Decodable { let id: String? }

  /// A row of the route's JSON (`{ id, ...record }`), encoded; nil without an id.
  public init?(data: Data) {
    guard let id = (try? JSONDecoder().decode(Identity.self, from: data))?.id, !id.isEmpty,
      let record = try? JSONDecoder().decode(HostCheckIn.self, from: data)
    else { return nil }
    self.init(id: id, record: record)
  }

  public var checkedIn: Bool { record.status == .checkedIn }
}

/// One person's line, as the list and the spreadsheet name it: "Day pass · Adult (2 of 3)".
public func checkInItemLabel(itemName: String, variantLabel: String?, unitIndex: Int, unitCount: Int) -> String {
  let item = variantLabel.flatMap { $0.isEmpty ? nil : "\(itemName) · \($0)" } ?? itemName
  return unitCount > 1 ? "\(item) (\(unitIndex + 1) of \(unitCount))" : item
}

public func checkInItemLabel(_ row: HostCheckIn) -> String {
  checkInItemLabel(
    itemName: row.itemName ?? "", variantLabel: row.variantLabel, unitIndex: row.unitIndex ?? 0, unitCount: row.unitCount ?? 1)
}

/// A wristband as one line: "Blue #214".
public func describeWristband(_ wristband: CheckInWristband?) -> String {
  guard let wristband else { return "" }
  let number = wristband.number.flatMap { $0.isEmpty ? nil : "#" + ($0.hasPrefix("#") ? String($0.dropFirst()) : $0) }
  return [wristband.color.flatMap { $0.isEmpty ? nil : $0 }, number].compactMap { $0 }.joined(separator: " ")
}

/// A time on the site's clock: "9:14 AM". An unknown zone reads in `fallback` (the device's, as the console falls back to the
/// browser's).
public func checkInTimeLabel(_ atMs: Double?, timeZone: String, fallback: TimeZone = .current) -> String {
  guard let atMs, atMs != 0 else { return "" }
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.calendar = Calendar(identifier: .gregorian)
  formatter.dateFormat = "h:mm a"
  formatter.timeZone = TimeZone(identifier: timeZone) ?? fallback
  return formatter.string(from: Date(timeIntervalSince1970: atMs / 1000))
}

/// "Already checked in at 9:14 AM by Sam".
public func alreadyCheckedInLabel(checkedInAtMs: Double?, checkedInByName: String?, timeZone: String, fallback: TimeZone = .current)
  -> String
{
  let at = checkInTimeLabel(checkedInAtMs, timeZone: timeZone, fallback: fallback)
  let by = checkedInByName.flatMap { $0.isEmpty ? nil : " by \($0)" } ?? ""
  return "Already checked in\(at.isEmpty ? "" : " at \(at)")\(by)"
}

/// What the row says under a person checked in: "Checked in at 9:14 AM by Sam · Blue #214", as the console's dialog says it.
public func checkedInLine(_ row: HostCheckIn, timeZone: String, fallback: TimeZone = .current) -> String {
  let at = "Checked in at \(checkInTimeLabel(row.checkedInAtMs, timeZone: timeZone, fallback: fallback))"
    + (row.checkedInByName.flatMap { $0.isEmpty ? nil : " by \($0)" } ?? "")
  return [at, describeWristband(row.wristband)].filter { !$0.isEmpty }.joined(separator: " · ")
}

/// A wristband as typed, made safe, as the route checks it: a number (letters, digits, `#`, a dash) and a color word, each
/// optional. `.success(nil)` with neither; `.failure` with the route's words for junk.
public enum WristbandCheck: Equatable {
  case ok(CheckInWristband?)
  case refused(String)
}

public func normalizeWristband(number: String?, color: String?) -> WristbandCheck {
  let max = ContractValues.shared.checkInWristbandMax
  let number = (number ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  let color = (color ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if number.count > max || color.count > max {
    return .refused("A wristband number or color is \(max) characters at most.")
  }
  if !number.isEmpty, number.range(of: "^[A-Za-z0-9#-]+$", options: .regularExpression) == nil {
    return .refused("A wristband number is letters, digits and dashes.")
  }
  if !color.isEmpty, color.range(of: "^[\\p{L} -]+$", options: .regularExpression) == nil {
    return .refused("A wristband color is a word, such as Blue.")
  }
  if number.isEmpty && color.isEmpty { return .ok(nil) }
  return .ok(CheckInWristband(color: color.isEmpty ? nil : color, number: number.isEmpty ? nil : number))
}

// MARK: - The product setting (commerce-check-in-product.ts)

/// People one item admits, from a stored or typed value: JavaScript's `Math.round(Number(value))`, from 1 to
/// `CHECK_IN_MAX_HEADCOUNT`, and 1 for anything else (blank too).
public func checkInHeadcount(_ value: Any?) -> Int {
  let number: Double
  switch value {
  case let flag as Bool: number = flag ? 1 : 0
  case let given as NSNumber: number = given.doubleValue
  case let text as String:
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    number = trimmed.isEmpty ? 0 : (Double(trimmed) ?? .nan)
  default: number = .nan
  }
  let count = (number + 0.5).rounded(.down)
  guard count.isFinite, count >= 1 else { return 1 }
  return Int(min(count, Double(ContractValues.shared.checkInMaxHeadcount)))
}

/// A stored check-in setting made safe, or nil when it says nothing (`enabled` not a boolean).
public func normalizeProductCheckIn(_ value: Any?) -> ProductCheckIn? {
  guard let raw = value as? [String: Any], let flag = raw["enabled"] as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID()
  else { return nil }
  return flag.boolValue ? ProductCheckIn(enabled: true, headcount: checkInHeadcount(raw["headcount"])) : ProductCheckIn(enabled: false)
}
