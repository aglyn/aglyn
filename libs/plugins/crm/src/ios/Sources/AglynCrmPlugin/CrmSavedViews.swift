// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * Saved views on a CRM list (`crm-views-control.tsx`, `use-crm-saved-view.ts`, AGL-3669): the views menu beside the
 * filters. A view is `orgs/{orgId}/crmViews/{id}`, a named set of filter clauses with the visible columns and one sort;
 * the reader's own views and the shared ones are listed, opening one runs its clauses and sort through the list's own
 * query, and the reader's default view (on their profile) opens first.
 *
 * A phone list is rows, not a grid, so a view's columns are kept as saved and never changed here.
 */

let crmViewsCollection = "crmViews"
/// `CRM_VIEWS_LIMIT`: the views one section's menu reads.
let crmViewsLimit = 100
/// A view's list id among the list's filters.
let crmViewFilterPrefix = "view:"

extension CrmKind {
  /// The section a view belongs to (`CrmViewSection`).
  var viewSection: String { collection }
}

struct CrmViewClause: Equatable {
  var field: String
  var op: String
  var value: String
  var label: String?
}

struct CrmViewSort: Equatable {
  var field: String
  var direction: String
}

/// `CrmViewState`: the part of a view a list reads.
struct CrmViewState: Equatable {
  var filters: [CrmViewClause] = []
  var columns: [String] = []
  var sort: CrmViewSort?
}

struct CrmSavedView: Identifiable, Equatable {
  let id: String
  var name: String
  var ownerUID: String
  var createdByUID: String
  var shared: Bool
  var state: CrmViewState
}

private func viewText(_ value: Any?, _ max: Int) -> String {
  guard let text = value as? String else { return "" }
  return String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(max))
}

/// `normalizeCrmViewState`: a stored document's filters, columns and sort, held to their shapes.
func normalizeCrmViewState(_ data: [String: Any]?) -> CrmViewState {
  let values = ContractValues.shared
  var state = CrmViewState()
  for raw in data?["filters"] as? [Any] ?? [] {
    let entry = raw as? [String: Any] ?? [:]
    let field = viewText(entry["field"], 80)
    let op = viewText(entry["op"], 40)
    let value = viewText(entry["value"], 500)
    guard !field.isEmpty, !op.isEmpty else { continue }
    // A valued operator with no value would match nothing: dropped, as the console drops it.
    if value.isEmpty && op != "isEmpty" && op != "isNotEmpty" { continue }
    let label = viewText(entry["label"], 120)
    state.filters.append(CrmViewClause(field: field, op: op, value: value, label: label.isEmpty ? nil : label))
    if state.filters.count >= values.crmViewMaxFilters { break }
  }
  for raw in data?["columns"] as? [Any] ?? [] {
    let column = viewText(raw, 80)
    if !column.isEmpty && !state.columns.contains(column) { state.columns.append(column) }
    if state.columns.count >= values.crmViewMaxColumns { break }
  }
  if let sort = data?["sort"] as? [String: Any] {
    let field = viewText(sort["field"], 80)
    if !field.isEmpty { state.sort = CrmViewSort(field: field, direction: sort["direction"] as? String == "desc" ? "desc" : "asc") }
  }
  return state
}

/// `crmViewIsListed`: the reader's own view, or one somebody shared.
func crmViewIsListed(shared: Bool, ownerUID: String, uid: String?) -> Bool {
  shared || (!(uid ?? "").isEmpty && ownerUID == uid)
}

/// `crmDefaultViewId`: the view this reader opens a section on in this workspace, off their profile.
func crmDefaultViewID(_ profile: [String: Any]?, orgID: String?, section: String) -> String? {
  guard let profile, let orgID, !orgID.isEmpty,
    let byOrg = profile[ContractValues.shared.crmDefaultViewsField] as? [String: Any],
    let bySection = byOrg[orgID] as? [String: Any],
    let id = bySection[section] as? String, !id.trimmingCharacters(in: .whitespaces).isEmpty
  else { return nil }
  return id
}

/// `crmDefaultViewPatch`: the merged write that sets (or clears, with nil) the default.
func crmDefaultViewPatch(orgID: String, section: String, viewID: String?) -> [String: Any] {
  [ContractValues.shared.crmDefaultViewsField: [orgID: [section: viewID.map { $0 as Any } ?? NSNull()]]]
}

