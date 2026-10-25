// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

func problemText(_ error: Error) -> String {
  (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Try again."
}

/// One object's list (search, the console's chips, a page at a time) beside the picked record in a wide window.
struct RecordsSection: View {
  let context: NativePluginContext
  let kind: CrmKind
  let scope: CrmScope
  let api: CrmAPI
  let reference: CrmReference
  var initial: String?
  /// An address to open the one contact of (`contactsListSeed`'s `openEmail`): the list filters on it and moves on
  /// to the record when exactly one matches; no match leaves the filtered list on screen.
  var openEmail: String?
  /// Opened from Create new (`new=1`): the new-record sheet comes up once the list is on screen.
  var startNew = false
  @State private var startedNew = false
  @State private var list: LiveQueryList<CrmRow>?
  @State private var openedByEmail = false
  @State private var filterID = ""
  @State private var searchText = ""
  @State private var search = ""
  @State private var selection: String?
  @State private var creating = false

  private var filters: [CrmFilter] { (contactEmailFilter(openEmail).map { [$0] } ?? []) + crmFilters(kind, scope) }

  /// The one row the address filter found, once the list has settled on it.
  private var oneMatch: String? {
    guard contactEmailFilter(openEmail) != nil, filterID == contactEmailFilterID, search.isEmpty, let list, list.ready,
      list.failure == nil, list.rows.count == 1, !list.hasMore
    else { return nil }
    return list.rows.first?.id
  }

  var body: some View {
    WideLayoutReader { wide in
      Group {
        if wide {
          AglynListDetailColumns(listWidth: 380) {
            listPane(selectable: true)
          } detail: {
            if let selection {
              RecordDetail(context: context, kind: kind, id: selection, scope: scope, api: api, reference: reference).id(selection)
            } else {
              AglynSelectionPlaceholder("No \(kind.singular.lowercased()) selected", systemImage: kind.symbol)
            }
          }
        } else {
          listPane(selectable: false)
        }
      }
      .onChange(of: oneMatch, initial: true) { _, id in
        guard let id, !openedByEmail else { return }
        openedByEmail = true
        if wide { selection = id } else { context.navigate(kind.detailScreen, [kind.param: id]) }
      }
    }
    .aglynSearchable(text: $searchText, prompt: "Search \(kind.plural.lowercased())", onSubmit: { search = searchText })
    .onChange(of: searchText) { _, text in if text.isEmpty { search = "" } }
    // Shown to everyone, and off for a member whose role cannot add records.
    .aglynPrimaryAction(
      id: "crm-new-\(kind.collection)", "New \(kind.singular.lowercased())", systemImage: "plus", enabled: scope.canWrite,
      shortcut: KeyboardShortcut("n", modifiers: .command)
    ) { creating = true }
    .sheet(isPresented: $creating) {
      CreateRecordSheet(kind: kind, scope: scope, api: api, reference: reference) { id in selection = id }
    }
    .onAppear {
      guard startNew, !startedNew, scope.canWrite else { return }
      startedNew = true
      creating = true
    }
    .task(id: "\(filterID)|\(search)") {
      if filterID.isEmpty { filterID = filters.first?.id ?? "" }
      if selection == nil { selection = initial }
      let filter = filters.first { $0.id == filterID } ?? filters[0]
      let model = list ?? LiveQueryList(pageSize: 25) { crmRow(kind, $0, scope) }
      list = model
      let search = search
      model.show(context.firestore) { crmListQuery(kind, scope, filter, search: search, limit: $0) }
    }
    .onDisappear { list?.stop() }
  }

  private var chips: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        ForEach(filters) { filter in
          AglynChoiceChip(filter.label, selected: filterID == filter.id) { filterID = filter.id }
        }
      }
      .aglynContentEdges()
      .padding(.vertical, AglynSpace.one)
    }
  }

  @ViewBuilder
  private func listPane(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      chips
      if let list {
        if !list.ready {
          List { SkeletonRows(count: 6) }.aglynListBackground()
        } else if let failure = list.failure {
          AglynEmptyState("Could not load \(kind.plural.lowercased())", systemImage: "exclamationmark.triangle", message: failure) {
            Button("Try again") { list.retry() }
          }
        } else if list.rows.isEmpty {
          AglynEmptyState(
            search.isEmpty ? "No \(kind.plural.lowercased()) yet" : "No \(kind.plural.lowercased()) match", systemImage: kind.symbol,
            message: search.isEmpty ? "\(kind.plural) you add, and the ones your forms capture, show up here." : "Try another search or filter.")
        } else if selectable {
          List { rows(list, selectable: true) }
            .aglynSelectableListStyle().aglynSelectionKeys(list.rows.map(\.id), selection: $selection)
            .accessibilityIdentifier("crm-list")
        } else {
          List { rows(list, selectable: false) }
            .refreshable { list.retry() }
            .aglynListBackground()
            .accessibilityIdentifier("crm-list")
        }
      } else {
        List { SkeletonRows(count: 6) }.aglynListBackground()
      }
    }
    .background(AglynGround())
  }

  @ViewBuilder
  private func rows(_ list: LiveQueryList<CrmRow>, selectable: Bool) -> some View {
    ForEach(list.rows) { row in
      Group {
        if selectable {
          CrmRowView(row: row, reference: reference).aglynSelectableRow(row.id, selection: $selection)
        } else {
          AglynPushLink {
            RecordDetail(context: context, kind: kind, id: row.id, scope: scope, api: api, reference: reference)
          } label: {
            CrmRowView(row: row, reference: reference)
          }
        }
      }
      .aglynListRow()
      .accessibilityIdentifier("crm-row-\(row.id)")
    }
    if list.hasMore {
      Button("Show more") { list.loadMore() }.frame(maxWidth: .infinity)
    }
  }
}

