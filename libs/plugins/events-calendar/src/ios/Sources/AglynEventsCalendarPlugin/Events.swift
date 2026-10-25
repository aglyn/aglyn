// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynSite
import AglynUI
import Observation
import SwiftUI

// A SITE'S EVENTS, as the Events page keeps them: `hosts/{hostId}/events`,
// the newest 200 by start; add or edit one with the page's own rule
// (`eventWrite`) and its own merge write, and delete one the way the page
// does (`deletedAt` with `status: deleted`, which the public listing reads).
// The Kotlin plugin's Events.kt is the same contract.

public let eventsScreen = "events-calendar.events"

/// The page's ceiling: the newest 200, plus a probe row that says there is more.
let eventCeiling = 200

func eventsPath(_ hostID: String) -> [String] { ["hosts", hostID, "events"] }

struct EventRow: Identifiable, Equatable {
  let id: String
  let title: String
  let startsAtMs: Int
  let endsAtMs: Int?
  let location: String
  let organizer: String
  let description: String
  let coverImage: String
  let coverImageAlt: String
  let status: String
  let deleted: Bool

  init(_ doc: FirestoreDocument) {
    id = doc.id
    title = doc.string("title") ?? ""
    startsAtMs = doc.int("startsAtMs") ?? 0
    endsAtMs = doc.int("endsAtMs")
    location = doc.string("location") ?? ""
    organizer = doc.string("organizer") ?? ""
    description = doc.string("description") ?? ""
    coverImage = doc.string("coverImage") ?? ""
    coverImageAlt = doc.string("coverImageAlt") ?? ""
    status = doc.string("status") ?? "draft"
    deleted = doc.data["deletedAt"] != nil && !(doc.data["deletedAt"] is NSNull)
  }

  var start: Date { Date(timeIntervalSince1970: TimeInterval(startsAtMs) / 1000) }
}

/// The page's list: the window minus the deleted, newest first; and whether the window was full.
func visibleEvents(_ docs: [FirestoreDocument]) -> (rows: [EventRow], full: Bool) {
  (docs.prefix(eventCeiling).map(EventRow.init).filter { !$0.deleted }.sorted { $0.startsAtMs > $1.startsAtMs }, docs.count > eventCeiling)
}

/// The editor as typed.
struct EventDraft: Equatable {
  var id: String?
  var title = ""
  var startsAt: Date?
  var endsAt: Date?
  var location = ""
  var organizer = ""
  var description = ""
  var coverImage = ""
  var coverImageAlt = ""
  var status: EventStatus = .draft

  init(id: String? = nil) { self.id = id }

  init(_ row: EventRow) {
    id = row.id
    title = row.title
    startsAt = row.startsAtMs > 0 ? row.start : nil
    endsAt = row.endsAtMs.map { Date(timeIntervalSince1970: TimeInterval($0) / 1000) }
    location = row.location
    organizer = row.organizer
    description = row.description
    coverImage = row.coverImage
    coverImageAlt = row.coverImageAlt
    status = row.status == "published" ? .published : .draft
  }

  var startsAtMs: Int { startsAt.map { Int($0.timeIntervalSince1970 * 1000) } ?? 0 }
}

/// The page's save: the shared rule's stored form as a merge, every field the
/// rule removes deleted (a merge would keep it), `updatedAt`, and `createdAt`
/// on a new event.
func eventMerge(_ draft: EventDraft) -> [String: Any]? {
  guard
    let write = eventWrite(
      EventWriteInput(
        coverImage: draft.coverImage, coverImageAlt: draft.coverImageAlt, description: draft.description,
        endsAtMs: draft.endsAt.map { Int($0.timeIntervalSince1970 * 1000) }, location: draft.location,
        organizer: draft.organizer, startsAtMs: draft.startsAtMs, status: draft.status, title: draft.title))
  else { return nil }
  let fields = write.fields
  var merge: [String: Any] = [
    "title": fields.title, "startsAtMs": fields.startsAtMs, "endsAtMs": fields.endsAtMs, "status": fields.status.rawValue,
    "updatedAt": FirestoreSentinel.serverTimestamp,
  ]
  if let value = fields.location { merge["location"] = value }
  if let value = fields.organizer { merge["organizer"] = value }
  if let value = fields.description { merge["description"] = value }
  if let value = fields.coverImage { merge["coverImage"] = value }
  if let value = fields.coverImageAlt { merge["coverImageAlt"] = value }
  for field in write.remove { merge[field.rawValue] = FirestoreSentinel.delete }
  if draft.id == nil { merge["createdAt"] = FirestoreSentinel.serverTimestamp }
  return merge
}

/// A new event's id, the length and alphabet of the console's resource ids.
func newEventID() -> String {
  let alphabet = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
  return String((0..<20).map { _ in alphabet.randomElement()! })
}

@MainActor
@Observable
final class HostEvents {
  private(set) var rows: [EventRow]?
  private(set) var full = false
  private(set) var failed = false
  @ObservationIgnored private var listener: FirestoreListening?

