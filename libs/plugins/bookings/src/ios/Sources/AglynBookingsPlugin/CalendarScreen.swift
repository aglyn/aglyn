// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

enum CalendarMode: String, CaseIterable, Identifiable {
  case list, day, week, month
  var id: String { rawValue }
  var label: String {
    switch self {
    case .list: "Upcoming"
    case .day: "Day"
    case .week: "Week"
    case .month: "Month"
    }
  }
}

/// The range a mode shows around `anchor`: the day, its Sunday-first week, or its month.
func calendarRange(_ mode: CalendarMode, anchor: Date) -> (Date, Date) {
  switch mode {
  case .day, .list:
    let start = AglynCalendarMath.startOfDay(anchor)
    return (start, AglynCalendarMath.addDays(start, 1))
  case .week:
    let start = AglynCalendarMath.startOfWeek(anchor)
    return (start, AglynCalendarMath.addDays(start, 7))
  case .month:
    let start = AglynCalendarMath.startOfMonth(anchor)
    return (start, AglynCalendarMath.addMonths(start, 1))
  }
}

func stepAnchor(_ mode: CalendarMode, _ anchor: Date, _ step: Int) -> Date {
  switch mode {
  case .day, .list: AglynCalendarMath.addDays(anchor, step)
  case .week: AglynCalendarMath.addDays(anchor, step * 7)
  case .month: AglynCalendarMath.addMonths(anchor, step)
  }
}

/// The Bookings page, natively: the site's bookings on a calendar (day, week
/// and month) or as the upcoming list the console shows, one booker's
/// bookings from a CRM link (`?email=`), and the picked booking beside it on
/// iPad and Mac.
struct BookingsCalendarScreen: View {
  let context: NativePluginContext
  let params: NativeParams
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var mode: CalendarMode?
  @State private var anchor = Date()
  @State private var serviceFilter: String?
  @State private var booker: String?
  @State private var selection: String?
  @State private var shown = 50
  @State private var bookings = LiveList<BookingRow>()
  @State private var services = LiveList<ServiceRow>()
  @State private var started = false

  private var effectiveMode: CalendarMode { mode ?? (sizeClass == .compact ? .list : .week) }

  private var query: FirestoreQuery? {
    guard let hostID = context.hostID else { return nil }
    if let booker { return BookingQueries.booker(hostID, email: booker, limit: shown) }
    let now = Date()
    switch effectiveMode {
    case .list: return BookingQueries.upcoming(hostID, from: ms(AglynCalendarMath.startOfDay(now)), limit: shown)
    case .month:
      let first = AglynCalendarMath.startOfWeek(AglynCalendarMath.startOfMonth(anchor))
      return BookingQueries.range(hostID, from: ms(first), to: ms(AglynCalendarMath.addDays(first, 42)), serviceID: serviceFilter)
    default:
      let (from, to) = calendarRange(effectiveMode, anchor: anchor)
      return BookingQueries.range(hostID, from: ms(from), to: ms(to), serviceID: serviceFilter)
    }
  }

