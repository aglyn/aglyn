// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

// Calendars for the apps' scheduling screens: a month grid, a day or week
// time grid, a picker of open times, and a weekly hours editor. Days are read
// on the device's calendar and zone, as the console reads them in the browser.

/// One appointment on a calendar.
public struct AglynCalendarEvent: Identifiable, Hashable, Sendable {
  public let id: String
  public let title: String
  public let subtitle: String?
  public let start: Date
  public let end: Date
  public let tone: AglynTone
  /// Drawn struck through and faded: it no longer holds its time.
  public let canceled: Bool

  public init(id: String, title: String, subtitle: String? = nil, start: Date, end: Date, tone: AglynTone = .info, canceled: Bool = false) {
    self.id = id
    self.title = title
    self.subtitle = subtitle
    self.start = start
    self.end = end
    self.tone = tone
    self.canceled = canceled
  }
}


public enum AglynCalendarMath {
  public static var calendar: Calendar {
    var calendar = Calendar.current
    calendar.firstWeekday = 1
    return calendar
  }

  /// `YYYY-MM-DD` of a moment's local day.
  public static func dayKey(_ date: Date) -> String {
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }

  public static func startOfDay(_ date: Date) -> Date { calendar.startOfDay(for: date) }

  public static func addDays(_ date: Date, _ days: Int) -> Date {
    calendar.date(byAdding: .day, value: days, to: startOfDay(date)) ?? date
  }

  public static func startOfWeek(_ date: Date) -> Date {
    let weekday = calendar.component(.weekday, from: date) - 1
    return addDays(date, -weekday)
  }

  public static func startOfMonth(_ date: Date) -> Date {
    calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
  }

  public static func addMonths(_ date: Date, _ months: Int) -> Date {
    calendar.date(byAdding: .month, value: months, to: startOfMonth(date)) ?? date
  }
}

private extension AglynTone {
  var fill: Color { self == .neutral ? Color.secondary.opacity(0.18) : color.opacity(0.18) }
}

/// A month: weekday header, then a week per row with each day's events as dots.
public struct AglynMonthGrid: View {
  let month: Date
  let selected: Date?
  let now: Date
  let tonesByDay: [String: [AglynTone]]
  let onSelect: (Date) -> Void

  public init(month: Date, selected: Date?, now: Date = .now, tonesByDay: [String: [AglynTone]], onSelect: @escaping (Date) -> Void) {
    self.month = month
    self.selected = selected
    self.now = now
    self.tonesByDay = tonesByDay
    self.onSelect = onSelect
  }

  public var body: some View {
    let first = AglynCalendarMath.startOfWeek(AglynCalendarMath.startOfMonth(month))
    let monthNumber = AglynCalendarMath.calendar.component(.month, from: month)
    let weeks = (0..<6).filter { week in
      week == 0 || AglynCalendarMath.calendar.component(.month, from: AglynCalendarMath.addDays(first, week * 7)) == monthNumber
    }
    let today = AglynCalendarMath.dayKey(now)
    let picked = selected.map(AglynCalendarMath.dayKey)
    VStack(spacing: 2) {
      HStack(spacing: 0) {
        ForEach(0..<7, id: \.self) { offset in
          Text(AglynCalendarMath.addDays(first, offset).formatted(.dateTime.weekday(.narrow)))
            .font(AglynFont.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
        }
      }
      ForEach(weeks, id: \.self) { week in
        HStack(spacing: 0) {
          ForEach(0..<7, id: \.self) { offset in
            let day = AglynCalendarMath.addDays(first, week * 7 + offset)
            let key = AglynCalendarMath.dayKey(day)
            let inMonth = AglynCalendarMath.calendar.component(.month, from: day) == monthNumber
            let tones = tonesByDay[key] ?? []
            Button {
              onSelect(day)
            } label: {
              VStack(spacing: 3) {
                Text(day.formatted(.dateTime.day()))
                  .font(AglynFont.subheadline.weight(key == today ? .bold : .regular))
                  .foregroundStyle(key == today ? AglynColor.primaryContrast : inMonth ? Color.primary : Color.secondary.opacity(0.5))
                  .frame(width: 30, height: 30)
                  .background(key == today ? AglynColor.primary : Color.clear, in: Circle())
                HStack(spacing: 2) {
                  ForEach(Array(tones.prefix(4).enumerated()), id: \.offset) { _, tone in
                    Circle().fill(tone.color).frame(width: 5, height: 5)
                  }
                }
                .frame(height: 6)
              }
              .frame(maxWidth: .infinity, minHeight: 48)
              .overlay(
                RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous)
                  .strokeBorder(key == picked ? AglynColor.tint : Color.clear, lineWidth: 2))
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(day.formatted(date: .complete, time: .omitted) + (tones.isEmpty ? ", nothing booked" : ", \(tones.count) booked"))
            .accessibilityAddTraits(key == picked ? .isSelected : [])
            .accessibilityIdentifier("day-\(key)")
          }
        }
      }
    }
    .accessibilityIdentifier("month-grid")
  }
}

/// Days side by side on an hour grid, each event a block from its start to
/// its end; overlapping ones share the column. Scrolls to the working day.
public struct AglynTimeGrid: View {
  let days: [Date]
  let events: [AglynCalendarEvent]
  let now: Date
  let selectedID: String?
  let onEvent: (AglynCalendarEvent) -> Void
  @ScaledMetric(relativeTo: .body) private var hourHeight: CGFloat = 56