  func start(_ reader: FirestoreReader, hostID: String?) {
    listener?.remove()
    guard let hostID else { return }
    listener = reader.listen(
      FirestoreQuery(eventsPath(hostID), order: [.init("startsAtMs", descending: true)], limit: eventCeiling + 1)
    ) { [weak self] result in
      switch result {
      case .success(let docs):
        let visible = visibleEvents(docs)
        self?.rows = visible.rows
        self?.full = visible.full
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

/// The site's events, the picked one's editor beside the list on iPad and Mac.
struct EventsScreen: View {
  let context: NativePluginContext
  /// Opened from Create new (`new=1`): its create form comes up on arrival.
  var startNew = false
  @State private var startedNew = false
  @State private var events = HostEvents()
  @State private var selection: String?
  @State private var adding = false
  @State private var notice: (String, AglynTone)?
  @State private var deleting: EventRow?
  @Environment(\.horizontalSizeClass) private var sizeClass

  private static let newID = "new"

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          list(selectable: true).frame(minWidth: 300, idealWidth: 360, maxWidth: 420)
          Divider()
          detail.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        list(selectable: false)
      }
    }
    .navigationTitle("Events")
    .aglynScreenTitle("Events")
    .aglynPrimaryAction(id: "add-event", "Add event", systemImage: "plus") {
      if sizeClass == .compact { adding = true } else { selection = Self.newID }
    }
    .sheet(isPresented: $adding) { NavigationStack { editor(for: nil) } }
    .onAppear {
      guard startNew, !startedNew else { return }
      startedNew = true
      if sizeClass == .compact { adding = true } else { selection = Self.newID }
    }
    .task(id: context.hostID) { events.start(context.firestore, hostID: context.hostID) }
    .onDisappear { events.stop() }
    .confirmationDialog(
      "Delete this event?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
      titleVisibility: .visible, presenting: deleting
    ) { row in
      Button("Delete", role: .destructive) {
        run("Event deleted.") {
          guard let hostID = context.hostID else { return }
          try await context.writer.merge(eventsPath(hostID) + [row.id], ["deletedAt": FirestoreSentinel.serverTimestamp, "status": "deleted"])
        }
        if selection == row.id { selection = nil }
      }
    } message: { row in
      Text("\"\(row.title)\" disappears from your site.")
    }
  }

  private func run(_ done: String, _ action: @escaping () async throws -> Void) {
    notice = nil
    Task {
      do {
        try await action()
        notice = (done, .success)
      } catch {
        notice = (error.localizedDescription, .error)
      }
    }
  }

  @ViewBuilder
  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      if let (text, tone) = notice { AglynNotice(text, tone: tone) { notice = nil }.aglynContentEdges().padding(.vertical, AglynSpace.two) }
      if events.full { AglynNotice("Showing the newest \(eventCeiling) events.", tone: .info).aglynContentEdges() }
      if let rows = events.rows {
        if events.failed && rows.isEmpty {
          AglynEmptyState("Could not load this site's events", systemImage: "exclamationmark.triangle")
        } else if rows.isEmpty {
          AglynEmptyState(
            "No events yet", systemImage: "calendar",
            message: "Create events here, then drop an Event List element on any page; published events show with SEO event markup.")
        } else if selectable {
          List(rows) { row in EventListRow(row: row).aglynSelectableRow(row.id, selection: $selection) }
            .aglynSelectableListStyle()
            .aglynSelectionKeys(rows.map(\.id), selection: $selection)
            .accessibilityIdentifier("events-list")
        } else {
          List(rows) { row in
            AglynPushLink {
              editor(for: row)
            } label: {
              EventListRow(row: row)
            }
            .accessibilityIdentifier("event-\(row.id)")
          }
          .aglynListBackground()
          .accessibilityIdentifier("events-list")
        }
      } else {
        List { SkeletonRows(count: 4) }.aglynListBackground()
      }
    }
  }

  @ViewBuilder
  private var detail: some View {
    if selection == Self.newID {
      editor(for: nil)
    } else if let row = events.rows?.first(where: { $0.id == selection }) {
      editor(for: row).id(row.id)
    } else {
      AglynSelectionPlaceholder("No event selected", systemImage: "calendar")
    }
  }

  private func editor(for row: EventRow?) -> some View {
    EventEditor(context: context, initial: row.map(EventDraft.init) ?? EventDraft(), onDelete: row.map { row in { deleting = row } }) { draft in
      guard let hostID = context.hostID, let merge = eventMerge(draft) else { return }
      let id = draft.id ?? newEventID()
      if draft.id == nil {
        adding = false
        selection = id
      }
      run("Event saved.") { try await context.writer.merge(eventsPath(hostID) + [id], merge) }
    }
  }
}

struct EventListRow: View {
  let row: EventRow

  var body: some View {
    AglynRow(
      row.title, subtitle: row.start.formatted(date: .abbreviated, time: .shortened) + (row.location.isEmpty ? "" : " · \(row.location)"),
      systemImage: "calendar"
    ) {
      StatusChip(row.status == "published" ? "Published" : "Draft", tone: row.status == "published" ? .success : .neutral)
    }
  }
}

