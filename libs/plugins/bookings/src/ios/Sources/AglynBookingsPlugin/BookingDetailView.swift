// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import AglynPluginHost
import AglynUI
import SwiftUI

/// One booking by id, as a link or a notification opens it.
struct BookingScreen: View {
  let context: NativePluginContext
  let params: NativeParams

  var body: some View {
    if let id = params["booking"] {
      BookingDetailView(context: context, bookingID: id) { email in
        context.navigate(bookingsCalendarScreen, ["email": email])
      }
      .navigationTitle("Booking")
    } else {
      AglynEmptyState("This booking is not available", systemImage: "calendar.badge.exclamationmark")
    }
  }
}

/// One booking: who, when, what was paid, and what may be done to it now
/// (check in, reschedule, cancel and refund, payment at the counter).
struct BookingDetailView: View {
  let context: NativePluginContext
  let bookingID: String
  let onBooker: (String) -> Void
  @Environment(\.openURL) private var openURL
  @State private var live = LiveDocument()
  @State private var busy = false
  @State private var notice: (String, AglynTone)?
  @State private var confirmCancel = false
  @State private var cancelKey = UUID().uuidString
  @State private var rescheduling = false
  @State private var paying = false

  private var api: BookingsAPI? { context.hostID.map { BookingsAPI(api: context.api, writer: context.writer, hostID: $0) } }

  var body: some View {
    Group {
      if let doc = live.doc {
        content(BookingRow(doc))
      } else if live.failed {
        AglynEmptyState("Could not load this booking", systemImage: "exclamationmark.triangle")
      } else if live.loaded {
        AglynEmptyState("This booking is gone", systemImage: "calendar.badge.minus")
      } else {
        List { SkeletonRows(count: 5) }.aglynListBackground()
      }
    }
    .task(id: "\(context.hostID ?? ""):\(bookingID)") {
      if let hostID = context.hostID { live.start(context.firestore, bookingsPath(hostID) + [bookingID]) }
    }
    .onDisappear { live.stop() }
  }

  private func run(_ done: String, _ action: @escaping () async throws -> Void) {
    busy = true
    notice = nil
    Task {
      do {
        try await action()
        notice = (done, .success)
      } catch {
        notice = (error.localizedDescription, .error)
      }
      busy = false
    }
  }