func crmSavedView(id: String, _ data: [String: Any]) -> CrmSavedView {
  CrmSavedView(
    id: id, name: data["name"] as? String ?? "", ownerUID: data["ownerUid"] as? String ?? "",
    createdByUID: data["createdByUid"] as? String ?? "", shared: data["shared"] as? Bool == true, state: normalizeCrmViewState(data))
}

/// The menu's views: named ones this reader may list, theirs first, then the shared ones (the menu's two halves).
func crmListedViews(_ docs: [FirestoreDocument], uid: String) -> (mine: [CrmSavedView], shared: [CrmSavedView]) {
  let views = docs.map { crmSavedView(id: $0.id, $0.data) }.filter { !$0.name.isEmpty && crmViewIsListed(shared: $0.shared, ownerUID: $0.ownerUID, uid: uid) }
  return (views.filter { $0.ownerUID == uid }, views.filter { $0.ownerUID != uid })
}

/// `crmViewQuerySort`: the list's own order for the view's sort, or the list's first when it declares none for it.
func crmViewQuerySort(_ sorts: [ListQuerySort], _ sort: CrmViewSort?) -> ListQuerySort? {
  guard let sort else { return nil }
  return sorts.first { $0.column == sort.field && $0.direction.rawValue == sort.direction }
}

/// A view as one of the list's filters: its clauses, and its sort when the list can serve it.
func crmViewFilter(_ view: CrmSavedView, kind: CrmKind) -> CrmFilter {
  CrmFilter(
    id: crmViewFilterPrefix + view.id, label: view.name,
    clauses: view.state.filters.map { ListFilterRequest(field: $0.field, op: $0.op, value: $0.value) },
    sort: crmViewQuerySort(kind.declaration.sorts, view.state.sort))
}

/// The clauses a filter carries, as a view stores them (the label kept for a view's own clause).
func crmViewClauses(_ filter: CrmFilter) -> [[String: Any]] {
  filter.clauses.map { ["field": $0.field, "op": $0.op, "value": $0.value] }
}

/// Who may change a view: its creator, or a member who reaches every site (`canEdit`).
func crmCanEditView(_ view: CrmSavedView, scope: CrmScope) -> Bool {
  !scope.uid.isEmpty && (view.createdByUID == scope.uid || scope.orgWide)
}

extension CrmAPI {
  private var viewsPath: [String] { crmPath(scope.orgID, crmViewsCollection) }

  /// Save as view: the open filter's clauses and sort under a name, the creator's own (`saveAs`).
  func createView(section: String, name: String, shared: Bool, filters: [[String: Any]], columns: [String], sort: CrmViewSort?) async throws -> String {
    let id = newRecordID()
    let site = scope.orgLevel ? nil : scope.hostID
    try await reader.setDocument(
      viewsPath + [id],
      [
        "section": section, "name": String(name.trimmingCharacters(in: .whitespaces).prefix(ContractValues.shared.crmViewNameMax)),
        "filters": filters, "columns": columns,
        "sort": sort.map { ["field": $0.field, "direction": $0.direction] as Any } ?? NSNull(),
        "ownerUid": scope.uid, "createdByUid": scope.uid, "shared": shared, "hostId": site.map { $0 as Any } ?? NSNull(),
        "visibleTo": site == nil ? [orgScopeToken] : scope.createTokens,
        "createdAt": FirestoreSentinel.serverTimestamp, "updatedAt": FirestoreSentinel.serverTimestamp,
      ], merge: false)
    return id
  }

  func renameView(_ id: String, name: String) async throws {
    try await reader.setDocument(
      viewsPath + [id],
      ["name": String(name.trimmingCharacters(in: .whitespaces).prefix(ContractValues.shared.crmViewNameMax)), "updatedAt": FirestoreSentinel.serverTimestamp],
      merge: true)
  }

  func shareView(_ id: String, shared: Bool) async throws {
    try await reader.setDocument(viewsPath + [id], ["shared": shared, "updatedAt": FirestoreSentinel.serverTimestamp], merge: true)
  }

  func deleteView(_ id: String) async throws { try await reader.deleteDocument(viewsPath + [id]) }

