// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import AglynPluginHost
import AglynUI
import SwiftUI

/// Today's bookings at the Aglyn POS counter, earliest first, with what each
/// owes; a payable one takes its payment on this device's card reader
/// through `bookings/in-person-payment`. The Kotlin `CounterBookingsScreen`
/// is the same screen.
struct CounterBookingsScreen: View {
  let context: NativePluginContext
  @State private var bookings = LiveList<BookingRow>()
  @State private var paying: BookingRow?
  @State private var notice: (String, AglynTone)?

  var body: some View {
    let now = nowMs()
    let collector = DeviceCardReaders.shared
    let rows = bookings.rows?.filter { $0.payment(now) != .canceled }
    List {
      if collector?.state.isConnected != true {
        Section {
          AglynNotice(
            collector == nil
              ? "Booking payments are taken on a device's own reader (Tap to Pay or Bluetooth), which this register does not have."
              : "Open Card readers to connect this device's reader.",
            tone: .neutral)
        }
      }
      if let (text, tone) = notice {
        Section { AglynNotice(text, tone: tone) { notice = nil } }
      }
      if let rows {
        if rows.isEmpty {
          AglynEmptyState("No bookings today", systemImage: "calendar", message: "Bookings made for today show up here.")
        }
        ForEach(rows) { row in
          let payment = row.payment(now)
          HStack(alignment: .top, spacing: AglynSpace.two) {
            VStack(alignment: .leading) {
              Text(row.start.formatted(date: .omitted, time: .shortened)).font(AglynFont.headline)
              Text(row.end.formatted(date: .omitted, time: .shortened)).font(AglynFont.caption).foregroundStyle(.secondary)
            }
            .frame(width: 76, alignment: .leading)
            VStack(alignment: .leading, spacing: AglynSpace.half) {
              Text(row.name).font(AglynFont.headline)
              Text(row.serviceName).font(AglynFont.subheadline).foregroundStyle(.secondary)
              HStack {
                StatusChip(Self.chip(payment).0, tone: Self.chip(payment).1)
                if payment == .paid, row.paidAmountCents > 0 { Text(usd(row.paidAmountCents)).font(AglynFont.subheadline) }
              }
            }
            Spacer()
            if payment == .payable {
              Button("Take payment") { paying = row }
                .buttonStyle(.borderedProminent)
                .disabled(collector?.state.isConnected != true)
                .accessibilityIdentifier("pay-\(row.id)")
            }
          }
          .padding(.vertical, AglynSpace.half)
          .contentShape(Rectangle())
          .onTapGesture { context.navigate(bookingScreen, ["booking": row.id]) }
        }
      } else {
        SkeletonRows(count: 4)
      }
    }
    .aglynListBackground()
    .navigationTitle("Today's bookings")
    .accessibilityIdentifier("pos-counter-bookings")
    .task(id: context.hostID) {
      guard let hostID = context.hostID else { return }
      let start = AglynCalendarMath.startOfDay(Date())
      bookings.start(context.firestore, BookingQueries.range(hostID, from: ms(start), to: ms(AglynCalendarMath.addDays(start, 1)))) {
        $0.map(BookingRow.init)
      }
    }
    .onDisappear { bookings.stop() }
    .sheet(item: $paying) { row in
      if let collector, let hostID = context.hostID {
        PaySheet(context: context, collector: collector, hostID: hostID, row: row) { outcome in
          notice =
            switch outcome {
            case .paid(let cents): ("\(row.name) paid \(usd(cents)).", .success)
            case .canceled: ("The payment was canceled. Nobody was charged.", .warning)
            case .failed(let message): (message, .error)
            }
        }
      }
    }
  }

  static func chip(_ state: BookingInPersonState) -> (String, AglynTone) {
    switch state {
    case .paid: ("Paid", .success)
    case .collecting: ("Card in progress", .info)
    case .awaitingOnline: ("Paying online", .info)
    case .payable: ("To pay", .warning)
    default: ("Canceled", .neutral)
    }
  }
}
