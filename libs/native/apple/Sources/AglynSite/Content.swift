// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

// A site's content collections and their entries, as the console's Content
// page reads and changes them (`hosts/[host]/content`): the collections
// (`hosts/{hostId}/collections`, the content kind) and one collection's
// entries through ENTRY_LIST_QUERY (the status clause and the title search on
// the one Firestore query). A collection is created, renamed and bound to its
// pages through `/api/hosts/collections` and erased through
// `/api/resources/erase`; an entry is created through `/api/hosts/resources`
// (the quota-counted create) and then saved, published, scheduled, re-dated
// and deleted with the same document writes the console makes. The Kotlin
// kit's `Content.kt`.

/// The entries list's window; it grows by this much as the list scrolls.
public let entryPageSize = 25

/// A collection holds at most this many categories (`COLLECTION_CATEGORIES_MAX`).
public let collectionCategoriesMax = 50

/// What the byline rule says before an entry without one is published (`ENTRY_BYLINE_REQUIRED_MESSAGE`).
public let entryBylineRequiredMessage = "Add an author before publishing — pick one or type a custom byline"

/// The search snippet lengths past which the editor warns.
public let entrySeoTitleWarn = 60
public let entrySeoDescriptionWarn = 155

/// A slug as the content page makes one (`slugify`): lower case, every run of other characters one hyphen.
public func contentSlug(_ text: String) -> String {
  text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
    .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
    .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
}

/// The collection route's slug rule (`^[a-z0-9]+(?:-[a-z0-9]+)*$`).
public func isCollectionSlug(_ slug: String) -> Bool {
  slug.range(of: "^[a-z0-9]+(?:-[a-z0-9]+)*$", options: .regularExpression) != nil
}

/// One category of a collection.
public struct ContentCategory: Equatable, Identifiable, Sendable {
  public let id: String
  public var name: String
  public var description: String?

  public init(id: String, name: String, description: String? = nil) {
    self.id = id
    self.name = name
    self.description = description
  }
}

/// One content collection.
public struct ContentCollection: Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let slug: String
  public let schemaType: String?
  public let excludeFromSearch: Bool
  public let categories: [ContentCategory]
  public let listScreenID: String?
  public let entryScreenID: String?

  /// Nil for a collection of another kind (a commerce catalog shares the path).
  public init?(_ doc: FirestoreDocument) {
    if let kind = doc.string("kind"), kind != "content" { return nil }
    id = doc.id
    name = nonBlankText(doc.string("displayName")) ?? doc.id
    slug = doc.string("slug") ?? ""
    schemaType = doc.string("schemaType")
    excludeFromSearch = doc.bool("excludeEntriesFromSearch") == true
    categories = (doc.data["categories"] as? [Any])?.compactMap { raw in
      guard let map = raw as? [String: Any], let id = map["id"] as? String else { return nil }
      return ContentCategory(id: id, name: map["name"] as? String ?? id, description: map["description"] as? String)
    } ?? []
    listScreenID = nonBlankText(doc.string("listScreenId"))
    entryScreenID = nonBlankText(doc.string("entryScreenId") ?? doc.string("templateScreenId"))
  }
}

func nonBlankText(_ text: String?) -> String? {
  guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
  return text
}

/// The collections in the picker's order: by name.
public func sortedCollections(_ docs: [FirestoreDocument]) -> [ContentCollection] {
  docs.compactMap(ContentCollection.init).sorted { $0.name.lowercased() < $1.name.lowercased() }
}

/// A new category's id: its name as a slug (or `category`), made unique with `-2`, `-3`…
public func newCategoryID(_ name: String, existing: [ContentCategory]) -> String {
  let base = contentSlug(name).isEmpty ? "category" : contentSlug(name)
  let taken = Set(existing.map(\.id))
  if !taken.contains(base) { return base }
  var n = 2
  while taken.contains("\(base)-\(n)") { n += 1 }
  return "\(base)-\(n)"
}

