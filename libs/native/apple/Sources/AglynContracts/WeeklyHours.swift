// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * The model behind the weekly hours picker (weekly-hours.ts): seven days, each
 * a list of open intervals in minutes since midnight. Index 0 is Sunday, as
 * `Date#getDay` counts.
 *
 * Opening hours, pickup hours and delivery windows are STORED as text lines in
 * `schema.org`'s `openingHours` syntax (`Mo-Fr 09:00-17:00`), which the
 * structured-data serializer and checkout read. The picker writes those same
 * lines, so nothing downstream changes; nobody types them. The Kotlin
 * contracts' WeeklyHours.kt.
 */

public struct WeeklyHoursInterval: Equatable, Hashable, Sendable {
  public var start: Int
  public var end: Int

  public init(start: Int, end: Int) {
    self.start = start
    self.end = end
  }
}

/// Seven entries, Sunday first; an empty list is a closed day.
public typealias WeeklyHours = [[WeeklyHoursInterval]]

/// A day of the week as the picker lists it: Monday first, with the index `WeeklyHours` keeps it under.
public struct WeeklyHoursDay: Sendable {
  public let index: Int
  public let name: String
  public let short: String
}

public let weeklyHoursDays: [WeeklyHoursDay] = [
  WeeklyHoursDay(index: 1, name: "Monday", short: "Mo"),
  WeeklyHoursDay(index: 2, name: "Tuesday", short: "Tu"),
  WeeklyHoursDay(index: 3, name: "Wednesday", short: "We"),
  WeeklyHoursDay(index: 4, name: "Thursday", short: "Th"),
  WeeklyHoursDay(index: 5, name: "Friday", short: "Fr"),
  WeeklyHoursDay(index: 6, name: "Saturday", short: "Sa"),
  WeeklyHoursDay(index: 0, name: "Sunday", short: "Su"),
]

private let fullNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

/// An all-closed week.
public func emptyWeeklyHours() -> WeeklyHours { Array(repeating: [], count: 7) }

private func pad2(_ value: Int) -> String { value < 10 ? "0\(value)" : "\(value)" }

/// `540` -> `09:00`.
public func formatClockMinutes(_ minutes: Int) -> String { "\(pad2(minutes / 60)):\(pad2(minutes % 60))" }

/// `540` -> `9:00 AM`, for a menu.
public func clockLabel(_ minutes: Int) -> String {
  let hours = minutes / 60
  let suffix = hours < 12 ? "AM" : "PM"
  let twelve = hours % 12 == 0 ? 12 : hours % 12
  return "\(twelve):\(pad2(minutes % 60)) \(suffix)"
}

/// A day token by its shortest unambiguous prefix (`Mo`, `Mon`, `Monday`).
private func dayIndex(_ token: String) -> Int {
  let wanted = token.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  if wanted.count < 2 { return -1 }
  return fullNames.firstIndex { $0.hasPrefix(wanted) } ?? -1
}

private func clock(_ hours: String, _ minutes: String) -> Int {
  guard let h = Int(hours), let m = Int(minutes) else { return -1 }
  return h > 23 || m > 59 ? -1 : h * 60 + m
}

private let dashes = CharacterSet(charactersIn: "-–—")

/// Monday-first position, so a range reads the way a week is written.
private func mondayFirst(_ index: Int) -> Int { (index + 6) % 7 }

