// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import AglynUI
import Foundation
import Observation

// A SITE'S BOOKINGS AND SERVICES, as the console's Bookings page reads and
// writes them: `hosts/{hostId}/bookings` and `hosts/{hostId}/services`, read
// by a site member under the same rules. A booking is checked in, moved,
// refunded or canceled only through the routes the console uses (and their
// own rules); one with nothing to refund is canceled with the console's own
// write. A service is created through `/api/hosts/resources` (the quota
// gate) and edited, offered, withdrawn and deleted with the console's own
// writes, through the shared form rules. The Kotlin plugin's Bookings.kt is
// the same contract.

enum BookingRoutes {
  static let checkIn = "/api/bookings/check-in"
  static let reschedule = "/api/bookings/reschedule"
  static let refund = "/api/bookings/refund"
  static let slots = "/api/bookings/slots"
  static let inPerson = "/api/bookings/in-person-payment"
  static let hostResources = "/api/hosts/resources"
}

/// A calendar range reads at most this many bookings.
let bookingsRangeLimit = 500
/// The services window the console's page holds whole.
let servicesWindow = 100

func bookingsPath(_ hostID: String) -> [String] { ["hosts", hostID, "bookings"] }
func servicesPath(_ hostID: String) -> [String] { ["hosts", hostID, "services"] }

private func millis(_ value: Any?) -> Int? {
  guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
  let double = number.doubleValue
  return double.isFinite ? Int((double + 0.5).rounded(.down)) : nil
}

public struct BookingRow: Identifiable, Equatable, @unchecked Sendable {
  public let id: String
  let serviceID: String
  let serviceName: String
  let name: String
  let email: String?
  let phone: String?
  let address: String?
  let startsAtMs: Int
  let endsAtMs: Int
  /// The zone the guest booked in, when the booking carries one.
  let timeZone: String?
  let managed: ManagedBooking
  let checkedInAtMs: Int?
  let paidAmountCents: Int
  let refundedCents: Int
  let paidInPerson: Bool
  let rescheduledFromMs: Int?
  let reminderSent: Bool
  let flagged: Bool
  let raw: [String: Any]

