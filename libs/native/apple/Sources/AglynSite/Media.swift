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

/// A folder and every folder under it, the folder first (`mediaFolderDescendants`).
public func mediaFolderSubtree(_ id: String, folders: [MediaFolder]) -> [String] {
  var children: [String: [String]] = [:]
  for folder in folders { if let parent = folder.parentID { children[parent, default: []].append(folder.id) } }
  var out: [String] = []
  var queue = [id]
  var seen = Set<String>()
  while !queue.isEmpty {
    let next = queue.removeFirst()
    guard seen.insert(next).inserted else { continue }
    out.append(next)
    queue.append(contentsOf: children[next] ?? [])
  }
  return out
}

/// Firestore's cap on disjunctions: the product of every `in` and `-any` (`MEDIA_DISJUNCTION_LIMIT`).
public let mediaDisjunctionLimit = 30

/// Said when Include subfolders gives way to the open folder alone (the console's notice, word for word).
public let mediaSubfoldersDroppedNotice =
  "Include subfolders is off for this folder: it has more subfolders than one query can look through, so only the "
  + "files directly in it are shown."

/// The folders one view reads: the open folder, and with Include subfolders every folder under it, unless they and
/// the reader's scope tokens pass Firestore's thirty disjunctions (then only the open folder, and `dropped`).
public func mediaFolderIDs(
  _ folder: FolderPick, subtree: [String], scopeTokens: [String]?
) -> (ids: [String], dropped: Bool) {
  guard case .one(let id) = folder else { return ([], false) }
  let ids = subtree.first == id ? subtree : [id] + subtree.filter { $0 != id }
  if ids.count > 1 && ids.count * (scopeTokens?.count ?? 1) > mediaDisjunctionLimit { return ([id], true) }
  return (ids, false)
}

/// Where an arrow key moves the focus in a grid of `columns` across: left and right step one, up and down a row;
/// nil past an edge. With nothing focused, any arrow focuses the first item.
public func mediaGridStep<ID: Hashable>(_ ids: [ID], from current: ID?, columns: Int, move: MediaGridMove) -> ID? {
  guard !ids.isEmpty else { return nil }
  guard let current, let index = ids.firstIndex(of: current) else { return ids.first }
  let across = max(1, columns)
  let next: Int
  switch move {
  case .left: next = index - 1
  case .right: next = index + 1
  case .up: next = index - across
  case .down: next = index + across
  }
  return ids.indices.contains(next) ? ids[next] : nil
}

/// An arrow key's direction in a grid.
public enum MediaGridMove: Sendable { case left, right, up, down }

/// Which files a click selects: alone, toggled (⌘-click), or the run from the last one picked (⇧-click), in the grid's
/// order (the console's `media-selection` rules).
public func mediaSelection(
  _ current: Set<String>, anchor: String?, clicked: String, toggle: Bool, range: Bool, order: [String]
) -> Set<String> {
  if range, let anchor, let from = order.firstIndex(of: anchor), let to = order.firstIndex(of: clicked) {
    return current.union(order[min(from, to)...max(from, to)])
  }
  if toggle {
    var next = current
    if next.contains(clicked) { next.remove(clicked) } else { next.insert(clicked) }
    return next
  }
  return [clicked]
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
  /// A film's measured length in whole seconds (`videoMediaProps`); nil for anything else or a film that records none.
  public let videoSeconds: Int?
  /// Whether the film's document records a captured poster frame (only then is its poster URL a picture, not a 404).
  public let hasPoster: Bool

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
    videoSeconds = libraryVideoSeconds(doc.data["video"])
    hasPoster = doc.data["poster"] is [String: Any]
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

  /// A thumbnail at `width` pixels (the CDN's own variants), or the file itself. An SVG has no width variants, so it is
  /// asked for as a square transparent PNG (`?icon=png-N`, the CDN's icon sizes); a film shows its poster only when its
  /// document records one (otherwise the poster URL is a 404 and the tile shows the film's type instead).
  public func thumbnail(origin: String, width: Int = 320) -> String? {
    let base = cdnPath.map { Self.trimmedOrigin(origin) + $0 }
    if kind == "image", let base {
      if isSVG { return "\(base)?icon=png-\(mediaIconSize(atLeast: width))" }
      return "\(base)?w=\(width)"
    }
    if kind == "video", hasPoster, let base { return "\(base)?poster=1&w=\(width)" }
    if kind == "image" { return url }
    return nil
  }

  /// Whether the file is an SVG drawing.
  public var isSVG: Bool { contentType.lowercased().hasPrefix("image/svg") }

  /// What a tile says the file is, as the console's tile does: its type's short label (`PDF`, `XLSX`, `JPEG`).
  public var typeLabel: String { mediaFileType(contentType).label }

  /// The tile's caption: `PDF · 1.2 MB`.
  public var caption: String { "\(typeLabel) · \(formatBytes(sizeBytes ?? 0))" }
}