  /// The reader's default for a section, on their own profile beside their other preferences.
  func setDefaultView(section: String, viewID: String?) async throws {
    try await reader.setDocument(["users", scope.uid], crmDefaultViewPatch(orgID: scope.orgID, section: section, viewID: viewID), merge: true)
  }
}

/// A section's saved views and the reader's default, live.
@MainActor
@Observable
final class CrmViewsModel {
  @ObservationIgnored let list = LiveQueryList(pageSize: crmViewsLimit) { $0 }
  @ObservationIgnored let profile = ObservedDocument()

  func start(_ reader: FirestoreReader, _ scope: CrmScope, section: String) {
    list.show(reader) { _ in
      scopedQuery(
        scope, crmViewsCollection, filters: [ListQueryConstraint(path: "section", op: .equal, value: section)],
        order: [.init("name")], limit: crmViewsLimit)
    }
    if !scope.uid.isEmpty { profile.start(reader, ["users", scope.uid]) }
  }

  func stop() {
    list.stop()
    profile.stop()
  }

  func views(uid: String) -> (mine: [CrmSavedView], shared: [CrmSavedView]) { crmListedViews(list.rows, uid: uid) }

  func defaultID(orgID: String, section: String) -> String? { crmDefaultViewID(profile.document?.data, orgID: orgID, section: section) }
}

/// The views menu (`CrmViewsControl`): the views to open, then what the reader may do to the open one.
struct CrmViewsMenu: View {
  let kind: CrmKind
  let scope: CrmScope
  let api: CrmAPI
  let model: CrmViewsModel
  /// The filter the list shows now: a chip or a view.
  let current: CrmFilter
  let open: (String) -> Void
  /// The plain, unnarrowed list ("All contacts"), which a cleared default opens on.
  let openAll: () -> Void
  @State private var naming: CrmViewNaming?
  @State private var deleting: CrmSavedView?
  @State private var notice: String?

  private var section: String { kind.viewSection }
  private var listed: (mine: [CrmSavedView], shared: [CrmSavedView]) { model.views(uid: scope.uid) }
  private var openView: CrmSavedView? {
    guard current.id.hasPrefix(crmViewFilterPrefix) else { return nil }
    let id = String(current.id.dropFirst(crmViewFilterPrefix.count))
    return (listed.mine + listed.shared).first { $0.id == id }
  }
  private var defaultID: String? { model.defaultID(orgID: scope.orgID, section: section) }
  private var allLabel: String { "All \(kind.plural.lowercased())" }

  var body: some View {
    Menu {
      if !listed.mine.isEmpty {
        Section("My views") { ForEach(listed.mine) { pick($0) } }
      }
      if !listed.shared.isEmpty {
        Section("Shared with the team") { ForEach(listed.shared) { pick($0) } }
      }
      Section {
        Button(openView == nil ? "Save as view…" : "Save as new view…", systemImage: "square.and.arrow.down") {
          naming = CrmViewNaming(mode: .create, name: "", shared: false)
        }
        .disabled(scope.uid.isEmpty)
        if let view = openView, crmCanEditView(view, scope: scope) {
          Button("Rename…", systemImage: "pencil") { naming = CrmViewNaming(mode: .rename(view.id), name: view.name, shared: view.shared) }
          Button(view.shared ? "Stop sharing" : "Share with the team", systemImage: "square.and.arrow.up") {
            act(view.shared ? "The view is yours alone again" : "The view is shared with the team", failed: "The view could not be changed.") {
              try await api.shareView(view.id, shared: !view.shared)
            }
          }
        }
        if let view = openView {
          let isDefault = defaultID == view.id
          Button(isDefault ? "Clear default" : "Set as default", systemImage: isDefault ? "star.fill" : "star") {
            act(isDefault ? "\(allLabel) opens first again" : "“\(view.name)” opens first from now on", failed: "The default could not be changed.") {
              try await api.setDefaultView(section: section, viewID: isDefault ? nil : view.id)
            }
          }
        } else if defaultID != nil {
          Button("Make \(allLabel.lowercased()) the default", systemImage: "star") {
            act("\(allLabel) opens first again", failed: "The default could not be changed.") {
              try await api.setDefaultView(section: section, viewID: nil)
            }
          }
        }
        if let view = openView, crmCanEditView(view, scope: scope) {
          Button("Delete view…", systemImage: "trash", role: .destructive) { deleting = view }
        }
      }
    } label: {
      Label(openView?.name ?? "Views", systemImage: "bookmark")
        .font(AglynFont.subheadline.weight(.semibold))
        .lineLimit(1)
    }
    .accessibilityIdentifier("crm-views")
    .sheet(item: $naming) { naming in
      CrmViewNameSheet(naming: naming) { name, shared in
        switch naming.mode {
        case .create:
          let id = try await api.createView(
            section: section, name: name, shared: shared, filters: crmViewClauses(current),
            columns: openView?.state.columns ?? [], sort: openView?.state.sort)
          notice = "View “\(name)” saved"
          open(id)
        case .rename(let id):
          try await api.renameView(id, name: name)
          notice = "Renamed to “\(name)”"
        }
      }
    }
    .alert(
      "Delete the view “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
      presenting: deleting
    ) { view in
      Button("Cancel", role: .cancel) { deleting = nil }
      Button("Delete view", role: .destructive) {
        deleting = nil
        act("View “\(view.name)” deleted", failed: "The view could not be deleted.") {
          try await api.deleteView(view.id)
          // A default pointing at nothing would open every visit on a missing view.
          if defaultID == view.id { try await api.setDefaultView(section: section, viewID: nil) }
          openAll()
        }
      }
      .accessibilityIdentifier("crm-view-delete-confirm")
    } message: { view in
      Text(view.shared
        ? "Everyone on the team who opens it will lose it; the \(kind.plural.lowercased()) themselves are untouched."
        : "The \(kind.plural.lowercased()) themselves are untouched.")
    }
    .alert(notice ?? "", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
      Button("OK", role: .cancel) { notice = nil }
    }
  }

