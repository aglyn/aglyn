// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

// Starting a page, component or layout from a template, and saving one as a
// template, as the console's Use template and Save as template do. A stored
// node tree is msgpack bytes that the apps only read: it is decoded here and
// sent to the console's routes as JSON, which encode it themselves. Every
// create rides the quota-enforcing routes, so a refusal reads the way the
// console's does.

private let initialVersionLabel = "Initial version"

/// A placeholder a template asks for when it is used.
public struct TemplatePlaceholder: Equatable, Sendable {
  public let name: String
  public let label: String
  public let defaultValue: String
}

/// A template as Use reads it: what it is, the tree it holds and what a copy carries.
public struct TemplateContent: Identifiable, @unchecked Sendable {
  public let id: String
  public let name: String
  /// `page`, `component` or `layout` (missing is `page`).
  public let kind: String
  public let description: String?
  public let nodes: [String: Any]?
  public let rootID: String?
  public let props: [Any]?
  /// `email` for an email block's template.
  public let componentKind: String?
  public let seo: [String: Any]?
  public let slug: String?
  public let placeholders: [TemplatePlaceholder]
  public let starterID: String?
  public let starterOrder: Int?

  /// Nil for a deleted template.
  public init?(_ doc: FirestoreDocument) {
    if let deleted = doc.data["deletedAt"], !(deleted is NSNull) { return nil }
    let source = doc.data["source"] as? [String: Any]
    id = doc.id
    name = nonBlankText(doc.string("displayName")) ?? "Untitled"
    kind = nonBlankText(doc.string("kind")) ?? "page"
    description = nonBlankText(doc.string("description"))
    nodes = decodeStoredNodes(doc.data["nodes"])
    rootID = nonBlankText(doc.string("rootId"))
    props = (doc.data["props"] as? [Any]).flatMap { $0.isEmpty ? nil : $0 }
    componentKind = nonBlankText(doc.string("componentKind"))
    seo = (doc.data["seo"] as? [String: Any]).flatMap { $0.isEmpty ? nil : $0 }
    slug = nonBlankText(doc.string("slug"))
    placeholders = ((doc.data["placeholders"] as? [Any]) ?? []).compactMap { entry in
      guard let map = entry as? [String: Any], let name = map["name"] as? String else { return nil }
      // A `{{prop.*}}` token binds to a property the template carries, never a placeholder to fill.
      if name.hasPrefix(ContractValues.shared.componentPropTokenPrefix) { return nil }
      return TemplatePlaceholder(
        name: name, label: nonBlankText(map["label"] as? String) ?? name, defaultValue: (map["defaultValue"] as? String) ?? "")
    }
    starterID = nonBlankText(source?["starterId"] as? String)
    starterOrder = (source?["starterOrder"] as? NSNumber)?.intValue
  }

  func withSlug(_ slug: String?) -> TemplateContent { TemplateContent(copying: self, slug: slug) }

  private init(copying other: TemplateContent, slug: String?) {
    id = other.id
    name = other.name
    kind = other.kind
    description = other.description
    nodes = other.nodes
    rootID = other.rootID
    props = other.props
    componentKind = other.componentKind
    seo = other.seo
    self.slug = slug
    placeholders = other.placeholders
    starterID = other.starterID
    starterOrder = other.starterOrder
  }
}

/// A page made from a template: its id, and the address it went live at.
public struct UsedPage: Equatable, Sendable {
  public let screenID: String
  public let slug: String
  public let requestedSlug: String
}

/// What Save as template captures from a page, component or layout.
public struct TemplateSource: @unchecked Sendable {
  public var kind: String
  public var nodes: [String: Any]
  public var rootID: String?
  public var slug: String?
  public var seo: [String: Any]?
  public var props: [Any]?
  public var componentKind: String?

  public init(
    kind: String, nodes: [String: Any], rootID: String? = nil, slug: String? = nil, seo: [String: Any]? = nil, props: [Any]? = nil,
    componentKind: String? = nil
  ) {
    self.kind = kind
    self.nodes = nodes
    self.rootID = rootID
    self.slug = slug
    self.seo = seo
    self.props = props
    self.componentKind = componentKind
  }
}

/// A sentence for the person, thrown by a flow that cannot go on; the runner shows it as written.
public func templateProblem(_ message: String) -> ConsoleAPIError { ConsoleAPIError(status: 400, message: message) }

/// The tree as JSON, keeping its nulls (the tree is data the console's routes store as it is).
private func treeJSON(_ value: Any) -> JSONValue { JSONValue.from(value) }

public struct TemplatesAPI: @unchecked Sendable {
  let api: ConsoleAPIClient
  let reader: FirestoreReader
  let writer: FirestoreWriter
  let hostID: String

  public init(api: ConsoleAPIClient, reader: FirestoreReader, writer: FirestoreWriter, hostID: String) {
    self.api = api
    self.reader = reader
    self.writer = writer
    self.hostID = hostID
  }