  public init(days: [Date], events: [AglynCalendarEvent], now: Date = .now, selectedID: String? = nil, onEvent: @escaping (AglynCalendarEvent) -> Void) {
    self.days = days
    self.events = events
    self.now = now
    self.selectedID = selectedID
    self.onEvent = onEvent
  }

  private let gutter: CGFloat = 52

  public var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 0) {
        Color.clear.frame(width: gutter, height: 1)
        ForEach(days, id: \.self) { day in
          let isToday = AglynCalendarMath.dayKey(day) == AglynCalendarMath.dayKey(now)
          VStack(spacing: 2) {
            Text(day.formatted(.dateTime.weekday(.abbreviated))).font(AglynFont.caption).foregroundStyle(.secondary)
            Text(day.formatted(.dateTime.day()))
              .font(AglynFont.headline)
              .foregroundStyle(isToday ? AglynColor.primaryContrast : Color.primary)
              .frame(width: 32, height: 32)
              .background(isToday ? AglynColor.primary : Color.clear, in: Circle())
          }
          .frame(maxWidth: .infinity)
          .accessibilityElement(children: .combine)
        }
      }
      .padding(.vertical, AglynSpace.half)
      Divider()
      ScrollViewReader { proxy in
        ScrollView {
          ZStack(alignment: .topLeading) {
            VStack(spacing: 0) {
              ForEach(0..<24, id: \.self) { hour in
                HStack(alignment: .top, spacing: 0) {
                  Text(hour == 0 ? "" : hourLabel(hour))
                    .font(AglynFont.caption)
                    .foregroundStyle(.secondary)
                    .frame(width: gutter - 6, alignment: .trailing)
                    .offset(y: -7)
                    .padding(.trailing, 6)
                  VStack { Divider() }
                }
                .frame(height: hourHeight, alignment: .top)
                .id(hour)
              }
            }
            HStack(spacing: 0) {
              Color.clear.frame(width: gutter)
              ForEach(days, id: \.self) { day in
                dayColumn(day).frame(maxWidth: .infinity)
              }
            }
            .frame(height: hourHeight * 24)
          }
        }
        .onAppear { proxy.scrollTo(7, anchor: .top) }
      }
    }
    .accessibilityIdentifier("time-grid")
  }

  private func hourLabel(_ hour: Int) -> String {
    let date = AglynCalendarMath.calendar.date(bySettingHour: hour, minute: 0, second: 0, of: now) ?? now
    return date.formatted(.dateTime.hour())
  }

  private func dayColumn(_ day: Date) -> some View {
    let start = AglynCalendarMath.startOfDay(day)
    let end = AglynCalendarMath.addDays(start, 1)
    let dayEvents = events.filter { $0.start < end && $0.end > start }.sorted { $0.start < $1.start }
    var laneEnds: [Date] = []
    var lanes: [String: Int] = [:]
    for event in dayEvents {
      if let free = laneEnds.firstIndex(where: { $0 <= event.start }) {
        laneEnds[free] = event.end
        lanes[event.id] = free
      } else {
        laneEnds.append(event.end)
        lanes[event.id] = laneEnds.count - 1
      }
    }
    let laneCount = max(1, laneEnds.count)
    return GeometryReader { geometry in
      let laneWidth = geometry.size.width / CGFloat(laneCount)
      ZStack(alignment: .topLeading) {
        Rectangle().strokeBorder(Color.secondary.opacity(0.12), lineWidth: 0.5)
        ForEach(dayEvents) { event in
          let top = hourHeight * CGFloat(max(event.start, start).timeIntervalSince(start) / 3600)
          let height = max(hourHeight * CGFloat(min(event.end, end).timeIntervalSince(max(event.start, start)) / 3600), 22)
          Button {
            onEvent(event)
          } label: {
            VStack(alignment: .leading, spacing: 1) {
              Text(event.title).font(AglynFont.caption.weight(.semibold)).lineLimit(1).strikethrough(event.canceled)
              if height > 36 {
                Text(event.subtitle ?? event.start.formatted(date: .omitted, time: .shortened)).font(AglynFont.caption).lineLimit(1)
              }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .frame(width: laneWidth - 2, height: height - 2, alignment: .topLeading)
            .foregroundStyle(event.tone == .neutral ? Color.secondary : event.tone.color)
            .background(event.tone.fill.opacity(event.canceled ? 0.5 : 1), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(
              RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(event.id == selectedID ? event.tone.color : Color.clear, lineWidth: 2))
          }
          .buttonStyle(.plain)
          .offset(x: laneWidth * CGFloat(lanes[event.id] ?? 0) + 1, y: top + 1)
          .accessibilityLabel(
            "\(event.title), \(event.start.formatted(date: .omitted, time: .shortened)) to \(event.end.formatted(date: .omitted, time: .shortened))")
          .accessibilityIdentifier("event-\(event.id)")
        }
        if AglynCalendarMath.dayKey(day) == AglynCalendarMath.dayKey(now) {
          Rectangle().fill(AglynColor.error).frame(height: 2)
            .offset(y: hourHeight * CGFloat(now.timeIntervalSince(start) / 3600))
            .accessibilityHidden(true)
        }
      }
    }
  }
}

/// Open times grouped by day, each a chip; the picked one is selected.
public struct AglynSlotPicker: View {
  let slots: [Date]
  @Binding var selected: Date?

  public init(slots: [Date], selected: Binding<Date?>) {
    self.slots = slots
    self._selected = selected
  }

  public var body: some View {
    let days = Dictionary(grouping: slots, by: AglynCalendarMath.dayKey)
    let keys = days.keys.sorted()
    VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
      ForEach(keys, id: \.self) { key in
        let daySlots = days[key] ?? []
        Text(daySlots.first?.formatted(.dateTime.weekday(.wide).month(.wide).day()) ?? key)
          .font(AglynFont.strongSubheadline)
          .accessibilityAddTraits(.isHeader)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: AglynSpace.one)], spacing: AglynSpace.one) {
          ForEach(daySlots, id: \.self) { slot in
            AglynChoiceChip(slot.formatted(date: .omitted, time: .shortened), selected: slot == selected) { selected = slot }
              .accessibilityIdentifier("slot-\(Int(slot.timeIntervalSince1970 * 1000))")
          }
        }
      }
    }
    .accessibilityIdentifier("slot-picker")
  }
}