  private func pick(_ view: CrmSavedView) -> some View {
    Button {
      open(view.id)
    } label: {
      if openView?.id == view.id {
        Label(view.name, systemImage: "checkmark")
      } else {
        Text(view.name)
      }
      if let detail = crmViewMenuDetail(view, uid: scope.uid, defaultID: defaultID) { Text(detail) }
    }
  }

  private func act(_ done: String, failed: String, _ work: @escaping () async throws -> Void) {
    Task {
      do {
        try await work()
        notice = done
      } catch {
        notice = failed
      }
    }
  }
}

/// The line under a view in the menu: shared, the reader's default, or both (as the console's menu says it).
func crmViewMenuDetail(_ view: CrmSavedView, uid: String, defaultID: String?) -> String? {
  let isDefault = view.id == defaultID
  if view.ownerUID == uid {
    if view.shared { return isDefault ? "Shared · your default" : "Shared" }
    return isDefault ? "Your default" : nil
  }
  return isDefault ? "Your default" : nil
}

struct CrmViewNaming: Identifiable {
  enum Mode: Equatable {
    case create
    case rename(String)
  }
  let mode: Mode
  var name: String
  var shared: Bool
  var id: String {
    switch mode {
    case .create: "create"
    case .rename(let id): "rename-\(id)"
    }
  }
}

/// Save as view / Rename view: the name, and on a new view whether the team sees it.
struct CrmViewNameSheet: View {
  let naming: CrmViewNaming
  let save: (_ name: String, _ shared: Bool) async throws -> Void
  @State private var name = ""
  @State private var shared = false
  @State private var loaded = false

  var body: some View {
    let creating = naming.mode == .create
    AglynFormSheet(
      creating ? "Save as view" : "Rename view", confirm: creating ? "Save view" : "Rename",
      canConfirm: !name.trimmingCharacters(in: .whitespaces).isEmpty,
      save: { try await save(String(name.trimmingCharacters(in: .whitespaces).prefix(ContractValues.shared.crmViewNameMax)), shared) }
    ) {
      Section {
        TextField("Name", text: $name).accessibilityIdentifier("crm-view-name")
        if creating {
          Toggle("Share with the team", isOn: $shared).accessibilityIdentifier("crm-view-shared")
        }
      } footer: {
        if creating { Text("The filters and sort as they are now, under a name you can open from the views menu.") }
      }
    }
    .onAppear {
      guard !loaded else { return }
      loaded = true
      name = naming.name
      shared = naming.shared
    }
  }
}

/// What re-runs a list's query: the filter it shows (a view's clauses arrive after its id) and the search.
struct CrmListKey: Equatable {
  let filter: CrmFilter
  let search: String
}
