// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

// A site's pages as the console's Pages hub reads and changes them
// (`hosts/[host]/screens`): the whole collection by document id with one
// probe row, deleted pages and email screens left out, built into the tree
// the hub draws (groups are folders; a page's parent is `parentId`), each
// page live when the host's routing map holds it.

/// The hub's own window: the site's screens by document id, plus one probe row.
public let pagesWindow = 200

public let screenKindGroup = "group"
public let screenKindTemplate = "template"
public let screenKindError = "error"
let screenKindEmail = "email"

/// The canvas root id the Besigner opens into (`CANVAS_ROOT_ELEMENT_ID`).
public let canvasRootElementID = "_@_"

/// The limits of the hub's New page form.
public let pageNameMax = 25
public let pageDescriptionMax = 80

public let hostResourcesRoute = "/api/hosts/resources"
public let hostVersionsRoute = "/api/hosts/versions"
public let hostPagesRoute = "/api/hosts/pages"

private func nonBlank(_ text: String?) -> String? {
  guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
  return text
}

/// One screen of the site, as the hub reads it.
public struct PageNode: Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let description: String?
  public let slug: String?
  public let parentID: String?
  public let kind: String?
  public let order: Double?
  public let createdAt: Date?
  public let versionID: String?
  public let publishedAt: Date?
  public let updatedAt: Date?

  public var isGroup: Bool { kind == screenKindGroup }

  /// Nil for a deleted page or an email screen (the Emails page's).
  public init?(_ doc: FirestoreDocument) {
    let kind = doc.string("kind")
    if let deleted = doc.data["deletedAt"], !(deleted is NSNull) { return nil }
    if kind == screenKindEmail { return nil }
    id = doc.id
    name = nonBlank(doc.string("displayName")) ?? (kind == screenKindGroup ? "Untitled group" : "Untitled page")
    description = nonBlank(doc.string("description"))
    slug = nonBlank(doc.string("slug"))
    parentID = nonBlank(doc.string("parentId"))
    self.kind = kind
    order = doc.double("order")
    createdAt = doc.date("createdAt")
    versionID = nonBlank(doc.string("versionId"))
    publishedAt = doc.date("publishedAt")
    updatedAt = doc.date("updatedAt")
  }
}

/// The host fields the hub reads beside the pages: the routing map and the placeholder home page.
public struct SiteRouting: Equatable, Sendable {
  public var routes: [String: String]
  public var defaultHomeScreenID: String?
  public var subdomain: String?
  public var cname: String?

  public init(
    routes: [String: String] = [:], defaultHomeScreenID: String? = nil, subdomain: String? = nil, cname: String? = nil
  ) {
    self.routes = routes
    self.defaultHomeScreenID = defaultHomeScreenID
    self.subdomain = subdomain
    self.cname = cname
  }

  public init(host: FirestoreDocument?) {
    var routes: [String: String] = [:]
    for (key, value) in host?.data["screens"] as? [String: Any] ?? [:] {
      if let path = value as? String, !path.isEmpty { routes[key] = path }
    }
    self.init(
      routes: routes, defaultHomeScreenID: host?.string("defaultHomeScreenId"), subdomain: host?.string("subdomain"),
      cname: nonBlank(host?.string("cname")))
  }
}

/// A routing-map path as a site address: `/` stays `/`, `about` is `/about`.
public func routeURL(_ path: String) -> String { path == "/" ? "/" : "/\(path)" }

/// One row of the drawn tree.
public struct PageTreeRow: Identifiable, Equatable, Sendable {
  public let page: PageNode
  public let depth: Int
  /// The address it answers, when live.
  public let livePath: String?
  public let home: Bool
  public let childCount: Int

  public var id: String { page.id }
}

/// Siblings in the hub's order: `order`, then created, then id.
func pageSiblingOrder(_ a: PageNode, _ b: PageNode) -> Bool {
  let (oa, ob) = (a.order ?? .greatestFiniteMagnitude, b.order ?? .greatestFiniteMagnitude)
  if oa != ob { return oa < ob }
  let (ca, cb) = (a.createdAt.map { floor($0.timeIntervalSince1970) } ?? 0, b.createdAt.map { floor($0.timeIntervalSince1970) } ?? 0)
  if ca != cb { return ca < cb }
  return a.id < b.id
}

