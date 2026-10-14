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
  static let pendingHoldMs: Int64 = 30 * 60 * 1000

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

  /// A range clashes with a live reservation, or with a block, when they overlap; back-to-back stays touch without clashing.
  static func isRangeAvailable(_ resource: StayResource, booked: [StayBooked], checkIn: Int64, checkOut: Int64, now: Int64) -> Bool {
    guard checkOut > checkIn else { return false }
    for stay in booked where holdsDates(stay, now: now) {
      if checkIn < stay.checkOutDayMs && checkOut > stay.checkInDayMs { return false }
    }
    for block in resource.blocks where checkIn < block.toDayMs && checkOut > block.fromDayMs { return false }
    return true
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
      minNights: number(data?["minNights"]), depositPct: number(data?["depositPct"]))
  }

  /// A stored reservation as the availability check reads it.
  static func booked(_ data: [String: Any]) -> StayBooked? {
    guard let checkIn = number(data["checkInDayMs"]), let checkOut = number(data["checkOutDayMs"]) else { return nil }
    return StayBooked(
      checkInDayMs: Int64(checkIn), checkOutDayMs: Int64(checkOut), status: data["status"] as? String ?? "",
      createdAtMs: number(data["createdAtMs"]).map { Int64($0) })
  }
}