  @discardableResult
  private func post(_ path: String, _ body: [String: JSONValue]) async throws -> JSONValue? {
    var fields = body
    fields["hostId"] = .string(hostID)
    return try await api.request(path, method: .post, body: .object(fields))
  }

  private func resources(_ resource: String, id: String? = nil, data: [String: JSONValue]) async throws -> JSONValue? {
    var body: [String: JSONValue] = ["resource": .string(resource), "data": .object(data)]
    if let id { body["id"] = .string(id) }
    return try await post("/api/hosts/resources", body)
  }

  /// One template, or nil when it is gone.
  public func load(_ templateID: String) async throws -> TemplateContent? {
    try await reader.readOnce(["hosts", hostID, "templates", templateID]).flatMap(TemplateContent.init)
  }

  /// The pages of a starter bundle, in the bundle's order.
  public func bundlePages(_ starterID: String) async throws -> [TemplateContent] {
    try await reader.readOnce(FirestoreQuery(["hosts", hostID, "templates"], equals: [(field: "source.starterId", value: starterID)], limit: 100))
      .compactMap(TemplateContent.init).sorted { ($0.starterOrder ?? Int.max) < ($1.starterOrder ?? Int.max) }
  }

  private func filled(_ template: TemplateContent, _ values: [String: String]) throws -> [String: Any] {
    guard let nodes = template.nodes else { throw templateProblem("This template has no content to start from.") }
    return resolveNamedTokens(nodes, tokens: template.placeholders.isEmpty ? nil : values)
  }

  /// A component from the template; answers its id.
  public func useComponent(_ template: TemplateContent, name: String, values: [String: String]) async throws -> String {
    var data: [String: JSONValue] = ["displayName": .string(name.trimmed), "nodes": treeJSON(try filled(template, values))]
    if let description = template.description { data["description"] = .string(description) }
    if let rootID = template.rootID { data["rootId"] = .string(rootID) }
    if let props = template.props { data["props"] = treeJSON(props) }
    if template.componentKind == "email" { data["kind"] = .string("email") }
    return try await resources("reusableComponent", data: data).field("id") ?? ""
  }

  /// A layout from the template, with its first version; answers its id.
  public func useLayout(_ template: TemplateContent, name: String, values: [String: String]) async throws -> String {
    let layoutID = newDocumentID()
    let versionID = newDocumentID()
    let nodes = try filled(template, values)
    var layout: [String: JSONValue] = ["displayName": .string(name.trimmed), "versionId": .string(versionID)]
    if let description = template.description { layout["description"] = .string(description) }
    try await resources("layout", id: layoutID, data: layout)
    var version: [String: JSONValue] = [
      "layoutId": .string(layoutID), "hostId": .string(hostID), "displayName": .string(initialVersionLabel), "nodes": treeJSON(nodes),
    ]
    if let props = template.props { version["props"] = treeJSON(props) }
    try await post(
      "/api/hosts/versions",
      ["kind": .string("layout"), "parentId": .string(layoutID), "id": .string(versionID), "data": .object(version)])
    return layoutID
  }

  /// The paths already routed on the site (the routing map's values).
  public func takenAddresses() async throws -> Set<String> {
    let host = try await reader.readOnce(["hosts", hostID])
    return Set(((host?.data["screens"] as? [String: Any]) ?? [:]).values.compactMap { $0 as? String })
  }

  /// One live page from a template, de-conflicted against `taken` (which gains what it claims).
  public func usePage(
    _ template: TemplateContent, name: String, slug: String?, values: [String: String], taken: inout Set<String>, pages: PagesAPI
  ) async throws -> UsedPage {
    let nodes = try filled(template, values)
    let claimed = resolveTemplateSlug(slug: slug, displayName: name.trimmed, taken: &taken)
    let screenID = newDocumentID()
    let versionID = newDocumentID()
    var screen: [String: JSONValue] = ["displayName": .string(name.trimmed), "versionId": .string(versionID)]
    if let description = template.description { screen["description"] = .string(description) }
    if let seo = template.seo { screen["seo"] = treeJSON(seo) }
    try await resources("screen", id: screenID, data: screen)
    try await post(
      "/api/hosts/versions",
      [
        "kind": .string("screen"), "parentId": .string(screenID), "id": .string(versionID),
        "data": .object(["screenId": .string(screenID), "displayName": .string(initialVersionLabel), "nodes": treeJSON(nodes)]),
      ])
    _ = try await pages.publish(screenID, slug: claimed.slug)
    return UsedPage(screenID: screenID, slug: claimed.slug, requestedSlug: claimed.requestedSlug)
  }