private let lineExpression = try! NSRegularExpression(pattern: #"^(.+?)\s+(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$"#)

private func splitDash(_ part: String) -> [String] {
  // JavaScript's `split(/\s*[-–—]\s*/)`.
  var out: [String] = []
  var current = ""
  for scalar in part.unicodeScalars {
    if dashes.contains(scalar) {
      out.append(current.trimmingCharacters(in: .whitespacesAndNewlines))
      current = ""
    } else {
      current.unicodeScalars.append(scalar)
    }
  }
  out.append(current.trimmingCharacters(in: .whitespacesAndNewlines))
  return out
}

private func parseLine(_ line: String) -> (days: [Int], interval: WeeklyHoursInterval)? {
  let text = line.trimmingCharacters(in: .whitespacesAndNewlines)
  guard let match = lineExpression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
  func group(_ i: Int) -> String { Range(match.range(at: i), in: text).map { String(text[$0]) } ?? "" }
  let start = clock(group(2), group(3))
  let end = clock(group(4), group(5))
  if start < 0 || end < 0 { return nil }
  var days: [Int] = []
  for part in group(1).split(separator: ",", omittingEmptySubsequences: false) {
    let ends = splitDash(String(part))
    if ends.count > 2 { return nil }
    let from = dayIndex(ends[0])
    let to = dayIndex(ends[ends.count - 1])
    if from < 0 || to < 0 { return nil }
    // A range may wrap the weekend: `Fr-Mo` is Friday through Monday.
    let span = (mondayFirst(to) - mondayFirst(from) + 7) % 7
    for step in 0...span {
      let day = (from + step) % 7
      if !days.contains(day) { days.append(day) }
    }
  }
  return days.isEmpty ? nil : (days, WeeklyHoursInterval(start: start, end: end))
}

private func sortIntervals(_ intervals: [WeeklyHoursInterval]) -> [WeeklyHoursInterval] {
  intervals.sorted { $0.start != $1.start ? $0.start < $1.start : $0.end < $1.end }
}

/// Hours text read into the picker's week; the lines that did not read are returned by 1-based number, never silently dropped.
public struct ParsedWeeklyHours: Equatable, Sendable {
  public var hours: WeeklyHours
  public var unreadLines: [Int]
}

public func weeklyHoursFromText(_ value: String?) -> ParsedWeeklyHours {
  var hours = emptyWeeklyHours()
  var unread: [Int] = []
  let lines = (value ?? "").replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
  for (index, line) in lines.enumerated() {
    if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
    guard let row = parseLine(line) else {
      unread.append(index + 1)
      continue
    }
    for day in row.days where !hours[day].contains(row.interval) { hours[day].append(row.interval) }
  }
  return ParsedWeeklyHours(hours: hours.map(sortIntervals), unreadLines: unread)
}

/// Monday-first day indexes -> `Mo-Fr`, `Mo,We,Fr`, `Mo-We,Sa`.
private func dayList(_ days: [Int]) -> String {
  let positions = days.map(mondayFirst).sorted()
  var runs: [[Int]] = []
  for position in positions {
    if let last = runs.last?.last, last == position - 1 { runs[runs.count - 1].append(position) } else { runs.append([position]) }
  }
  func short(_ position: Int) -> String { weeklyHoursDays[position].short }
  return runs.flatMap { run in run.count >= 3 ? ["\(short(run[0]))-\(short(run[run.count - 1]))"] : run.map(short) }.joined(separator: ",")
}

/// The picker's week as hours text: one line per interval per set of days that share it (`Mo-Fr 09:00-17:00`).
public func weeklyHoursToText(_ hours: WeeklyHours) -> String {
  var keys: [String] = []
  var groups: [String: (days: [Int], interval: WeeklyHoursInterval)] = [:]
  for day in weeklyHoursDays {
    for interval in sortIntervals(day.index < hours.count ? hours[day.index] : []) {
      let key = "\(interval.start)-\(interval.end)"
      if groups[key] != nil {
        groups[key]!.days.append(day.index)
      } else {
        groups[key] = ([day.index], interval)
        keys.append(key)
      }
    }
  }
  return keys.compactMap { groups[$0] }
    .enumerated()
    .sorted { a, b in
      let l = mondayFirst(a.element.days[0])
      let r = mondayFirst(b.element.days[0])
      if l != r { return l < r }
      if a.element.interval.start != b.element.interval.start { return a.element.interval.start < b.element.interval.start }
      return a.offset < b.offset
    }
    .map { "\(dayList($0.element.days)) \(formatClockMinutes($0.element.interval.start))-\(formatClockMinutes($0.element.interval.end))" }
    .joined(separator: "\n")
}