/// The tree the hub draws, flattened depth first. A page whose parent is not
/// in the window shows at the top level, as the hub shows it; a cycle is cut
/// where it would repeat.
public func pageTree(_ pages: [PageNode], routing: SiteRouting) -> [PageTreeRow] {
  let ids = Set(pages.map(\.id))
  let children = Dictionary(grouping: pages) { page -> String in
    guard let parent = page.parentID, ids.contains(parent), parent != page.id else { return "" }
    return parent
  }
  var out: [PageTreeRow] = []
  var seen = Set<String>()
  func walk(_ parent: String, _ depth: Int) {
    for page in (children[parent] ?? []).sorted(by: pageSiblingOrder) {
      guard seen.insert(page.id).inserted else { continue }
      let live = routing.routes[page.id]
      out.append(
        PageTreeRow(
          page: page, depth: depth, livePath: live.map(routeURL), home: live == "/",
          childCount: children[page.id]?.count ?? 0))
      walk(page.id, depth + 1)
    }
  }
  walk("", 0)
  // Anything only reachable through a cycle still shows, at the top level.
  for page in pages.sorted(by: pageSiblingOrder) where !seen.contains(page.id) {
    seen.insert(page.id)
    let live = routing.routes[page.id]
    out.append(PageTreeRow(page: page, depth: 0, livePath: live.map(routeURL), home: live == "/", childCount: 0))
  }
  return out
}

/// How a row reads: what it is and whether a visitor can reach it.
public struct PageStatus: Equatable, Sendable {
  public let label: String
  public let live: Bool
}

public func pageStatus(_ row: PageTreeRow) -> PageStatus {
  if row.page.isGroup { return PageStatus(label: "Group", live: false) }
  if row.page.kind == screenKindTemplate { return PageStatus(label: "Entry template", live: false) }
  if row.page.kind == screenKindError { return PageStatus(label: "Error page", live: false) }
  if row.livePath != nil { return PageStatus(label: "Published", live: true) }
  return PageStatus(label: "Draft", live: false)
}

/// The pages a page may move under: groups and pages, never itself or its own descendants.
public func movableParents(_ pages: [PageNode], pageID: String) -> [PageNode] {
  let byParent = Dictionary(grouping: pages) { $0.parentID ?? "" }
  var blocked: Set<String> = [pageID]
  var queue = [pageID]
  while !queue.isEmpty {
    let next = queue.removeFirst()
    for child in byParent[next] ?? [] where blocked.insert(child.id).inserted { queue.append(child.id) }
  }
  return pages.filter { !blocked.contains($0.id) && $0.kind != screenKindTemplate && $0.kind != screenKindError }
    .sorted { $0.name.lowercased() < $1.name.lowercased() }
}

/// A page's live address on the site's own domain, as the hub's "Open live page" builds it.
public func livePageURL(_ routing: SiteRouting, livePath: String, apex: String = HostStatus.defaultTenantApex)
  -> String?
{
  guard let domain = routing.cname ?? routing.subdomain.map({ "\($0).\(apex)" }) else { return nil }
  return "https://\(domain)\(livePath)"
}

/// One saved version of a page.
public struct PageVersion: Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String?
  public let createdAt: Date?

  public init(_ doc: FirestoreDocument) {
    id = doc.id
    name = nonBlank(doc.string("displayName"))
    createdAt = doc.date("createdAt")
  }
}

/// A site's page writes, made the way the console makes them: a new page or
/// group and a duplicate through the quota-enforcing resources route and its
/// first version through the versions route; publishing, unpublishing, moving
/// and deleting through the pages route, which runs the console's own routing
/// code; a rename, a description and the live version as the same document
/// updates the hub and the page details make.
public struct PagesAPI: Sendable {
  let api: ConsoleAPIClient
  let writer: FirestoreWriter
  let hostID: String

