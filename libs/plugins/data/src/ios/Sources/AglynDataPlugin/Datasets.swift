// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import Foundation
import Observation

/*
 * The workspace's datasets (`orgs/{orgId}/datasets`, records under each) as
 * the console's Data card reads and changes them, the Kotlin plugin's
 * Datasets.kt line for line: the list a member can see (their scope tokens
 * unless they reach every site), a dataset's records one query at a time
 * (`planDatasetRecordQuery`), creates and record edits and deletes through
 * `/api/orgs/datasets`, a dataset's delete through the erase route, and its
 * schema as the same document update the Schema dialog makes.
 */

let recordsPageSize = 25

/// The picker's window: the console lists at most this many datasets.
let datasetsLimit = 100

func datasetsPath(_ orgID: String) -> [String] { ["orgs", orgID, "datasets"] }

func recordsPath(_ orgID: String, _ datasetID: String) -> [String] { datasetsPath(orgID) + [datasetID, "records"] }

/// The sentence that says who a new dataset is shared with (`newDatasetSharingNote`).
public func newDatasetSharingNote(siteOnly: Bool) -> String {
  siteOnly
    ? "Datasets belong to your organization. Your default sharing starts a new one on this site only — use Schema to share it with more."
    : "Datasets belong to your organization. A new one is shared with every site — use Schema to narrow that."
}

/// One dataset as the list and its pages read it.
struct DatasetRow: Identifiable, Hashable {
  let id: String
  let name: String
  let model: DatasetModel
  /// The stored model's field maps, kept so a schema save never drops a key this app does not edit.
  let rawFields: [String: [String: ContractJSON]]
  let singular: String
  let plural: String
  /// The sharing scope as stored; nil when the document stores none.
  let visibleTo: [String]?
  /// The all-sites-except marker beside `visibleTo` (AGL-4047): the sites left out, as scope tokens, under `allExcept`.
  let scopeMode: String?
  let scopeExcept: [String]?
  let updatedAt: Date?

  /// Shared with all sites except some (AGL-4047): either marker key present, as the rules read it.
  let sharingMarked: Bool

  /// Where it sits for the one-site verdict (`oneSitePlacement`): never one site while it is marked, however few sites it
  /// reaches today, since it belongs to the whole workspace.
  var placementScope: [String]? { sharingMarked ? nil : visibleTo }

  /// Who it is shared with, as `describeSharing` and `scopeSharingOf` read it.
  var sharing: [String: Any] {
    var fields: [String: Any] = [:]
    if let visibleTo { fields["visibleTo"] = visibleTo }
    if let scopeMode { fields["scopeMode"] = scopeMode }
    if let scopeExcept { fields["scopeExcept"] = scopeExcept }
    return fields
  }

  init(_ doc: FirestoreDocument) {
    let names = doc.data["names"] as? [String: Any]
    var raw: [String: [String: ContractJSON]] = [:]
    for (key, value) in (doc.data["model"] as? [String: Any])?["fields"] as? [String: Any] ?? [:] {
      if let map = value as? [String: Any] { raw[key] = map.mapValues { contractJSON(of: $0) } }
    }
    id = doc.id
    name = datasetDisplayName(doc.data).isEmpty ? doc.id : datasetDisplayName(doc.data)
    model = effectiveDatasetModel(doc.data)
    rawFields = raw
    singular = names?["singular"] as? String ?? ""
    let storedPlural = names?["plural"] as? String
    plural = (storedPlural?.isEmpty == false ? storedPlural : nil) ?? datasetDisplayName(doc.data)
    let scope = (doc.data["visibleTo"] as? [Any])?.compactMap { $0 as? String } ?? []
    visibleTo = scope.isEmpty ? nil : scope
    scopeMode = doc.data["scopeMode"] as? String
    scopeExcept = (doc.data["scopeExcept"] as? [Any])?.compactMap { $0 as? String }
    sharingMarked = doc.data.keys.contains("scopeMode") || doc.data.keys.contains("scopeExcept")
    updatedAt = firestoreInstant(doc.data["updatedAt"])
  }

  /// The other datasets' reference fields that point here.
  func referencedBy(_ others: [DatasetRow]) -> [(dataset: DatasetRow, fieldID: String)] {
    others.flatMap { other in
      other.model.orderedFields.filter { $0.field.type == .reference && $0.field.reference?.datasetId == id }
        .map { (other, $0.id) }
    }
  }