/// One open interval of a day, minutes since midnight.
public struct AglynHoursWindow: Hashable, Sendable {
  public var start: Int
  public var end: Int
  public init(start: Int, end: Int) {
    self.start = start
    self.end = end
  }
}

/// "9:00 AM" for minutes since midnight.
public func aglynMinutesLabel(_ minutes: Int) -> String {
  let hour = minutes / 60
  let twelve = hour % 12 == 0 ? 12 : hour % 12
  return String(format: "%d:%02d %@", twelve, minutes % 60, hour < 12 || hour == 24 ? "AM" : "PM")
}

/// A week of opening hours, Sunday first: each day's intervals (tap one to
/// change it, swipe or × to remove), and + to add one. Closed days read Closed.
public struct AglynWeeklyHoursEditor: View {
  let labels: [String]
  @Binding var days: [[AglynHoursWindow]]
  @State private var editing: Editing?

  struct Editing: Identifiable {
    let day: Int
    let index: Int?
    var window: AglynHoursWindow
    var id: String { "\(day)-\(index ?? -1)" }
  }

  public init(labels: [String], days: Binding<[[AglynHoursWindow]]>) {
    self.labels = labels
    self._days = days
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      ForEach(labels.indices, id: \.self) { day in
        let windows = day < days.count ? days[day] : []
        HStack(alignment: .firstTextBaseline) {
          Text(labels[day]).font(AglynFont.strongSubheadline).frame(width: 44, alignment: .leading)
          FlowChips(windows: windows, day: day, label: labels[day], onEdit: { index in
            editing = Editing(day: day, index: index, window: windows[index])
          }, onRemove: { index in
            days[day].remove(at: index)
          })
          Spacer(minLength: 0)
          Button {
            let last = windows.last
            editing = Editing(
              day: day, index: nil,
              window: last.map { AglynHoursWindow(start: $0.end, end: min($0.end + 60, 24 * 60)) } ?? AglynHoursWindow(start: 540, end: 1020))
          } label: {
            Image(systemName: "plus.circle")
          }
          .buttonStyle(.borderless)
          .accessibilityLabel("Add hours on \(labels[day])")
          .accessibilityIdentifier("hours-add-\(day)")
        }
      }
    }
    .accessibilityIdentifier("weekly-hours")
    .sheet(item: $editing) { item in
      TimeRangeSheet(title: "\(labels[item.day]) hours", window: item.window) { window in
        while days.count < labels.count { days.append([]) }
        if let index = item.index { days[item.day][index] = window } else { days[item.day].append(window) }
        days[item.day].sort { $0.start < $1.start }
      }
    }
  }

  private struct FlowChips: View {
    let windows: [AglynHoursWindow]
    let day: Int
    let label: String
    let onEdit: (Int) -> Void
    let onRemove: (Int) -> Void

    var body: some View {
      if windows.isEmpty {
        Text("Closed").font(AglynFont.subheadline).foregroundStyle(.secondary)
      } else {
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          ForEach(windows.indices, id: \.self) { index in
            let window = windows[index]
            HStack(spacing: AglynSpace.half) {
              Button("\(aglynMinutesLabel(window.start)) – \(aglynMinutesLabel(window.end))") { onEdit(index) }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("hours-\(day)-\(index)")
              Button {
                onRemove(index)
              } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
              }
              .buttonStyle(.borderless)
              .accessibilityLabel("Remove \(aglynMinutesLabel(window.start)) to \(aglynMinutesLabel(window.end)) on \(label)")
            }
          }
        }
      }
    }
  }
}

