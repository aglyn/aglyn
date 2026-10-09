// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

// A site's reusable components, shared layouts and templates, as the
// console's three lists read and change them (`hosts/[host]/components`,
// `layouts`, `templates`): one query per view through the list's own
// declaration (COMPONENT_LIST_QUERY, LAYOUT_LIST_QUERY, TEMPLATE_LIST_QUERY
// with `libraryRow == true` as its base), ordered by document id, the quick
// search on `nameTokens` and the kind filter as a clause. Creates and
// duplicates go through `/api/hosts/resources` (and a layout's first version
// through `/api/hosts/versions`), the quota-enforcing routes the console
// uses; a rename, a description, a layout's parent and a delete are the same
// document updates the console's pages make, under the same rules. The
// design itself is the Besigner's. The Kotlin kit's `Artifacts.kt`.

/// The lists' window; it grows by this much as the list scrolls.
public let artifactPageSize = 25

/// The create drawer's limits (`create-artifact-drawer`).
public let artifactNameMax = 25
public let artifactDescriptionMax = 80

/// The duplicate dialog's name limit and default (`DUPLICATE_NAME_MAX`, `DUPLICATE_NAME_PREFIX`).
public let duplicateNameMax = 200
public let duplicateNamePrefix = "Copy of "

/// How deep a chain of layouts may go (`MAX_LAYOUT_CHAIN_DEPTH`).
public let maxLayoutChainDepth = 5

private let canvasRoot = "_@_"
private let layoutSlotComponentID = "layoutSlot"
private let muiBundleID = "mui"

/// The three lists, each its collection, its routes' words and its declaration.
public enum ArtifactKind: String, CaseIterable, Identifiable, Sendable {
  case component, layout, template

  public var id: String { rawValue }

  public var screen: String { "site.\(collection)" }

  public var collection: String {
    switch self {
    case .component: "components"
    case .layout: "layouts"
    case .template: "templates"
    }
  }

  public var title: String {
    switch self {
    case .component: "Components"
    case .layout: "Layouts"
    case .template: "Templates"
    }
  }

  public var singular: String { rawValue }

  public var supporting: String {
    switch self {
    case .component: "Designs you reuse across pages and emails"
    case .layout: "The shared header and footer pages sit in"
    case .template: "Starting points for pages, components and layouts"
    }
  }

  public var systemImage: String {
    switch self {
    case .component: "square.on.square.dashed"
    case .layout: "rectangle.split.3x1"
    case .template: "square.grid.2x2"
    }
  }

  /// The `resource` a create sends to `/api/hosts/resources`.
  var createResource: String {
    switch self {
    case .component: "reusableComponent"
    case .layout: "layout"
    case .template: "template"
    }
  }

  /// The `resource` a duplicate sends (`DUPLICABLE_HOST_RESOURCE_KINDS`).
  var duplicateResource: String { rawValue }

  /// The `kind` `/api/hosts/versions` and `/api/hosts/where-used` know it by; nil for templates, which have no versions.
  public var versionKind: String? { self == .template ? nil : rawValue }

  public var declaration: ListQueryDeclaration {
    switch self {
    case .component: ContractValues.shared.componentListQuery
    case .layout: ContractValues.shared.layoutListQuery
    case .template: ContractValues.shared.templateListQuery
    }
  }

  /// The filter chips above the list: the kind clause's values and their labels (nil value is "All").
  public var kindChoices: [(value: String?, label: String)] {
    switch self {
    case .component: [(nil, "All"), ("site", "Page"), ("email", "Email")]
    case .layout: []
    case .template: [(nil, "All")] + ContractValues.shared.templateKindOptions.map { ($0.value, $0.label) }
    }
  }

  /// The words for an empty list.
  public var emptyMessage: String {
    switch self {
    case .component: "A component is a design you place on many pages and change in one place."
    case .layout: "A layout wraps pages in a shared header and footer."
    case .template: "Save a page, component or layout as a template to start new ones from it."
    }
  }
}

/// Where a component is placed, as the list's "Used in" column reads it (missing is `site`).
public func componentPlacementLabel(_ kind: String?) -> String { kind == "email" ? "Email" : "Page" }

/// A template's kind label (missing is `page`).
public func templateKindLabel(_ kind: String?) -> String {
  let resolved = kind ?? "page"
  return ContractValues.shared.templateKindOptions.first { $0.value == resolved }?.label
    ?? (resolved.prefix(1).uppercased() + resolved.dropFirst())
}

/// A template's source badge: saved on this site, a starter, or a plugin's.
public func templateSourceLabel(_ type: String?) -> String {
  switch type {
  case nil, "", "authored": "Saved here"
  case "starter": "Starter"
  default: type.map { $0.prefix(1).uppercased() + $0.dropFirst() } ?? "Saved here"
  }
}