  @ViewBuilder
  private func content(_ row: BookingRow) -> some View {
    let now = nowMs()
    let actions = row.actions(now)
    let (label, tone) = bookingChip(row, now: now)
    let payment = row.payment(now)
    let collector = DeviceCardReaders.shared
    Form {
      if let (text, noticeTone) = notice {
        Section { AglynNotice(text, tone: noticeTone) { notice = nil } }
      }
      Section {
        HStack(spacing: AglynSpace.one) {
          StatusChip(label, tone: tone)
          if row.paidInPerson { StatusChip("Paid in person", tone: .success) }
          if row.flagged { StatusChip("Payment flagged", tone: .warning) }
        }
        Text(row.name).font(AglynFont.title2).strikethrough(row.state(now) == .canceled).accessibilityAddTraits(.isHeader)
        Text(row.serviceName).foregroundStyle(.secondary)
        LabeledContent("Date", value: row.start.formatted(date: .complete, time: .omitted))
        LabeledContent(
          "Time",
          value: "\(row.start.formatted(date: .omitted, time: .shortened)) – \(row.end.formatted(date: .omitted, time: .shortened))")
        if let zone = row.timeZone, zone != TimeZone.current.identifier, let tz = TimeZone(identifier: zone) {
          LabeledContent("Where it was booked", value: "\(timeIn(row.start, tz)) · \(zone)")
        }
        if let moved = row.rescheduledFromMs {
          LabeledContent("Moved from", value: date(moved).formatted(date: .abbreviated, time: .shortened))
        }
        if let checkedIn = row.checkedInAtMs {
          LabeledContent("Checked in", value: date(checkedIn).formatted(date: .omitted, time: .shortened))
        }
      }
      Section("Guest") {
        if let email = row.email {
          Button {
            if let url = URL(string: "mailto:\(email)") { openURL(url) }
          } label: {
            Label(email, systemImage: "envelope")
          }
        }
        if let phone = row.phone {
          Button {
            if let url = URL(string: "tel:\(phone.filter { !$0.isWhitespace })") { openURL(url) }
          } label: {
            Label(phone, systemImage: "phone")
          }
        }
        if let address = row.address { Label(address, systemImage: "mappin.and.ellipse") }
        if let email = row.email {
          Button("Every booking by this guest") { onBooker(email) }
            .accessibilityIdentifier("booker-bookings")
        }
      }
      Section("Payment") {
        if row.paidAmountCents > 0 {
          LabeledContent("Paid", value: usd(row.paidAmountCents))
          if row.refundedCents > 0 { LabeledContent("Refunded", value: usd(row.refundedCents)) }
        } else if payment == .awaitingOnline {
          Text("The guest is paying online.")
        } else if payment == .collecting {
          Text("A card is being taken for it now.")
        } else {
          Text("Nothing paid.").foregroundStyle(.secondary)
        }
        if payment == .payable {
          if let collector {
            Button("Take payment") { paying = true }
              .disabled(!collector.state.isConnected || busy)
              .accessibilityIdentifier("booking-take-payment")
          } else {
            Text("Take its payment at the counter in Aglyn POS.").font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
      }
      Section {
        if actions.checkIn {
          Button {
            run("\(row.name) is checked in.") { try await api?.checkIn(row.id, true) }
          } label: {
            Label("Check in", systemImage: "person.crop.circle.badge.checkmark")
          }
          .disabled(busy)
          .accessibilityIdentifier("booking-check-in")
        }
        if actions.undoCheckIn {
          Button("Undo check-in") { run("Check-in undone.") { try await api?.checkIn(row.id, false) } }
            .disabled(busy)
            .accessibilityIdentifier("booking-undo-check-in")
        }
        if actions.reschedule {
          Button {
            rescheduling = true
          } label: {
            Label("Reschedule", systemImage: "calendar.badge.clock")
          }
          .disabled(busy)
          .accessibilityIdentifier("booking-reschedule")
        }
        if actions.cancel {
          Button(role: .destructive) {
            cancelKey = UUID().uuidString
            confirmCancel = true
          } label: {
            Label(actions.refundCents > 0 ? "Cancel and refund" : "Cancel booking", systemImage: "calendar.badge.minus")
          }
          .disabled(busy)
          .accessibilityIdentifier("booking-cancel")
        }
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .accessibilityIdentifier("booking-detail")
    .confirmationDialog(
      "Cancel this booking?", isPresented: $confirmCancel, titleVisibility: .visible
    ) {
      Button(actions.refundCents > 0 ? "Refund \(usd(actions.refundCents)) and cancel" : "Cancel booking", role: .destructive) {
        run(actions.refundCents > 0 ? "Refunded and canceled." : "Canceled.") { [cancelKey] in
          try await api?.cancel(row, now: nowMs(), key: cancelKey)
        }
      }
      Button("Keep it", role: .cancel) {}
    } message: {
      Text(actions.refundCents > 0 ? "\(usd(actions.refundCents)) goes back to \(row.name), and the time opens up again." : "\(row.name)'s time opens up again.")
    }
    .sheet(isPresented: $rescheduling) {
      if let api {
        RescheduleSheet(api: api, row: row) { startsAtMs in
          run(
            "Moved to \(date(startsAtMs).formatted(date: .abbreviated, time: .shortened)). \(row.name) was emailed."
          ) { try await api.reschedule(row.id, startsAtMs: startsAtMs) }
        }
      }
    }
    .sheet(isPresented: $paying) {
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

  private func timeIn(_ date: Date, _ zone: TimeZone) -> String {
    var style = Date.FormatStyle(date: .omitted, time: .shortened)
    style.timeZone = zone
    return date.formatted(style)
  }
}

/// Open times for the booking's service, a page of whole days at a time.
struct RescheduleSheet: View {
  @Environment(\.dismiss) private var dismiss
  let api: BookingsAPI
  let row: BookingRow
  let onPick: (Int) -> Void
  @State private var slots: [Date]?
  @State private var next: Int?
  @State private var zone: String?
  @State private var error: String?
  @State private var picked: Date?
  @State private var loading = false

  var body: some View {
    let refusal = picked.flatMap { rescheduleRefusal(row.managed, startsAtMs: ms($0), nowMs: nowMs()) }
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: AglynSpace.two) {
          Text("Pick an open time for \(row.serviceName). The guest is emailed the new time.")
            .font(AglynFont.subheadline).foregroundStyle(.secondary)
          if let message = error ?? refusal { AglynNotice(message, tone: .error) }
          if let slots {
            if slots.isEmpty && next == nil {
              Text("No open times left in the booking window.")
            } else {
              AglynSlotPicker(slots: slots, selected: $picked)
            }
            if next != nil {
              Button(loading ? "Loading…" : "Later times") { load(next) }
                .disabled(loading)
                .accessibilityIdentifier("slots-more")
            }
          } else {
            ProgressView().frame(maxWidth: .infinity)
          }
          if let zone, zone != TimeZone.current.identifier {
            Text("Times are shown on this device's clock; the service runs on \(zone).")
              .font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
        .padding(AglynSpace.two)
      }
      .navigationTitle("Move \(row.name)'s booking")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Move it") {
            if let picked { onPick(ms(picked)) }
            dismiss()
          }
          .disabled(picked == nil || refusal != nil)
          .accessibilityIdentifier("reschedule-confirm")
        }
      }
      .task { load(nil) }
    }
    .frame(minWidth: 420, minHeight: 480)
  }

  private func load(_ from: Int?) {
    loading = true
    Task {
      do {
        let page = try await api.slots(serviceID: row.serviceID, from: from)
        // The booking's own time is not a move.
        slots = (slots ?? []) + page.slots.filter { $0 != row.startsAtMs }.map(date)
        next = page.nextFromMs
        zone = page.timeZone
        error = nil
      } catch {
        self.error = error.localizedDescription
        if slots == nil { slots = [] }
      }
      loading = false
    }
  }
}

/// The amount to charge at the counter, then the card on this device's reader.
struct PaySheet: View {
  @Environment(\.dismiss) private var dismiss
  let context: NativePluginContext
  let collector: CardCollector
  let hostID: String
  let row: BookingRow
  let onDone: (InPersonOutcome) -> Void
  @State private var text = ""
  @State private var busy = false
  @State private var service = LiveDocument()

  private var cents: Int? {
    let cleaned = text.filter { $0.isNumber || $0 == "." }
    guard let value = Double(cleaned), value.isFinite else { return nil }
    return Int((value * 100).rounded())
  }

  var body: some View {
    let problem = bookingInPersonAmountProblem(cents)
    NavigationStack {
      Form {
        Section {
          TextField("Amount", text: $text)
            #if os(iOS)
              .keyboardType(.decimalPad)
            #endif
            .accessibilityIdentifier("pay-amount")
          if let cents, problem == nil {
            Text("Charge \(usd(cents)) + tax").foregroundStyle(.secondary)
          } else if !text.isEmpty, let problem {
            Text(problem).foregroundStyle(AglynColor.error)
          }
        } header: {
          Text("\(row.name) · \(row.serviceName)")
        }
        if busy, let prompt = collector.prompt {
          Section { Label(prompt, systemImage: "wave.3.right") }
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Take payment")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") {
            if busy { Task { await collector.cancel() } } else { dismiss() }
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(busy ? "Charging…" : "Charge") { charge() }
            .disabled(problem != nil || busy)
            .accessibilityIdentifier("pay-charge")
        }
      }
      .task(id: row.serviceID) {
        service.start(context.firestore, servicesPath(hostID) + [row.serviceID])
      }
      .onChange(of: service.doc?.id) {
        if text.isEmpty, let data = service.doc?.data,
          let suggested = bookingSuggestedCents(priceUsd: data["priceUsd"], priceDisplay: data["priceDisplay"])
        {
          text = String(format: "%d.%02d", suggested / 100, suggested % 100)
        }
      }
    }
    .frame(minWidth: 360, minHeight: 300)
  }

  private func charge() {
    guard let cents else { return }
    busy = true
    Task {
      let outcome = await takeBookingPayment(
        api: context.api, collector: collector, hostID: hostID, bookingID: row.id, serviceCents: cents,
        attemptKey: "booking-\(UUID().uuidString)")
      busy = false
      onDone(outcome)
      dismiss()
    }
  }
}