  static func == (a: DatasetRow, b: DatasetRow) -> Bool { a.id == b.id && a.name == b.name && a.model == b.model && a.visibleTo == b.visibleTo && a.scopeMode == b.scopeMode
      && a.scopeExcept == b.scopeExcept && a.updatedAt == b.updatedAt }
  func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// A Firestore time: a timestamp, or epoch milliseconds.
func firestoreInstant(_ value: Any?) -> Date? {
  if let date = value as? Date { return date }
  return finiteNumber(value).map { Date(timeIntervalSince1970: $0 / 1000) }
}

/// One record: its stored values and when it last changed.
struct RecordRow: Identifiable {
  let id: String
  let values: [String: Any]
  let updatedAt: Date?
  let createdAt: Date?

  init(_ doc: FirestoreDocument) {
    id = doc.id
    values = doc.data["values"] as? [String: Any] ?? [:]
    updatedAt = firestoreInstant(doc.data["updatedAt"])
    createdAt = firestoreInstant(doc.data["createdAt"])
  }

  /// The record's title in a list: the first field with a value, else its id.
  func title(_ model: DatasetModel) -> String {
    for (id, field) in model.orderedFields {
      let text = formatDatasetValue(field, values[id])
      if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return text }
    }
    return id
  }

  /// A line under the title: the next two fields with values.
  func supporting(_ model: DatasetModel) -> String? {
    let lines = model.orderedFields.compactMap { id, field -> String? in
      let text = formatDatasetValue(field, values[id])
      return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : "\(field.label(id)): \(text)"
    }
    let joined = lines.dropFirst().prefix(2).joined(separator: " · ")
    return joined.isEmpty ? nil : joined
  }
}

/// The `visibleTo` tokens a list of datasets asks for, or nil for no filter (`datasetListScope`). On a site, the site decides,
/// whoever is looking: that site's datasets and the workspace-wide ones. With no site, the member's own reach decides.
func datasetListScope(hostID: String?, memberScope: [String]?) -> [String]? {
  hostID.map { [OrgAccess.orgScopeToken, OrgAccess.hostScopeToken($0)] } ?? memberScope
}

/// The datasets a member can list: everything for an org-wide member, their scope's otherwise (the rules refuse an unfiltered list).
func datasetsQuery(_ orgID: String, scopeTokens: [String]?) -> FirestoreQuery {
  FirestoreQuery(
    datasetsPath(orgID),
    filters: scopeTokens.map { [ListQueryConstraint(path: "visibleTo", op: .arrayContainsAny, value: $0)] } ?? [],
    // So the server's confirmation of an empty list reaches the screen, which says "none" only then (AGL-4047).
    limit: datasetsLimit, includeMetadataChanges: true)
}

/// The quick search's words, as the grid splits what was typed.
func searchWords(_ search: String) -> [String] {
  search.trimmingCharacters(in: .whitespacesAndNewlines).split(whereSeparator: { $0.isWhitespace }).map(String.init)
}

/// One page of a dataset's records under the clauses and search, `limit` rows.
func recordsQuery(
  _ orgID: String, _ datasetID: String, model: DatasetModel, clauses: [ListFilterRequest], search: String, limit: Int
) -> FirestoreQuery {
  planDatasetRecordQuery(model, clauses: clauses, searchWords: searchWords(search)).plan
    .firestoreQuery(recordsPath(orgID, datasetID), limit: limit)
}

/// A dataset's records, one query at a time, as the records table pages them.
@MainActor
@Observable
final class RecordsModel {
  private(set) var rows: [RecordRow] = []
  private(set) var ready = false
  private(set) var failed = false
  private(set) var hasMore = false
  private(set) var search = ""
  private(set) var clauses: [ListFilterRequest] = []
  private(set) var plan: DatasetRecordPlan

  @ObservationIgnored private var reader: FirestoreReader?
  @ObservationIgnored private var orgID = ""
  @ObservationIgnored private var dataset: DatasetRow
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var limit = recordsPageSize
  @ObservationIgnored private var debounce: Task<Void, Never>?

  init(dataset: DatasetRow) {
    self.dataset = dataset
    plan = planDatasetRecordQuery(dataset.model, clauses: [], searchWords: [])
  }