struct CrmRowView: View {
  let row: CrmRow
  /// The workspace's pipelines, which load beside the list: a deal's row names its stage from them.
  var reference: CrmReference? = nil

  private var subtitle: String {
    guard row.kind == .deal, let reference, let stageID = row.data["stageId"] as? String else { return row.subtitle }
    let name = reference.stageName(row.data["pipelineId"] as? String, stageID)
    return dealSubtitle(row.data) { _, _ in name }
  }

  var body: some View {
    AglynRow(row.title, subtitle: subtitle.isEmpty ? nil : subtitle, systemImage: row.kind.symbol) {
      if let chip = row.chip { StatusChip(chip, tone: row.tone) }
    }
  }
}

private enum RecordAction: String, Identifiable {
  case edit, delete, log, email, task, status, unqualify, convert, stage, move, won, lost
  var id: String { rawValue }
  /// A one-sentence confirmation with nothing to fill in: an alert, never a sheet (HIG alerts).
  var confirmsInAlert: Bool { self == .delete || self == .won }
}

/// One record: header and actions, its properties, what it is linked to, open tasks and activity.
struct RecordDetail: View {
  let context: NativePluginContext
  let kind: CrmKind
  let id: String
  let scope: CrmScope
  let api: CrmAPI
  let reference: CrmReference
  @State private var doc = ObservedDocument()
  @State private var tasks = LiveQueryList(pageSize: 25, map: crmTask)
  @State private var activity = LiveQueryList(pageSize: 25) { $0 }
  @State private var related: [(CrmKind, LiveQueryList<FirestoreDocument>)] = []
  @State private var action: RecordAction?
  @State private var notice: String?
  @State private var error: String?

  var body: some View {
    Group {
      if !doc.ready {
        List { SkeletonRows(count: 8) }.aglynListBackground()
      } else if doc.failed {
        AglynEmptyState("Could not load this \(kind.singular.lowercased())", systemImage: "exclamationmark.triangle")
      } else if let document = doc.document {
        content(document)
      } else {
        AglynEmptyState(
          "This \(kind.singular.lowercased()) is gone", systemImage: kind.symbol, message: "It may have been deleted or converted.")
      }
    }
    .task(id: id) { start() }
    .onDisappear {
      doc.stop()
      tasks.stop()
      activity.stop()
      related.forEach { $0.1.stop() }
    }
  }

