// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// A send's rates and its link table (`send-report.ts` in the shared email-campaigns lib): a campaign's report and a
// sequence's Results read them alike, so they live here rather than in either plugin. Replayed from the console's own
// cases (`sendLinkReport`); the Kotlin kit's SendReport.kt holds the same.

/// A rate and the denominator it was taken over (`SendRate`).
public struct SendRate: Equatable, Sendable {
  public let value: Double
  public let numerator: Double
  public let denominator: Double
  public let denominatorLabel: String

  public init(value: Double, numerator: Double, denominator: Double, denominatorLabel: String) {
    self.value = value
    self.numerator = numerator
    self.denominator = denominator
    self.denominatorLabel = denominatorLabel
  }
}

/// `sendRate`: numerator over denominator, or nil when there is no positive denominator to take it over.
public func sendRate(_ numerator: Double?, _ denominator: Double?, _ label: String) -> SendRate? {
  let top = numerator ?? 0
  let bottom = denominator ?? 0
  guard top.isFinite, bottom.isFinite, bottom > 0 else { return nil }
  return SendRate(value: top / bottom, numerator: top, denominator: bottom, denominatorLabel: label)
}

/// One destination of the link table.
public struct LinkRow: Equatable, Sendable {
  public let url: String
  public let clicks: Int
  public let share: SendRate?
}

/// The link table (`SendLinkReport`).
public struct LinkReport: Equatable, Sendable {
  public var rows: [LinkRow] = []
  public var attributedClicks = 0
  public var overflowClicks = 0
  public var unattributedClicks = 0
  public var truncated = false
}

/// `sendLinkReport`: a stored link rollup as the table reads it, most clicked first.
public func sendLinkReport(_ rollup: [String: Any]?) -> LinkReport {
  let entries = (rollup?["links"] as? [String: Any] ?? [:]).values.compactMap { raw -> (String, Int)? in
    guard let entry = raw as? [String: Any], let url = entry["url"] as? String, !url.isEmpty else { return nil }
    return (url, (entry["clicks"] as? NSNumber)?.intValue ?? 0)
  }
  let attributed = entries.reduce(0) { $0 + $1.1 }
  let rows = entries.sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0 < $1.0 }
    .map { LinkRow(url: $0.0, clicks: $0.1, share: sendRate(Double($0.1), Double(attributed), "link clicks counted")) }
  let overflow = (rollup?["overflowClicks"] as? NSNumber)?.intValue ?? 0
  return LinkReport(
    rows: rows, attributedClicks: attributed, overflowClicks: overflow,
    unattributedClicks: (rollup?["unattributedClicks"] as? NSNumber)?.intValue ?? 0, truncated: entries.count >= 50 || overflow > 0)
}

/// A rate as the reports print it, `12.5%`, or the em dash for a rate that was not taken.
public func percent(_ rate: SendRate?) -> String {
  guard let rate else { return "—" }
  return String(format: "%.1f%%", rate.value * 100)
}