struct EventEditor: View {
  @Environment(\.dismiss) private var dismiss
  let context: NativePluginContext
  let onDelete: (() -> Void)?
  let onSave: (EventDraft) -> Void
  @State private var draft: EventDraft

  init(context: NativePluginContext, initial: EventDraft, onDelete: (() -> Void)?, onSave: @escaping (EventDraft) -> Void) {
    self.context = context
    _draft = State(initialValue: initial)
    self.onDelete = onDelete
    self.onSave = onSave
  }

  private var values: ContractValues { .shared }

  var body: some View {
    let problem = eventWriteProblem(title: draft.title, startsAtMs: draft.startsAtMs)
    Form {
      Section {
        Picker("Status", selection: $draft.status) {
          Text("Draft").tag(EventStatus.draft)
          Text("Published").tag(EventStatus.published)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("event-status")
        TextField("Title", text: Binding(get: { draft.title }, set: { draft.title = String($0.prefix(values.eventTitleMaxLength)) }))
          .accessibilityIdentifier("event-title")
        DatePicker(
          "Starts", selection: Binding(get: { draft.startsAt ?? Self.nextHour }, set: { draft.startsAt = $0 }))
          .accessibilityIdentifier("event-starts")
        Toggle("Has an end", isOn: Binding(get: { draft.endsAt != nil }, set: { draft.endsAt = $0 ? (draft.startsAt ?? Self.nextHour).addingTimeInterval(3600) : nil }))
        if draft.endsAt != nil {
          DatePicker("Ends", selection: Binding(get: { draft.endsAt ?? .now }, set: { draft.endsAt = $0 }))
            .accessibilityIdentifier("event-ends")
        }
      } footer: {
        Text("Without an end after the start, an event lasts an hour.")
      }
      Section {
        TextField("Location", text: Binding(get: { draft.location }, set: { draft.location = String($0.prefix(values.eventLocationMaxLength)) }))
          .accessibilityIdentifier("event-location")
        TextField("Organizer", text: Binding(get: { draft.organizer }, set: { draft.organizer = String($0.prefix(values.eventOrganizerMaxLength)) }))
          .accessibilityIdentifier("event-organizer")
        TextField(
          "Description", text: Binding(get: { draft.description }, set: { draft.description = String($0.prefix(values.eventDescriptionMaxLength)) }),
          axis: .vertical
        )
        .lineLimit(3...10)
        .accessibilityIdentifier("event-description")
      }
      Section("Cover") {
        // The cover is picked from the site's media library (or a link pasted), never a typed address field.
        MediaPickField(
          context: context, label: "Cover image", value: draft.coverImage,
          onPick: { chosen in draft.coverImage = chosen.item.url ?? chosen.item.cdnPath ?? "" },
          onClear: { draft.coverImage = "" }, onLink: { draft.coverImage = $0 }
        )
        .accessibilityIdentifier("event-cover")
        if !draft.coverImage.trimmingCharacters(in: .whitespaces).isEmpty {
          TextField(
            "Cover image description", text: Binding(get: { draft.coverImageAlt }, set: { draft.coverImageAlt = String($0.prefix(values.eventCoverAltMaxLength)) }),
            axis: .vertical
          )
          .accessibilityIdentifier("event-cover-alt")
        }
      }
      if let onDelete {
        Section { Button("Delete", role: .destructive, action: onDelete).accessibilityIdentifier("event-delete") }
      }
    }
    .formStyle(.aglynGrouped)
    .navigationTitle(draft.id == nil ? "New event" : draft.title.isEmpty ? "Event" : draft.title)
    .aglynScreenTitle(draft.id == nil ? "New event" : draft.title.isEmpty ? "Event" : draft.title)
    .onAppear { if draft.startsAt == nil { draft.startsAt = Self.nextHour } }
    // Beside the list on the Mac and iPad, Save sits in the head as a bordered button; the list keeps Add event.
    .aglynEditorActions(id: "event-save", save: "Save", enabled: problem == nil, primary: false) {
      onSave(draft)
      if draft.id == nil { dismiss() }
    }
    .accessibilityIdentifier("event-editor")
  }

  static var nextHour: Date {
    let calendar = Calendar.current
    let hour = calendar.dateInterval(of: .hour, for: .now)?.start ?? .now
    return hour.addingTimeInterval(3600)
  }
}

/// Registers the ids `plugins.config.json` declares under the plugin's
/// `mobile.contributes`: the site's events, and the Events page opening
/// natively from a link. The Kotlin registrar is the same list.
@MainActor
public func registerEventsCalendarNative(_ r: NativePluginRegistrar) {
  r.screen(eventsScreen, title: "Events", requiresSite: true, icon: "calendar") { ctx, params in
    // Sold only as an add-on: a workspace without it reads the add-on's own sentence and View add-ons.
    AglynFeatureGate(context: ctx, feature: "eventCalendar", title: "Events") {
      EventsScreen(context: ctx, startNew: params["new"] == "1")
    }
  }
  r.quickAction("events-calendar.open", title: "Events", icon: "calendar", order: 320, screen: eventsScreen, requiresSite: true)
  r.deepLink("events-calendar.page", path: "/events", screen: eventsScreen)
}
