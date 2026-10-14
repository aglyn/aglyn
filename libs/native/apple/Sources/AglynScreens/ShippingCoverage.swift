import AglynCore
import Foundation

/// What a store's saved shipping zones and rates cover, as the console's Shipping card says it (`summarizeShippingCoverage`
/// in `commerce-shipping.ts`): which of the six destinations checkout collects an address for are reached by at least one
/// rate, which it turns away, and whether the shopper is asked where the parcel is going. A port of the console's resolver
/// (zones, the four priced rate kinds, local pickup, the five-option cap) replayed from `shipping-coverage-cases.json`, so a
/// change to the TypeScript fails there until this follows.
enum ShippingCoverage {
  /// The destinations a storefront session collects an address for, in the order the console lists them.
  static let countries = ["US", "CA", "GB", "AU", "DE", "FR"]

  /// Shopper-facing names for those destinations.
  static let names = [
    "US": "United States", "CA": "Canada", "GB": "United Kingdom", "AU": "Australia", "DE": "Germany", "FR": "France",
  ]

  /// Stripe shows a session at most this many shipping options.
  static let maxOptions = 5

  static let pickupID = "pickup"

  struct Option: Equatable {
    let rateID: String
    let name: String
    let amountCents: Double
  }

  /// A cart picked so every rate a merchant could write resolves if it can at all: a zero subtotal and weight clear every
  /// tier, and a free-over rate resolves at any subtotal. The answer is a lower bound on the gaps, never a false warning.
  private static let probe = (subtotalCents: 0.0, totalGrams: 0.0)

  /// `Math.round`: halves go up.
  private static func jsRound(_ value: Double) -> Double { (value + 0.5).rounded(.down) }

  private static func zoneCode(_ value: JSONValue?) -> String {
    switch value {
    case .string(let text)?: text.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    case .number(let number)?: ScreenValues.numberText(number).uppercased()
    default: ""
    }
  }

  private static func codes(_ zone: JSONValue) -> [JSONValue] { zone["countries"]?.arrayValue ?? [] }

  /// The zones that cover a destination: those that name it, and only when none does, those that claim everywhere (`*`).
  private static func matchedZoneIDs(_ zones: [JSONValue], _ country: String) -> Set<String> {
    let want = country.uppercased()
    let specific = zones.filter { zone in codes(zone).contains { zoneCode($0) == want } }
    let matched = specific.isEmpty ? zones.filter { zone in codes(zone).contains { zoneCode($0) == "*" || zoneCode($0) == want } } : specific
    return Set(matched.map { $0["id"]?.stringValue ?? "" })
  }

  /// The first tier whose `upTo` reaches the value, tiers taken smallest first.
  private static func tierAmount(_ tiers: [JSONValue], _ value: Double) -> Double? {
    let sorted = tiers.enumerated().sorted { a, b in
      let left = ScreenValues.number(a.element["upTo"]) ?? 0
      let right = ScreenValues.number(b.element["upTo"]) ?? 0
      return left != right ? left < right : a.offset < b.offset
    }
    for (_, tier) in sorted {
      // A tier with no limit reaches nothing, as a comparison against nothing is false in the console.
      if let limit = ScreenValues.number(tier["upTo"]), value <= limit { return ScreenValues.number(tier["amountCents"]) }
    }
    return nil
  }

  /// Every rate that prices this cart to this destination, with local pickup when it is on, cheapest first.
  private static func resolveRates(_ settings: JSONValue, _ country: String, _ cart: (subtotalCents: Double, totalGrams: Double)) -> [Option] {
    let zoneIDs = matchedZoneIDs(settings["zones"]?.arrayValue ?? [], country)
    var resolved: [Option] = []
    for rate in settings["rates"]?.arrayValue ?? [] {
      guard zoneIDs.contains(rate["zoneId"]?.stringValue ?? "") else { continue }
      let amount = max(0, jsRound(ScreenValues.number(rate["amountCents"]) ?? 0))
      let cents: Double?
      switch rate["kind"]?.stringValue {
      case "flat": cents = amount
      case "free_over":
        if let over = ScreenValues.number(rate["freeOverCents"]), cart.subtotalCents >= over {
          cents = 0
        } else {
          cents = amount
        }
      case "price_tiers": cents = tierAmount(rate["tiers"]?.arrayValue ?? [], cart.subtotalCents)
      case "weight_tiers": cents = tierAmount(rate["tiers"]?.arrayValue ?? [], cart.totalGrams)
      default: cents = nil
      }
      guard let cents else { continue }
      resolved.append(Option(rateID: rate["id"]?.stringValue ?? "", name: rate["name"]?.stringValue ?? "", amountCents: cents))
    }
    if ScreenValues.truthy(settings["localPickup"]) {
      resolved.append(Option(rateID: pickupID, name: "Local pickup", amountCents: 0))
    }
    return resolved.enumerated().sorted { a, b in
      a.element.amountCents != b.element.amountCents ? a.element.amountCents < b.element.amountCents : a.offset < b.offset
    }.map(\.element)
  }

