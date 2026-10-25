import AglynContracts
import AglynCore
import Foundation

/// A season of a resource's year, by month and day (`06-01` to `08-31`; it may wrap the new year): its nights cost `multiplier` times as much.
struct StaySeason: Equatable {
  let from: String
  let to: String
  let multiplier: Double
}

/// Dates the resource is closed for, by the day the block starts and the day it ends.
struct StayBlock: Equatable {
  let fromDayMs: Int64
  let toDayMs: Int64
}

/// What a stay is priced and checked against: a resource of the store's reservations.
struct StayResource: Equatable {
  var nightlyRateUsd: Double
  var weekendMultiplier: Double?
  var seasons: [StaySeason] = []
  var blocks: [StayBlock] = []
  var minNights: Double?
  var depositPct: Double?
  /// How many identical units the resource holds (12 RV hookups): a whole number from 1 to `Stays.maxUnits`, and 1 for a
  /// resource that never set one. Each night takes this many stays at once.
  var units = 1
}

/// One night of a resource: how many of its units are still free.
struct StayNight: Equatable {
  let dayMs: Int64
  let unitsLeft: Int
  let units: Int
}

/// A reservation as an availability check reads it.
struct StayBooked: Equatable {
  let checkInDayMs: Int64
  let checkOutDayMs: Int64
  let status: String
  let createdAtMs: Int64?
}

struct StayQuote: Equatable {
  var nights = 0
  var subtotalCents: Int64 = 0
  var depositCents: Int64 = 0
  var totalCents: Int64 = 0
  var nightlyCents: [Int64] = []
  var problem: String?
}

/// The console's reservation pricing and availability (`commerce-reservations.ts`), for the front desk's walk-in: the nightly
/// rate for each night (weekends and seasons), the quote for a stay, and whether a range of dates clashes with a live
/// reservation or a block. `stays-cases.json` was made from the console's functions and both platforms replay it.
enum Stays {
  static let dayMs: Int64 = 24 * 60 * 60 * 1000

  /// An unpaid `pending` reservation holds its dates only this long.
  static var pendingHoldMs: Int64 { Int64(ContractValues.shared.pendingReservationHoldMs) }

  /// The most identical units one resource can hold.
  static var maxUnits: Int { ContractValues.shared.maxResourceUnits }

  /// A night with this many units left, or fewer, reads as scarce.
  static var fewUnitsLeft: Int { ContractValues.shared.fewUnitsLeft }

  /// The resource's stored `units` as the console reads it (`resourceUnits`): JavaScript's `Math.floor(Number(units))`, from 1
  /// to `maxUnits`, and 1 for anything else (absent, zero, negative, not a number).
  static func units(_ raw: Any?) -> Int {
    let value: Double
    switch raw {
    case let number as NSNumber: value = number.doubleValue
    case let text as String:
      let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
      value = trimmed.isEmpty ? 0 : (Double(trimmed) ?? .nan)
    case is NSNull: value = 0
    default: value = .nan
    }
    let whole = value.rounded(.down)
    guard whole.isFinite, whole >= 1 else { return 1 }
    return Int(Swift.min(Double(maxUnits), whole))
  }

  /// JavaScript's `Math.round`: halves go up.
  private static func round(_ value: Double) -> Int64 { Int64((value + 0.5).rounded(.down)) }

  private static func floorDiv(_ a: Int64, _ b: Int64) -> Int64 {
    let quotient = a / b
    return (a % b != 0 && (a < 0) != (b < 0)) ? quotient - 1 : quotient
  }

  /// A date `2026-10-14` as UTC midnight, or nil when it is not one.
  static func day(_ iso: String) -> Int64? {
    let parts = iso.trimmingCharacters(in: .whitespaces).split(separator: "-", omittingEmptySubsequences: false)
    guard parts.count == 3, let y = Int64(parts[0]), let m = Int64(parts[1]), let d = Int64(parts[2]), (1...12).contains(m),
      (1...31).contains(d)
    else { return nil }
    // Days from the civil date (proleptic Gregorian), counted from 1970-01-01.
    let year = m <= 2 ? y - 1 : y
    let era = floorDiv(year, 400)
    let yoe = year - era * 400
    let doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return (era * 146_097 + doe - 719_468) * dayMs
  }

  private static func monthDay(_ ms: Int64) -> String {
    let z = floorDiv(ms, dayMs) + 719_468
    let era = floorDiv(z, 146_097)
    let doe = z - era * 146_097
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    let day = doy - (153 * mp + 2) / 5 + 1
    let month = mp < 10 ? mp + 3 : mp - 9
    return String(format: "%02d-%02d", Int(month), Int(day))
  }

  private static func weekday(_ ms: Int64) -> Int {
    Int(((floorDiv(ms, dayMs) + 4) % 7 + 7) % 7)
  }