  private func start() {
    let reader = context.firestore
    doc.start(reader, crmPath(scope.orgID, kind.collection) + [id])
    if kind != .lead {
      tasks.show(reader) { _ in
        scopedQuery(
          scope, "crmTasks",
          filters: [
            ListQueryConstraint(path: kind.linkField, op: .equal, value: id), ListQueryConstraint(path: "status", op: .equal, value: "open"),
          ], order: [.init("dueAtMs")], limit: 25)
      }
    }
    activity.show(reader) { _ in
      scopedQuery(
        scope, "crmActivities", filters: [ListQueryConstraint(path: kind.linkField, op: .equal, value: id)],
        order: [.init("atMs", descending: true)], limit: 25)
    }
    var lists: [(CrmKind, LiveQueryList<FirestoreDocument>)] = []
    switch kind {
    case .company:
      let people = LiveQueryList(pageSize: 25) { $0 }
      people.show(reader) { _ in
        FirestoreQuery(
          crmPath(scope.orgID, "contacts"), filters: [ListQueryConstraint(path: "companyIds", op: .arrayContains, value: id)],
          order: [.init("updatedAt", descending: true)], limit: 25)
      }
      let deals = LiveQueryList(pageSize: 25) { $0 }
      deals.show(reader) { _ in
        scopedQuery(
          scope, "deals", filters: [ListQueryConstraint(path: "companyId", op: .equal, value: id)],
          order: [.init("updatedAt", descending: true)], limit: 25)
      }
      lists = [(.contact, people), (.deal, deals)]
    case .contact:
      let deals = LiveQueryList(pageSize: 25) { $0 }
      deals.show(reader) { _ in
        scopedQuery(
          scope, "deals", filters: [ListQueryConstraint(path: "contactId", op: .equal, value: id)],
          order: [.init("updatedAt", descending: true)], limit: 25)
      }
      lists = [(.deal, deals)]
    default: break
    }
    related = lists
  }

