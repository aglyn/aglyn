// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import Foundation
import Observation

// A media library as the console's library reads and changes it: a site's
// (`hosts/{hostId}/media`) or the workspace's (`orgs/{orgId}/media`), its
// folders, and its files through the library's own query (MEDIA_LIST_QUERY,
// the folder and the reader's scope as its base, the type, the sort and the
// search on the one Firestore query). Every write is the console's route:
// upload (direct or through a signed URL), details, folders, moves, privacy,
// replace, delete and restore.

/// The library's page of files (`MEDIA_PAGE_SIZE`).
public let mediaPageSize = 60

/// Files above this go through the signed-URL upload (`SIGNED_UPLOAD_THRESHOLD_BYTES`).
public let signedUploadThresholdBytes = 3 * 1024 * 1024

/// Where a library lives: a site's own, or the workspace's (seen from `forHostID` when a site is picked).
public enum MediaScope: Hashable, Sendable {
  case site(hostID: String)
  case org(orgID: String, forHostID: String?)

  public var collection: String {
    if case .org = self { return "orgs" }
    return "hosts"
  }

  public var id: String {
    switch self {
    case .site(let hostID): hostID
    case .org(let orgID, _): orgID
    }
  }

  /// The scope's key in every media route's body.
  public var bodyKey: String {
    if case .org = self { return "orgId" }
    return "hostId"
  }

  public var isOrg: Bool {
    if case .org = self { return true }
    return false
  }

  public var path: [String] { [collection, id] }

  /// The CDN segment of a file's public path (`{hostId}` or `org:{orgId}`).
  public var cdnScope: String { isOrg ? "org:\(id)" : id }
}

/// Which folder the grid shows.
public enum FolderPick: Hashable, Sendable {
  case all
  case root
  case one(String)

  public var folderID: String? {
    if case .one(let id) = self { return id }
    return nil
  }
}

public struct MediaFolder: Identifiable, Hashable, Sendable {
  public let id: String
  public let name: String
  public let parentID: String?
  public let order: Double?

  public init(id: String, name: String, parentID: String?, order: Double?) {
    self.id = id
    self.name = name
    self.parentID = parentID
    self.order = order
  }

  public init(_ doc: FirestoreDocument) {
    let name = doc.string("name") ?? ""
    let parent = doc.string("parentId") ?? ""
    self.init(
      id: doc.id, name: name.trimmed.isEmpty ? "Untitled folder" : name, parentID: parent.isEmpty ? nil : parent,
      order: doc.double("order"))
  }
}

/// Folders in the rail's order: `order`, then name.
public func sortedFolders(_ folders: [MediaFolder]) -> [MediaFolder] {
  folders.sorted {
    let (a, b) = ($0.order ?? .greatestFiniteMagnitude, $1.order ?? .greatestFiniteMagnitude)
    return a != b ? a < b : $0.name.lowercased() < $1.name.lowercased()
  }
}

/// A folder's path for a picker: `Blog / Covers`.
public func folderPath(_ folder: MediaFolder, byID: [String: MediaFolder]) -> String {
  var names: [String] = []
  var current: MediaFolder? = folder
  var seen = Set<String>()
  while let step = current, seen.insert(step.id).inserted {
    names.insert(step.name, at: 0)
    current = step.parentID.flatMap { byID[$0] }
  }
  return names.joined(separator: " / ")
}

/// One file, as the grid and its details read it.
public struct MediaItem: Identifiable, Equatable, Sendable {
  public let id: String
  public let fileName: String
  public let contentType: String
  public let kind: String
  public let sizeBytes: Int?
  public let width: Int?
  public let height: Int?
  public let url: String?
  public let cdnPath: String?
  public let folderID: String?
  public let alt: String
  public let description: String
  public let tags: [String]
  public let isPrivate: Bool
  public let createdAt: Date?
  public let updatedAt: Date?
  public let uploadedBy: String?
  public let visibleTo: [String]

  /// Nil for a deleted file.
  public init?(_ doc: FirestoreDocument) {
    if let deleted = doc.data["deletedAt"], !(deleted is NSNull) { return nil }
    let type = doc.string("contentType") ?? ""
    let blank = { (text: String?) in text.flatMap { $0.trimmed.isEmpty ? nil : $0 } }
    id = doc.id
    fileName = blank(doc.string("fileName")) ?? doc.id
    contentType = type
    kind = doc.string("kind") ?? mediaKindOf(type)
    sizeBytes = doc.int("sizeBytes")
    width = doc.int("width")
    height = doc.int("height")
    url = blank(doc.string("url"))
    cdnPath = blank(doc.string("cdnPath"))
    folderID = blank(doc.string("folderId"))
    alt = doc.string("alt") ?? ""
    description = doc.string("description") ?? ""
    tags = (doc.data["tags"] as? [Any])?.compactMap { $0 as? String } ?? []
    isPrivate = doc.bool("private") == true
    createdAt = doc.date("createdAt")
    updatedAt = doc.date("updatedAt")
    uploadedBy = doc.string("uploadedBy")
    visibleTo = (doc.data["visibleTo"] as? [Any])?.compactMap { $0 as? String } ?? []
  }