  /// Takes the site root back from the placeholder home page (AGL-3408): a
  /// starter is a whole site and has to land on the site's address. Only the
  /// page the site names as its default home, and only while it still holds
  /// `/`. Answers whether `/` was released.
  public func releaseDefaultHome(pages: PagesAPI) async throws -> Bool {
    guard let host = try await reader.readOnce(["hosts", hostID])?.data, let screenID = host["defaultHomeScreenId"] as? String,
      let routes = host["screens"] as? [String: Any], routes[screenID] as? String == screenRootPath
    else { return false }
    try await pages.unpublish(screenID)
    try await writer.merge(["hosts", hostID], ["defaultHomeScreenId": FirestoreSentinel.delete])
    return true
  }

  /// Every page of a starter bundle; the first takes the root when nothing in the bundle or on the site does.
  /// Answers the pages made and those that could not be.
  public func useBundle(_ bundle: [TemplateContent], pages: PagesAPI) async throws -> (made: [UsedPage], skipped: [String]) {
    var taken = try await takenAddresses()
    if !bundle.isEmpty, try await releaseDefaultHome(pages: pages) { taken.remove(screenRootPath) }
    var made: [UsedPage] = []
    var skipped: [String] = []
    let ordered = withBundleRootScreen(bundle, taken: taken, slug: { $0.slug }, setting: { page, slug in page.withSlug(slug) })
    for page in ordered {
      if let refusal = templateScreenAddressRefusal(slug: page.slug, displayName: page.name) {
        skipped.append("\"\(page.name)\" — \(refusal)")
        continue
      }
      made.append(try await usePage(page, name: page.name, slug: page.slug, values: [:], taken: &taken, pages: pages))
    }
    return (made, skipped)
  }

  /// Saves a page, component or layout to the templates; answers how many placeholders it declares.
  public func saveAsTemplate(_ source: TemplateSource, name: String, description: String) async throws -> Int {
    if source.nodes.isEmpty { throw templateProblem("Nothing to save yet — publish this first, then save it as a template.") }
    let placeholders = detectTemplatePlaceholders(source.nodes)
    var data: [String: JSONValue] = [
      "kind": .string(source.kind), "displayName": .string(name.trimmed), "nodes": treeJSON(source.nodes),
    ]
    if !description.trimmed.isEmpty { data["description"] = .string(description.trimmed) }
    if !placeholders.isEmpty { data["placeholders"] = .array(placeholders.map { .object(["name": .string($0)]) }) }
    if let rootID = source.rootID { data["rootId"] = .string(rootID) }
    if let props = source.props, !props.isEmpty { data["props"] = treeJSON(props) }
    if source.kind == "component", source.componentKind == "email" { data["componentKind"] = .string("email") }
    if let slug = source.slug { data["slug"] = .string(slug) }
    if let seo = source.seo { data["seo"] = treeJSON(seo) }
    try await resources("template", data: data)
    return placeholders.count
  }

  /// A component's tree to save: its own design, the properties it declares and where it is placed.
  public func componentSource(_ componentID: String) async throws -> TemplateSource? {
    guard let doc = try await reader.readOnce(["hosts", hostID, "components", componentID]), let nodes = decodeStoredNodes(doc.data["nodes"]) else { return nil }
    return TemplateSource(kind: "component", nodes: nodes, rootID: doc.string("rootId"), props: doc.data["props"] as? [Any], componentKind: doc.string("kind"))
  }

  /// A layout's current version to save: the tree (the slot rides in it) and the properties.
  public func layoutSource(_ layoutID: String, versionID: String?) async throws -> TemplateSource? {
    guard let versionID, let doc = try await reader.readOnce(["hosts", hostID, "layouts", layoutID, "versions", versionID]),
      let nodes = decodeStoredNodes(doc.data["nodes"])
    else { return nil }
    return TemplateSource(kind: "layout", nodes: nodes, props: doc.data["props"] as? [Any])
  }

  /// A page's current version to save, with the address it is on as a suggestion and its search settings.
  public func pageSource(_ screenID: String, versionID: String?) async throws -> TemplateSource? {
    guard let versionID, let version = try await reader.readOnce(["hosts", hostID, "screens", screenID, "versions", versionID]),
      let nodes = decodeStoredNodes(version.data["nodes"])
    else { return nil }
    let screen = try await reader.readOnce(["hosts", hostID, "screens", screenID])
    let slug = ((try await reader.readOnce(["hosts", hostID]))?.data["screens"] as? [String: Any])?[screenID] as? String
    let seo = (screen?.data["seo"] as? [String: Any]).flatMap { $0.isEmpty ? nil : $0 }
    return TemplateSource(kind: "page", nodes: nodes, slug: slug, seo: seo)
  }
}

/// What a page address field says about its value: the refusal, or nil when it can have the address.
public func pageAddressProblem(slug: String, name: String) -> String? {
  if screenSlugHasPathSeparator(slug) { return ContractValues.shared.screenSlugPathSeparatorMessage }
  let composed = normalizeScreenSlug(slug) ?? normalizeScreenSlug(name) ?? "page"
  return reservedScreenRouteSegment(composed).map(reservedScreenRouteMessage)
}