  private static func inSeason(_ key: String, _ season: StaySeason) -> Bool {
    season.from <= season.to ? (key >= season.from && key <= season.to) : (key >= season.from || key <= season.to)
  }

  /// The rate in cents for one night.
  static func nightlyRateCents(_ resource: StayResource, _ ms: Int64) -> Int64 {
    var rate = resource.nightlyRateUsd * 100
    let weekday = weekday(ms)
    if (weekday == 5 || weekday == 6), let weekend = resource.weekendMultiplier, weekend != 0 { rate *= weekend }
    let key = monthDay(ms)
    if let season = resource.seasons.first(where: { inSeason(key, $0) }) { rate *= season.multiplier }
    return round(rate)
  }

  /// Prices a stay; `problem` is set (and the figures are zero) when the range is not one that can be booked.
  static func quote(_ resource: StayResource, checkIn: Int64, checkOut: Int64) -> StayQuote {
    let nights = Int(round(Double(checkOut - checkIn) / Double(dayMs)))
    guard nights > 0 else { return StayQuote(problem: "Choose at least one night") }
    if let minimum = resource.minNights, minimum != 0, Double(nights) < minimum {
      let shown = minimum.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(minimum)) : String(minimum)
      return StayQuote(problem: "Minimum stay is \(shown) nights")
    }
    var nightly: [Int64] = []
    var cursor = checkIn
    while cursor < checkOut {
      nightly.append(nightlyRateCents(resource, cursor))
      cursor += dayMs
    }
    let subtotal = nightly.reduce(0, +)
    let depositPct = Swift.min(100, Swift.max(0, resource.depositPct ?? 100))
    return StayQuote(
      nights: nights, subtotalCents: subtotal, depositCents: round(Double(subtotal) * depositPct / 100), totalCents: subtotal,
      nightlyCents: nightly, problem: nil)
  }

  /// Whether a reservation still stands between a guest and its dates: not cancelled or a no-show, and a `pending` one only while it is fresh.
  static func holdsDates(_ booked: StayBooked, now: Int64) -> Bool {
    if booked.status == "cancelled" || booked.status == "no_show" { return false }
    if booked.status != "pending" { return true }
    let created = booked.createdAtMs ?? 0
    return created > 0 && now - created < pendingHoldMs
  }

  /// How many units are taken on each night from `from` up to (not including) `to`, one entry per night, counting only the
  /// stays that still hold their dates. A stay takes a night it overlaps, so one that leaves the morning another arrives does not.
  static func unitsTakenByNight(_ booked: [StayBooked], from: Int64, to: Int64, now: Int64) -> [Int] {
    let live = booked.filter { holdsDates($0, now: now) }
    var taken: [Int] = []
    var night = from
    while night < to {
      let nightEnd = Swift.min(night + dayMs, to)
      taken.append(live.filter { $0.checkInDayMs < nightEnd && $0.checkOutDayMs > night }.count)
      night += dayMs
    }
    return taken
  }

  /// Units left on each of `nights` nights from `from`: the resource's units less the stays holding that night, and none on a
  /// blocked night, because a block closes the whole resource.
  static func unitsLeftByNight(_ resource: StayResource, booked: [StayBooked], from: Int64, nights: Int, now: Int64) -> [StayNight] {
    let to = from + Int64(Swift.max(0, nights)) * dayMs
    return unitsTakenByNight(booked, from: from, to: to, now: now).enumerated().map { index, taken in
      let night = from + Int64(index) * dayMs
      let blocked = resource.blocks.contains { night < $0.toDayMs && night + dayMs > $0.fromDayMs }
      return StayNight(dayMs: night, unitsLeft: blocked ? 0 : Swift.max(0, resource.units - taken), units: resource.units)
    }
  }

  /// A range is free when no block touches it and, on EVERY night of it, fewer live stays overlap that night than the resource
  /// has units; back-to-back stays touch without clashing. One unit (every resource that never set `units`) clashes with any
  /// live stay it overlaps, as a resource always has.
  static func isRangeAvailable(_ resource: StayResource, booked: [StayBooked], checkIn: Int64, checkOut: Int64, now: Int64) -> Bool {
    guard checkOut > checkIn else { return false }
    for block in resource.blocks where checkIn < block.toDayMs && checkOut > block.fromDayMs { return false }
    if resource.units == 1 {
      for stay in booked where holdsDates(stay, now: now) {
        if checkIn < stay.checkOutDayMs && checkOut > stay.checkInDayMs { return false }
      }
      return true
    }
    return unitsTakenByNight(booked, from: checkIn, to: checkOut, now: now).allSatisfy { $0 < resource.units }
  }

  /// What the front desk is told when a walk-in's dates are not free, in the console's words.
  static func takenMessage(_ resource: StayResource) -> String {
    resource.units > 1 ? "Every unit is taken on at least one of those nights" : "Those dates are taken"
  }

  /// Today on the device's calendar as the UTC midnight stays are stored in (the console's `localTodayDayMs`).
  static func localToday(_ date: Date, in zone: TimeZone) -> Int64 {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return day(String(format: "%04d-%02d-%02d", parts.year ?? 1970, parts.month ?? 1, parts.day ?? 1)) ?? 0
  }

  private static let weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  private static let monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

  /// A night as the console's Reservations card names it: `Mon, Oct 26` (US English, in UTC, as the card prints it).
  static func nightLabel(_ ms: Int64) -> String {
    let key = monthDay(ms).split(separator: "-").compactMap { Int($0) }
    guard key.count == 2 else { return "" }
    return "\(weekdayNames[weekday(ms)]), \(monthNames[key[0] - 1]) \(key[1])"
  }

  /// How many nights ahead the Reservations screen draws a several-unit resource's units, as the console's card does.
  static let lookaheadNights = 14

  /// The Reservations screen's look-ahead (`derive: "unitsAhead"`): for each resource with several units, its next
  /// `lookaheadNights` nights from `today` as `{ dayMs, label, unitsLeft, units, tone }`, keyed by resource id. `resources` and
  /// `stays` are query answers (`{ items }`) or plain lists. A resource with one unit is left out, as the console's card leaves it.
  static func unitsAhead(resources: JSONValue?, stays: JSONValue?, today: Int64, now: Int64) -> JSONValue {
    func rows(_ value: JSONValue?) -> [JSONValue] { ScreenValues.rows(value?["items"] ?? value) }
    let booked = rows(stays).compactMap { stay -> (String, StayBooked)? in
      guard let id = stay["resourceId"]?.stringValue, let data = FirestoreLoads.plain(stay) as? [String: Any],
        let held = Self.booked(data)
      else { return nil }
      return (id, held)
    }
    var byResource: [String: JSONValue] = [:]
    for row in rows(resources) {
      guard let id = row["$id"]?.stringValue, let data = FirestoreLoads.plain(row) as? [String: Any] else { continue }
      let units = Self.units(data["units"])
      guard units > 1 else { continue }
      let blocks = Self.resource(["nightlyRateUsd": 0, "blocks": data["blocks"] ?? []])?.blocks ?? []
      let resource = StayResource(nightlyRateUsd: 0, blocks: blocks, units: units)
      let nights = unitsLeftByNight(
        resource, booked: booked.filter { $0.0 == id }.map(\.1), from: today, nights: lookaheadNights, now: now)
      byResource[id] = .array(
        nights.map { night in
          let tone = night.unitsLeft == 0 ? "error" : night.unitsLeft <= fewUnitsLeft ? "warning" : "neutral"
          return .object([
            "dayMs": .number(Double(night.dayMs)), "label": .string(nightLabel(night.dayMs)),
            "unitsLeft": .number(Double(night.unitsLeft)), "units": .number(Double(night.units)), "tone": .string(tone),
          ])
        })
    }
    return .object(byResource)
  }

  private static func number(_ value: Any?) -> Double? { (value as? NSNumber)?.doubleValue }

  /// A stored resource as the pricing reads it; nil when it is not one (no nightly rate).
  static func resource(_ data: [String: Any]?) -> StayResource? {
    guard let rate = number(data?["nightlyRateUsd"]) else { return nil }
    let seasons = (data?["seasons"] as? [[String: Any]] ?? []).compactMap { raw -> StaySeason? in
      guard let from = raw["from"] as? String, let to = raw["to"] as? String, let multiplier = number(raw["multiplier"]) else { return nil }
      return StaySeason(from: from, to: to, multiplier: multiplier)
    }
    let blocks = (data?["blocks"] as? [[String: Any]] ?? []).compactMap { raw -> StayBlock? in
      guard let from = number(raw["fromDayMs"]), let to = number(raw["toDayMs"]) else { return nil }
      return StayBlock(fromDayMs: Int64(from), toDayMs: Int64(to))
    }
    return StayResource(
      nightlyRateUsd: rate, weekendMultiplier: number(data?["weekendMultiplier"]), seasons: seasons, blocks: blocks,
      minNights: number(data?["minNights"]), depositPct: number(data?["depositPct"]), units: units(data?["units"]))
  }

  /// A stored reservation as the availability check reads it.
  static func booked(_ data: [String: Any]) -> StayBooked? {
    guard let checkIn = number(data["checkInDayMs"]), let checkOut = number(data["checkOutDayMs"]) else { return nil }
    return StayBooked(
      checkInDayMs: Int64(checkIn), checkOutDayMs: Int64(checkOut), status: data["status"] as? String ?? "",
      createdAtMs: number(data["createdAtMs"]).map { Int64($0) })
  }
}