  private static func trimmedOrigin(_ origin: String) -> String {
    var value = origin
    while value.hasSuffix("/") { value.removeLast() }
    return value
  }

  /// Where the file is served from: its CDN path on the console origin, else its stored URL.
  public func src(origin: String) -> String? {
    cdnPath.map { Self.trimmedOrigin(origin) + $0 } ?? url
  }

  /// A thumbnail at `width` pixels (the CDN's own variants), or the file itself.
  public func thumbnail(origin: String, width: Int = 320) -> String? {
    if kind == "image", let cdnPath { return "\(Self.trimmedOrigin(origin))\(cdnPath)?w=\(width)" }
    if kind == "video", let cdnPath { return "\(Self.trimmedOrigin(origin))\(cdnPath)?poster=1&w=\(width)" }
    if kind == "image" { return url }
    return nil
  }
}

/// The kind's SF Symbol, for a tile with no preview.
public func mediaKindSymbol(_ kind: String) -> String {
  switch kind {
  case "image": "photo"
  case "video": "film"
  case "audio": "music.note"
  case "pdf": "doc.richtext"
  default: "doc"
  }
}

/// Bytes in the units a person reads: `820 KB`, `4.2 MB`.
public func formatBytes(_ bytes: Int?) -> String {
  guard let bytes else { return "—" }
  let kb = Double(bytes) / 1024
  let mb = kb / 1024
  if mb >= 1 {
    let one = (mb * 10).rounded(.towardZero) / 10
    return one == one.rounded(.towardZero) ? "\(Int(one)) MB" : "\(one) MB"
  }
  if kb >= 1 { return "\(Int(kb)) KB" }
  return "\(bytes) B"
}

/// The type chips above the grid: every file, then the Type filter's own options (`MEDIA_TYPE_OPTIONS`).
public func mediaTypeChoices() -> [(value: String?, label: String)] {
  [(nil, "All")] + ContractValues.shared.mediaTypeOptions.map { ($0.value, $0.label) }
}

/// The library's request for one view, as `mediaQuery` builds it: the folder
/// and the scope as base filters, the type as a clause, and the search on
/// the name tokens, or, for a reader limited to some sites, a "starts with"
/// on the name (the scope already holds the query's one array clause).
public func mediaRequest(
  folder: FolderPick, scopeTokens: [String]?, type: String?, sort: MediaSort, search: String
) -> ListQueryRequest {
  var base: [ListQueryFilter] = []
  switch folder {
  case .all: break
  case .root: base.append(ListQueryFilter(op: .equal, path: "folderId", value: .null))
  case .one(let id): base.append(ListQueryFilter(op: .equal, path: "folderId", value: .string(id)))
  }
  if let scopeTokens {
    base.append(ListQueryFilter(op: .arrayContainsAny, path: "visibleTo", value: .array(scopeTokens.map { .string($0) })))
  }
  let typed = search.trimmed
  let scopedSearch =
    scopeTokens != nil && !typed.isEmpty ? ListFilterRequest(field: "fileName", op: "startsWith", value: typed) : nil
  var clauses: [ListFilterRequest] = []
  if let scopedSearch { clauses.append(scopedSearch) }
  if let type { clauses.append(ListFilterRequest(field: "type", op: "equals", value: type)) }
  return ListQueryRequest(
    base: base, clauses: clauses,
    search: scopedSearch == nil && !typed.isEmpty ? [typed] : nil,
    sort: ContractValues.shared.mediaSortOrder[sort.rawValue])
}

public func mediaQuery(
  scope: MediaScope, folder: FolderPick, scopeTokens: [String]?, type: String?, sort: MediaSort, search: String,
  limit: Int = mediaPageSize
) -> FirestoreQuery {
  planListQuery(
    ContractValues.shared.mediaListQuery,
    mediaRequest(folder: folder, scopeTokens: scopeTokens, type: type, sort: sort, search: search),
    names: MediaNameNormalizers()
  ).firestoreQuery(scope.path + ["media"], limit: limit)
}