/// One entry, as the list and the editor read it.
public struct ContentEntry: Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let slug: String
  public let excerpt: String
  public let body: String
  public let status: String
  public let categoryID: String?
  public let legacyCategory: String?
  public let tags: [String]
  public let authorID: String?
  public let authorName: String
  public let coverImage: String
  public let coverImageAlt: String
  public let coverVideo: String
  public let coverVideoDuration: Int?
  public let seoTitle: String
  public let seoDescription: String
  public let publishedAt: Date?
  public let publishAt: Date?
  public let updatedAt: Date?

  public var hasByline: Bool { !(authorID ?? "").isEmpty || !authorName.trimmingCharacters(in: .whitespaces).isEmpty }
  public var isLive: Bool { status != "draft" }

  public init(_ doc: FirestoreDocument) {
    id = doc.id
    title = nonBlankText(doc.string("title")) ?? "Untitled"
    slug = doc.string("slug") ?? ""
    excerpt = doc.string("excerpt") ?? ""
    body = doc.string("body") ?? ""
    status = nonBlankText(doc.string("status")) ?? "draft"
    categoryID = nonBlankText(doc.string("categoryId"))
    legacyCategory = nonBlankText(doc.string("category"))
    tags = (doc.data["tags"] as? [Any])?.compactMap { $0 as? String } ?? []
    authorID = nonBlankText(doc.string("authorId"))
    authorName = doc.string("authorName") ?? ""
    coverImage = doc.string("coverImage") ?? ""
    coverImageAlt = doc.string("coverImageAlt") ?? ""
    coverVideo = doc.string("coverVideo") ?? ""
    coverVideoDuration = doc.int("coverVideoDuration")
    seoTitle = doc.string("seoTitle") ?? ""
    seoDescription = doc.string("seoDescription") ?? ""
    publishedAt = doc.date("publishedAt")
    publishAt = doc.date("publishAt")
    updatedAt = doc.date("updatedAt")
  }
}

/// The status chip's words for a stored status.
public func entryStatusLabel(_ status: String) -> String {
  ContractValues.shared.entryStatusOptions.first { $0.value == status }?.label ?? status.prefix(1).uppercased() + status.dropFirst()
}

/// The list's order: last edited first, which every entry can be ordered by.
public let entryListOrder = ListQuerySort(column: "updatedAt", direction: .desc, path: "updatedAt")

/// One entries view: the status clause and the title search, last edited first.
public func entryRequest(status: String?, search: String) -> ListQueryRequest {
  let typed = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return ListQueryRequest(
    clauses: status.map { [ListFilterRequest(field: "status", op: "equals", value: $0)] } ?? [],
    search: typed.isEmpty ? nil : [typed], sort: entryListOrder)
}

public func entryQuery(hostID: String, collectionID: String, status: String?, search: String, limit: Int) -> FirestoreQuery {
  planListQuery(ContractValues.shared.entryListQuery, entryRequest(status: status, search: search))
    .firestoreQuery(["hosts", hostID, "collections", collectionID, "entries"], limit: limit)
}

/// One collection's entries: the search, the status chip, the rows read so
/// far and whether more are left. A live window that grows a page at a time.
@MainActor
@Observable
public final class EntryListModel {
  public private(set) var rows: LiveValue<[ContentEntry]> = .loading
  public private(set) var hasMore = false
  public var search = "" { didSet { if oldValue != search { restart() } } }
  public var status: String? { didSet { if oldValue != status { restart() } } }

  @ObservationIgnored private var reader: FirestoreReader?
  @ObservationIgnored private var hostID = ""
  @ObservationIgnored private var collectionID = ""
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var limit = entryPageSize

  public init() {}

  public func start(_ reader: FirestoreReader, hostID: String, collectionID: String) {
    self.reader = reader
    self.hostID = hostID
    self.collectionID = collectionID
    restart()
  }

  public func loadMore() {
    guard hasMore else { return }
    limit += entryPageSize
    listen(keep: true)
  }

  public func refresh() { listen(keep: true) }

  public func stop() {
    listener?.remove()
    listener = nil
  }

  private func restart() {
    limit = entryPageSize
    listen(keep: false)
  }

  private func listen(keep: Bool) {
    listener?.remove()
    if !keep { rows = .loading }
    guard let reader, !hostID.isEmpty, !collectionID.isEmpty else { return }
    let window = limit
    let query = entryQuery(hostID: hostID, collectionID: collectionID, status: status, search: search, limit: window + 1)
    listener = reader.listen(query) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.hasMore = docs.count > window
        self.rows = .ready(docs.prefix(window).map(ContentEntry.init))
      case .failure:
        self.hasMore = false
        self.rows = .failed("Entries could not be loaded. Check the connection and try again.")
      }
    }
  }
}

/// The editor's fields, as text, and what a save writes from them.
public struct EntryDraft: Equatable, Sendable {
  public var title: String
  public var slug: String
  public var excerpt: String
  public var body: String
  public var categoryID: String?
  public var tags: [String]
  public var authorID: String?
  public var authorName: String
  public var coverImage: String
  public var coverImageAlt: String
  public var coverVideo: String
  public var coverVideoDuration: String
  public var seoTitle: String
  public var seoDescription: String

  public init(_ entry: ContentEntry) {
    title = entry.title == "Untitled" ? "" : entry.title
    slug = entry.slug
    excerpt = entry.excerpt
    body = entry.body
    categoryID = entry.categoryID
    tags = entry.tags
    authorID = entry.authorID
    authorName = entry.authorName
    coverImage = entry.coverImage
    coverImageAlt = entry.coverImageAlt
    coverVideo = entry.coverVideo
    coverVideoDuration = entry.coverVideoDuration.map(String.init) ?? ""
    seoTitle = entry.seoTitle
    seoDescription = entry.seoDescription
  }

