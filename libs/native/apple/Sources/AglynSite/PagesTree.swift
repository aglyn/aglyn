// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import Observation

// The Pages list's tree, read a level at a time (AGL-3896), the same way on
// Apple and Android. Top-level pages usually carry no `parentId`, so
// Firestore cannot select "parent = none": the site's screens are paged by
// document id (the console's order), 25 at a time, and only top-level rows
// are drawn until 25 new ones are on screen. Each batch of drawn rows (30 ids
// at most) asks once for `parentId in [ids]`, which gives exact child counts
// and chevrons, and the children are in hand when a row expands; an expanded
// row asks the same of its children, so the next level's chevrons are right.
// No parent's children are read twice in a session. No new index: the `in`
// query is single-field equality in the default order.

/// How many top-level rows a page of the list draws.
public let pagesTreePageSize = 25
/// The most ids one `parentId in` query names (Firestore's `in` cap).
public let pagesTreeInBatch = 30

/// The expanded rows of each site's list, for as long as the app runs.
@MainActor
enum PagesTreeSession {
  static var expanded: [String: Set<String>] = [:]
}

/// Whether a stored page sits at the top level: no `parentId`, or an empty one (the console's screen route's test).
func isTopLevelPage(_ doc: FirestoreDocument) -> Bool {
  guard let parent = doc.data["parentId"] as? String else { return true }
  return parent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
}

/// The site's pages as far as the list has read them, and the tree it draws.
@MainActor
@Observable
public final class PagesTree {
  public typealias Fetch = @MainActor (FirestoreQuery) async throws -> [FirestoreDocument]

  let hostID: String
  let fetch: Fetch
  /// Every page read so far, children included (a deleted page or an email screen is left out).
  public private(set) var nodes: [String: PageNode] = [:]
  /// The top-level rows drawn, in the order they were read.
  private(set) var topLevel: [String] = []
  /// Each parent's children, once a `parentId in` query has asked for them.
  private(set) var children: [String: [String]] = [:]
  /// The parents whose children have been asked for.
  private(set) var childrenRead: Set<String> = []
  /// The last document id the top-level windows read up to.
  private var cursor: String?
  /// Top-level pages a window read past the 25 it drew: the next page's first rows, with no read of their own.
  private var buffered: [String] = []
  private var windowsDone = false
  /// Whether every top-level page has been drawn.
  public var exhausted: Bool { windowsDone && buffered.isEmpty }
  public private(set) var loading = false
  public private(set) var failure: String?
  public private(set) var started = false
  /// How many documents (at least one a query) the list has read, and how many queries asked.
  public private(set) var reads = 0
  public private(set) var queries = 0
  public var expanded: Set<String> {
    didSet { PagesTreeSession.expanded[hostID] = expanded }
  }

  public init(hostID: String, fetch: @escaping Fetch) {
    self.hostID = hostID
    self.fetch = fetch
    self.expanded = PagesTreeSession.expanded[hostID] ?? []
  }

  private var collection: [String] { ["hosts", hostID, "screens"] }

  private func read(_ query: FirestoreQuery) async throws -> [FirestoreDocument] {
    let docs = try await fetch(query)
    queries += 1
    reads += max(1, docs.count)
    #if DEBUG
      print("AglynPagesReads host=\(hostID) queries=\(queries) reads=\(reads) (+\(max(1, docs.count)))")
    #endif
    return docs
  }

  private func remember(_ doc: FirestoreDocument) {
    if let node = PageNode(doc) { nodes[doc.id] = node } else { nodes[doc.id] = nil }
  }

  /// The first page of the list.
  public func start() async {
    guard !started else { return }
    started = true
    await loadMore()
  }