/// One library view: its folder, filters and the files read so far, live,
/// in a window that grows a page at a time.
@MainActor
@Observable
public final class MediaListModel {
  public private(set) var rows: LiveValue<[MediaItem]> = .loading
  public private(set) var hasMore = false
  public var folder = FolderPick.all { didSet { if oldValue != folder { restart() } } }
  public var type: String? { didSet { if oldValue != type { restart() } } }
  public var sort = MediaSort.newest { didSet { if oldValue != sort { restart() } } }
  public var search = "" { didSet { if oldValue != search { restart() } } }
  /// The scope clause a limited reader's queries carry; nil reads the whole library.
  public private(set) var scopeTokens: [String]?

  @ObservationIgnored private var reader: FirestoreReader?
  @ObservationIgnored private var scope: MediaScope?
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var limit = mediaPageSize

  public init() {}

  public func start(_ reader: FirestoreReader, scope: MediaScope, scopeTokens: [String]?) {
    self.reader = reader
    self.scope = scope
    self.scopeTokens = scopeTokens
    restart()
  }

  public func loadMore() {
    guard hasMore else { return }
    limit += mediaPageSize
    listen(keep: true)
  }

  public func refresh() { listen(keep: true) }

  public func stop() {
    listener?.remove()
    listener = nil
  }

  /// Drops a file the person just deleted, without waiting for the listener.
  public func drop(_ id: String) {
    if case .ready(let items) = rows { rows = .ready(items.filter { $0.id != id }) }
  }

  private func restart() {
    limit = mediaPageSize
    listen(keep: false)
  }

  private func listen(keep: Bool) {
    listener?.remove()
    if !keep { rows = .loading }
    guard let reader, let scope else { return }
    let window = limit
    let query = mediaQuery(
      scope: scope, folder: folder, scopeTokens: scopeTokens, type: type, sort: sort, search: search,
      limit: window + 1)
    listener = reader.listen(query) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.hasMore = docs.count > window
        self.rows = .ready(docs.prefix(window).compactMap(MediaItem.init))
      case .failure:
        self.hasMore = false
        self.rows = .failed("The library could not be loaded. Check the connection and try again.")
      }
    }
  }
}

/// Who used a file, as the library's "Used on" lists it.
public struct MediaReference: Hashable, Sendable {
  public let kind: String
  public let name: String
  public let live: Bool
}

/// The org-wide storage band the library header reads (`GET /api/media/storage`).
public struct MediaStorage: Equatable, Sendable {
  public let usedBytes: Int
  public let allowanceMB: Int?
  public let unlimited: Bool
}

/// The library's writes, each the console's own route with the scope in the
/// body: upload (direct under `signedUploadThresholdBytes`, a signed URL
/// above it), details, privacy, folders, moves, replace, delete, restore.
public struct MediaAPI: Sendable {
  let api: ConsoleAPIClient
  let scope: MediaScope

  public init(api: ConsoleAPIClient, scope: MediaScope) {
    self.api = api
    self.scope = scope
  }

  /// A route body: the scope's key, `forHostId` for a workspace library seen from a site, then `fields`.
  func body(_ fields: [String: Any?]) -> JSONValue {
    var all: [String: Any?] = [scope.bodyKey: scope.id]
    if case .org(_, let forHostID?) = scope { all["forHostId"] = forHostID }
    all.merge(fields) { _, new in new }
    return .from(all)
  }

  @discardableResult
  private func post(_ path: String, _ fields: [String: Any?], method: HTTPMethod = .post) async throws -> JSONValue? {
    try await api.request(path, method: method, body: body(fields))
  }

  /// Uploads one picked file into `folderID`; answers its media id.
  @discardableResult
  public func upload(_ file: PickedFile, folderID: String?) async throws -> String? {
    let contentType = file.mimeType.isEmpty ? "application/octet-stream" : file.mimeType
    if file.size <= signedUploadThresholdBytes {
      let answer = try await post(
        "/api/media/upload",
        [
          "fileName": file.name, "contentType": contentType, "folderId": folderID,
          "data": file.data.base64EncodedString(),
        ])
      return answer.field("mediaId")
    }
    let minted = try await post(
      "/api/media/upload-url",
      ["contentType": contentType, "fileName": file.name, "sizeBytes": file.size, "folderId": folderID])
    guard let mediaID = minted.field("mediaId"), let uploadURL = minted.field("uploadUrl") else { return nil }
    try await api.putSigned(uploadURL, contentType: minted.field("contentType") ?? contentType, data: file.data)
    try await post(
      "/api/media/upload-url", ["mediaId": mediaID, "fileName": file.name, "folderId": folderID], method: .patch)
    return mediaID
  }