  /// The slug a save stores: the typed one as a slug, else the title's.
  public var effectiveSlug: String {
    let typed = contentSlug(slug)
    return typed.isEmpty ? contentSlug(title) : typed
  }

  /// The entry editor's save (`setDoc(entry, …, {merge: true})`), field for field.
  public func payload() -> [String: Any] {
    let cover = coverImage.trimmingCharacters(in: .whitespacesAndNewlines)
    let alt = coverImageAlt.trimmingCharacters(in: .whitespacesAndNewlines)
    let video = coverVideo.trimmingCharacters(in: .whitespacesAndNewlines)
    let duration = Double(coverVideoDuration.trimmingCharacters(in: .whitespaces)).flatMap { $0 > 0 ? Int($0.rounded()) : nil }
    var out: [String: Any] = [
      "title": title.trimmed,
      "titleTokens": nameSearchTokens(title.trimmed),
      "slug": effectiveSlug,
      "excerpt": excerpt.trimmed,
      "body": body,
      "coverImage": cover,
      "coverImageAlt": !cover.isEmpty && !alt.isEmpty ? alt as Any : FirestoreSentinel.delete,
      "coverVideo": video.isEmpty ? FirestoreSentinel.delete as Any : video,
      "coverVideoDuration": !video.isEmpty && duration != nil ? duration! as Any : FirestoreSentinel.delete,
      "seoTitle": seoTitle.trimmed,
      "seoDescription": seoDescription.trimmed,
      "authorId": nonBlankText(authorID).map { $0 as Any } ?? FirestoreSentinel.delete,
      "authorName": authorName.trimmed,
      "tags": tags.map(\.trimmed).filter { !$0.isEmpty },
      "updatedAt": Date(),
    ]
    if let categoryID {
      out["categoryId"] = categoryID
      out["category"] = FirestoreSentinel.delete
    } else {
      out["categoryId"] = FirestoreSentinel.delete
    }
    return out
  }
}

/// A custom author of the site (`hosts/{hostId}/authors`).
public struct ContentAuthor: Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String

  public init(_ doc: FirestoreDocument) {
    id = doc.id
    name = nonBlankText(doc.string("name")) ?? "Unnamed author"
  }
}

/// A page an entry or the list can render through.
public struct TemplateScreen: Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let kind: String?
}

public func templateScreens(_ docs: [FirestoreDocument]) -> [TemplateScreen] {
  docs.filter { $0.data["deletedAt"] == nil && $0.string("kind") != "group" && $0.string("kind") != "email" }
    .map { TemplateScreen(id: $0.id, name: nonBlankText($0.string("displayName")) ?? "Untitled page", kind: $0.string("kind")) }
    .sorted { $0.name.lowercased() < $1.name.lowercased() }
}

/// Whether `date` may be a schedule (in the future) or a published date (not).
public func isFuture(_ date: Date, now: Date = Date()) -> Bool { date > now }

/// The content writes, each the console's own.
public struct ContentAPI: Sendable {
  let api: ConsoleAPIClient
  let writer: FirestoreWriter
  let reader: FirestoreReader
  let hostID: String

  public init(api: ConsoleAPIClient, writer: FirestoreWriter, reader: FirestoreReader, hostID: String) {
    self.api = api
    self.writer = writer
    self.reader = reader
    self.hostID = hostID
  }

  private func collectionPath(_ id: String) -> [String] { ["hosts", hostID, "collections", id] }
  private func entryPath(_ collectionID: String, _ id: String) -> [String] { collectionPath(collectionID) + ["entries", id] }

  @discardableResult
  private func collections(_ body: [String: Any?]) async throws -> JSONValue? {
    var fields: [String: Any?] = ["hostId": hostID]
    fields.merge(body) { _, new in new }
    return try await api.request("/api/hosts/collections", method: .post, body: jsonBody(fields))
  }

  /// A new collection, then the pages it was given; answers its id.
  public func createCollection(name: String, slug: String, listScreenID: String?, entryScreenID: String?) async throws -> String {
    let answer = try await collections([
      "action": "create", "kind": "content", "data": ["displayName": name.trimmed, "slug": slug] as [String: Any?],
    ])
    guard let id = answer.field("id") else { throw ConsoleAPIError(status: 0, message: "The collection could not be created.") }
    if let listScreenID {
      try await collections(["action": "templates", "id": id, "data": ["listScreenId": listScreenID] as [String: Any?]])
    }
    if let entryScreenID {
      try await collections([
        "action": "templates", "id": id, "data": ["entryScreenId": entryScreenID, "templateScreenId": nil] as [String: Any?],
      ])
    }
    return id
  }

