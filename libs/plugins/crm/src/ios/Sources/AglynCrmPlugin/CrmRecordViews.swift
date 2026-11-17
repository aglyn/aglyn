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
  /// Picking several rows for one act (the console's ticked rows and its bulk bar).
  @State private var selecting = false
  @State private var picked = Set<String>()
  @State private var bulkAction: CrmBulkAction?
  @State private var confirming: CrmBulkAction?
  @State private var bulkBusy = false
  @State private var bulkResult: CrmBulkResult?
  /// The section's saved views and the reader's default (`useCrmSavedView`).
  @State private var views = CrmViewsModel()
  /// Whether the reader picked a filter or a view, which the default view then leaves alone.
  @State private var picking = false
  @State private var defaultApplied = false

  private var filters: [CrmFilter] { (contactEmailFilter(openEmail).map { [$0] } ?? []) + crmFilters(kind, scope) }

  /// The saved views as filters: the reader's own and the shared ones.
  private var viewFilters: [CrmFilter] {
    let listed = views.views(uid: scope.uid)
    return (listed.mine + listed.shared).map { crmViewFilter($0, kind: kind) { crmAskClause(kind, $0, scope: scope) } }
  }

  /// What the list shows: the chip or view picked, the first chip until then (or while a view is still loading).
  private var activeFilter: CrmFilter {
    (filters + viewFilters).first { $0.id == filterID } ?? filters.first { $0.id == filterID } ?? filters[0]
  }

  private var defaultViewKey: String {
    "\(views.profile.ready)|\(views.list.ready)|\(views.defaultID(orgID: scope.orgID, section: kind.viewSection) ?? "")"
  }

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
              RecordDetail(context: context, kind: kind, id: selection, listScope: scope, listAPI: api, reference: reference).id(selection)
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
      CreateRecordSheet(context: context, kind: kind, scope: scope, api: api, reference: reference) { id in selection = id }
    }
    .onAppear {
      guard startNew, !startedNew, scope.canWrite else { return }
      startedNew = true
      creating = true
    }
    .sheet(item: $bulkAction) { action in
      let rows = pickedRows
      CrmBulkSheet(
        action: action, kind: kind, count: rows.count, reference: reference,
        pipeline: kind == .deal ? crmBulkPipeline(rows).map { reference.pipeline($0) } : nil
      ) { value in await runBulk(action, rows: rows, value: value) }
    }
    .alert(
      confirmation?.title ?? "", isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
      presenting: confirming
    ) { action in
      Button("Cancel", role: .cancel) { confirming = nil }
      Button(confirmation?.button ?? action.label, role: .destructive) {
        let rows = pickedRows
        confirming = nil
        Task { await runBulk(action, rows: rows, value: CrmBulkValue()) }
      }
      .accessibilityIdentifier("crm-bulk-confirm")
    } message: { _ in
      Text(confirmation?.message ?? "")
    }
    .task(id: CrmListKey(filter: activeFilter, search: search)) {
      picked = []
      if filterID.isEmpty { filterID = filters.first?.id ?? "" }
      if selection == nil { selection = initial }
      let filter = activeFilter
      let model = list ?? LiveQueryList(pageSize: 25) { crmRow(kind, $0, scope) }
      list = model
      let search = search
      model.show(context.firestore) { crmListQuery(kind, scope, filter, search: search, limit: $0) }
    }
    .task(id: scope) { views.start(context.firestore, scope, section: kind.viewSection) }
    .onChange(of: defaultViewKey, initial: true) { _, _ in openDefaultView() }
    .onDisappear {
      list?.stop()
      views.stop()
    }
  }

  /// The reader's default view opens first, once, unless they already picked or the list was opened for an address.
  private func openDefaultView() {
    guard !defaultApplied, views.profile.ready, views.list.ready else { return }
    defaultApplied = true
    guard !picking, contactEmailFilter(openEmail) == nil,
      let id = views.defaultID(orgID: scope.orgID, section: kind.viewSection),
      viewFilters.contains(where: { $0.id == crmViewFilterPrefix + id })
    else { return }
    filterID = crmViewFilterPrefix + id
  }

  private var chips: some View {
    HStack(spacing: 0) {
      if !scope.uid.isEmpty {
        CrmViewsMenu(
          section: kind.viewSection, plural: kind.plural, scope: scope, api: api, model: views, current: activeFilter,
          open: { id in
            picking = true
            filterID = crmViewFilterPrefix + id
          },
          openAll: { filterID = filters.first?.id ?? "" }
        )
        .aglynContentEdges()
      }
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: AglynSpace.one) {
          ForEach(filters) { filter in
            AglynChoiceChip(filter.label, selected: filterID == filter.id) {
              picking = true
              filterID = filter.id
            }
          }
        }
        .aglynContentEdges()
        .padding(.vertical, AglynSpace.one)
      }
      if scope.canWrite {
        CrmSelectToggle(selecting: $selecting) { picked = [] }
          .aglynContentEdges()
      }
    }
  }

  /// The ticked rows the list still shows, as the bar reads them.
  private var pickedRows: [CrmBulkRow] {
    (list?.rows ?? []).filter { picked.contains($0.id) }.map { crmBulkRow($0, scope: scope) }
  }

  private var confirmation: CrmBulkConfirm? {
    confirming.flatMap { crmBulkConfirm($0, noun: CrmBulkNoun(kind), count: pickedRows.count) }
  }

  /// Whether the role may use an act: every act writes, the stage acts ask "Move contacts and deals between stages",
  /// and a workspace whose plan lacks the CRM keeps a contact's owner, stage and company locked.
  private func bulkEnabled(_ action: CrmBulkAction) -> Bool {
    guard scope.canWrite else { return false }
    if (action == .stage || action == .lost) && !scope.movesStages(on: nil) { return false }
    if kind == .contact && !scope.suite && [.owner, .stage, .company].contains(action) { return false }
    return true
  }

  private func pickBulk(_ action: CrmBulkAction) {
    bulkResult = nil
    if action.confirms { confirming = action } else { bulkAction = action }
  }

  private func runBulk(_ action: CrmBulkAction, rows: [CrmBulkRow], value: CrmBulkValue) async {
    bulkBusy = true
    let result = await api.bulk(action, kind: kind, rows: rows, value: value, reference: reference)
    bulkBusy = false
    bulkResult = result
    // The rows a delete removed are gone from the list; the refused ones stay ticked so the reader sees which.
    if action.destructive { picked = Set(result.keep) }
    list?.retry()
  }

  @ViewBuilder
  private var bulkBar: some View {
    // Counted over the rows the list still shows: an act that moves rows out of the view leaves none of them picked.
    if selecting && !pickedRows.isEmpty || bulkResult != nil {
      VStack(spacing: AglynSpace.one) {
        if selecting && !pickedRows.isEmpty {
          CrmBulkBar(
            count: pickedRows.count, actions: crmBulkActions(kind, orgLevel: scope.orgLevel), busy: bulkBusy, enabled: bulkEnabled,
            pick: pickBulk, clear: { picked = [] })
        }
        CrmBulkNotices(result: $bulkResult)
      }
      .aglynContentEdges()
      .padding(.bottom, AglynSpace.one)
    }
  }

  @ViewBuilder
  private func listPane(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      chips
      // A saved view's clauses this list cannot ask, said rather than silently dropped.
      ForEach(activeFilter.refused, id: \.sentence) { refusal in
        AglynNotice(refusal.sentence, tone: .warning).aglynContentEdges()
      }
      bulkBar
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
        if selecting {
          CrmPickRow(picked: picked.contains(row.id), toggle: { toggle(row.id) }) { CrmRowView(row: row, reference: reference) }
        } else if selectable {
          CrmRowView(row: row, reference: reference).aglynSelectableRow(row.id, selection: $selection)
        } else {
          AglynPushLink {
            RecordDetail(context: context, kind: kind, id: row.id, listScope: scope, listAPI: api, reference: reference)
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

  private func toggle(_ id: String) {
    if picked.contains(id) { picked.remove(id) } else { picked.insert(id) }
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
  case edit, delete, log, logCall, email, task, status, unqualify, convert, stage, move, won, lost, addRole
  var id: String { rawValue }
  /// A one-sentence confirmation with nothing to fill in: an alert, never a sheet (HIG alerts).
  var confirmsInAlert: Bool { self == .delete || self == .won }
}

/// One record: header and actions, its properties, what it is linked to, open tasks and activity.
struct RecordDetail: View {
  let context: NativePluginContext
  let kind: CrmKind
  let id: String
  /// What the list reads with; `scope` is the record's own (`recordScope`).
  let listScope: CrmScope
  let listAPI: CrmAPI
  let reference: CrmReference
  @State private var doc = ObservedDocument()
  @State private var tasks = LiveQueryList(pageSize: 25, map: crmTask)
  @State private var activity = LiveQueryList(pageSize: 25) { $0 }
  @State private var related: [(CrmKind, LiveQueryList<FirestoreDocument>)] = []
  @State private var action: RecordAction?
  @State private var notice: String?
  @State private var error: String?
  @State private var site = LiveDoc()
  @Environment(\.openURL) private var openURL

  private var scope: CrmScope { doc.document.map { recordScope(listScope, $0.data) } ?? listScope }
  /// "Move contacts and deals between stages", where this record's stage routes will ask it.
  private var movesStages: Bool { scope.movesStages(on: site.doc?.data) }
  private var hasStage: Bool { kind == .contact || (kind == .deal && (doc.document?.string("status") ?? "open") == "open") }
  private var api: CrmAPI { CrmAPI(api: listAPI.api, reader: listAPI.reader, scope: scope) }

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
    .task(id: scope.hostID) {
      if !scope.hostID.isEmpty { site.start(context.firestore, ["hosts", scope.hostID]) }
    }
    .onDisappear {
      doc.stop()
      site.stop()
      tasks.stop()
      activity.stop()
      related.forEach { $0.1.stop() }
    }
  }

  private func start() {
    let reader = context.firestore
    // A record's page reads as its list does: a whole-workspace reader sees every site's entries on it.
    let scope = listScope
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
        // Dialling writes nothing, so Call stands for a reader too (`CrmCallButton`).
        let acts = scope.canWrite ? recordActions(row) : (primary: nil, more: callActions(row).filter { $0.id == "crm-action-call" })
        if scope.canWrite && hasStage && !movesStages {
          AglynNotice(permissionRefusalText(ContractValues.shared.orgRoleGrants, key: crmMoveStagesKey), tone: .info)
            .accessibilityIdentifier("crm-stage-refusal")
        }
        AglynRecordHeader(
          row.title, subtitle: row.subtitle, systemImage: kind.symbol, status: row.chip.map { ($0, row.tone) },
          primary: acts.primary, more: acts.more)
        if kind == .deal { DealStagePath(pipeline: pipeline, stageID: document.string("stageId"), status: document.string("status")) }
        // What another plugin does with the person, such as start a quote (the console's `crmRecordActions` zone).
        if kind == .contact, !context.slotWidgets(crmRecordActionsZone).isEmpty {
          // The person as the page shows them: the holder's facet over the shared fields (`contactRecordFromDoc`).
          let data = row.data
          let text = { (key: String) in (data[key] as? String) ?? "" }
          SlotWidgets(
            context: context, slot: crmRecordActionsZone,
            props: [
              "hostId": scope.hostID.isEmpty ? (context.hostID ?? "") : scope.hostID, "orgId": scope.orgID,
              "kind": "contact", "recordId": id, "name": row.title, "email": text("email"),
              "phone": text("phone").isEmpty ? text("mobilePhone") : text("phone"), "company": text("companyName"),
            ])
        }
      }
      Section("Details") {
        // The fields that hold something; Edit holds every one.
        let shown: [(CrmField, String)] = fields.compactMap { field in
          let value = values[field.spec.key]
          let display = field.spec.key == "ownerUid" ? reference.memberLabel(value) : fieldDisplay(field.spec, value)
          return display.flatMap { $0.isEmpty ? nil : (field, $0) }
        }
        ForEach(shown, id: \.0.id) { field, display in
          if field.spec.kind == .phone, let href = crmTelHref(display), let url = URL(string: href) {
            // A number a dialler can take is a `tel:` link (`CrmPhoneLink`), flagged when they asked not to be phoned.
            LabeledContent(field.spec.label) {
              HStack(spacing: AglynSpace.half) {
                Link(display, destination: url).accessibilityIdentifier("crm-phone-\(field.spec.key)")
                if row.data["doNotCall"] as? Bool == true { Text("(do not call)").font(AglynFont.caption).foregroundStyle(AglynColor.warning) }
              }
            }
          } else {
            PropertyRow(field.spec.label, display)
          }
        }
        if shown.count < fields.count {
          Text("\(fields.count - shown.count) more fields are empty. Edit to fill them in.").font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
      relatedSection(row)
      if kind == .deal || kind == .company {
        ContactRolesSection(
          context: context, kind: kind, id: id, data: document.data, scope: scope, api: api, reference: reference,
          onAdd: { action = .addRole }, onNotice: { notice = $0 }, onError: { error = $0 })
      }
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
      sheet(action, row: row, fields: fields, values: values, fromCache: document.fromCache)
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
    if kind != .deal { acts.append(("Log a call", "phone.badge.plus", .logCall)) }
    if crmHasEmail(row.data) || kind == .deal { acts.append(("Email", "envelope", .email)) }
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
      case .contact: crmHasEmail(row.data) ? .email : .log
      case .deal: (status ?? "open") == "open" && movesStages ? .move : .log
      case .company: .log
      }
    let all = acts.map { title, symbol, act in
      AglynRecordAction(
        "crm-action-\(act.rawValue)", title, systemImage: symbol, destructive: act == .delete,
        enabled: movesStages || ![.stage, .move, .won, .lost].contains(act)
      ) { action = act }
    }
    let primary = all.first { $0.id == "crm-action-\(next.rawValue)" }
    let rest = all.filter { $0.id != primary?.id }
    // Call sits beside Log a call, ahead of everything but Edit and Log activity.
    let at = min(rest.firstIndex { $0.id == "crm-action-logCall" } ?? 2, rest.count)
    var more = rest
    more.insert(contentsOf: callActions(row), at: at)
    return (primary, more)
  }

  /// **Call** (`CrmCallButton`): dials the record's number, switched off when there is none a dialler can take, and
  /// worded as a warning for a person who asked not to be phoned.
  private func callActions(_ row: CrmRow) -> [AglynRecordAction] {
    guard kind != .deal else { return [] }
    let phone = crmCallNumber(kind, row.data)
    let doNotCall = kind != .company && row.data["doNotCall"] as? Bool == true
    let href = crmTelHref(phone)
    return [
      AglynRecordAction("crm-action-call", crmCallLabel(doNotCall: doNotCall), systemImage: "phone", enabled: href != nil) {
        if let href, let url = URL(string: href) { openURL(url) }
      }
    ]
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
    let at = millis(entry.data["atMs"]).map { Date(timeIntervalSince1970: Double($0) / 1000) }
    let meta = [
      entry.string("byName"), at.map { relativeTime($0) }, entry.string("outcome"),
      (entry.data["durationMinutes"] as? NSNumber).map { "\($0.intValue) min" },
    ].compactMap { $0 }.joined(separator: " · ")
    return CrmActivityRow(line: crmActivityLine(entry.data), meta: meta)
      .swipeActions {
        if scope.canWrite && entry.string("byUid") == scope.uid && entry.string("kind") != "email" {
          Button("Delete", role: .destructive) { Task { try? await api.deleteActivity(entry.id) } }
        }
      }
      .accessibilityIdentifier("crm-activity-\(entry.id)")
  }

  @ViewBuilder
  private func sheet(_ action: RecordAction, row: CrmRow, fields: [CrmField], values: [String: String], fromCache: Bool) -> some View {
    let done = { (message: String) in notice = message }
    switch action {
    case .edit:
      EditRecordSheet(
        title: "Edit \(kind.singular.lowercased())",
        fields: kind == .contact ? withContactEmailHelp(fields.filter { $0.editable && (movesStages || $0.spec.key != "lifecycleStage") }, hasEmail: crmHasEmail(row.data)) : fields.filter(\.editable),
        initial: values, held: fromCache, subject: kind.singular.lowercased()
      ) { edited in
        // The sheet lays what was typed over the record as stored now, so only what the person changed differs from it.
        let changes = changedFields(fields, before: values, after: edited)
        if kind == .contact { try await api.updateContact(id, changes) } else { try await api.updateRecord(kind, id, changes) }
        done("\(kind.singular) saved.")
      }
    case .log, .logCall:
      LogActivitySheet(
        reader: context.firestore, scope: scope, reference: reference, start: activityPicks(row), deal: kind == .deal ? row.data : nil,
        known: activityKnownLabels(row), initialKind: action == .logCall ? "call" : "note"
      ) { activityKind, body, outcome, minutes, direction, picks in
        let links = picks.map { crmActivityLinkFromPicks($0) } ?? [kind.linkField: id]
        try await api.logActivity(kind: activityKind, body: body, links: links, outcome: outcome, minutes: minutes, direction: direction)
        done("Logged.")
      }
    case .email:
      CrmEmailComposer(context: context, scope: scope, api: api, to: row.data["email"] as? String, links: emailLinks(row)) { subject, message in
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
    case .addRole:
      let roles = contactRolesOf(kind, row.data)
      AddContactRoleSheet(
        noun: kind.singular.lowercased(), roles: roles, contacts: reference.contacts,
        roleLabels: reference.picklists.labels(crmContactRolePicklist)
      ) { contactID, role, primary in
        try await saveContactRoles(
          kind, id, row.data, contactRolesAdded(roles, contactID: contactID, role: role, primary: primary), api: api, reference: reference)
        done("Contact added.")
      }
    case .delete, .won:
      // Confirmed in an alert (see `confirmsInAlert`), never a sheet.
      EmptyView()
    }
  }

  /// The records a letter from here reads its merge fields from: a deal's own and its Primary, else the record itself.
  private func emailLinks(_ row: CrmRow) -> [String: String] {
    var links = [kind.linkField: id]
    if kind == .deal, let contact = row.data["contactId"] as? String, !contact.isEmpty { links["contactId"] = contact }
    return links
  }

  /// What Name and Related To open on (`crmActivityPicksFrom`): the record itself, and on a deal its Primary as Name.
  /// Nil for a lead's own log, which offers neither: a lead is the entry's only link until it converts.
  private func activityPicks(_ row: CrmRow) -> CrmActivityPicks? {
    guard kind != .lead else { return nil }
    let primary = kind == .deal ? contactRolesPrimary(dealContactRolesOf(row.data)) : nil
    return crmActivityPicksFrom([kind.linkField: id], primaryContactID: primary)
  }

  /// The record's own name, for a field that opens on it while the reference's windows do not hold it.
  private func activityKnownLabels(_ row: CrmRow) -> [String: String] {
    switch kind {
    case .contact: [id: row.title]
    case .company: [CrmRelated(kind: .company, id: id).key: row.title]
    case .deal: [CrmRelated(kind: .deal, id: id).key: row.title]
    case .lead: [:]
    }
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

/// One entry in a record's activity (the console's `ActivityRow`): the kind's mark, its chips, what was said, and who and
/// when. The channels that are brands draw the console's own glyph; the others the nearest SF Symbol.
struct CrmActivityRow: View {
  let line: CrmActivityLine
  let meta: String

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Group {
        if let path = ContractValues.shared.nativeCrmActivityIconPaths[line.kind] {
          SvgPathIcon(path, size: 20)
        } else {
          Image(systemName: crmActivitySymbol(line.kind))
        }
      }
      .foregroundStyle(AglynColor.tint)
      .frame(width: 28, alignment: .leading)
      .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 4) {
          StatusChip(line.chip, tone: .neutral)
          if let state = line.state { StatusChip(state, tone: state == "Received" ? .info : .neutral) }
        }
        if !line.heading.isEmpty { Text(line.heading).font(AglynFont.body).lineLimit(2) }
        if let detail = line.detail { Text(detail).font(AglynFont.subheadline).foregroundStyle(.secondary) }
        if !meta.isEmpty { Text(meta).font(AglynFont.caption).foregroundStyle(.secondary) }
      }
      Spacer(minLength: 0)
    }
    .accessibilityElement(children: .combine)
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

struct EditRecordSheet<Footer: View>: View {
  let title: String
  let fields: [CrmField]
  let initial: [String: String]
  /// A stored record read only from the device cache: Save waits for the server's copy (AGL-4047). A new one is never held.
  var held = false
  /// The record's noun in the held sentence ("contact").
  var subject = "record"
  var confirm = "Save"
  /// What the form asks below its fields that is not a field of the record (New contact's opt-in), reading and writing
  /// the same values.
  let footer: (Binding<[String: String]>) -> Footer
  let save: ([String: String]) async throws -> Void
  @State private var values: [String: String] = [:]
  /// The stored values the typing is laid over.
  @State private var opened: [String: String]?
  @State private var tried = false

  init(
    title: String, fields: [CrmField], initial: [String: String], held: Bool = false, subject: String = "record",
    confirm: String = "Save", @ViewBuilder footer: @escaping (Binding<[String: String]>) -> Footer,
    save: @escaping ([String: String]) async throws -> Void
  ) {
    self.title = title
    self.fields = fields
    self.initial = initial
    self.held = held
    self.subject = subject
    self.confirm = confirm
    self.footer = footer
    self.save = save
  }

  var body: some View {
    let problems = fieldProblems(fields.map(\.spec), values)
    AglynFormSheet(title, confirm: confirm, hold: held ? AglynFormHold(checking: seedCheckingText(subject), unconfirmed: seedUnconfirmedText(subject)) : nil, save: {
      tried = true
      guard problems.isEmpty else { throw ConsoleAPIError(status: 400, message: "Check the fields marked below.") }
      try await save(values)
    }) {
      FieldFormSection(specs: fields.map(\.spec), values: $values, errors: tried ? problems : [:])
      footer($values)
    }
    .onAppear {
      if values.isEmpty { values = initial }
      if opened == nil { opened = initial }
    }
    // A newer copy of the record keeps what was typed and moves every other field to it (AGL-4047).
    .onChange(of: initial) { _, next in
      values = rebased(values, previous: opened ?? next, next: next)
      opened = next
    }
  }
}

extension EditRecordSheet where Footer == EmptyView {
  init(
    title: String, fields: [CrmField], initial: [String: String], held: Bool = false, subject: String = "record",
    confirm: String = "Save", save: @escaping ([String: String]) async throws -> Void
  ) {
    self.init(
      title: title, fields: fields, initial: initial, held: held, subject: subject, confirm: confirm, footer: { _ in EmptyView() },
      save: save)
  }
}

/// New contact's marketing opt-in (the console's drawer): a box worded as the person's own act, off and saying why
/// until the form has an address, with the consent group's sentence and what no source site means beside it.
struct ContactConsentBox: View {
  @Binding var values: [String: String]
  /// The group the opt-in is recorded for: the source site's, or nil with none, which records it on every site.
  let group: ConsentGroup?

  var body: some View {
    let hasEmail = !(values["email"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    Section {
      Toggle(
        "This person opted in to marketing email",
        isOn: Binding(get: { hasEmail && values[contactConsentKey] == "true" }, set: { values[contactConsentKey] = $0 ? "true" : "false" })
      )
      .toggleStyle(.aglynCheckbox)
      .disabled(!hasEmail)
      .accessibilityIdentifier("crm-contact-consent")
    } footer: {
      Text(contactConsentHelp(hasEmail: hasEmail, group: group)).accessibilityIdentifier("crm-contact-consent-help")
    }
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

/// Log a call, a note or anything else (the console's log dialog): what happened, and **Name** and **Related To**, who
/// it was with and the deal or company it is about. Opened from a deal, Name starts on its Primary and its contact roles
/// lead the list; Related To leads with the open deals of the person and the company on the entry.
struct LogActivitySheet: View {
  let reader: FirestoreReader
  let scope: CrmScope
  let reference: CrmReference
  /// What the fields open on; nil for a lead's own log, which offers neither.
  let start: CrmActivityPicks?
  /// The deal the sheet was opened on, whose contact roles lead Name.
  var deal: [String: Any]?
  /// Names for the records the fields open on, which the reference's windows may not hold.
  var known: [String: String] = [:]
  /// The kind the sheet opens on: a note, or a call from **Log a call**.
  var initialKind = "note"
  let save: (String, String, String?, Int?, String?, CrmActivityPicks?) async throws -> Void
  @State private var kind = "note"
  @State private var startedKind = false
  @State private var text = ""
  @State private var outcome = ""
  @State private var minutes = ""
  @State private var direction = ""
  @State private var picks: CrmActivityPicks?
  @State private var linked: [FirestoreDocument] = []

  private var current: CrmActivityPicks? { picks ?? start }

  /// The company whose open deals lead Related To: the one it names, else the record's.
  private var dealsCompany: String? {
    if let related = current?.related, related.kind == .company { return related.id }
    return start?.related?.kind == .company ? start?.related?.id : nil
  }

  private var nameOptions: [CrmPickOption] {
    let pinned = (deal.map(dealContactRolesOf) ?? []).map {
      CrmPickOption(key: $0.contactID, label: reference.contactLabel($0.contactID) ?? known[$0.contactID] ?? "Contact", group: "")
    }
    return crmNameOptions(pinned: pinned, contacts: reference.contacts)
  }

  private var relatedOptions: [CrmPickOption] {
    crmRelatedToOptions(
      linkedDeals: linked, deals: reference.deals,
      companies: reference.companies.map { FirestoreDocument(id: $0.value, data: ["name": $0.label]) })
  }

  var body: some View {
    let kinds = ContractValues.shared.nativeCrmActivityKinds.filter { $0 != "email" }
    let directions = ContractValues.shared.nativeCrmActivityDirections[kind] ?? []
    let picks = current
    let linkedOK = picks?.linked ?? true
    AglynFormSheet(
      "Log activity", confirm: "Log", canConfirm: !text.trimmingCharacters(in: .whitespaces).isEmpty && linkedOK,
      save: { try await save(kind, text, outcome.isEmpty ? nil : outcome, Int(minutes), direction.isEmpty ? nil : direction, picks) }
    ) {
      Section {
        Picker("Kind", selection: $kind) {
          ForEach(kinds, id: \.self) { Text(ContractValues.shared.crmActivityKindLabels[$0] ?? $0).tag($0) }
        }
        .accessibilityIdentifier("activity-kind")
        .onChange(of: kind) { direction = "" }
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
      if let picks {
        Section {
          CrmPickerField(
            "Name", options: nameOptions, selected: picks.contactID,
            selectedLabel: picks.contactID.flatMap { reference.contactLabel($0) ?? known[$0] } ?? "Contact", identifier: "activity-name"
          ) { self.picks = CrmActivityPicks(contactID: $0, related: picks.related) }
          CrmPickerField(
            "Related To", options: relatedOptions, selected: picks.related?.key,
            selectedLabel: picks.related.map { known[$0.key] ?? ($0.kind == .deal ? "Deal" : "Company") }, identifier: "activity-related"
          ) { self.picks = CrmActivityPicks(contactID: picks.contactID, related: $0.flatMap(CrmRelated.init(key:))) }
        } footer: {
          if !picks.linked { Text("Name a contact, or what this is related to.").foregroundStyle(AglynColor.error) }
        }
      }
    }
    .onAppear {
      guard !startedKind else { return }
      startedKind = true
      kind = initialKind
    }
    .task(id: "\(picks?.contactID ?? "")|\(dealsCompany ?? "")") {
      guard start != nil else { return }
      linked = await crmLinkedDeals(reader, scope, contactID: picks?.contactID, companyID: dealsCompany)
    }
  }
}

/// Send email (`crm-send-email-dialog.tsx`): To, a template to start from, the subject, Insert (a snippet or a merge
/// field) and Save as template, then the message.
struct EmailSheet: View {
  let to: String?
  /// The record the letter is written from (`contactId`, `leadId`, `dealId`): which merge fields apply.
  var links: [String: String] = [:]
  /// The workspace's templates as this reader may list them; nil leaves the template tools out.
  var templates: [CrmEmailTemplate]?
  /// Saves the draft as a template; nil leaves Save as template out.
  var saveTemplate: ((_ name: String, _ visibility: String, _ subject: String, _ body: String) async throws -> Void)?
  let save: (String, String) async throws -> Void
  @State private var subject = ""
  @State private var message = ""
  @State private var applied: CrmEmailTemplate?
  @State private var replacing: CrmEmailTemplate?
  @State private var savingTemplate = false

  private var pickable: [CrmEmailTemplate] { crmTemplatePickOrder(templates ?? []) }
  private var snippets: [CrmEmailTemplate] { (templates ?? []).filter { $0.kind == "snippet" } }

  var body: some View {
    let values = ContractValues.shared
    AglynFormSheet(
      "Email", confirm: "Send",
      canConfirm: !subject.trimmingCharacters(in: .whitespaces).isEmpty && !message.trimmingCharacters(in: .whitespaces).isEmpty,
      save: { try await save(subject, message) }
    ) {
      Section {
        if let to { LabeledContent("To", value: to) }
        if !pickable.isEmpty {
          Picker("Template", selection: Binding(get: { applied?.id ?? "" }, set: { id in pick(pickable.first { $0.id == id }) })) {
            Text("None").tag("")
            let shared = pickable.filter { $0.visibility != "personal" }
            let mine = pickable.filter { $0.visibility == "personal" }
            if !shared.isEmpty { Section("Shared") { ForEach(shared) { Text($0.name).tag($0.id) } } }
            if !mine.isEmpty { Section("Mine") { ForEach(mine) { Text($0.name).tag($0.id) } } }
          }
          .accessibilityIdentifier("crm-email-template")
        }
        TextField("Subject", text: Binding(get: { subject }, set: { subject = String($0.prefix(values.crmEmailSubjectMax)) }))
          .accessibilityIdentifier("crm-email-subject")
        if templates != nil {
          HStack {
            Menu("Insert") {
              if !snippets.isEmpty {
                Section("Snippets") { ForEach(snippets) { snippet in Button(snippet.name) { message = crmInsert(snippet.body, into: message) } } }
              }
              ForEach(crmMergeGroups(links), id: \.self) { group in
                Section("\(group.rawValue) fields") {
                  ForEach(values.crmMergeFields.filter { $0.group == group }, id: \.key) { field in
                    Button(field.label) { message = crmInsert(crmMergeFieldToken(field.key), into: message) }
                  }
                }
              }
            }
            .accessibilityIdentifier("crm-email-insert")
            Spacer()
            if saveTemplate != nil {
              Button("Save as template…") { savingTemplate = true }
                .disabled(subject.trimmingCharacters(in: .whitespaces).isEmpty && message.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityIdentifier("crm-email-save-template")
            }
          }
          .buttonStyle(.borderless)
        }
        TextField("Message", text: Binding(get: { message }, set: { message = String($0.prefix(values.crmEmailBodyMax)) }), axis: .vertical)
          .lineLimit(5...16)
          .accessibilityIdentifier("crm-email-body")
      } footer: {
        Text(
          message.contains("{{")
            ? "Plain text. Merge fields are filled in from this record when the email is sent."
            : "The email is sent from your sending address and logged on the record.")
      }
    }
    .alert(
      "Replace the message?", isPresented: Binding(get: { replacing != nil }, set: { if !$0 { replacing = nil } }), presenting: replacing
    ) { template in
      Button("Cancel", role: .cancel) { replacing = nil }
      Button("Replace") {
        replacing = nil
        apply(template)
      }
    } message: { template in
      Text("\"\(template.name)\" replaces what you have written in the subject and the message.")
    }
    .sheet(isPresented: $savingTemplate) {
      CrmSaveAsTemplateSheet { name, visibility in
        try await saveTemplate?(name, visibility, subject.trimmingCharacters(in: .whitespaces), message.trimmingCharacters(in: .whitespacesAndNewlines))
      }
    }
  }

  /// A template into both fields, asking first when a message of the writer's own is already there.
  private func pick(_ template: CrmEmailTemplate?) {
    guard let template else {
      applied = nil
      return
    }
    let written = !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && message != applied?.body
    if written { replacing = template } else { apply(template) }
  }

  private func apply(_ template: CrmEmailTemplate) {
    if !template.subject.isEmpty { subject = template.subject }
    message = template.body
    applied = template
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
  let context: NativePluginContext
  let kind: CrmKind
  let scope: CrmScope
  let api: CrmAPI
  let reference: CrmReference
  let onCreated: (String) -> Void
  @State private var pipelineID = ""
  @State private var stageID = ""

  /// The group a new contact's opt-in is recorded for (the console's `createGroup`): the site's, or at the workspace's
  /// level the source site's; nil with none, where the route records it on every site.
  private func consentGroup(_ values: [String: String]) -> ConsentGroup? {
    let site = scope.orgLevel ? values[crmSiteFieldKey].flatMap { $0.isEmpty ? nil : $0 } : scope.createHostID
    return site.map { consentGroupForHost(scope.org, $0) }
  }

  var body: some View {
    // At the workspace's level a new record names its site in its own form; none is an answer unless the workspace
    // keeps its sites apart.
    let site = crmSiteField(kind, scope, sites: context.sites)
    let fields = (site.map { [$0] } ?? []) + createFields(kind, reference)
    let startSite = scope.orgLevel ? crmCreateHost(picked: CrmCreateSiteMemory.pick(scope.orgID), sites: context.sites.map(\.id)) : nil
    EditRecordSheet(
      title: "New \(kind.singular.lowercased())", fields: fields, initial: ["ownerUid": scope.uid, crmSiteFieldKey: startSite ?? ""],
      confirm: "Create"
    ) { values in
      if kind == .contact { ContactConsentBox(values: values, group: consentGroup(values.wrappedValue)) }
    } save: { values in
      if kind == .contact, !crmContactIdentified(values) {
        throw ConsoleAPIError(status: 400, message: "Enter a name, an email or a phone number.")
      }
      let picked = values[crmSiteFieldKey].flatMap { $0.isEmpty ? nil : $0 }
      if scope.orgLevel { CrmCreateSiteMemory.remember(picked, scope.orgID) }
      let api = CrmAPI(api: api.api, reader: api.reader, scope: scope.orgLevel ? picked.map(scope.forSite) ?? scope : scope)
      let created = createdFields(fields, values)
      var id: String?
      switch kind {
      case .contact:
        var fields = created
        for (key, value) in contactConsentFields(values, group: consentGroup(values)) { fields[key] = value }
        id = try await api.createContact(fields)
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

/// The console's zone of actions in a contact's head, which other plugins fill (`CRM_RECORD_ACTIONS_ZONE`).
let crmRecordActionsZone = "crmRecordActions"