  private var queryKey: String {
    "\(context.hostID ?? ""):\(booker ?? ""):\(effectiveMode.rawValue):\(ms(calendarRange(effectiveMode, anchor: anchor).0)):\(serviceFilter ?? ""):\(shown)"
  }

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          calendar(wide: true).frame(minWidth: 420, maxWidth: .infinity)
          Divider()
          Group {
            if let selection {
              BookingDetailView(context: context, bookingID: selection) { email in
                booker = email
                self.selection = nil
              }
            } else {
              AglynEmptyState("Pick a booking to see it here", systemImage: "calendar")
            }
          }
          .frame(minWidth: 320, idealWidth: 380, maxWidth: 440)
        }
      } else {
        calendar(wide: false)
      }
    }
    .navigationTitle("Bookings")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          context.navigate(bookingsServicesScreen)
        } label: {
          Label("Services", systemImage: "list.bullet.rectangle")
        }
        .accessibilityIdentifier("open-services")
      }
    }
    .onAppear {
      guard !started else { return }
      started = true
      serviceFilter = params["service"]
      booker = params["email"].flatMap { $0.isEmpty ? nil : $0 }
      selection = params["booking"]
    }
    .task(id: queryKey) {
      bookings.start(context.firestore, query) { $0.map(BookingRow.init) }
    }
    .task(id: context.hostID) {
      if let hostID = context.hostID {
        services.start(context.firestore, FirestoreQuery(servicesPath(hostID), limit: servicesWindow), map: visibleServices)
      }
    }
    .onDisappear {
      bookings.stop()
      services.stop()
    }
  }

  private func open(_ id: String, wide: Bool) {
    if wide { selection = id } else { context.navigate(bookingScreen, ["booking": id]) }
  }

  @ViewBuilder
  private func calendar(wide: Bool) -> some View {
    let now = nowMs()
    let rows = bookings.rows.map { list in
      serviceFilter != nil && (booker != nil || effectiveMode == .list) ? list.filter { $0.serviceID == serviceFilter } : list
    }
    VStack(spacing: 0) {
      toolbar
      if let booker {
        AglynNotice("Bookings for \(booker)", tone: .info) { self.booker = nil }
          .padding(.horizontal, AglynSpace.two)
          .accessibilityIdentifier("booker-banner")
      } else if effectiveMode != .list {
        let (from, to) = calendarRange(effectiveMode, anchor: anchor)
        AglynCalendarHeader(
          title(from: from, to: to), onPrevious: { anchor = stepAnchor(effectiveMode, anchor, -1) },
          onToday: { anchor = Date() }, onNext: { anchor = stepAnchor(effectiveMode, anchor, 1) }
        )
        .padding(.horizontal, AglynSpace.two)
        .padding(.vertical, AglynSpace.one)
      }
      Group {
        if let rows {
          if bookings.failed && rows.isEmpty {
            AglynEmptyState("Could not load bookings", systemImage: "exclamationmark.triangle")
          } else if booker != nil || effectiveMode == .list {
            agenda(rows: Array(rows.prefix(shown)), now: now, wide: wide, more: rows.count > shown)
          } else if effectiveMode == .month {
            month(rows: rows, now: now, wide: wide)
          } else {
            let (from, _) = calendarRange(effectiveMode, anchor: anchor)
            AglynTimeGrid(
              days: effectiveMode == .day ? [from] : (0..<7).map { AglynCalendarMath.addDays(from, $0) },
              events: rows.map { calendarEvent($0, now: now) }, selectedID: selection
            ) { open($0.id, wide: wide) }
          }
        } else {
          List { SkeletonRows(count: 6) }.aglynListBackground()
        }
      }
      .frame(maxHeight: .infinity)
    }
    .accessibilityIdentifier("bookings-calendar")
  }

  private func title(from: Date, to: Date) -> String {
    switch effectiveMode {
    case .day: from.formatted(.dateTime.weekday(.wide).month(.wide).day())
    case .week:
      "\(from.formatted(.dateTime.month(.abbreviated).day())) – \(AglynCalendarMath.addDays(to, -1).formatted(.dateTime.month(.abbreviated).day().year()))"
    default: from.formatted(.dateTime.month(.wide).year())
    }
  }

  private var toolbar: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      if booker == nil {
        Picker("View", selection: Binding(get: { effectiveMode }, set: { mode = $0 })) {
          ForEach(CalendarMode.allCases) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("calendar-mode")
      }
      if let list = services.rows, list.count > 1 {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: AglynSpace.one) {
            AglynChoiceChip("All services", selected: serviceFilter == nil) { serviceFilter = nil }
            ForEach(list) { service in
              AglynChoiceChip(service.name, selected: serviceFilter == service.id) { serviceFilter = service.id }
            }
          }
        }
        .accessibilityIdentifier("service-filter")
      }
    }
    .padding(.horizontal, AglynSpace.two)
    .padding(.top, AglynSpace.one)
  }

  @ViewBuilder
  private func agenda(rows: [BookingRow], now: Int, wide: Bool, more: Bool) -> some View {
    let days = Dictionary(grouping: rows) { AglynCalendarMath.dayKey($0.start) }
    let keys = booker == nil ? days.keys.sorted() : days.keys.sorted(by: >)
    List {
      if booker == nil {
        let counts = reminderCounts(rows, now: now)
        Text("24-hour reminders · \(counts.due) due in the next pass · \(counts.sent) already sent")
          .font(AglynFont.caption)
          .foregroundStyle(.secondary)
          .accessibilityIdentifier("reminder-line")
      }
      if rows.isEmpty {
        AglynEmptyState(
          booker.map { "No bookings for \($0)" } ?? "No upcoming bookings", systemImage: "calendar",
          message: "Bookings made on your site show up here.")
      }
      ForEach(keys, id: \.self) { key in
        Section(days[key]?.first?.start.formatted(.dateTime.weekday(.wide).month(.wide).day()) ?? key) {
          ForEach(days[key] ?? []) { row in
            Button {
              open(row.id, wide: wide)
            } label: {
              BookingListRow(row: row, now: now, selected: row.id == selection)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("booking-\(row.id)")
          }
        }
      }
      if more {
        Button("Show more") { shown += 50 }
          .frame(maxWidth: .infinity)
          .accessibilityIdentifier("bookings-more")
      }
    }
    .aglynListBackground()
    .accessibilityIdentifier("bookings-list")
  }

  @ViewBuilder
  private func month(rows: [BookingRow], now: Int, wide: Bool) -> some View {
    let byDay = Dictionary(grouping: rows) { AglynCalendarMath.dayKey($0.start) }
    let picked = byDay[AglynCalendarMath.dayKey(anchor)] ?? []
    List {
      AglynMonthGrid(
        month: anchor, selected: anchor, tonesByDay: byDay.mapValues { $0.map { bookingChip($0, now: now).1 } }
      ) { anchor = $0 }
      Section(anchor.formatted(.dateTime.weekday(.wide).month(.wide).day())) {
        if picked.isEmpty {
          Text("Nothing booked.").foregroundStyle(.secondary)
        }
        ForEach(picked) { row in
          Button {
            open(row.id, wide: wide)
          } label: {
            BookingListRow(row: row, now: now, selected: row.id == selection)
          }
          .buttonStyle(.plain)
        }
      }
    }
    .aglynListBackground()
  }
}