  /// What `String#localeCompare` does for plain ids: letters without regard to case first, a lowercase letter before its capital.
  private static func idOrder(_ a: String, _ b: String) -> Bool {
    let (la, lb) = (a.lowercased(), b.lowercased())
    return la != lb ? la < lb : a > b
  }

  /// The options a session offers for these destinations: a rate with no id or name is dropped (Stripe would reject it), a rate
  /// that resolves differently for two destinations keeps the dearer price, cheapest first, at most five.
  static func checkoutOptions(_ settings: JSONValue?, _ destinations: [String], _ cart: (subtotalCents: Double, totalGrams: Double) = probe) -> [Option] {
    guard let settings, settings != .null else { return [] }
    var byID: [String: Option] = [:]
    for country in destinations {
      for rate in resolveRates(settings, country, cart) {
        guard !rate.rateID.isEmpty, !rate.name.isEmpty else { continue }
        let cents = max(0, jsRound(rate.amountCents))
        if let existing = byID[rate.rateID], cents <= existing.amountCents { continue }
        byID[rate.rateID] = Option(rateID: rate.rateID, name: rate.name, amountCents: cents)
      }
    }
    let ordered = byID.values.sorted { a, b in
      a.amountCents != b.amountCents ? a.amountCents < b.amountCents : idOrder(a.rateID, b.rateID)
    }
    return Array(ordered.prefix(maxOptions))
  }

  private static func key(_ options: [Option]) -> String {
    options.map { "\($0.rateID):\(ScreenValues.numberText($0.amountCents))" }.joined(separator: "|")
  }

  /// The summary the Shipping card reads, as the object a screen's `derive` load answers with.
  static func summary(_ settings: JSONValue?) -> JSONValue {
    var served: [String] = []
    var unserved: [String] = []
    var offers = Set<String>()
    for country in countries {
      let options = checkoutOptions(settings, [country])
      offers.insert(key(options))
      // Asked of the shippable list: local pickup is a collection choice, not a rate, so it never counts as coverage.
      if options.contains(where: { $0.rateID != pickupID }) { served.append(country) } else { unserved.append(country) }
    }
    let reach = served.isEmpty ? [] : unserved
    let named: ([String]) -> String = { $0.map { names[$0] ?? $0 }.joined(separator: ", ") }
    let zones = settings?["zones"]?.arrayValue ?? []
    let pickup = ScreenValues.truthy(settings?["localPickup"])
    let restOfWorld = zones.contains { codes($0).contains { $0.stringValue == "*" } }
    // The console's own sentences (`describeShippingCoverage`), so a store reads the same on every surface.
    var headline = ""
    var detail = ""
    var note = ""
    if !reach.isEmpty {
      headline = "Checkout turns away \(reach.count) of the \(countries.count) destinations it collects addresses for"
      detail =
        "No rate reaches \(named(reach)), so an order shipping there is refused rather than posted for free. "
        + (pickup
          ? "Local pickup does not cover them: it is a collection choice, not a rate, so it is offered where checkout completes and closes no gap here. "
          : "")
        + (restOfWorld
          ? "A rest-of-world zone is already saved, so what those destinations are missing is a rate on the zone that covers them."
          : "Give them a zone with a rate, or add a rest-of-world zone and price one on it.")
    } else if served.isEmpty {
      note = pickup
        ? "No rate reaches any destination, so local pickup is the only delivery choice checkout offers. Nobody is turned away and no shipping is charged."
        : "No rate reaches any destination, so checkout charges no shipping and turns nobody away."
    } else {
      note = "Checkout can price shipping to every destination it collects an address for: \(named(served))."
    }
    return .object([
      "headline": .string(headline),
      "detail": .string(detail),
      "note": .string(note),
      "asks": .string(
        offers.count > 1
          ? "Rates differ by destination, so checkout asks the shopper where the parcel is going before it can price one." : ""),
      "served": .array(served.map { .string($0) }),
      "unserved": .array(reach.map { .string($0) }),
      "servedNames": .string(named(served)),
      "unservedNames": .string(named(reach)),
      "unservedCount": .number(Double(reach.count)),
      "countryCount": .number(Double(countries.count)),
      "shipsNowhere": .bool(served.isEmpty),
      "asksDestination": .bool(offers.count > 1),
      "offersLocalPickup": .bool(pickup),
      "hasRestOfWorldZone": .bool(restOfWorld),
    ])
  }
}