/// One row of a list, and the detail pane's subject.
public struct ArtifactRow: Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let description: String?
  /// A component's placement or a template's kind.
  public let kind: String?
  public let versionID: String?
  /// A layout's parent layout (`layoutId`, "Renders inside").
  public let parentLayoutID: String?
  public let sourceType: String?
  public let starterID: String?
  public let starterName: String?
  public let starterOrder: Int?
  /// The row the template library lists (one per starter bundle).
  public let libraryRow: Bool
  public let updatedAt: Date?
  public let createdAt: Date?

  public var isStarterBundle: Bool { starterID != nil }

  /// Nil for a deleted row, which the console's lists hide.
  public init?(_ doc: FirestoreDocument) {
    if doc.data["deletedAt"] != nil, !(doc.data["deletedAt"] is NSNull) { return nil }
    let source = doc.data["source"] as? [String: Any]
    id = doc.id
    name = nonBlankText(doc.string("displayName")) ?? "Untitled"
    description = nonBlankText(doc.string("description"))
    kind = nonBlankText(doc.string("kind"))
    versionID = nonBlankText(doc.string("versionId"))
    parentLayoutID = nonBlankText(doc.string("layoutId"))
    sourceType = source?["type"] as? String
    starterID = nonBlankText(source?["starterId"] as? String)
    starterName = nonBlankText(source?["starterName"] as? String)
    starterOrder = (source?["starterOrder"] as? NSNumber)?.intValue
    libraryRow = doc.bool("libraryRow") == true
    updatedAt = doc.date("updatedAt")
    createdAt = doc.date("createdAt")
  }
}

/// One saved version of a component or layout.
public struct ArtifactVersion: Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String?
  public let createdAt: Date?
  public let updatedAt: Date?

  public init(_ doc: FirestoreDocument) {
    id = doc.id
    name = nonBlankText(doc.string("displayName"))
    createdAt = doc.date("createdAt")
    updatedAt = doc.date("updatedAt")
  }
}

/// Versions newest first, as the detail pages sort the 100 they read.
public func sortedVersions(_ versions: [ArtifactVersion]) -> [ArtifactVersion] {
  versions.sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }
}

/// The version "Edit in the Besigner" opens: the one asked for, else the
/// current one, else the newest. Nil when there is none yet.
public func versionToOpen(_ row: ArtifactRow, versions: [ArtifactVersion], asked: String? = nil) -> String? {
  asked ?? row.versionID ?? sortedVersions(versions).first?.id
}

/// One list view's request: the kind clause and the quick search, on the declaration's base.
public func artifactRequest(_ kind: ArtifactKind, search: String, kindFilter: String?) -> ListQueryRequest {
  let typed = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return ListQueryRequest(
    base: kind == .template ? ContractValues.shared.templateListBase : nil,
    clauses: kindFilter.map { [ListFilterRequest(field: "kind", op: "equals", value: $0)] } ?? [],
    search: typed.isEmpty ? nil : [typed])
}

public func artifactQuery(_ kind: ArtifactKind, hostID: String, search: String, kindFilter: String?, limit: Int) -> FirestoreQuery {
  planListQuery(kind.declaration, artifactRequest(kind, search: search, kindFilter: kindFilter))
    .firestoreQuery(["hosts", hostID, kind.collection], limit: limit)
}

/// The layouts a layout may render inside (`canNestLayout`): never itself,
/// never one that already has it somewhere above, sorted by name.
public func nestableParents(of layoutID: String, in layouts: [ArtifactRow]) -> [ArtifactRow] {
  var parentOf: [String: String] = [:]
  for layout in layouts { if let parent = layout.parentLayoutID { parentOf[layout.id] = parent } }
  func chain(_ start: String) -> [String] {
    var out: [String] = []
    var current: String? = start
    while let id = current, !out.contains(id), out.count < maxLayoutChainDepth {
      out.append(id)
      current = parentOf[id]
    }
    return out
  }
  return layouts.filter { $0.id != layoutID && !chain($0.id).contains(layoutID) }
    .sorted { $0.name.lowercased() < $1.name.lowercased() }
}

/// One list: the search, the kind chip, the rows read so far and whether
/// more are left. A live window that grows a page at a time.
@MainActor
@Observable
public final class ArtifactListModel {
  public private(set) var rows: LiveValue<[ArtifactRow]> = .loading
  public private(set) var hasMore = false
  public var search = "" { didSet { if oldValue != search { restart() } } }
  public var kindFilter: String? { didSet { if oldValue != kindFilter { restart() } } }

