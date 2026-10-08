// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The Analytics page's figures (analytics-summary.ts,
// screen-analytics-aggregate.ts), ported once and held to the console's
// answers by the function cases. Map keys are read in Firestore's order
// (sorted), the order the console's reads hand them out in, so a tie breaks
// the same way on every platform.

private func jsRound(_ value: Double) -> Int { Int((value + 0.5).rounded(.down)) }

/// The change against the window before, to one decimal; nil when there was nothing before.
public func trafficDeltaPct(current: Double, prior: Double) -> Double? {
  guard prior != 0 else { return nil }
  return Double(jsRound((current - prior) / prior * 1000)) / 10
}

/// The device split, largest first, in whole percents.
public func deviceSplit(_ devices: [String: Double]) -> [DeviceSplitEntry] {
  let entries = devices.sorted { $0.key < $1.key }.filter { $0.value.isFinite && $0.value > 0 }
  let sum = entries.reduce(0) { $0 + $1.value }
  guard sum > 0 else { return [] }
  return stableSortedDescending(entries).map {
    DeviceSplitEntry(count: Int($0.value), device: $0.key, percent: jsRound($0.value / sum * 100))
  }
}

private func stableSortedDescending<K>(_ entries: [(key: K, value: Double)]) -> [(key: K, value: Double)] {
  entries.enumerated().sorted { $0.element.value != $1.element.value ? $0.element.value > $1.element.value : $0.offset < $1.offset }
    .map(\.element)
}

/// `Mobile / Desktop`.
public func deviceSplitLabel(_ split: [DeviceSplitEntry]) -> String {
  split.map { $0.device.prefix(1).uppercased() + $0.device.dropFirst() }.joined(separator: " / ")
}

/// `61% / 39%`.
public func deviceSplitValue(_ split: [DeviceSplitEntry]) -> String {
  split.map { "\($0.percent)%" }.joined(separator: " / ")
}

/// One field's counts summed over days (oldest first), largest first.
public func rollUp(_ days: [[String: Double]]) -> [(key: String, value: Double)] {
  var order: [String] = []
  var totals: [String: Double] = [:]
  for day in days {
    for (key, count) in day.sorted(by: { $0.key < $1.key }) {
      if totals[key] == nil { order.append(key) }
      totals[key, default: 0] += count
    }
  }
  return stableSortedDescending(order.map { (key: $0, value: totals[$0] ?? 0) })
}

/// Dwell time as `4s`, `1m 05s` or `1h 02m`.
public func formatDwell(_ ms: Double) -> String {
  let totalSeconds = max(0, jsRound(ms / 1000))
  let minutes = totalSeconds / 60
  let seconds = totalSeconds % 60
  if minutes == 0 { return "\(seconds)s" }
  if minutes < 60 { return String(format: "%dm %02ds", minutes, seconds) }
  return String(format: "%dh %02dm", minutes / 60, minutes % 60)
}

private func jsNumberOrNaN(_ value: Any?) -> Double {
  switch value {
  case nil, is NSNull: return 0
  case let number as NSNumber: return number.doubleValue
  case let text as String:
    let trimmed = text.trimmingCharacters(in: .whitespaces)
    return trimmed.isEmpty ? 0 : Double(trimmed) ?? .nan
  default: return .nan
  }
}

/// The per-page table: screen day documents (their fields) folded per page, most viewed first.
public func aggregateScreenDays(_ docs: [[String: Any]]) -> [ScreenTrafficRow] {
  var order: [String] = []
  var rows: [String: (total: Double, devices: [String: Double], referrers: [String: Double])] = [:]
  for data in docs {
    let screenID = data["screenId"] as? String ?? ""
    let total = jsNumberOrNaN(data["total"])
    guard !screenID.isEmpty, total.isFinite, total > 0 else { continue }
    if rows[screenID] == nil {
      order.append(screenID)
      rows[screenID] = (0, [:], [:])
    }
    rows[screenID]!.total += total
    for (key, count) in (data["devices"] as? [String: Any] ?? [:]) {
      let n = jsNumberOrNaN(count)
      if n.isFinite && n > 0 { rows[screenID]!.devices[key, default: 0] += n }
    }
    for (key, count) in (data["referrers"] as? [String: Any] ?? [:]) {
      let n = jsNumberOrNaN(count)
      if n.isFinite && n > 0 { rows[screenID]!.referrers[key, default: 0] += n }
    }
  }
  return stableSortedDescending(order.map { (key: $0, value: rows[$0]!.total) }).map { entry in
    let row = rows[entry.key]!
    return ScreenTrafficRow(devices: row.devices, referrers: row.referrers, screenId: entry.key, total: Int(row.total))
  }
}

private func top(_ map: [String: Double]) -> String {
  stableSortedDescending(map.sorted { $0.key < $1.key }.map { (key: $0.key, value: $0.value) }).first?.key ?? ""
}

/// The device a page was viewed on most, or empty.
public func topDevice(_ row: ScreenTrafficRow) -> String { top(row.devices) }

/// The site that sent a page the most visitors, or empty.
public func topReferrer(_ row: ScreenTrafficRow) -> String { top(row.referrers) }

/// A UTC day id, `YYYY-MM-DD`: how `hosts/{id}/analytics/{day}` is keyed.
public func analyticsDayID(_ date: Date) -> String {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(identifier: "UTC")!
  let parts = calendar.dateComponents([.year, .month, .day], from: date)
  return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
}

/// The ids of the `days` UTC days ending today, newest first (`recentDayIds`).
public func recentDayIDs(now: Date, days: Int) -> [String] {
  (0..<days).map { analyticsDayID(now.addingTimeInterval(-Double($0) * 86_400)) }
}