  @ViewBuilder
  private func content(_ document: FirestoreDocument) -> some View {
    let pipeline = reference.pipeline(document.string("pipelineId"))
    let row = crmRow(kind, document, scope, stages: Dictionary(uniqueKeysWithValues: pipeline.stages.map { ($0.id, $0.name) }))
    let fields = reference.fields(kind)
    let values = formValues(fields, row.data)
    Form {
      if let notice { AglynNotice(notice, tone: .success) { self.notice = nil } }
      if let error { AglynNotice(error, tone: .error) { self.error = nil } }
      Section {
        // The record's head (the calmer screens): the next step for this record as the one filled button, the rest in ⋯.
        let acts = scope.canWrite ? recordActions(row) : (primary: nil, more: [])
        AglynRecordHeader(
          row.title, subtitle: row.subtitle, systemImage: kind.symbol, status: row.chip.map { ($0, row.tone) },
          primary: acts.primary, more: acts.more)
        if kind == .deal { DealStagePath(pipeline: pipeline, stageID: document.string("stageId"), status: document.string("status")) }
      }
      Section("Details") {
        // The fields that hold something; Edit holds every one.
        let shown: [(CrmField, String)] = fields.compactMap { field in
          let value = values[field.spec.key]
          let display = field.spec.key == "ownerUid" ? reference.memberLabel(value) : fieldDisplay(field.spec, value)
          return display.flatMap { $0.isEmpty ? nil : (field, $0) }
        }
        ForEach(shown, id: \.0.id) { PropertyRow($0.0.spec.label, $0.1) }
        if shown.count < fields.count {
          Text("\(fields.count - shown.count) more fields are empty. Edit to fill them in.").font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
      relatedSection(row)
      if kind != .lead {
        Section("Open tasks") {
          if tasks.rows.isEmpty { Text(tasks.ready ? "Nothing to do here." : "Loading…").foregroundStyle(.secondary) }
          ForEach(tasks.rows) { task in
            TaskRowView(task: task, reference: reference, onToggle: scope.canWrite ? { Task { try? await api.completeTask(task.id) } } : nil)
          }
        }
      }
      Section("Activity") {
        if activity.rows.isEmpty { Text(activity.ready ? "Nothing logged yet." : "Loading…").foregroundStyle(.secondary) }
        ForEach(activity.rows, id: \.id) { entry in activityRow(entry) }
      }
    }
    .formStyle(.aglynGrouped)
    .navigationTitle(row.title)
    .aglynScreenTitle(row.title)
    #if os(iOS)
      // The record's head already shows the name large.
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .sheet(item: Binding(get: { action.flatMap { $0.confirmsInAlert ? nil : $0 } }, set: { action = $0 })) { action in
      sheet(action, row: row, fields: fields, values: values)
    }
    .alert(
      alertTitle(row), isPresented: Binding(get: { action?.confirmsInAlert == true }, set: { if !$0 { action = nil } })
    ) {
      Button("Cancel", role: .cancel) { action = nil }
      Button(action == .won ? "Mark won" : kind == .contact ? "Remove" : "Delete", role: action == .won ? nil : .destructive) {
        let confirmed = action
        action = nil
        Task { await confirm(confirmed, row: row) }
      }
      .accessibilityIdentifier("crm-alert-confirm")
    } message: {
      Text(alertMessage)
    }
  }

  private func alertTitle(_ row: CrmRow) -> String {
    if action == .won { return "Mark \(row.title) won?" }
    return kind == .contact ? "Remove \(row.title)?" : "Delete \(row.title)?"
  }

  private var alertMessage: String {
    if action == .won { return "It moves to the pipeline's won stage and counts as closed today." }
    switch kind {
    case .contact:
      return "They leave this site's CRM. If no other site holds them, the contact is deleted; marketing refusals they gave are kept."
    case .company: return "Its contacts are unlinked first, then the company is deleted."
    default: return "This cannot be undone."
    }
  }

  private func confirm(_ confirmed: RecordAction?, row: CrmRow) async {
    do {
      switch confirmed {
      case .won:
        try await api.closeDeal(id, won: true)
        notice = "Won. Nice work."
      case .delete:
        switch kind {
        case .contact: try await api.removeContact(id)
        case .company: try await api.deleteCompany(id)
        default: try await api.deleteRecord(kind, id)
        }
        notice = "\(row.title) is gone."
      default: break
      }
    } catch {
      self.error = (error as? LocalizedError)?.errorDescription ?? "Something went wrong. Try again."
    }
  }

  /// What the record's head offers: the next step for its state as the one filled button (Convert a qualified lead,
  /// Email a contact, Move an open deal's stage, else Log activity), and every other act in ⋯, Remove or Delete last.
  private func recordActions(_ row: CrmRow) -> (primary: AglynRecordAction?, more: [AglynRecordAction]) {
    var acts: [(String, String, RecordAction)] = [("Edit", "pencil", .edit), ("Log activity", "note.text", .log)]
    if row.data["email"] != nil || kind == .deal { acts.append(("Email", "envelope", .email)) }
    acts.append(("New task", "checklist", .task))
    let status = row.data["status"] as? String
    switch kind {
    case .lead:
      acts.append(("Status", "tag", .status))
      if row.data["convertedContactId"] == nil { acts.append(("Convert", "arrow.right.circle", .convert)) }
      if status != "unqualified" { acts.append(("Unqualify", "xmark.circle", .unqualify)) }
    case .contact: acts.append(("Lifecycle stage", "tag", .stage))
    case .deal:
      if (status ?? "open") == "open" {
        acts += [("Move stage", "rectangle.split.3x1", .move), ("Won", "checkmark.seal", .won), ("Lost", "xmark.seal", .lost)]
      }
    case .company: break
    }
    acts.append((kind == .contact ? "Remove" : "Delete", "trash", .delete))
    let next: RecordAction =
      switch kind {
      case .lead: status == "qualified" && row.data["convertedContactId"] == nil ? .convert : .log
      case .contact: row.data["email"] != nil ? .email : .log
      case .deal: (status ?? "open") == "open" ? .move : .log
      case .company: .log
      }
    let all = acts.map { title, symbol, act in
      AglynRecordAction("crm-action-\(act.rawValue)", title, systemImage: symbol, destructive: act == .delete) { action = act }
    }
    let primary = all.first { $0.id == "crm-action-\(next.rawValue)" }
    return (primary, all.filter { $0.id != primary?.id })
  }

  @ViewBuilder
  private func relatedSection(_ row: CrmRow) -> some View {
    let companyID = (row.data["companyId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    let contactID = kind == .deal ? (row.data["contactId"] as? String).flatMap { $0.isEmpty ? nil : $0 } : nil
    if (companyID != nil && kind != .company) || contactID != nil || !related.isEmpty || kind == .lead {
      Section("Related") {
        if let companyID, kind != .company {
          Button {
            context.navigate(CrmKind.company.detailScreen, ["company": companyID])
          } label: {
            AglynRow(reference.companies.first { $0.value == companyID }?.label ?? (row.data["companyName"] as? String) ?? "Company", subtitle: "Company", systemImage: CrmKind.company.symbol)
          }
          .buttonStyle(.aglynRow)
        }
        if let contactID {
          Button {
            context.navigate(CrmKind.contact.detailScreen, ["contact": contactID])
          } label: {
            AglynRow(reference.contacts.first { $0.value == contactID }?.label ?? "Contact", subtitle: "Primary contact", systemImage: CrmKind.contact.symbol)
          }
          .buttonStyle(.aglynRow)
        }
        if kind == .lead, let converted = row.data["convertedContactId"] as? String {
          Button("Open the converted contact") { context.navigate(CrmKind.contact.detailScreen, ["contact": converted]) }
        }
        ForEach(related.indices, id: \.self) { index in
          let (relatedKind, list) = related[index]
          Text(relatedKind == .contact ? "People" : relatedKind.plural).font(AglynFont.caption).foregroundStyle(.secondary)
          if list.rows.isEmpty { Text(list.ready ? "None yet." : "Loading…").foregroundStyle(.secondary) }
          ForEach(list.rows, id: \.id) { doc in
            let item = crmRow(relatedKind, doc, scope)
            Button {
              context.navigate(relatedKind.detailScreen, [relatedKind.param: item.id])
            } label: {
              CrmRowView(row: item, reference: reference)
            }
            .buttonStyle(.plain)
          }
        }
      }
    }
  }

  private func activityRow(_ entry: FirestoreDocument) -> some View {
    let activityKind = entry.string("kind") ?? "note"
    let at = millis(entry.data["atMs"]).map { Date(timeIntervalSince1970: Double($0) / 1000) }
    let symbol: String =
      switch activityKind {
      case "call": "phone"
      case "email": "envelope"
      case "meeting": "person.2"
      default: "note.text"
      }
    let meta = [
      entry.string("byName"), at.map { relativeTime($0) }, entry.string("outcome"),
      (entry.data["durationMinutes"] as? NSNumber).map { "\($0.intValue) min" },
    ].compactMap { $0 }.joined(separator: " · ")
    return AglynRow(
      entry.string("subject").flatMap { $0.isEmpty ? nil : $0 } ?? (ContractValues.shared.crmActivityKindLabels[activityKind] ?? activityKind),
      subtitle: [entry.string("body").map { String($0.prefix(240)) }, meta.isEmpty ? nil : meta].compactMap { $0 }.joined(separator: "\n"),
      systemImage: symbol
    )
    .swipeActions {
      if scope.canWrite && entry.string("byUid") == scope.uid && activityKind != "email" {
        Button("Delete", role: .destructive) { Task { try? await api.deleteActivity(entry.id) } }
      }
    }
  }

  @ViewBuilder
  private func sheet(_ action: RecordAction, row: CrmRow, fields: [CrmField], values: [String: String]) -> some View {
    let done = { (message: String) in notice = message }
    switch action {
    case .edit:
      EditRecordSheet(title: "Edit \(kind.singular.lowercased())", fields: fields.filter(\.editable), initial: values) { edited in
        let changes = changedFields(fields, before: values, after: edited)
        if kind == .contact { try await api.updateContact(id, changes) } else { try await api.updateRecord(kind, id, changes) }
        done("\(kind.singular) saved.")
      }
    case .log:
      LogActivitySheet { activityKind, body, outcome, minutes, direction in
        try await api.logActivity(kind: activityKind, body: body, links: activityLinks(row), outcome: outcome, minutes: minutes, direction: direction)
        done("Logged.")
      }
    case .email:
      EmailSheet(to: row.data["email"] as? String) { subject, message in
        try await api.sendEmail(subject: subject, message: message, links: [kind.linkField: id])
        done("Email sent.")
      }
    case .task:
      TaskSheet(title: "New task", initial: taskDraft(row), reference: reference) { draft in
        try await api.saveTask(nil, draft)
        done("Task added.")
      }
    case .status:
      ChoiceSheet(
        title: "Lead status", options: leadStatuses.filter { $0 != "qualified" && $0 != "unqualified" }.map { ($0, leadStatusLabel($0)) },
        initial: row.data["status"] as? String ?? "new",
        note: "Qualified comes with converting a lead, and Unqualified asks why."
      ) { status in
        try await api.setLeadStatus(id, status: status, label: leadStatusLabel(status))
        done("Status saved.")
      }
    case .stage:
      ChoiceSheet(
        title: "Lifecycle stage", options: [("", "None")] + lifecycleStages.map { ($0, stageLabel($0) ?? $0) },
        initial: row.data["lifecycleStage"] as? String ?? ""
      ) { stage in
        try await api.setContactStage(id, stage.isEmpty ? nil : stage)
        done("Stage saved.")
      }
    case .move:
      let pipeline = reference.pipeline(row.data["pipelineId"] as? String)
      ChoiceSheet(title: "Move \(row.title)", options: pipeline.openStages.map { ($0.id, $0.name) }, initial: row.data["stageId"] as? String ?? "") { stage in
        try await api.moveDeal(id, stageID: stage)
        done("Moved.")
      }
    case .unqualify:
      ReasonSheet(title: "Unqualify \(row.title)?", message: "The lead stays, marked Unqualified, and leaves the open views.", confirm: "Unqualify") { reason in
        try await api.setLeadStatus(id, status: "unqualified", label: leadStatusLabel("unqualified"), reason: reason)
        done("Unqualified.")
      }
    case .lost:
      ReasonSheet(title: "Mark \(row.title) lost?", message: "Say why, if you know.", confirm: "Mark lost") { reason in
        try await api.closeDeal(id, won: false, lostReason: reason)
        done("Marked lost.")
      }
    case .convert:
      ConvertSheet(row: row, scope: scope, reference: reference) { draft in
        try await api.convertLead(id, draft)
        done("\(row.title) is converted.")
      }
    case .delete, .won:
      // Confirmed in an alert (see `confirmsInAlert`), never a sheet.
      EmptyView()
    }
  }

  private func activityLinks(_ row: CrmRow) -> [String: String] {
    var links = [kind.linkField: id]
    if kind == .deal || kind == .contact, let company = row.data["companyId"] as? String, !company.isEmpty { links["companyId"] = company }
    if kind == .deal, let contact = row.data["contactId"] as? String, !contact.isEmpty { links["contactId"] = contact }
    return links
  }

  private func taskDraft(_ row: CrmRow) -> TaskDraft {
    var draft = TaskDraft(assigneeUID: scope.uid)
    switch kind {
    case .contact:
      draft.contactID = id
      draft.companyID = row.data["companyId"] as? String
    case .company: draft.companyID = id
    case .deal:
      draft.dealID = id
      draft.contactID = row.data["contactId"] as? String
      draft.companyID = row.data["companyId"] as? String
    case .lead: break
    }
    return draft
  }
}

/// A deal's stages as a path: done, current, ahead.
struct DealStagePath: View {
  let pipeline: Pipeline
  let stageID: String?
  let status: String?

  var body: some View {
    let open = pipeline.openStages
    let at = open.firstIndex { $0.id == stageID } ?? -1
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 4) {
        ForEach(Array(open.enumerated()), id: \.element.id) { index, stage in
          StatusChip(
            stage.name,
            tone: status == "won" ? .success : status == "lost" ? .neutral : index < at ? .success : index == at ? .info : .neutral)
        }
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Stage \(open.first { $0.id == stageID }?.name ?? "not set")")
  }
}

// MARK: Sheets

struct EditRecordSheet: View {
  let title: String
  let fields: [CrmField]
  let initial: [String: String]
  var confirm = "Save"
  let save: ([String: String]) async throws -> Void
  @State private var values: [String: String] = [:]
  @State private var tried = false

  var body: some View {
    let problems = fieldProblems(fields.map(\.spec), values)
    AglynFormSheet(title, confirm: confirm, save: {
      tried = true
      guard problems.isEmpty else { throw ConsoleAPIError(status: 400, message: "Check the fields marked below.") }
      try await save(values)
    }) {
      FieldFormSection(specs: fields.map(\.spec), values: $values, errors: tried ? problems : [:])
    }
    .onAppear { if values.isEmpty { values = initial } }
  }
}

struct ChoiceSheet: View {
  let title: String
  let options: [(String, String)]
  let initial: String
  var note: String?
  let save: (String) async throws -> Void
  @State private var picked: String?

  var body: some View {
    AglynFormSheet(title, save: { try await save(picked ?? initial) }) {
      Section {
        Picker(title, selection: Binding(get: { picked ?? initial }, set: { picked = $0 })) {
          ForEach(options, id: \.0) { Text($0.1).tag($0.0) }
        }
        .pickerStyle(.inline)
        .labelsHidden()
      } footer: {
        if let note { Text(note) }
      }
    }
  }
}

struct ReasonSheet: View {
  let title: String
  let message: String
  let confirm: String
  var destructive = false
  var asksReason = true
  let save: (String) async throws -> Void
  @State private var reason = ""

  var body: some View {
    AglynFormSheet(title, confirm: confirm, destructive: destructive, save: { try await save(reason) }) {
      Section {
        Text(message)
        if asksReason { TextField("Why (optional)", text: $reason, axis: .vertical) }
      }
    }
  }
}

struct LogActivitySheet: View {
  let save: (String, String, String?, Int?, String?) async throws -> Void
  @State private var kind = "note"
  @State private var text = ""
  @State private var outcome = ""
  @State private var minutes = ""
  @State private var direction = ""

  var body: some View {
    let kinds = ContractValues.shared.nativeCrmActivityKinds.filter { $0 != "email" }
    let directions = ContractValues.shared.nativeCrmActivityDirections[kind] ?? []
    AglynFormSheet("Log activity", confirm: "Log", canConfirm: !text.trimmingCharacters(in: .whitespaces).isEmpty, save: {
      try await save(kind, text, outcome.isEmpty ? nil : outcome, Int(minutes), direction.isEmpty ? nil : direction)
    }) {
      Section {
        Picker("Kind", selection: $kind) {
          ForEach(kinds, id: \.self) { Text(ContractValues.shared.crmActivityKindLabels[$0] ?? $0).tag($0) }
        }
        .pickerStyle(.segmented)
        TextField(kind == "note" ? "Note" : "What happened", text: $text, axis: .vertical).lineLimit(3...10)
          .accessibilityIdentifier("activity-body")
        if kind == "call" || kind == "meeting" {
          TextField("Minutes", text: $minutes)
          #if os(iOS)
            .keyboardType(.numberPad)
          #endif
        }
        if kind == "call" { TextField("Outcome", text: $outcome) }
        if !directions.isEmpty {
          Picker("Direction", selection: $direction) {
            Text("Not said").tag("")
            ForEach(directions, id: \.self) { Text(ContractValues.shared.crmActivityDirectionLabels[$0] ?? $0).tag($0) }
          }
        }
      }
    }
  }
}

struct EmailSheet: View {
  let to: String?
  let save: (String, String) async throws -> Void
  @State private var subject = ""
  @State private var message = ""

  var body: some View {
    AglynFormSheet(
      "Email", confirm: "Send",
      canConfirm: !subject.trimmingCharacters(in: .whitespaces).isEmpty && !message.trimmingCharacters(in: .whitespaces).isEmpty,
      save: { try await save(subject, message) }
    ) {
      Section {
        if let to { LabeledContent("To", value: to) }
        TextField("Subject", text: $subject)
        TextField("Message", text: $message, axis: .vertical).lineLimit(5...16)
      } footer: {
        Text("The email is sent from your sending address and logged on the record.")
      }
    }
  }
}

struct ConvertSheet: View {
  let row: CrmRow
  let scope: CrmScope
  let reference: CrmReference
  let save: (ConvertDraft) async throws -> Void
  @State private var owner = ""
  @State private var companyMode = "new"
  @State private var companyID = ""
  @State private var companyName = ""
  @State private var withDeal = false
  @State private var dealTitle = ""
  @State private var amount = ""
  @State private var stageID = ""

  var body: some View {
    let pipeline = reference.pipeline(nil)
    AglynFormSheet("Convert \(row.title)", confirm: "Convert", save: {
      try await save(
        ConvertDraft(
          ownerUID: owner.isEmpty ? nil : owner, companyID: companyMode == "existing" && !companyID.isEmpty ? companyID : nil,
          createCompanyName: companyMode == "new" ? companyName : nil, dealTitle: withDeal ? dealTitle : nil,
          dealAmountCents: Double(amount.replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: "")).map { Int64(($0 * 100).rounded()) },
          dealStageID: stageID.isEmpty ? pipeline.openStages.first?.id : stageID))
    }) {
      Section {
        Text("The lead becomes a contact, with a company and a deal if you want them.").foregroundStyle(.secondary)
        Picker("Owner", selection: $owner) {
          Text("No owner").tag("")
          ForEach(reference.members) { Text($0.label).tag($0.uid) }
        }
      }
      Section("Company") {
        Picker("Company", selection: $companyMode) {
          Text("New company").tag("new")
          Text("Existing company").tag("existing")
          Text("No company").tag("none")
        }
        .pickerStyle(.segmented)
        if companyMode == "new" { TextField("Company name", text: $companyName) }
        if companyMode == "existing" {
          Picker("Company", selection: $companyID) {
            Text("Choose").tag("")
            ForEach(reference.companies) { Text($0.label).tag($0.value) }
          }
        }
      }
      Section("Deal") {
        Toggle("Create a deal", isOn: $withDeal)
        if withDeal {
          TextField("Deal name", text: $dealTitle)
          TextField("Amount", text: $amount)
          Picker("Stage", selection: $stageID) {
            ForEach(pipeline.openStages) { Text($0.name).tag($0.id) }
          }
        }
      }
    }
    .onAppear {
      if owner.isEmpty { owner = row.data["ownerUid"] as? String ?? scope.uid }
      if companyName.isEmpty { companyName = row.data["company"] as? String ?? "" }
      if companyName.isEmpty { companyMode = "none" }
      if dealTitle.isEmpty { dealTitle = "\(row.title) deal" }
      if stageID.isEmpty { stageID = pipeline.openStages.first?.id ?? "" }
    }
  }
}

/// What a new record is created with, as the console's create drawer asks it.
@MainActor
func createFields(_ kind: CrmKind, _ reference: CrmReference) -> [CrmField] {
  let all = reference.fields(kind)
  func pick(_ keys: [String]) -> [CrmField] {
    keys.compactMap { key in all.first { $0.spec.key == key } }.map { var field = $0; field.editable = true; return field }
  }
  switch kind {
  case .contact:
    return pick(["email", "name", "phone", "jobTitle", "companyId", "leadSource", "ownerUid"])
      + [CrmField(FieldSpec("lifecycleStage", "Lifecycle stage", kind: .select, options: lifecycleStages.map { FieldOption($0, stageLabel($0) ?? $0) }))]
      + customFieldsOf(kind, reference.customFields)
  case .lead:
    return pick(["email", "name", "company", "jobTitle", "phone", "website", "leadSource", "ownerUid", "notes"])
      + customFieldsOf(kind, reference.customFields)
  case .company, .deal: return all.filter(\.editable)
  }
}

struct CreateRecordSheet: View {
  let kind: CrmKind
  let scope: CrmScope
  let api: CrmAPI
  let reference: CrmReference
  let onCreated: (String) -> Void
  @State private var pipelineID = ""
  @State private var stageID = ""

  var body: some View {
    let fields = createFields(kind, reference)
    EditRecordSheet(title: "New \(kind.singular.lowercased())", fields: fields, initial: ["ownerUid": scope.uid], confirm: "Create") { values in
      let created = createdFields(fields, values)
      var id: String?
      switch kind {
      case .contact: id = try await api.createContact(created)
      case .lead: id = try await api.createLead(created)
      case .company: id = try await api.createRecord(kind, created, extra: ["contactsCount": 0])
      case .deal:
        let pipeline = reference.pipeline(pipelineID.isEmpty ? nil : pipelineID)
        let stage = pipeline.stages.first { $0.id == stageID } ?? pipeline.openStages.first
        var extra: [String: Any] = [
          "pipelineId": pipeline.id, "stageId": stage?.id ?? "", "status": "open", "currency": "usd",
          "stageChangedAtMs": Int64(Date().timeIntervalSince1970 * 1000),
        ]
        if let category = stage?.forecastCategory { extra["forecastCategory"] = category }
        if created["probability"] == nil, let stage { extra["probability"] = stage.probability }
        if let contact = created["contactId"] as? String { extra["contactRoles"] = [["contactId": contact, "primary": true]] }
        id = try await api.createRecord(kind, created, extra: extra)
      }
      if let id { onCreated(id) }
    }
    .safeAreaInset(edge: .top) {
      if kind == .deal {
        let pipeline = reference.pipeline(pipelineID.isEmpty ? nil : pipelineID)
        HStack {
          if reference.activePipelines.count > 1 {
            Picker("Pipeline", selection: $pipelineID) { ForEach(reference.activePipelines) { Text($0.name).tag($0.id) } }
          }
          Picker("Stage", selection: $stageID) { ForEach(pipeline.openStages) { Text($0.name).tag($0.id) } }
        }
        .aglynContentEdges()
        .onAppear {
          if pipelineID.isEmpty { pipelineID = pipeline.id }
          if stageID.isEmpty { stageID = pipeline.openStages.first?.id ?? "" }
        }
      }
    }
  }
}