  @ObservationIgnored private var kind = ArtifactKind.component
  @ObservationIgnored private var reader: FirestoreReader?
  @ObservationIgnored private var hostID = ""
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var limit = artifactPageSize

  public init() {}

  public func start(_ reader: FirestoreReader, kind: ArtifactKind, hostID: String) {
    self.reader = reader
    self.kind = kind
    self.hostID = hostID
    restart()
  }

  public func loadMore() {
    guard hasMore else { return }
    limit += artifactPageSize
    listen(keep: true)
  }

  public func refresh() { listen(keep: true) }

  public func stop() {
    listener?.remove()
    listener = nil
  }

  private func restart() {
    limit = artifactPageSize
    listen(keep: false)
  }

  private func listen(keep: Bool) {
    listener?.remove()
    if !keep { rows = .loading }
    guard let reader, !hostID.isEmpty else { return }
    let window = limit
    let query = artifactQuery(kind, hostID: hostID, search: search, kindFilter: kindFilter, limit: window + 1)
    let title = kind.title
    listener = reader.listen(query) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.hasMore = docs.count > window
        self.rows = .ready(docs.prefix(window).compactMap(ArtifactRow.init))
      case .failure:
        self.hasMore = false
        self.rows = .failed("\(title) could not be loaded. Check the connection and try again.")
      }
    }
  }
}

/// Something that uses a component or layout, as the "Used by" card lists it.
public struct ArtifactDependent: Equatable, Identifiable, Sendable {
  public let type: String
  public let id: String
  public let name: String
}

/// The "Used by" scan's answer: who, and whether it read everything.
public struct ArtifactUsage: Equatable, Sendable {
  public let dependents: [ArtifactDependent]
  public let complete: Bool
}

/// A dependent's kind, as the "Used by" card names it.
public func dependentLabel(_ type: String) -> String {
  switch type {
  case "screen": "Page"
  case "layout": "Layout"
  case "component": "Component"
  case "collection": "Collection"
  case "emailTemplate", "emailDesign", "systemEmail": "Email"
  default: type.prefix(1).uppercased() + type.dropFirst()
  }
}

/// A canvas holding only its root, as a new component or template starts.
func blankCanvas() -> [String: Any] {
  [canvasRoot: ["$id": canvasRoot, "componentId": "div", "nodes": [Any]()] as [String: Any]]
}

/// A new layout's canvas: the root and the one slot pages graft into.
func layoutCanvas(slotID: String) -> [String: Any] {
  [
    canvasRoot: ["$id": canvasRoot, "componentId": "div", "nodes": [slotID]] as [String: Any],
    slotID: [
      "$id": slotID, "componentId": layoutSlotComponentID, "pluginId": muiBundleID, "parentId": canvasRoot, "props": [String: Any](),
    ] as [String: Any],
  ]
}

/// The Besigner page an artifact opens on (a template has no version).
public func artifactBesignerPath(_ kind: ArtifactKind, id: String, versionID: String?, preview: Bool = false) -> String? {
  let leaf = preview ? "preview" : "besigner"
  switch kind {
  case .component, .layout: return versionID.map { "/\(kind.collection)/\(id)/versions/\($0)/\(leaf)" }
  case .template: return "/templates/\(id)/\(leaf)"
  }
}

/// The writes of one list, each made the way the console's page makes it.
public struct ArtifactsAPI: Sendable {
  let api: ConsoleAPIClient
  let writer: FirestoreWriter
  let hostID: String
  let kind: ArtifactKind

  public init(api: ConsoleAPIClient, writer: FirestoreWriter, hostID: String, kind: ArtifactKind) {
    self.api = api
    self.writer = writer
    self.hostID = hostID
    self.kind = kind
  }

  private func path(_ id: String) -> [String] { ["hosts", hostID, kind.collection, id] }

  @discardableResult
  private func resources(_ body: [String: Any?]) async throws -> JSONValue? {
    var fields: [String: Any?] = ["hostId": hostID]
    fields.merge(body) { _, new in new }
    return try await api.request("/api/hosts/resources", method: .post, body: jsonBody(fields))
  }