/// A start and an end time on the clock; the end must follow the start.
struct TimeRangeSheet: View {
  @Environment(\.dismiss) private var dismiss
  let title: String
  @State private var start: Date
  @State private var end: Date
  let onDone: (AglynHoursWindow) -> Void

  init(title: String, window: AglynHoursWindow, onDone: @escaping (AglynHoursWindow) -> Void) {
    self.title = title
    let midnight = AglynCalendarMath.startOfDay(.now)
    _start = State(initialValue: midnight.addingTimeInterval(TimeInterval(window.start * 60)))
    _end = State(initialValue: midnight.addingTimeInterval(TimeInterval(min(window.end, 24 * 60 - 1) * 60)))
    self.onDone = onDone
  }

  private func minutes(_ date: Date) -> Int {
    let parts = AglynCalendarMath.calendar.dateComponents([.hour, .minute], from: date)
    return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
  }

  var body: some View {
    let startMinutes = minutes(start)
    let endMinutes = minutes(end) == 0 ? 24 * 60 : minutes(end)
    NavigationStack {
      Form {
        DatePicker("Opens", selection: $start, displayedComponents: .hourAndMinute).accessibilityIdentifier("time-start")
        DatePicker("Closes", selection: $end, displayedComponents: .hourAndMinute).accessibilityIdentifier("time-end")
        if endMinutes <= startMinutes {
          Text("The end comes after the start.").foregroundStyle(AglynColor.error)
        }
      }
      .formStyle(.grouped)
      .navigationTitle(title)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") {
            onDone(AglynHoursWindow(start: startMinutes, end: endMinutes))
            dismiss()
          }
          .disabled(endMinutes <= startMinutes)
        }
      }
    }
    .frame(minWidth: 320, minHeight: 260)
    .presentationDetents([.medium])
  }
}

/// Previous, next, the period's name and Today, for a calendar's header.
public struct AglynCalendarHeader<Trailing: View>: View {
  let title: String
  let onPrevious: () -> Void
  let onToday: () -> Void
  let onNext: () -> Void
  let trailing: Trailing

  public init(
    _ title: String, onPrevious: @escaping () -> Void, onToday: @escaping () -> Void, onNext: @escaping () -> Void,
    @ViewBuilder trailing: () -> Trailing = { EmptyView() }
  ) {
    self.title = title
    self.onPrevious = onPrevious
    self.onToday = onToday
    self.onNext = onNext
    self.trailing = trailing()
  }

  public var body: some View {
    HStack(spacing: AglynSpace.one) {
      Button(action: onPrevious) { Image(systemName: "chevron.backward") }
        .accessibilityLabel("Previous")
        .accessibilityIdentifier("calendar-previous")
        .keyboardShortcut("[", modifiers: .command)
      Button(action: onNext) { Image(systemName: "chevron.forward") }
        .accessibilityLabel("Next")
        .accessibilityIdentifier("calendar-next")
        .keyboardShortcut("]", modifiers: .command)
      Text(title).font(AglynFont.headline).lineLimit(1).accessibilityAddTraits(.isHeader)
      Spacer(minLength: 0)
      Button("Today", action: onToday)
        .accessibilityIdentifier("calendar-today")
        .keyboardShortcut("t", modifiers: .command)
      trailing
    }
    .buttonStyle(.borderless)
  }
}