  var filtering: Bool { !clauses.isEmpty || !search.trimmingCharacters(in: .whitespaces).isEmpty }

  /// The dataset as it is now, so a changed model re-plans the query.
  func use(_ dataset: DatasetRow) {
    self.dataset = dataset
    clauses = clauses.filter { dataset.model.fields?[$0.field.hasPrefix("values.") ? String($0.field.dropFirst(7)) : $0.field] != nil }
  }

  func start(_ reader: FirestoreReader, orgID: String) {
    self.reader = reader
    self.orgID = orgID
    restart()
  }

  /// A typed search, applied once typing pauses.
  func type(_ text: String) {
    guard text != search else { return }
    debounce?.cancel()
    debounce = Task { [weak self] in
      try? await Task.sleep(nanoseconds: 300_000_000)
      guard !Task.isCancelled, let self else { return }
      self.search = text
      self.restart()
    }
  }

  func setFilters(_ next: [ListFilterRequest]) {
    guard next != clauses else { return }
    clauses = next
    restart()
  }

  func loadMore() {
    guard hasMore else { return }
    limit += recordsPageSize
    listen()
  }

  func retry() { restart() }

  func stop() {
    debounce?.cancel()
    listener?.remove()
    listener = nil
  }

  private func restart() {
    limit = recordsPageSize
    ready = false
    listen()
  }

  private func listen() {
    listener?.remove()
    failed = false
    guard let reader else { return }
    plan = planDatasetRecordQuery(dataset.model, clauses: clauses, searchWords: searchWords(search))
    let window = limit
    listener = reader.listen(plan.plan.firestoreQuery(recordsPath(orgID, dataset.id), limit: window + 1)) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.hasMore = docs.count > window
        self.rows = docs.prefix(window).map(RecordRow.init)
      case .failure:
        self.hasMore = false
        self.failed = true
      }
      self.ready = true
    }
  }
}

/// A record the route refused field by field: each field's error, keyed by field id.
struct RecordInvalid: Error, LocalizedError {
  let message: String
  let errors: [String: String]
  var errorDescription: String? { message }
}

/// A reference field's choices: the target dataset's first records, labelled by its display field.
struct ReferenceChoice: Hashable { let id: String; let label: String }

/// The plain JSON a write sends for `model`.
func modelJSON(_ model: DatasetModel) -> JSONValue {
  guard let data = try? JSONEncoder().encode(model), let json = JSONValue.decode(data) else { return .object([:]) }
  return json
}

/// The keys of a field the schema editor owns; any other stored key is kept as it is.
private let editedFieldKeys: Set<String> = ["name", "type", "required", "description", "validation", "reference", "default"]

private func plainObject(_ json: JSONValue) -> Any {
  switch json {
  case .null: return NSNull()
  case .bool(let value): return value
  case .number(let value): return value
  case .string(let value): return value
  case .array(let list): return list.map(plainObject)
  case .object(let map): return map.mapValues(plainObject)
  }
}

/// `model` as stored, each field's edited keys laid over what the document already held.
func schemaModelJSON(_ model: DatasetModel, rawFields: [String: [String: ContractJSON]]) -> [String: Any] {
  var fields: [String: Any] = [:]
  if case .object(let encoded)? = modelJSON(model)["fields"] {
    for (id, value) in encoded {
      var merged: [String: Any] = [:]
      for (key, kept) in rawFields[id] ?? [:] where !editedFieldKeys.contains(key) { merged[key] = plain(kept) ?? NSNull() }
      if case .object(let edited) = value { for (key, entry) in edited { merged[key] = plainObject(entry) } }
      fields[id] = merged
    }
  }
  return ["fields": fields, "order": model.order ?? []]
}

/// A join collection's model: a required reference into each side (`handleCreateJoin`).
func joinModel(_ a: DatasetRow, _ b: DatasetRow) -> DatasetModel {
  func side(_ target: DatasetRow) -> DatasetFieldDefinition {
    DatasetFieldDefinition(
      name: target.name, reference: DatasetFieldDefinitionReference(
        datasetId: target.id, displayFieldId: target.model.order?.first, onDelete: .setNull),
      required: true, type: .reference)
  }
  return DatasetModel(fields: ["aRef": side(a), "bRef": side(b)], order: ["aRef", "bRef"])
}

