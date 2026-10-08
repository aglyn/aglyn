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
  @State private var list: LiveQueryList<CrmRow>?
  @State private var filterID = ""
  @State private var searchText = ""
  @State private var search = ""
  @State private var selection: String?
  @State private var creating = false

  private var filters: [CrmFilter] { crmFilters(kind, scope) }

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          listPane(selectable: true).frame(minWidth: 320, idealWidth: 380, maxWidth: 440)
          Divider()
          Group {
            if let selection {
              RecordDetail(context: context, kind: kind, id: selection, scope: scope, api: api, reference: reference).id(selection)
            } else {
              AglynEmptyState("Pick a \(kind.singular.lowercased()) to see it here", systemImage: kind.symbol)
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        listPane(selectable: false)
      }
    }
    .searchable(text: $searchText, prompt: "Search \(kind.plural.lowercased())")
    .onSubmit(of: .search) { search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { search = "" } }
    .toolbar {
      if scope.canWrite {
        ToolbarItem(placement: .primaryAction) {
          Button {
            creating = true
          } label: {
            Label("New \(kind.singular.lowercased())", systemImage: "plus")
          }
          .keyboardShortcut("n", modifiers: .command)
          .accessibilityIdentifier("crm-new-\(kind.collection)")
        }
      }
    }
    .sheet(isPresented: $creating) {
      CreateRecordSheet(kind: kind, scope: scope, api: api, reference: reference) { id in selection = id }
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
      .padding(.horizontal, AglynSpace.two)
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
          List(selection: $selection) { rows(list, selectable: true) }
            .aglynListBackground()
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
    .background(AglynColor.page)
  }

  @ViewBuilder
  private func rows(_ list: LiveQueryList<CrmRow>, selectable: Bool) -> some View {
    ForEach(list.rows) { row in
      Group {
        if selectable {
          CrmRowView(row: row).tag(row.id)
        } else {
          NavigationLink {
            RecordDetail(context: context, kind: kind, id: row.id, scope: scope, api: api, reference: reference)
          } label: {
            CrmRowView(row: row)
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

  var body: some View {
    AglynRow(row.title, subtitle: row.subtitle.isEmpty ? nil : row.subtitle, systemImage: row.kind.symbol) {
      if let chip = row.chip { StatusChip(chip, tone: row.tone) }
    }
  }
}

private enum RecordAction: String, Identifiable {
  case edit, delete, log, email, task, status, unqualify, convert, stage, move, won, lost
  var id: String { rawValue }
}

/// One record: header and actions, its properties, what it is linked to, open tasks and activity.
struct RecordDetail: View {
  let context: NativePluginContext
  let kind: CrmKind
  let id: String
  let scope: CrmScope
  let api: CrmAPI
  let reference: CrmReference
  @State private var doc = LiveDocument()
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
        HStack(alignment: .firstTextBaseline) {
          VStack(alignment: .leading, spacing: 4) {
            Text(row.title).font(AglynFont.title2).accessibilityAddTraits(.isHeader)
            if !row.subtitle.isEmpty { Text(row.subtitle).font(AglynFont.subheadline).foregroundStyle(.secondary) }
          }
          Spacer()
          if let chip = row.chip { StatusChip(chip, tone: row.tone) }
        }
        if kind == .deal { DealStagePath(pipeline: pipeline, stageID: document.string("stageId"), status: document.string("status")) }
        if scope.canWrite { actionButtons(row) }
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
    .formStyle(.grouped)
    .aglynListBackground()
    .navigationTitle(row.title)
    .sheet(item: $action) { action in sheet(action, row: row, fields: fields, values: values) }
  }

  private func actionButtons(_ row: CrmRow) -> some View {
    var buttons: [(String, String, RecordAction)] = [("Edit", "pencil", .edit), ("Log activity", "note.text", .log)]
    if row.data["email"] != nil || kind == .deal { buttons.append(("Email", "envelope", .email)) }
    buttons.append(("New task", "checklist", .task))
    switch kind {
    case .lead:
      buttons.append(("Status", "tag", .status))
      if row.data["convertedContactId"] == nil { buttons.append(("Convert", "arrow.right.circle", .convert)) }
      if row.data["status"] as? String != "unqualified" { buttons.append(("Unqualify", "xmark.circle", .unqualify)) }
    case .contact: buttons.append(("Lifecycle stage", "tag", .stage))
    case .deal:
      let status = row.data["status"] as? String ?? "open"
      if status == "open" {
        buttons += [("Move stage", "rectangle.split.3x1", .move), ("Won", "checkmark.seal", .won), ("Lost", "xmark.seal", .lost)]
      }
    case .company: break
    }
    buttons.append((kind == .contact ? "Remove" : "Delete", "trash", .delete))
    return ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        ForEach(buttons, id: \.2) { title, symbol, action in
          Button(role: action == .delete ? .destructive : nil) {
            self.action = action
          } label: {
            Label(title, systemImage: symbol)
          }
          .buttonStyle(.bordered)
          .accessibilityIdentifier("crm-action-\(action.rawValue)")
        }
      }
    }
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
          .buttonStyle(.plain)
        }
        if let contactID {
          Button {
            context.navigate(CrmKind.contact.detailScreen, ["contact": contactID])
          } label: {
            AglynRow(reference.contacts.first { $0.value == contactID }?.label ?? "Contact", subtitle: "Primary contact", systemImage: CrmKind.contact.symbol)
          }
          .buttonStyle(.plain)
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
              CrmRowView(row: item)
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
    case .won:
      ReasonSheet(title: "Mark \(row.title) won?", message: "It moves to the pipeline's won stage and counts as closed today.", confirm: "Mark won", asksReason: false) { _ in
        try await api.closeDeal(id, won: true)
        done("Won. Nice work.")
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
    case .delete:
      ReasonSheet(
        title: kind == .contact ? "Remove \(row.title)?" : "Delete \(row.title)?",
        message: kind == .contact
          ? "They leave this site's CRM. If no other site holds them, the contact is deleted; marketing refusals they gave are kept."
          : kind == .company ? "Its contacts are unlinked first, then the company is deleted." : "This cannot be undone.",
        confirm: kind == .contact ? "Remove" : "Delete", destructive: true, asksReason: false
      ) { _ in
        switch kind {
        case .contact: try await api.removeContact(id)
        case .company: try await api.deleteCompany(id)
        default: try await api.deleteRecord(kind, id)
        }
        done("\(row.title) is gone.")
      }
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
        .padding(.horizontal, AglynSpace.two)
        .onAppear {
          if pipelineID.isEmpty { pipelineID = pipeline.id }
          if stageID.isEmpty { stageID = pipeline.openStages.first?.id ?? "" }
        }
      }
    }
  }
}
