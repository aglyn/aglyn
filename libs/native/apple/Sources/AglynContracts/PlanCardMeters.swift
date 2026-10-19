// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * THE PLAN CARD'S METERS (AGL-3992), the console's `plan-card-meters.ts`.
 *
 * Which of the Usage page's meters the sidebar's plan card rotates through, the one that leads for the screen in front,
 * and the order the rest follow. The mapping is generated (`PLAN_CARD_*` in ContractValues) and the replayed cases in
 * function-cases.generated.json hold each function to the console's answers, so the Apple and Kotlin cards agree.
 */

/// One meter's reading: nil where the read failed, or where the plan does not cap it (an unlimited quota).
public struct PlanCardReading: Equatable, Sendable {
  public let meter: String
  public let used: Double?
  public let limit: Double?

  public init(meter: String, used: Double?, limit: Double?) {
    self.meter = meter
    self.used = used
    self.limit = limit
  }

  /// The share of the limit in use, for a meter the card can draw.
  public var share: Double? {
    guard let used, let limit, used.isFinite, limit.isFinite, limit > 0 else { return nil }
    return used / limit
  }
}

/// The context of the screen in front: a site's Home is its website, a screen not mapped has none (`planCardContext`).
public func planCardContext(_ screen: String?, inSite: Bool) -> String? {
  let values = ContractValues.shared
  guard let screen else { return nil }
  if screen == values.planCardHomeScreen { return inSite ? "website" : nil }
  return values.planCardScreenContexts[screen]
}

/// The order the card shows its meters in: the context's meters first, then the rest fullest first (a tie keeps
/// `PLAN_CARD_METERS`' order); failed and uncapped meters left out; Sites leads only on the Sites list
/// (`planCardMeterOrder`).
public func planCardMeterOrder(_ readings: [PlanCardReading], context: String?) -> [String] {
  let meters = ContractValues.shared.planCardMeters
  var seen = Set<String>()
  let shown = readings.filter { $0.share != nil && seen.insert($0.meter).inserted }
  let leading = context.flatMap { ContractValues.shared.planCardContextMeters[$0] } ?? []
  let lead = leading.filter { meter in shown.contains { $0.meter == meter } }
  func rank(_ meter: String) -> Int { meters.firstIndex(of: meter) ?? meters.count }
  let rest = shown.filter { !lead.contains($0.meter) }.sorted { a, b in
    let aSites = a.meter == "sites"
    let bSites = b.meter == "sites"
    if aSites != bSites { return bSites }
    let (aShare, bShare) = (a.share ?? 0, b.share ?? 0)
    return aShare != bShare ? aShare > bShare : rank(a.meter) < rank(b.meter)
  }
  return lead + rest.map(\.meter)
}

/// Whether the card shows: a meter to draw, and a plan the viewer can upgrade or a meter at its warning share
/// (`planCardShows`).
public func planCardShows(_ readings: [PlanCardReading], offersUpgrade: Bool) -> Bool {
  let shares = readings.compactMap(\.share)
  guard !shares.isEmpty else { return false }
  return offersUpgrade || shares.contains { $0 >= ContractValues.shared.planCardWarningShare }
}