struct DataAPI {
  let api: ConsoleAPIClient
  let writer: FirestoreWriter
  let orgID: String

  private func call(_ fields: [String: Any?]) async throws -> JSONValue? {
    var body = fields
    body["orgId"] = orgID
    do {
      return try await api.request("/api/orgs/datasets", method: .post, body: JSONValue.from(body))
    } catch let error as ConsoleAPIError {
      if case .object(let errors)? = error.body?["errors"], !errors.isEmpty {
        throw RecordInvalid(message: error.message, errors: errors.mapValues { $0.stringValue ?? "" })
      }
      throw error
    }
  }

  /// A new dataset from a name and comma-separated column names; answers its id. `hostID` is the site it is made from.
  func createDataset(name: String, columns: String, hostID: String?) async throws -> String {
    let entries = parseDatasetFieldEntries(columns)
    let answer = try await call([
      "action": "create-dataset", "displayName": name.trimmingCharacters(in: .whitespacesAndNewlines),
      "fields": entries.map(\.id), "model": modelJSON(modelFromFieldEntries(entries)), "hostId": hostID,
    ])
    guard let id = answer.field("id") else { throw ConsoleAPIError(status: 0, message: "The dataset was not created.") }
    return id
  }

  func createJoin(_ a: DatasetRow, _ b: DatasetRow, hostID: String?) async throws -> String {
    let answer = try await call([
      "action": "create-dataset", "displayName": "\(a.name) ↔ \(b.name)", "fields": ["aRef", "bRef"],
      "model": modelJSON(joinModel(a, b)), "hostId": hostID,
    ])
    guard let id = answer.field("id") else { throw ConsoleAPIError(status: 0, message: "The join collection was not created.") }
    return id
  }

  /// A new record from its inputs' text; the route coerces and validates it against the model.
  func createRecord(datasetID: String, values: [String: String]) async throws -> String? {
    try await call(["action": "create-record", "datasetId": datasetID, "values": values]).field("id")
  }

  func updateRecord(datasetID: String, recordID: String, values: [String: String]) async throws {
    _ = try await call(["action": "update-record", "datasetId": datasetID, "recordId": recordID, "values": values])
  }

  /// Deletes a record, stripping or refusing on the references to it as the console does.
  func deleteRecord(datasetID: String, recordID: String) async throws {
    _ = try await call(["action": "delete-record", "datasetId": datasetID, "recordId": recordID])
  }

  /// Deletes a dataset and its records through the erase route; `hostID` names the site it was asked from.
  func deleteDataset(_ datasetID: String, hostID: String?) async throws {
    try await api.request(
      "/api/resources/erase", method: .post,
      body: JSONValue.from(["scope": "orgs", "scopeId": orgID, "kind": "datasets", "id": datasetID, "hostId": hostID]))
  }

  /// The Schema dialog's save: the model, its names and (for an org-wide member) the sharing scope.
  /// Who a dataset is shared with, alone: what a member a site narrows can still change.
  /// Who a dataset is shared with, through the route (`set-sharing`): a marker is the server's alone (AGL-4047).
  func setSharing(_ dataset: DatasetRow, choice: ScopeSharingChoice) async throws {
    _ = try await api.request(
      "/api/orgs/datasets", method: .post,
      body: JSONValue.from(["orgId": orgID, "action": "set-sharing", "datasetId": dataset.id, "choice": choice.wire]))
  }

  func saveSchema(_ dataset: DatasetRow, model: DatasetModel, singular: String, plural: String) async throws {
    var data: [String: Any] = [
      "model": schemaModelJSON(model, rawFields: dataset.rawFields),
      "names": ["singular": singular.trimmingCharacters(in: .whitespacesAndNewlines), "plural": plural.trimmingCharacters(in: .whitespacesAndNewlines)],
      "fields": model.order ?? [],
    ]
    // The name's search key moves with it, as the web dialog writes it (AGL-4047).
    if !plural.trimmingCharacters(in: .whitespaces).isEmpty {
      data["displayName"] = plural.trimmingCharacters(in: .whitespacesAndNewlines)
      data["nameLower"] = nameSearchKey(plural)
    }
    try await writer.update(datasetsPath(orgID) + [dataset.id], data)
  }
}