  public init(api: ConsoleAPIClient, writer: FirestoreWriter, hostID: String) {
    self.api = api
    self.writer = writer
    self.hostID = hostID
  }

  private func path(_ id: String) -> [String] { ["hosts", hostID, "screens", id] }

  /// A new draft page (no address yet) with the empty canvas the Besigner opens into; answers its ids.
  @discardableResult
  public func createPage(name: String, description: String) async throws -> (id: String, versionID: String) {
    let id = newDocumentID()
    let versionID = newDocumentID()
    var data: [String: Any?] = ["displayName": name.trimmed, "versionId": versionID]
    if !description.trimmed.isEmpty { data["description"] = description.trimmed }
    try await api.request(
      hostResourcesRoute, method: .post,
      body: .from(["hostId": hostID, "resource": "screen", "id": id, "data": data] as [String: Any?]))
    let root: [String: Any?] = ["$id": canvasRootElementID, "componentId": "div", "nodes": [Any]()]
    try await api.request(
      hostVersionsRoute, method: .post,
      body: .from(
        [
          "hostId": hostID, "kind": "screen", "parentId": id, "id": versionID,
          "data": ["screenId": id, "nodes": [canvasRootElementID: root]] as [String: Any?],
        ] as [String: Any?]))
    return (id, versionID)
  }

  /// A new group at the top of the list, as the hub's New group adds one.
  public func createGroup(name: String, topOrder: Double) async throws {
    let id = newDocumentID()
    try await api.request(
      hostResourcesRoute, method: .post,
      body: .from(
        [
          "hostId": hostID, "resource": "screen", "id": id,
          "data": ["displayName": name.trimmed, "kind": screenKindGroup] as [String: Any?],
        ] as [String: Any?]))
    try await writer.merge(path(id), ["order": min(0, topOrder) - 1])
  }

  /// A draft copy with a unique slug and no address; answers its id.
  public func duplicate(sourceID: String, name: String) async throws -> String? {
    let answer = try await api.request(
      hostResourcesRoute, method: .post,
      body: .from(
        [
          "hostId": hostID, "resource": "screen", "action": "duplicate", "sourceId": sourceID,
          "name": name.trimmed.isEmpty ? nil : name.trimmed, "attemptKey": newDocumentID(),
        ] as [String: Any?]))
    return answer.field("id")
  }

  public func rename(_ id: String, name: String, description: String?) async throws {
    var fields: [String: Any] = displayNameSearchFields(name.trimmed)
    fields["displayName"] = name.trimmed
    if let description { fields["description"] = description.trimmed }
    fields["updatedAt"] = Date()
    try await writer.merge(path(id), fields)
  }

  /// Makes `versionID` the one the page serves, as the details page's versions do.
  public func makeVersionLive(_ id: String, versionID: String) async throws {
    try await writer.merge(path(id), ["versionId": versionID, "updatedAt": Date()])
  }

  @discardableResult
  private func pages(_ action: String, _ id: String, _ extra: [String: Any?] = [:]) async throws -> JSONValue? {
    var body: [String: Any?] = ["hostId": hostID, "action": action, "id": id]
    body.merge(extra) { _, new in new }
    return try await api.request(hostPagesRoute, method: .post, body: .from(body))
  }

  /// Publishes the page at `slug` (`/` for the home page); answers the address it went live at.
  public func publish(_ id: String, slug: String) async throws -> String? {
    try await pages("publish", id, ["slug": slug]).field("path")
  }

  public func unpublish(_ id: String) async throws { try await pages("unpublish", id) }

  public func delete(_ id: String) async throws { try await pages("delete", id) }

  public func deleteGroup(_ id: String) async throws { try await pages("delete-group", id) }

  /// Moves the page under `parentID` (nil: the top level), at `index` among its new siblings.
  public func move(_ id: String, parentID: String?, index: Int) async throws {
    try await pages("move", id, ["parentId": parentID, "index": index])
  }
}

extension String {
  var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