struct BookingListRow: View {
  let row: BookingRow
  let now: Int
  var selected = false

  var body: some View {
    let (label, tone) = bookingChip(row, now: now)
    let canceled = row.state(now) == .canceled
    AglynRow(
      "\(row.serviceName) — \(row.name)",
      subtitle: "\(row.start.formatted(date: .omitted, time: .shortened)) – \(row.end.formatted(date: .omitted, time: .shortened))"
        + (row.email.map { " · \($0)" } ?? ""),
      systemImage: canceled ? "calendar.badge.minus" : "calendar",
      tint: canceled ? .secondary : nil
    ) {
      HStack(spacing: AglynSpace.half) {
        if row.paidAmountCents > 0 { Text(usd(row.paidAmountCents)).font(AglynFont.caption) }
        StatusChip(label, tone: tone)
      }
    }
    .padding(.vertical, 2)
    .background(selected ? AglynColor.tint.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
  }
}

/// Home's bookings card: today's count and who is next.
struct BookingsTodayWidget: View {
  let context: NativePluginContext
  @State private var bookings = LiveList<BookingRow>()

  var body: some View {
    let now = nowMs()
    let rows = bookings.rows?.filter { $0.state(now) != .canceled && $0.state(now) != .expired }
    let next = rows?.first { $0.endsAtMs > now }
    MetricCard(
      "Today's bookings", systemImage: "calendar",
      value: rows.map { "\($0.count)" },
      caption: next.map { "Next: \($0.start.formatted(date: .omitted, time: .shortened)) · \($0.name)" }
        ?? (rows?.isEmpty == true ? "Nothing booked today" : "All done for today"),
      actionLabel: "Opens Bookings",
      failed: bookings.failed ? "Could not load bookings." : nil
    ) {
      context.navigate(bookingsCalendarScreen)
    }
    .accessibilityIdentifier("bookings-today")
    .task(id: context.hostID) {
      guard let hostID = context.hostID else { return }
      let start = AglynCalendarMath.startOfDay(Date())
      bookings.start(
        context.firestore, BookingQueries.range(hostID, from: ms(start), to: ms(AglynCalendarMath.addDays(start, 1)))
      ) { $0.map(BookingRow.init) }
    }
    .onDisappear { bookings.stop() }
  }
}