/// The square PNG sizes the CDN draws an SVG at (`?icon=png-N`).
public let mediaIconSizes = [16, 32, 48, 72, 96, 128, 144, 152, 192, 256, 384, 512]

/// The smallest icon size at least `pixels` wide (the largest when none is).
public func mediaIconSize(atLeast pixels: Int) -> Int {
  mediaIconSizes.first { $0 >= pixels } ?? mediaIconSizes[mediaIconSizes.count - 1]
}

/// What a tile shows for a file it cannot draw a preview of: the console's own map (`mediaFileTypeIcon`), as an SF
/// Symbol and a short label. It never returns nothing: an unknown type is a document named by its subtype.
public func mediaFileType(_ contentType: String) -> (symbol: String, label: String) {
  let value = contentType.split(separator: ";").first.map(String.init)?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
  let exact: [String: (String, String)] = [
    "application/pdf": ("doc.richtext", "PDF"),
    "application/zip": ("doc.zipper", "ZIP"), "application/x-zip-compressed": ("doc.zipper", "ZIP"),
    "application/gzip": ("doc.zipper", "GZIP"), "application/x-tar": ("doc.zipper", "TAR"),
    "application/x-7z-compressed": ("doc.zipper", "7Z"), "application/vnd.rar": ("doc.zipper", "RAR"),
    "application/msword": ("doc.text", "DOC"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ("doc.text", "DOCX"),
    "application/rtf": ("doc.text", "RTF"),
    "application/vnd.ms-excel": ("tablecells", "XLS"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ("tablecells", "XLSX"),
    "text/csv": ("tablecells", "CSV"),
    "application/vnd.ms-powerpoint": ("rectangle.on.rectangle", "PPT"),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ("rectangle.on.rectangle", "PPTX"),
    "audio/mpeg": ("music.note", "MP3"), "audio/mp4": ("music.note", "M4A"), "audio/aac": ("music.note", "AAC"),
    "audio/ogg": ("music.note", "OGG"), "audio/wav": ("music.note", "WAV"),
    "text/plain": ("doc.text", "TXT"), "text/markdown": ("doc.text", "MD"),
    "application/json": ("curlybraces", "JSON"),
  ]
  if let hit = exact[value] { return (hit.0, hit.1) }
  let subtype = value.split(separator: "/", maxSplits: 1).dropFirst().first.map(String.init) ?? ""
  let label = subtype.isEmpty ? "FILE" : (subtype.split(separator: "+").first.map(String.init) ?? subtype).uppercased()
  for (prefix, symbol) in [("image/", "photo"), ("video/", "film"), ("audio/", "music.note"), ("text/", "doc.text")]
  where value.hasPrefix(prefix) {
    return (symbol, label)
  }
  return ("doc", label)
}

/// The sentence an audio uploader confirms, word for word, and the one the server stores with the answer (`AUDIO_RIGHTS_STATEMENT`).
public let audioRightsStatement = "I own this audio or have a license to use it on my site"

/// Whether a picked file is audio, which the upload routes refuse without a rights confirmation.
public func isAudioFile(_ file: PickedFile) -> Bool { file.mimeType.lowercased().hasPrefix("audio/") }

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

/// The library's Filters beyond the type chips and the search, the console's
/// own fields (`MEDIA_FILTER_FIELDS`): orientation, whether alt text is set, a
/// tag, and a size range in megabytes. A blank one is not asked.
public struct MediaFilters: Equatable, Sendable {
  public var orientation: String?
  public var alt: String?
  public var tag: String
  public var minMegabytes: String
  public var maxMegabytes: String
  /// The day a file was uploaded on or after, and on or before (`yyyy-MM-dd`, the site's day), or blank.
  public var uploadedAfter: String
  public var uploadedBefore: String
  /// The member who uploaded it (a user id, or `api:…` for a key), or nil for anyone.
  public var uploadedBy: String?

  public init(
    orientation: String? = nil, alt: String? = nil, tag: String = "", minMegabytes: String = "",
    maxMegabytes: String = "", uploadedAfter: String = "", uploadedBefore: String = "", uploadedBy: String? = nil
  ) {
    self.orientation = orientation
    self.alt = alt
    self.tag = tag
    self.minMegabytes = minMegabytes
    self.maxMegabytes = maxMegabytes
    self.uploadedAfter = uploadedAfter
    self.uploadedBefore = uploadedBefore
    self.uploadedBy = uploadedBy
  }

  /// How many are set, for the Filters button.
  public var count: Int {
    [
      orientation != nil, alt != nil, !tag.trimmed.isEmpty, !minMegabytes.trimmed.isEmpty, !maxMegabytes.trimmed.isEmpty,
      !uploadedAfter.trimmed.isEmpty, !uploadedBefore.trimmed.isEmpty, uploadedBy != nil,
    ].filter { $0 }.count
  }

  /// The clauses the query plan reads. A reader limited to some sites has no
  /// Tags filter: the scope already holds the query's one array clause
  /// (`mediaFilterFields`). Tags are stored trimmed and lower-cased
  /// (`normalizeMediaTags`), so the one asked for is too.
  public func clauses(scoped: Bool) -> [ListFilterRequest] {
    var clauses: [ListFilterRequest] = []
    if let orientation { clauses.append(ListFilterRequest(field: "orientation", op: "equals", value: orientation)) }
    if let alt { clauses.append(ListFilterRequest(field: "alt", op: "equals", value: alt)) }
    let tag = self.tag.trimmed.lowercased()
    if !scoped && !tag.isEmpty { clauses.append(ListFilterRequest(field: "tags", op: "contains", value: tag)) }
    if !minMegabytes.trimmed.isEmpty {
      clauses.append(mediaQueryRequest(ListFilterRequest(field: "sizeMb", op: ">=", value: minMegabytes.trimmed)))
    }
    if !maxMegabytes.trimmed.isEmpty {
      clauses.append(mediaQueryRequest(ListFilterRequest(field: "sizeMb", op: "<=", value: maxMegabytes.trimmed)))
    }
    if !uploadedAfter.trimmed.isEmpty {
      clauses.append(ListFilterRequest(field: "uploaded", op: "onOrAfter", value: uploadedAfter.trimmed))
    }
    if !uploadedBefore.trimmed.isEmpty {
      clauses.append(ListFilterRequest(field: "uploaded", op: "onOrBefore", value: uploadedBefore.trimmed))
    }
    if let uploadedBy { clauses.append(ListFilterRequest(field: "uploadedBy", op: "equals", value: uploadedBy)) }
    return clauses
  }
}

/// What a size box takes: digits and one decimal point.
public func megabytesInput(_ text: String) -> String {
  var point = false
  return String(
    text.filter { char in
      if char.isASCII && char.isNumber { return true }
      if char == "." && !point {
        point = true
        return true
      }
      return false
    }.prefix(8))
}

/// A member of the workspace, for the Uploaded by filter: their id, and the name or email they are shown as.
public struct UploaderOption: Hashable, Sendable {
  public let uid: String
  public let label: String
}

/// The workspace's members (`GET /api/orgs/members`), as the Uploaded by filter lists them; none when the route answers no.
public func uploaderOptions(_ api: ConsoleAPIClient, orgID: String) async -> [UploaderOption] {
  guard let answer = try? await api.request("/api/orgs/members", query: [("orgId", orgID)]) else { return [] }
  return (answer["members"]?.arrayValue ?? []).compactMap { member -> UploaderOption? in
    guard let uid = member["$id"]?.stringValue ?? member["uid"]?.stringValue else { return nil }
    let email = member["email"]?.stringValue
    let name = member["displayName"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
    return UploaderOption(uid: uid, label: name ?? email ?? uid)
  }.sorted { $0.label.lowercased() < $1.label.lowercased() }
}

/// The library's request for one view, as `mediaQuery` builds it: the folder
/// and the scope as base filters, the type and the other filters as clauses,
/// and the search on the name tokens, or, for a reader limited to some sites,
/// a "starts with" on the name (the scope already holds the query's one array
/// clause).
public func mediaRequest(
  folder: FolderPick, scopeTokens: [String]?, type: String?, sort: MediaSort, search: String,
  filters: MediaFilters = MediaFilters(), subtree: [String] = []
) -> ListQueryRequest {
  var base: [ListQueryFilter] = []
  switch folder {
  case .all: break
  case .root: base.append(ListQueryFilter(op: .equal, path: "folderId", value: .null))
  case .one(let id):
    let ids = mediaFolderIDs(folder, subtree: subtree, scopeTokens: scopeTokens).ids
    if ids.count > 1 {
      base.append(ListQueryFilter(op: .in, path: "folderId", value: .array(ids.map { .string($0) })))
    } else {
      base.append(ListQueryFilter(op: .equal, path: "folderId", value: .string(id)))
    }
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
  clauses.append(contentsOf: filters.clauses(scoped: scopeTokens != nil))
  return ListQueryRequest(
    base: base, clauses: clauses,
    search: scopedSearch == nil && !typed.isEmpty ? [typed] : nil,
    sort: ContractValues.shared.mediaSortOrder[sort.rawValue])
}

/// What the console's plan makes of one view: the query, and what it left out and why.
public func mediaPlan(
  folder: FolderPick, scopeTokens: [String]?, type: String?, sort: MediaSort, search: String,
  filters: MediaFilters = MediaFilters(), subtree: [String] = []
) -> ListQueryPlan {
  planListQuery(
    ContractValues.shared.mediaListQuery,
    mediaRequest(
      folder: folder, scopeTokens: scopeTokens, type: type, sort: sort, search: search, filters: filters,
      subtree: subtree),
    names: MediaNameNormalizers())
}

public func mediaQuery(
  scope: MediaScope, folder: FolderPick, scopeTokens: [String]?, type: String?, sort: MediaSort, search: String,
  filters: MediaFilters = MediaFilters(), subtree: [String] = [], limit: Int = mediaPageSize
) -> FirestoreQuery {
  mediaPlan(
    folder: folder, scopeTokens: scopeTokens, type: type, sort: sort, search: search, filters: filters,
    subtree: subtree
  ).firestoreQuery(scope.path + ["media"], limit: limit)
}

/// How many files one folder holds, as the console's folder card counts them (`getCountFromServer` on `folderId`, with
/// the scope clause for a reader limited to some sites); nil when the count cannot be read.
public func mediaFolderCount(
  _ reader: FirestoreReader, scope: MediaScope, folderID: String, scopeTokens: [String]?
) async -> Int? {
  var filters: [ListQueryConstraint] = []
  if let scopeTokens { filters.append(ListQueryConstraint(path: "visibleTo", op: .arrayContainsAny, value: scopeTokens)) }
  return try? await reader.count(
    FirestoreQuery(scope.path + ["media"], equals: [("folderId", folderID)], filters: filters))
}

/// What the plan could not honor, in words: a clause it refused (two array
/// filters cannot share a query, a number that is not one) and its own notices.
public func mediaPlanNotices(_ plan: ListQueryPlan) -> [String] {
  plan.notices
    + plan.refused.map { refusal in
      var column: String?
      if case .object(let clause) = refusal.clause, case .string(let field)? = clause["field"] { column = field }
      let name = column.flatMap { ContractValues.shared.mediaFilterHeaders[$0] } ?? column ?? "A filter"
      return "\(name): \(refusal.reason)"
    }
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
  public var filters = MediaFilters() { didSet { if oldValue != filters { restart() } } }
  /// What the last view's plan left out, shown under the filters.
  public private(set) var notices: [String] = []
  public var sort = MediaSort.newest { didSet { if oldValue != sort { restart() } } }
  public var search = "" { didSet { if oldValue != search { restart() } } }
  /// The open folder and every folder under it, when Include subfolders is on; empty otherwise.
  public var subtree: [String] = [] { didSet { if oldValue != subtree { restart() } } }
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
  public func drop(_ id: String) { drop([id]) }

  /// Drops files the person just deleted or moved out of the view, without waiting for the listener.
  public func drop(_ ids: Set<String>) {
    if case .ready(let items) = rows { rows = .ready(items.filter { !ids.contains($0.id) }) }
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
    let dropped = mediaFolderIDs(folder, subtree: subtree, scopeTokens: scopeTokens).dropped
    notices = mediaPlanNotices(
      mediaPlan(
        folder: folder, scopeTokens: scopeTokens, type: type, sort: sort, search: search, filters: filters,
        subtree: subtree)) + (dropped ? [mediaSubfoldersDroppedNotice] : [])
    let query = mediaQuery(
      scope: scope, folder: folder, scopeTokens: scopeTokens, type: type, sort: sort, search: search,
      filters: filters, subtree: subtree, limit: window + 1)
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

  /// The field an audio file's rights confirmation rides in (`AUDIO_RIGHTS_FIELD`); sent only when it was given.
  private func withRights(_ fields: [String: Any?], _ confirmed: Bool) -> [String: Any?] {
    confirmed ? fields.merging(["rightsConfirmed": true]) { $1 } : fields
  }

  /// A film is read on this device before it is sent (neither server has a decoder): its length, frame size and a poster still.
  private func filmFields(_ file: PickedFile, _ contentType: String) async -> [String: Any?] {
    contentType.hasPrefix("video/") ? videoProbeFields(await probeVideo(file)) : [:]
  }

  /// Uploads one picked file into `folderID`; answers its media id. An audio file is refused unless
  /// `rightsConfirmed` says its uploader confirmed they own it or hold a license (`AUDIO_RIGHTS_STATEMENT`).
  @discardableResult
  public func upload(_ file: PickedFile, folderID: String?, rightsConfirmed: Bool = false) async throws -> String? {
    let contentType = file.mimeType.isEmpty ? "application/octet-stream" : file.mimeType
    let film = await filmFields(file, contentType)
    if file.size <= signedUploadThresholdBytes {
      let answer = try await post(
        "/api/media/upload",
        withRights(
          [
            "fileName": file.name, "contentType": contentType, "folderId": folderID,
            "data": file.data.base64EncodedString(),
          ].merging(film) { $1 }, rightsConfirmed))
      return answer.field("mediaId")
    }
    let minted = try await post(
      "/api/media/upload-url",
      withRights(["contentType": contentType, "fileName": file.name, "sizeBytes": file.size, "folderId": folderID], rightsConfirmed))
    guard let mediaID = minted.field("mediaId"), let uploadURL = minted.field("uploadUrl") else { return nil }
    try await api.putSigned(uploadURL, contentType: minted.field("contentType") ?? contentType, data: file.data)
    try await post(
      "/api/media/upload-url",
      withRights(["mediaId": mediaID, "fileName": file.name, "folderId": folderID].merging(film) { $1 }, rightsConfirmed),
      method: .patch)
    return mediaID
  }

  /// Replaces the file's bytes in place: the same id and address everywhere it is used.
  public func replace(_ item: MediaItem, with file: PickedFile, rightsConfirmed: Bool = false) async throws {
    let contentType = file.mimeType.isEmpty ? item.contentType : file.mimeType
    let film = await filmFields(file, contentType)
    let expected = item.updatedAt.map { Int(($0.timeIntervalSince1970 * 1000).rounded()) }
    if file.size <= signedUploadThresholdBytes {
      try await post(
        "/api/media/replace",
        withRights(
          [
            "mediaId": item.id, "contentType": contentType, "data": file.data.base64EncodedString(),
            "fileName": file.name, "expectedUpdatedAtMs": expected,
          ].merging(film) { $1 }, rightsConfirmed))
      return
    }
    let minted = try await post(
      "/api/media/replace",
      withRights(
        [
          "mediaId": item.id, "contentType": contentType, "fileName": file.name, "sizeBytes": file.size,
          "expectedUpdatedAtMs": expected,
        ], rightsConfirmed), method: .put)
    guard let uploadURL = minted.field("uploadUrl") else {
      throw ConsoleAPIError(status: 0, message: "The upload could not start.")
    }
    try await api.putSigned(uploadURL, contentType: minted.field("contentType") ?? contentType, data: file.data)
    try await post(
      "/api/media/replace",
      withRights(["mediaId": item.id, "fileName": file.name, "expectedUpdatedAtMs": expected].merging(film) { $1 }, rightsConfirmed),
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

  /// Sets one file's tags and nothing else (the route keeps its name, alt text and description).
  public func setTags(_ id: String, tags: [String]) async throws {
    try await post("/api/media/folders", ["action": "update-details", "mediaId": id, "tags": tags])
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

  /// Which of these files staff have disabled, and what the owner is told (`POST /api/media/quarantine`, AGL-1612),
  /// asked in batches of `mediaQuarantineProbeMax`, the most the route takes. Silent on failure, as the console is: a
  /// notice is extra context on a grid that reads fine without it, so a failed probe leaves the grid as it was.
  public func quarantine(_ ids: [String]) async -> [String: MediaQuarantineNotice] {
    var found: [String: MediaQuarantineNotice] = [:]
    var wanted: [String] = []
    for id in ids.sorted() where !id.trimmed.isEmpty && wanted.last != id { wanted.append(id) }
    var start = 0
    while start < wanted.count {
      let batch = Array(wanted[start..<min(start + mediaQuarantineProbeMax, wanted.count)])
      start += mediaQuarantineProbeMax
      if let answer = try? await post("/api/media/quarantine", ["mediaIds": batch]) {
        found.merge(parseMediaQuarantine(answer)) { _, new in new }
      }
    }
    return found
  }
}

/// How many files one `/api/media/quarantine` call may ask about (`MAX_PROBE_IDS`).
public let mediaQuarantineProbeMax = 100

/// Why a file stopped serving, in the words its owner is shown. The staff note (a takedown notice number, a
/// complainant) is not in what the route answers, so it cannot reach this.
public struct MediaQuarantineNotice: Equatable, Sendable {
  public let reason: String
  public let title: String
  public let body: String
  public let contact: String?

  public init(reason: String, title: String, body: String, contact: String?) {
    self.reason = reason
    self.title = title
    self.body = body
    self.contact = contact
  }

  /// The notice as one line: the body, then the support address in brackets, as the console's tooltip reads.
  public var message: String { contact.map { "\(body) (\($0))" } ?? body }
}

/// The route's `quarantined` map (media id to notice); none when the answer has no map, as a healthy platform's does.
public func parseMediaQuarantine(_ answer: JSONValue?) -> [String: MediaQuarantineNotice] {
  guard case .object(let map)? = answer?["quarantined"] else { return [:] }
  var notices: [String: MediaQuarantineNotice] = [:]
  for (id, entry) in map {
    guard case .object = entry else { continue }
    let title = entry["title"]?.stringValue?.trimmed ?? ""
    notices[id] = MediaQuarantineNotice(
      reason: entry["reason"]?.stringValue ?? "", title: title.isEmpty ? "Disabled" : title,
      body: entry["body"]?.stringValue ?? "",
      contact: entry["contact"]?.stringValue.flatMap { $0.trimmed.isEmpty ? nil : $0 })
  }
  return notices
}