  public func renameCollection(_ id: String, name: String, slug: String) async throws {
    try await collections([
      "action": "update", "id": id, "kind": "content", "data": ["displayName": name.trimmed, "slug": slug] as [String: Any?],
    ])
  }

  /// The list page (nil clears it).
  public func setListScreen(_ id: String, screenID: String?) async throws {
    try await collections(["action": "templates", "id": id, "data": ["listScreenId": screenID] as [String: Any?]])
  }

  /// The entry page (nil clears it).
  public func setEntryScreen(_ id: String, screenID: String?) async throws {
    try await collections([
      "action": "templates", "id": id, "data": ["entryScreenId": screenID, "templateScreenId": nil] as [String: Any?],
    ])
  }

  public func setSchemaType(_ id: String, _ schemaType: String) async throws {
    try await writer.merge(collectionPath(id), ["schemaType": schemaType, "updatedAt": Date()])
  }

  public func setExcludeFromSearch(_ id: String, _ exclude: Bool) async throws {
    try await writer.merge(
      collectionPath(id),
      ["excludeEntriesFromSearch": exclude ? true as Any : FirestoreSentinel.delete, "updatedAt": Date()])
  }

  public func setCategories(_ id: String, _ categories: [ContentCategory]) async throws {
    let rows: [[String: Any]] = categories.map { category in
      var row: [String: Any] = ["id": category.id, "name": category.name]
      if let description = category.description { row["description"] = description }
      return row
    }
    try await writer.merge(collectionPath(id), ["categories": rows])
  }

  /// Erases a collection (admins only; refused while it holds entries or a live page binding).
  public func deleteCollection(_ id: String) async throws {
    try await api.request(
      "/api/resources/erase", method: .post,
      body: jsonBody(["scope": "hosts", "scopeId": hostID, "kind": "collections", "id": id, "collectionKind": "content"]))
  }

  /// Whether another entry of the collection already has `slug`.
  @MainActor
  public func slugTaken(_ collectionID: String, slug: String, exceptID: String?) async throws -> Bool {
    let query = FirestoreQuery(collectionPath(collectionID) + ["entries"], equals: [(field: "slug", value: slug)], limit: 2)
    return try await reader.readOnce(query).contains { $0.id != exceptID }
  }

  /// A new draft entry through the counted create; answers its id.
  public func createEntry(_ collectionID: String, title: String, slug: String) async throws -> String {
    let id = newDocumentID()
    try await api.request(
      "/api/hosts/resources", method: .post,
      body: jsonBody([
        "hostId": hostID, "resource": "entry", "parentId": collectionID, "id": id,
        "data": ["title": title.trimmed, "slug": slug] as [String: Any?],
      ]))
    return id
  }

  public func saveEntry(_ collectionID: String, id: String, draft: EntryDraft) async throws {
    try await writer.merge(entryPath(collectionID, id), draft.payload())
  }

  /// Publishes (keeping a first published date) or takes back to a draft.
  public func setPublished(_ collectionID: String, entry: ContentEntry, publish: Bool) async throws {
    if publish {
      let at = entry.publishedAt ?? Date()
      try await writer.merge(entryPath(collectionID, entry.id), ["status": "published", "publishedAt": at, "publishSortAt": at])
    } else {
      try await writer.merge(
        entryPath(collectionID, entry.id),
        ["status": "draft", "publishedAt": FirestoreSentinel.delete, "publishSortAt": FirestoreSentinel.delete])
    }
  }

  public func schedule(_ collectionID: String, entry: ContentEntry, at: Date) async throws {
    try await writer.merge(entryPath(collectionID, entry.id), ["status": "scheduled", "publishAt": at, "publishSortAt": at])
  }

  /// Re-dates a published entry (never into the future); a scheduled one keeps sorting by its schedule.
  public func setPublishedDate(_ collectionID: String, entry: ContentEntry, at: Date) async throws {
    let sort = entry.status == "scheduled" ? entry.publishAt ?? at : at
    try await writer.merge(entryPath(collectionID, entry.id), ["publishedAt": at, "publishSortAt": sort])
  }

  public func deleteEntry(_ collectionID: String, id: String) async throws {
    try await reader.deleteDocument(entryPath(collectionID, id))
  }

  /// Tells the live site a collection's entries changed; never fails the write before it.
  public func announce(_ collectionID: String, slugs: [String]) async {
    _ = try? await api.request(
      "/api/screens/revalidate", method: .post,
      body: jsonBody(["hostId": hostID, "collectionId": collectionID, "entrySlugs": slugs.filter { !$0.isEmpty }]))
  }
}