  init(_ doc: FirestoreDocument) {
    let data = doc.data
    id = doc.id
    serviceID = data["serviceId"] as? String ?? ""
    serviceName = (data["serviceName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Appointment"
    let email = (data["email"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    name = (data["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? email ?? "Guest"
    self.email = email
    phone = (data["phone"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    address = (data["address"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    startsAtMs = millis(data["startsAtMs"]) ?? 0
    endsAtMs = millis(data["endsAtMs"]) ?? 0
    timeZone = (data["timezone"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    managed = managedBooking(data)
    checkedInAtMs = millis(data["checkedInAtMs"]).flatMap { $0 > 0 ? $0 : nil }
    paidAmountCents = max(0, millis(data["paidAmountCents"]) ?? 0)
    refundedCents = max(0, millis(data["refundedCents"]) ?? 0)
    paidInPerson = data["paidInPerson"] as? Bool == true
    rescheduledFromMs = millis(data["rescheduledFromMs"])
    reminderSent = data["reminderSentAt"] != nil && !(data["reminderSentAt"] is NSNull)
    flagged = data["paymentRisk"] != nil && !(data["paymentRisk"] is NSNull)
    raw = data
  }

  public static func == (a: BookingRow, b: BookingRow) -> Bool {
    a.id == b.id && a.startsAtMs == b.startsAtMs && a.endsAtMs == b.endsAtMs && a.managed == b.managed
      && a.paidAmountCents == b.paidAmountCents && a.refundedCents == b.refundedCents && a.checkedInAtMs == b.checkedInAtMs
  }

  var start: Date { Date(timeIntervalSince1970: TimeInterval(startsAtMs) / 1000) }
  var end: Date { Date(timeIntervalSince1970: TimeInterval(endsAtMs) / 1000) }
  func state(_ now: Int) -> BookingState { bookingState(managed, nowMs: now) }
  func actions(_ now: Int) -> BookingActions { bookingActions(managed, nowMs: now) }
  func payment(_ now: Int) -> BookingInPersonState { bookingInPersonState(raw, nowMs: now) }
}

func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }
func ms(_ date: Date) -> Int { Int(date.timeIntervalSince1970 * 1000) }
func date(_ ms: Int) -> Date { Date(timeIntervalSince1970: TimeInterval(ms) / 1000) }

/// A booking's chip: its state, checked in, or confirmed.
func bookingChip(_ row: BookingRow, now: Int) -> (String, AglynTone) {
  let state = row.state(now)
  switch state {
  case .canceled: return (bookingStateLabel(state), .neutral)
  case .expired: return (bookingStateLabel(state), .error)
  case .pendingPayment: return (bookingStateLabel(state), .warning)
  default: return row.checkedInAtMs != nil ? ("Checked in", .success) : (bookingStateLabel(state), .info)
  }
}

func calendarEvent(_ row: BookingRow, now: Int) -> AglynCalendarEvent {
  let state = row.state(now)
  return AglynCalendarEvent(
    id: row.id, title: row.name, subtitle: row.serviceName, start: row.start,
    end: max(row.end, row.start.addingTimeInterval(15 * 60)), tone: bookingChip(row, now: now).1,
    canceled: state == .canceled || state == .expired)
}

func usd(_ cents: Int) -> String { formatReceiptMoney(cents, currency: "usd") }

enum BookingQueries {
  /// Bookings starting in [from, to), one range on `startsAtMs`; with a service, the `(serviceId, startsAtMs)` index.
  static func range(_ hostID: String, from: Int, to: Int, serviceID: String? = nil) -> FirestoreQuery {
    FirestoreQuery(
      bookingsPath(hostID), equals: serviceID.map { [("serviceId", $0 as Any)] } ?? [],
      filters: [
        ListQueryConstraint(path: "startsAtMs", op: .greaterThanOrEqual, value: from),
        ListQueryConstraint(path: "startsAtMs", op: .lessThan, value: to),
      ],
      order: [.init("startsAtMs")], limit: bookingsRangeLimit)
  }

  /// One booker's bookings, newest first: the `(email, startsAtMs)` index the console's `?email=` view reads.
  static func booker(_ hostID: String, email: String, limit: Int) -> FirestoreQuery {
    FirestoreQuery(
      bookingsPath(hostID), equals: [("email", email.trimmingCharacters(in: .whitespaces).lowercased())],
      order: [.init("startsAtMs", descending: true)], limit: limit + 1)
  }

  /// Upcoming bookings from `from`, soonest first, `limit` plus a probe row.
  static func upcoming(_ hostID: String, from: Int, limit: Int) -> FirestoreQuery {
    FirestoreQuery(
      bookingsPath(hostID), filters: [ListQueryConstraint(path: "startsAtMs", op: .greaterThanOrEqual, value: from)],
      order: [.init("startsAtMs")], limit: limit + 1)
  }
}

/// The console's reminder line: due in the next pass, and already sent.
func reminderCounts(_ rows: [BookingRow], now: Int) -> (due: Int, sent: Int) {
  (rows.filter { isBookingReminderDue($0.raw, nowMs: now) }.count, rows.filter(\.reminderSent).count)
}

public struct ServiceRow: Identifiable, Equatable, @unchecked Sendable {
  public let id: String
  let name: String
  let durationMinutes: Int
  let priceText: String
  let timeZone: String
  let draft: Bool
  let deleted: Bool
  let raw: [String: Any]

  init(_ doc: FirestoreDocument) {
    id = doc.id
    name = (doc.data["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled service"
    durationMinutes = millis(doc.data["durationMinutes"]) ?? 30
    priceText = bookingPriceText(priceUsd: doc.data["priceUsd"], priceDisplay: doc.data["priceDisplay"])
    timeZone = (doc.data["timezone"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "UTC"
    draft = doc.data["status"] as? String == "draft"
    deleted = doc.data["deletedAt"] != nil && !(doc.data["deletedAt"] is NSNull)
    raw = doc.data
  }

  public static func == (a: ServiceRow, b: ServiceRow) -> Bool {
    a.id == b.id && a.name == b.name && a.durationMinutes == b.durationMinutes && a.priceText == b.priceText
      && a.timeZone == b.timeZone && a.draft == b.draft && a.deleted == b.deleted
  }
}

/// A live Firestore list, as the plugin's screens hold one.
@MainActor
@Observable
final class LiveList<Row> {
  private(set) var rows: [Row]?
  private(set) var failed = false
  @ObservationIgnored private var listener: FirestoreListening?

  func start(_ reader: FirestoreReader, _ query: FirestoreQuery?, map: @escaping ([FirestoreDocument]) -> [Row]) {
    listener?.remove()
    guard let query else { return }
    failed = false
    listener = reader.listen(query) { [weak self] result in
      switch result {
      case .success(let docs):
        self?.rows = map(docs)
        self?.failed = false
      case .failure:
        self?.failed = true
        if self?.rows == nil { self?.rows = [] }
      }
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }
}

/// A live document.
@MainActor
@Observable
final class LiveDocument {
  private(set) var doc: FirestoreDocument?
  private(set) var loaded = false
  private(set) var failed = false
  @ObservationIgnored private var listener: FirestoreListening?

  func start(_ reader: FirestoreReader, _ path: [String]) {
    listener?.remove()
    listener = reader.listenDocument(path) { [weak self] result in
      switch result {
      case .success(let doc):
        self?.doc = doc
        self?.failed = false
      case .failure:
        self?.failed = true
      }
      self?.loaded = true
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }
}

/// The services the console lists: not deleted, by name.
func visibleServices(_ docs: [FirestoreDocument]) -> [ServiceRow] {
  docs.map(ServiceRow.init).filter { !$0.deleted }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
}

struct OpenSlots {
  let slots: [Int]
  let nextFromMs: Int?
  let timeZone: String
}

/// The writes and route calls the console makes for one site's bookings.
struct BookingsAPI {
  let api: ConsoleAPIClient
  let reader: FirestoreReader
  let hostID: String

  func checkIn(_ bookingID: String, _ checkedIn: Bool) async throws {
    try await api.request(
      BookingRoutes.checkIn, method: .post,
      body: ["hostId": .string(hostID), "bookingId": .string(bookingID), "checkedIn": .bool(checkedIn)])
  }

  func reschedule(_ bookingID: String, startsAtMs: Int) async throws {
    try await api.request(
      BookingRoutes.reschedule, method: .post,
      body: ["hostId": .string(hostID), "bookingId": .string(bookingID), "startsAtMs": .number(Double(startsAtMs))])
  }

  /// Cancels as the console does: what was paid and not refunded goes back
  /// through the refund route (which cancels a fully refunded booking); a
  /// booking with nothing to refund is canceled with the console's write.
  func cancel(_ row: BookingRow, now: Int, key: String) async throws {
    if row.actions(now).refundCents > 0 {
      try await api.request(
        BookingRoutes.refund, method: .post, body: ["hostId": .string(hostID), "bookingId": .string(row.id)],
        idempotencyKey: key)
    } else {
      try await reader.setDocument(bookingsPath(hostID) + [row.id], ["status": "canceled"], merge: true)
    }
  }

  /// Open times for a service from `from`, a page of whole days.
  func slots(serviceID: String, from: Int?) async throws -> OpenSlots {
    let body = try await api.request(
      BookingRoutes.slots, query: [("hostId", hostID), ("serviceId", serviceID), ("from", from.map(String.init))])
    var slots: [Int] = []
    if case .array(let list)? = body?["slots"] {
      for slot in list { if case .number(let start)? = slot["startsAtMs"] { slots.append(Int(start)) } }
    }
    var next: Int?
    if case .number(let value)? = body?["nextFromMs"] { next = Int(value) }
    return OpenSlots(slots: slots, nextFromMs: next, timeZone: body?["service"]?["timezone"]?.stringValue ?? "UTC")
  }

  /// A new service through the quota-checked resources route.
  func createService(_ draft: BookingServiceDraft) async throws {
    let fields = bookingServiceFirestoreFields(bookingServiceFields(draft))
    try await api.request(
      BookingRoutes.hostResources, method: .post,
      body: ["hostId": .string(hostID), "resource": "service", "data": Self.json(fields)])
  }

  /// An edit: every editable key as a merge, as the console's dialog writes it.
  func saveService(_ id: String, _ draft: BookingServiceDraft) async throws {
    var fields = bookingServiceFirestoreFields(bookingServiceFields(draft))
    fields["updatedAt"] = FirestoreSentinel.serverTimestamp
    try await reader.setDocument(servicesPath(hostID) + [id], fields, merge: true)
  }

  /// Offers a draft or withdraws a live service.
  func setServiceActive(_ id: String, _ active: Bool) async throws {
    try await reader.setDocument(
      servicesPath(hostID) + [id], ["status": active ? "active" : "draft", "updatedAt": FirestoreSentinel.serverTimestamp],
      merge: true)
  }

  /// The console's soft delete.
  func deleteService(_ id: String) async throws {
    try await reader.setDocument(servicesPath(hostID) + [id], ["deletedAt": FirestoreSentinel.serverTimestamp], merge: true)
  }

  static func json(_ value: Any) -> JSONValue {
    switch value {
    case let text as String: .string(text)
    case let flag as Bool: .bool(flag)
    case let number as Int: .number(Double(number))
    case let number as Double: .number(number)
    case let list as [Any]: .array(list.map(json))
    case let map as [String: Any]: .object(map.mapValues(json))
    default: .null
    }
  }
}

enum InPersonOutcome: Equatable {
  case paid(Int)
  case canceled
  case failed(String)
}

/// One in-person booking payment, end to end: `start` (the server prices it
/// and makes the intent), this device's reader collects the card, `settle`
/// (the server reads Stripe and captures). A failed or canceled collection
/// releases the intent; a collection whose answer was lost is settled
/// anyway, because the server's read of Stripe decides.
@MainActor
func takeBookingPayment(
  api: ConsoleAPIClient, collector: CardCollector, hostID: String, bookingID: String, serviceCents: Int,
  attemptKey: String
) async -> InPersonOutcome {
  if let problem = bookingInPersonAmountProblem(serviceCents) { return .failed(problem) }
  func body(_ action: String) -> JSONValue { ["hostId": .string(hostID), "bookingId": .string(bookingID), "action": .string(action)] }
  let started: JSONValue?
  do {
    started = try await api.request(
      BookingRoutes.inPerson, method: .post,
      body: [
        "hostId": .string(hostID), "bookingId": .string(bookingID), "action": "start",
        "amountCents": .number(Double(serviceCents)),
      ], idempotencyKey: attemptKey)
  } catch {
    return .failed(error.localizedDescription)
  }
  let intent = started?["paymentIntentId"]?.stringValue ?? ""
  let secret = started?["clientSecret"]?.stringValue ?? ""
  var amount = serviceCents
  if case .number(let value)? = started?["amountCents"] { amount = Int(value.rounded()) }
  let collected = await collector.collect(CardCollectRequest(paymentIntentID: intent, clientSecret: secret, amountCents: amount))
  switch collected {
  case .canceled:
    _ = try? await api.request(BookingRoutes.inPerson, method: .post, body: body("cancel"))
    return .canceled
  case .failed(_, let message, _):
    _ = try? await api.request(BookingRoutes.inPerson, method: .post, body: body("cancel"))
    return .failed(message.isEmpty ? "The card was not taken." : message)
  case .collected: break
  }
  do {
    let settled = try await api.request(BookingRoutes.inPerson, method: .post, body: body("settle"))
    if settled?["status"]?.stringValue == "paid" {
      if case .number(let value)? = settled?["amountCents"], value > 0 { return .paid(Int(value.rounded())) }
      return .paid(amount)
    }
    _ = try? await api.request(BookingRoutes.inPerson, method: .post, body: body("cancel"))
    return .failed("The card was not charged. Try again.")
  } catch {
    return .failed(error.localizedDescription)
  }
}