  /// Replaces the file's bytes in place: the same id and address everywhere it is used.
  public func replace(_ item: MediaItem, with file: PickedFile) async throws {
    let contentType = file.mimeType.isEmpty ? item.contentType : file.mimeType
    let expected = item.updatedAt.map { Int(($0.timeIntervalSince1970 * 1000).rounded()) }
    if file.size <= signedUploadThresholdBytes {
      try await post(
        "/api/media/replace",
        [
          "mediaId": item.id, "contentType": contentType, "data": file.data.base64EncodedString(),
          "fileName": file.name, "expectedUpdatedAtMs": expected,
        ])
      return
    }
    let minted = try await post(
      "/api/media/replace",
      [
        "mediaId": item.id, "contentType": contentType, "fileName": file.name, "sizeBytes": file.size,
        "expectedUpdatedAtMs": expected,
      ], method: .put)
    guard let uploadURL = minted.field("uploadUrl") else {
      throw ConsoleAPIError(status: 0, message: "The upload could not start.")
    }
    try await api.putSigned(uploadURL, contentType: minted.field("contentType") ?? contentType, data: file.data)
    try await post(
      "/api/media/replace", ["mediaId": item.id, "fileName": file.name, "expectedUpdatedAtMs": expected],
      method: .patch)
  }

  public func saveDetails(_ id: String, fileName: String, alt: String, description: String, tags: [String])
    async throws
  {
    try await post(
      "/api/media/folders",
      [
        "action": "update-details", "mediaId": id, "fileName": fileName, "alt": alt, "description": description,
        "tags": tags,
      ])
  }

  public func setPrivate(_ id: String, _ isPrivate: Bool) async throws {
    try await post("/api/media/folders", ["action": "set-private", "mediaId": id, "private": isPrivate])
  }

  /// Moves files into `folderID` (nil: no folder), asking again until the route says it is done.
  public func move(_ ids: [String], folderID: String?) async throws {
    var remaining = ids
    var rounds = 0
    while !remaining.isEmpty && rounds < 20 {
      let answer = try await post(
        "/api/media/folders", ["action": "move-assets", "mediaIds": remaining, "folderId": folderID])
      if answer.boolField("done") != false { return }
      remaining = answer?["remainingIds"]?.arrayValue?.compactMap(\.stringValue) ?? []
      rounds += 1
    }
  }

  public func createFolder(name: String, parentID: String?) async throws {
    try await post("/api/media/folders", ["action": "create-folder", "name": name, "parentId": parentID])
  }

  public func renameFolder(_ id: String, name: String) async throws {
    try await post("/api/media/folders", ["action": "rename", "folderId": id, "name": name])
  }

  public func deleteFolder(_ id: String) async throws {
    try await post("/api/media/folders", ["action": "delete", "folderId": id])
  }

  /// Deletes the file; answers whether the route kept it restorable.
  public func delete(_ id: String) async throws -> Bool {
    try await post("/api/media/upload", ["mediaId": id], method: .delete).boolField("restorable") == true
  }

  public func restore(_ id: String) async throws {
    try await post("/api/media/restore", ["mediaId": id])
  }

  /// A short-lived link to a private workspace file (`/api/media/sign`), absolute.
  public func signedLink(_ id: String) async throws -> String? {
    guard let link = try await post("/api/media/sign", ["mediaId": id]).field("url") else { return nil }
    return link.hasPrefix("/") ? api.origin + link : link
  }

  public func references(_ id: String) async throws -> [MediaReference] {
    let answer = try await post("/api/media/references", ["mediaId": id])
    return answer?["references"]?.arrayValue?.compactMap { entry in
      guard case .object = entry else { return nil }
      let live: Bool = entry["live"]?.boolValue ?? (entry["live"]?.stringValue == "true")
      return MediaReference(
        kind: entry["kind"]?.stringValue ?? "page", name: entry["name"]?.stringValue ?? "Untitled", live: live)
    } ?? []
  }

  public func storage() async -> MediaStorage? {
    let answer: JSONValue?
    do {
      answer = try await api.request("/api/media/storage", query: [(scope.bodyKey, scope.id)])
    } catch {
      return nil
    }
    return MediaStorage(
      usedBytes: Int(answer.numberField("usedBytes") ?? 0), allowanceMB: answer.numberField("allowanceMb").map { Int($0) },
      unlimited: answer.boolField("unlimited") == true)
  }
}
