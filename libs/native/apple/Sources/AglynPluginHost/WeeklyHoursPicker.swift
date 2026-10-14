// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynUI
import SwiftUI

private let lastMinute = 23 * 60 + 59

/// Every quarter hour, plus 11:59 PM so a day can run to midnight.
private let timeOptions: [Int] = (0..<96).map { $0 * 15 } + [lastMinute]

/// A week of opening hours chosen by clicking: a switch per day, and for an open day one or more From/To times picked
/// from a menu. Nothing is typed. `sameDay` makes every interval end on the day it starts: the To menu offers only
/// times after From; off by default, where a To before From runs past midnight. The console's WeeklyHoursPicker.
public struct WeeklyHoursPicker: View {
  @Binding var hours: WeeklyHours
  let label: String?
  let footer: String?
  let enabled: Bool
  let defaultInterval: WeeklyHoursInterval
  let intervalNoun: String
  let sameDay: Bool

  public init(
    hours: Binding<WeeklyHours>, label: String? = nil, footer: String? = nil, enabled: Bool = true,
    defaultInterval: WeeklyHoursInterval = WeeklyHoursInterval(start: 9 * 60, end: 17 * 60), intervalNoun: String = "hours",
    sameDay: Bool = false
  ) {
    _hours = hours
    self.label = label
    self.footer = footer
    self.enabled = enabled
    self.defaultInterval = defaultInterval
    self.intervalNoun = intervalNoun
    self.sameDay = sameDay
  }

  private func intervals(_ day: Int) -> [WeeklyHoursInterval] { day < hours.count ? hours[day] : [] }

  private func setDay(_ day: Int, _ next: [WeeklyHoursInterval]) {
    if hours.count < 7 { hours = emptyWeeklyHours() }
    hours[day] = next
  }

  private func options(_ current: Int, after: Int?) -> [Int] {
    let all = timeOptions.contains(current) ? timeOptions : (timeOptions + [current]).sorted()
    return all.filter { after == nil || $0 > after! || $0 == current }
  }

  private func changed(_ interval: WeeklyHoursInterval, start: Bool, to minutes: Int) -> WeeklyHoursInterval {
    var next = interval
    if start { next.start = minutes } else { next.end = minutes }
    // A From moved past its To drags the To along, keeping the length.
    if sameDay, next.end <= next.start { next.end = min(next.start + max(interval.end - interval.start, 60), lastMinute) }
    return next
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      if let label { Text(label).font(AglynFont.strongSubheadline) }
      ForEach(weeklyHoursDays, id: \.index) { day in
        let list = intervals(day.index)
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          Toggle(
            day.name,
            isOn: Binding(get: { !list.isEmpty }, set: { on in setDay(day.index, on ? [defaultInterval] : []) })
          )
          .disabled(!enabled)
          .accessibilityIdentifier("hours-day-\(day.index)")
          if list.isEmpty {
            Text("Closed").font(AglynFont.caption).foregroundStyle(.secondary)
          } else {
            ForEach(Array(list.enumerated()), id: \.offset) { position, interval in
              HStack {
                timePicker("From", interval.start, after: nil) { setDay(day.index, replacing(list, position, changed(interval, start: true, to: $0))) }
                timePicker("To", interval.end, after: sameDay ? interval.start : nil) {
                  setDay(day.index, replacing(list, position, changed(interval, start: false, to: $0)))
                }
                Button(role: .destructive) {
                  setDay(day.index, list.enumerated().filter { $0.offset != position }.map(\.element))
                } label: {
                  Image(systemName: "xmark.circle.fill")
                }
                .buttonStyle(.borderless)
                .disabled(!enabled)
                .accessibilityLabel("Remove \(day.name) \(intervalNoun)\(list.count > 1 ? " \(position + 1)" : "")")
              }
            }
            Button("Add \(intervalNoun)") {
              // A second interval starts an hour after the first ends, the usual shape of a lunch break.
              let start = min((list.last?.end ?? 0) + 60, 22 * 60)
              setDay(day.index, list + [WeeklyHoursInterval(start: start, end: min(start + 4 * 60, lastMinute))])
            }
            .disabled(!enabled)
            .accessibilityIdentifier("hours-add-\(day.index)")
          }
        }
      }
      if let footer { Text(footer).font(AglynFont.caption).foregroundStyle(.secondary) }
    }
  }

  private func replacing(_ list: [WeeklyHoursInterval], _ position: Int, _ next: WeeklyHoursInterval) -> [WeeklyHoursInterval] {
    list.enumerated().map { $0.offset == position ? next : $0.element }
  }

  private func timePicker(_ title: String, _ value: Int, after: Int?, _ set: @escaping (Int) -> Void) -> some View {
    Picker(title, selection: Binding(get: { value }, set: set)) {
      ForEach(options(value, after: after), id: \.self) { Text(clockLabel($0)).tag($0) }
    }
    .disabled(!enabled)
  }
}

/// `WeeklyHoursPicker` over the stored hours text: reads the lines into a week and writes the week back as lines, so what is
/// saved is unchanged. Saved lines the picker cannot read are named under it.
public struct OpeningHoursPicker: View {
  @Binding var text: String
  let label: String?
  let footer: String?
  let enabled: Bool
  let defaultInterval: WeeklyHoursInterval
  let intervalNoun: String
  let sameDay: Bool

  public init(
    text: Binding<String>, label: String? = nil, footer: String? = nil, enabled: Bool = true,
    defaultInterval: WeeklyHoursInterval = WeeklyHoursInterval(start: 9 * 60, end: 17 * 60), intervalNoun: String = "hours",
    sameDay: Bool = false
  ) {
    _text = text
    self.label = label
    self.footer = footer
    self.enabled = enabled
    self.defaultInterval = defaultInterval
    self.intervalNoun = intervalNoun
    self.sameDay = sameDay
  }

  public var body: some View {
    let parsed = weeklyHoursFromText(text)
    WeeklyHoursPicker(
      hours: Binding(get: { parsed.hours }, set: { text = weeklyHoursToText($0) }), label: label,
      footer: parsed.unreadLines.isEmpty
        ? footer
        : "Some saved hours could not be read (line \(parsed.unreadLines.map(String.init).joined(separator: ", "))) and are not shown. Set the days again here and save to replace them.",
      enabled: enabled, defaultInterval: defaultInterval, intervalNoun: intervalNoun, sameDay: sameDay)
  }
}