  /// The next 25 top-level rows: windows by document id until that many new ones are drawn, or the collection ends.
  public func loadMore() async {
    guard !loading, !exhausted else { return }
    loading = true
    defer { loading = false }
    do {
      var drawn: [String] = []
      while drawn.count < pagesTreePageSize, !buffered.isEmpty {
        let id = buffered.removeFirst()
        if nodes[id] != nil, !topLevel.contains(id) {
          topLevel.append(id)
          drawn.append(id)
        }
      }
      while drawn.count < pagesTreePageSize, !windowsDone {
        var filters: [ListQueryConstraint] = []
        if let cursor { filters.append(ListQueryConstraint(path: "__name__", op: .greaterThan, value: cursor)) }
        let docs = try await read(
          FirestoreQuery(collection, filters: filters, order: [.init("__name__")], limit: pagesTreePageSize))
        for doc in docs {
          remember(doc)
          guard isTopLevelPage(doc), nodes[doc.id] != nil, !topLevel.contains(doc.id) else { continue }
          if drawn.count < pagesTreePageSize {
            topLevel.append(doc.id)
            drawn.append(doc.id)
          } else {
            buffered.append(doc.id)
          }
        }
        cursor = docs.last?.id ?? cursor
        if docs.count < pagesTreePageSize { windowsDone = true }
      }
      try await readChildren(of: drawn)
      // A row the person left open (this session) shows its children again.
      try await readChildren(of: expanded.flatMap { children[$0] ?? [] })
      failure = nil
    } catch {
      failure = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
  }

  /// One `parentId in` query per 30 parents not yet asked: their children, counted and cached.
  func readChildren(of parents: [String]) async throws {
    let asking = parents.filter { !childrenRead.contains($0) }
    var start = 0
    while start < asking.count {
      let batch = Array(asking[start..<min(start + pagesTreeInBatch, asking.count)])
      start += pagesTreeInBatch
      let docs = try await read(
        FirestoreQuery(collection, filters: [ListQueryConstraint(path: "parentId", op: .in, value: batch)]))
      for parent in batch {
        childrenRead.insert(parent)
        if children[parent] == nil { children[parent] = [] }
      }
      for doc in docs {
        remember(doc)
        guard nodes[doc.id] != nil, let parent = doc.string("parentId"), parent != doc.id else { continue }
        if !(children[parent] ?? []).contains(doc.id) { children[parent, default: []].append(doc.id) }
      }
    }
  }

  /// Opens a row: its children are in hand already; their own children are asked for so the next chevrons are right.
  public func expand(_ id: String) async {
    expanded.insert(id)
    try? await readChildren(of: [id] + (children[id] ?? []))
  }

  public func collapse(_ id: String) { expanded.remove(id) }

  public func toggle(_ id: String) async {
    if expanded.contains(id) { collapse(id) } else { await expand(id) }
  }

  /// Every window still unread, for a search or a choice over all pages (Move).
  public func loadAll() async {
    while !exhausted, failure == nil {
      let before = topLevel.count
      await loadMore()
      if topLevel.count == before && !exhausted { break }
    }
    // Every page under a top-level row: the levels below, a batch at a time.
    var frontier = topLevel
    while !frontier.isEmpty {
      try? await readChildren(of: frontier)
      frontier = frontier.flatMap { children[$0] ?? [] }.filter { !childrenRead.contains($0) }
    }
  }

  /// The child count a row shows, once its children were asked for.
  public func childCount(_ id: String) -> Int { children[id]?.count ?? 0 }

  /// After a create, edit, move or delete: the changed pages read again, one document each, and put where they now
  /// belong in the cache.
  public func reread(_ ids: [String], read: @MainActor ([String]) async throws -> FirestoreDocument?) async {
    for id in ids {
      let doc = try? await read(collection + [id])
      queries += 1
      reads += 1
      topLevel.removeAll { $0 == id }
      for key in children.keys { children[key]?.removeAll { $0 == id } }
      guard let doc, let node = PageNode(doc) else {
        nodes[id] = nil
        expanded.remove(id)
        continue
      }
      nodes[id] = node
      if let parent = node.parentID {
        if childrenRead.contains(parent) { children[parent, default: []].append(id) }
      } else {
        topLevel.append(id)
      }
    }
  }

  /// The rows the list draws: top-level pages in the console's sibling order, each open row's children beneath it.
  public func rows(routing: SiteRouting) -> [PageTreeRow] {
    var out: [PageTreeRow] = []
    var seen = Set<String>()
    func walk(_ ids: [String], _ depth: Int) {
      for node in ids.compactMap({ nodes[$0] }).sorted(by: pageSiblingOrder) {
        guard seen.insert(node.id).inserted else { continue }
        let live = routing.routes[node.id]
        out.append(
          PageTreeRow(
            page: node, depth: depth, livePath: live.map(routeURL), home: live == "/", childCount: childCount(node.id)))
        if expanded.contains(node.id) { walk(children[node.id] ?? [], depth + 1) }
      }
    }
    walk(topLevel, 0)
    return out
  }

  /// Every page read whose name holds `text`, flat, in sibling order.
  public func matches(_ text: String, routing: SiteRouting) -> [PageTreeRow] {
    let needle = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return nodes.values.filter { $0.name.lowercased().contains(needle) || ($0.slug?.lowercased().contains(needle) ?? false) }
      .sorted(by: pageSiblingOrder)
      .map { node in
        let live = routing.routes[node.id]
        return PageTreeRow(
          page: node, depth: 0, livePath: live.map(routeURL), home: live == "/", childCount: childCount(node.id))
      }
  }
}
