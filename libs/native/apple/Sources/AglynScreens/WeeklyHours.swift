import Foundation

/// One open interval of a day, in minutes since midnight; an `end` earlier than `start` runs into the next morning.
struct HoursInterval: Equatable, Hashable {
  var start: Int
  var end: Int
}

/// A week of opening hours, as the console's weekly hours picker keeps it: seven days, Sunday first (as `Date#getDay`
/// counts), each a list of open intervals. Pickup hours, delivery windows and opening hours are STORED as lines of
/// `schema.org` text (`Mo-Fr 09:00-17:00`), which the storefront reads; the picker writes those same lines so nobody
/// types them. The shared cases in `weekly-hours-cases.json` hold this to the console's own conversion.
enum WeeklyHours {
  /// The week in display order, Monday first: the day's index (Sunday is 0), its name and its two-letter code.
  static let days: [(index: Int, name: String, short: String)] = [
    (1, "Monday", "Mo"), (2, "Tuesday", "Tu"), (3, "Wednesday", "We"), (4, "Thursday", "Th"),
    (5, "Friday", "Fr"), (6, "Saturday", "Sa"), (0, "Sunday", "Su"),
  ]

  /// The last minute of a day, so a day can run to midnight.
  static let lastMinute = 23 * 60 + 59

  /// Every quarter hour, then 11:59 PM.
  static let times: [Int] = (0..<96).map { $0 * 15 } + [lastMinute]

  private static let fullNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
  private static let dashPattern = #"\s*[-–—]\s*"#
  private static let linePattern = #"^(.+?)\s+(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$"#

  static func empty() -> [[HoursInterval]] { Array(repeating: [], count: 7) }

  /// `540` as `09:00`.
  static func clock(_ minutes: Int) -> String { String(format: "%02d:%02d", minutes / 60, minutes % 60) }

  /// `540` as `9:00 AM`, for a menu.
  static func label(_ minutes: Int) -> String {
    let hours = minutes / 60
    let twelve = hours % 12 == 0 ? 12 : hours % 12
    return String(format: "%d:%02d %@", twelve, minutes % 60, hours < 12 ? "AM" : "PM")
  }

  private static func dayIndex(_ token: String) -> Int {
    let wanted = token.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard wanted.count >= 2 else { return -1 }
    return fullNames.firstIndex { $0.hasPrefix(wanted) } ?? -1
  }

  private static func minutes(_ hours: String, _ minutes: String) -> Int {
    guard let h = Int(hours), let m = Int(minutes), h <= 23, m <= 59 else { return -1 }
    return h * 60 + m
  }

  /// Monday-first position, so a range reads the way a week is written.
  private static func mondayFirst(_ index: Int) -> Int { (index + 6) % 7 }

  /// What `String.split(regex)` gives in a browser: the pieces between the matches, empty ones kept.
  private static func splitDashes(_ text: String) -> [String] {
    guard let regex = try? NSRegularExpression(pattern: dashPattern) else { return [text] }
    let whole = NSRange(text.startIndex..., in: text)
    var pieces: [String] = []
    var from = text.startIndex
    for match in regex.matches(in: text, range: whole) {
      guard let range = Range(match.range, in: text) else { continue }
      pieces.append(String(text[from..<range.lowerBound]))
      from = range.upperBound
    }
    pieces.append(String(text[from...]))
    return pieces
  }

  private static func parse(_ text: String) -> (days: [Int], interval: HoursInterval)? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let regex = try? NSRegularExpression(pattern: linePattern),
      let match = regex.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)), match.numberOfRanges == 6
    else { return nil }
    func group(_ index: Int) -> String {
      Range(match.range(at: index), in: trimmed).map { String(trimmed[$0]) } ?? ""
    }
    let start = minutes(group(2), group(3))
    let end = minutes(group(4), group(5))
    if start < 0 || end < 0 { return nil }
    var days: [Int] = []
    for part in group(1).split(separator: ",", omittingEmptySubsequences: false) {
      let ends = splitDashes(part.trimmingCharacters(in: .whitespacesAndNewlines))
      if ends.count > 2 { return nil }
      let from = dayIndex(ends.first ?? "")
      let to = dayIndex(ends.last ?? "")
      if from < 0 || to < 0 { return nil }
      // A range may wrap the weekend: `Fr-Mo` is Friday through Monday.
      let span = (mondayFirst(to) - mondayFirst(from) + 7) % 7
      for step in 0...span {
        let day = (from + step) % 7
        if !days.contains(day) { days.append(day) }
      }
    }
    return days.isEmpty ? nil : (days, HoursInterval(start: start, end: end))
  }

  private static func sorted(_ intervals: [HoursInterval]) -> [HoursInterval] {
    intervals.sorted { ($0.start, $0.end) < ($1.start, $1.end) }
  }

  /// The hours text as a week, and the 1-based numbers of the lines that could not be read (so a saved time is never dropped silently).
  static func fromText(_ value: String?) -> (week: [[HoursInterval]], unread: [Int]) {
    var week = empty()
    var unread: [Int] = []
    let lines = (value ?? "").replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    for (index, text) in lines.enumerated() {
      if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
      guard let row = parse(text) else {
        unread.append(index + 1)
        continue
      }
      for day in row.days where !week[day].contains(row.interval) { week[day].append(row.interval) }
    }
    return (week.map(sorted), unread)
  }

  /// `Mo-Fr`, `Mo,We,Fr`, `Mo-We,Sa`: Monday-first indexes as a day list.
  private static func dayList(_ dayIndexes: [Int]) -> String {
    var runs: [[Int]] = []
    for position in dayIndexes.map(mondayFirst).sorted() {
      if let last = runs.last?.last, last == position - 1 { runs[runs.count - 1].append(position) } else { runs.append([position]) }
    }
    func short(_ position: Int) -> String { days[position].short }
    return runs.flatMap { run in run.count >= 3 ? ["\(short(run[0]))-\(short(run[run.count - 1]))"] : run.map(short) }
      .joined(separator: ",")
  }

  /// The week as hours text: one line per interval per set of days that share it (`Mo-Fr 09:00-17:00`).
  static func toText(_ week: [[HoursInterval]]) -> String {
    var order: [String] = []
    var groups: [String: (days: [Int], interval: HoursInterval)] = [:]
    for (index, _, _) in days {
      for interval in sorted(index < week.count ? week[index] : []) {
        let key = "\(interval.start)-\(interval.end)"
        if groups[key] == nil {
          groups[key] = ([index], interval)
          order.append(key)
        } else {
          groups[key]?.days.append(index)
        }
      }
    }
    return order.compactMap { groups[$0] }
      .enumerated()
      .sorted { a, b in
        let left = (mondayFirst(a.element.days[0]), a.element.interval.start)
        let right = (mondayFirst(b.element.days[0]), b.element.interval.start)
        return left != right ? left < right : a.offset < b.offset
      }
      .map { "\(dayList($0.element.days)) \(clock($0.element.interval.start))-\(clock($0.element.interval.end))" }
      .joined(separator: "\n")
  }
}