  /// A new component, layout or template; answers its id. A component
  /// carries its blank design and no version (the first opens it); a layout
  /// gets its first version with the slot; a template is born through the
  /// route, never a client create.
  public func create(name: String, description: String, subKind: String?) async throws -> String {
    let id = newDocumentID()
    var data: [String: Any?] = ["displayName": name.trimmed, "description": description.trimmed]
    switch kind {
    case .component:
      data["rootId"] = canvasRoot
      data["nodes"] = blankCanvas()
      if subKind == "email" { data["kind"] = "email" }
      try await resources(["resource": kind.createResource, "id": id, "data": data])
    case .layout:
      let versionID = newDocumentID()
      data["versionId"] = versionID
      try await resources(["resource": kind.createResource, "id": id, "data": data])
      try await api.request(
        "/api/hosts/versions", method: .post,
        body: jsonBody([
          "hostId": hostID, "kind": "layout", "parentId": id, "id": versionID,
          "data": ["layoutId": id, "nodes": layoutCanvas(slotID: newDocumentID())] as [String: Any?],
        ]))
    case .template:
      data["kind"] = subKind ?? "page"
      data["rootId"] = canvasRoot
      data["nodes"] = blankCanvas()
      try await resources(["resource": kind.createResource, "id": id, "data": data])
    }
    return id
  }

  /// A draft copy under a new name; answers its id.
  public func duplicate(sourceID: String, name: String) async throws -> String? {
    let trimmed = String(name.trimmed.prefix(duplicateNameMax))
    return try await resources([
      "resource": kind.duplicateResource, "action": "duplicate", "sourceId": sourceID,
      "name": trimmed.isEmpty ? nil : trimmed, "attemptKey": newDocumentID(),
    ]).field("id")
  }

  /// The details form's save: the name with its search keys, the description, and a layout's parent.
  public func saveDetails(_ id: String, name: String, description: String, parentLayoutID: String? = nil, setParent: Bool = false)
    async throws
  {
    var fields = displayNameSearchFields(name.trimmed)
    fields["displayName"] = name.trimmed
    fields["description"] = description.trimmed
    if setParent { fields["layoutId"] = parentLayoutID.map { $0 as Any } ?? FirestoreSentinel.delete }
    fields["updatedAt"] = Date()
    try await writer.merge(path(id), fields)
  }

  /// Deletes softly, as every list does; a template also leaves the library.
  public func delete(_ id: String) async throws {
    var fields: [String: Any] = ["deletedAt": Date()]
    if kind == .template { fields["libraryRow"] = false }
    try await writer.merge(path(id), fields)
  }

  /// Deletes a whole starter bundle: every page leaves the library, as the list's Delete does.
  public func deleteBundle(_ pages: [ArtifactRow]) async throws {
    for page in pages { try await delete(page.id) }
  }

  /// Deletes one page of a starter bundle; when it was the bundle's library
  /// row, the next page (by its starter order) takes the row, as the
  /// template page's batch does.
  public func deleteBundlePage(_ page: ArtifactRow, siblings: [ArtifactRow], wasLead: Bool) async throws {
    try await delete(page.id)
    if wasLead,
      let next = siblings.filter({ $0.id != page.id }).min(by: { ($0.starterOrder ?? .max) < ($1.starterOrder ?? .max) })
    {
      try await writer.merge(path(next.id), ["libraryRow": true])
    }
  }

  /// The version the Besigner opens on, making the first one when there is
  /// none (a component is created without one): the versions route seeds it
  /// from the component's own design on the server, then the component
  /// points at it, as the console's Open Besigner does.
  public func ensureVersion(_ row: ArtifactRow, versions: [ArtifactVersion], asked: String? = nil) async throws -> String {
    if let existing = versionToOpen(row, versions: versions, asked: asked) { return existing }
    guard let versionKind = kind.versionKind else { throw ConsoleAPIError(status: 0, message: "Templates have no versions") }
    let versionID = newDocumentID()
    try await api.request(
      "/api/hosts/versions", method: .post,
      body: jsonBody(["hostId": hostID, "kind": versionKind, "parentId": row.id, "id": versionID, "seedFromParent": true]))
    try await writer.merge(path(row.id), ["versionId": versionID, "updatedAt": Date()])
    return versionID
  }

  /// What uses a component or layout (`POST /api/hosts/where-used`).
  public func usage(_ row: ArtifactRow) async throws -> ArtifactUsage? {
    guard let versionKind = kind.versionKind else { return nil }
    let answer = try await api.request(
      "/api/hosts/where-used", method: .post,
      body: jsonBody(["hostId": hostID, "kind": versionKind, "id": row.id, "name": row.name]))
    let list: [ArtifactDependent] =
      answer?["dependents"]?.arrayValue?.compactMap { entry in
        guard let id = entry["id"]?.stringValue else { return nil }
        return ArtifactDependent(type: entry["type"]?.stringValue ?? "screen", id: id, name: entry["name"]?.stringValue ?? "Untitled")
      } ?? []
    return ArtifactUsage(dependents: list, complete: answer?["complete"]?.boolValue ?? false)
  }
}
