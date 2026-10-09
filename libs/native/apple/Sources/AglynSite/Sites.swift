// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

// The workspace's sites, as the console's Sites cards list them: one query on
// the member's own `users/{uid}/hostMemberships` rows (SITE_LIST_DECLARATION,
// the workspace as its base, the search and the custom-domain filter as
// clauses on it), each row joined to its site document for the status pill.

public let sitesPageSize = 30

/// The chips above the list: every site, or only those with or without a custom domain.
public enum SiteDomainFilter: String, CaseIterable, Sendable {
  case all, connected, none

  public var label: String {
    switch self {
    case .all: "All"
    case .connected: "Custom domain"
    case .none: "No custom domain"
    }
  }

  public var value: String? {
    switch self {
    case .all: nil
    case .connected: "true"
    case .none: "false"
    }
  }
}

public func sitesRequest(orgID: String, search: String, domain: SiteDomainFilter) -> ListQueryRequest {
  let typed = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return ListQueryRequest(
    base: [ListQueryFilter(op: .equal, path: "orgId", value: .string(orgID))],
    clauses: domain.value.map { [ListFilterRequest(field: "hasCustomDomain", op: "is", value: $0)] } ?? [],
    search: typed.isEmpty ? nil : [typed])
}

/// The sites list's reader query: the plan over the member's own rows, one row past the window.
public func sitesQuery(uid: String, orgID: String, search: String, domain: SiteDomainFilter, limit: Int)
  -> FirestoreQuery
{
  planListQuery(ContractValues.shared.siteListDeclaration, sitesRequest(orgID: orgID, search: search, domain: domain))
    .firestoreQuery(["users", uid, "hostMemberships"], limit: limit)
}

/// One row of the list: the membership row's own fields.
public struct SiteRow: Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let subdomain: String?
  public let role: String?
  public let hasCustomDomain: Bool
  public let favicon: String?
  public let createdAt: Date?

  public init(_ doc: FirestoreDocument) {
    let subdomain = doc.string("subdomain").flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
    id = doc.id
    name = doc.string("displayName").flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
      ?? subdomain ?? doc.id
    self.subdomain = subdomain
    role = doc.string("role")
    hasCustomDomain = doc.bool("hasCustomDomain") == true
    favicon = doc.string("favicon").flatMap { $0.isEmpty ? nil : $0 }
    createdAt = doc.date("createdAt")
  }
}

/// The workspace's sites: the search, the chip, the rows read so far and
/// whether more are left. A live window that grows a page at a time.
@MainActor
@Observable
public final class SitesListModel {
  public private(set) var rows: LiveValue<[SiteRow]> = .loading
  public private(set) var hasMore = false
  public var search = "" { didSet { if oldValue != search { restart() } } }
  public var domain = SiteDomainFilter.all { didSet { if oldValue != domain { restart() } } }

  @ObservationIgnored private var reader: FirestoreReader?
  @ObservationIgnored private var uid = ""
  @ObservationIgnored private var orgID = ""
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var limit = sitesPageSize

  public init() {}

  public func start(_ reader: FirestoreReader, uid: String, orgID: String) {
    self.reader = reader
    self.uid = uid
    self.orgID = orgID
    restart()
  }

  public func loadMore() {
    guard hasMore else { return }
    limit += sitesPageSize
    listen(keep: true)
  }

  public func refresh() { listen(keep: true) }

  public func stop() {
    listener?.remove()
    listener = nil
  }

  private func restart() {
    limit = sitesPageSize
    listen(keep: false)
  }

  private func listen(keep: Bool) {
    listener?.remove()
    if !keep { rows = .loading }
    guard let reader, !orgID.isEmpty else { return }
    let window = limit
    let query = sitesQuery(uid: uid, orgID: orgID, search: search, domain: domain, limit: window + 1)
    listener = reader.listen(query) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.hasMore = docs.count > window
        self.rows = .ready(docs.prefix(window).map(SiteRow.init))
      case .failure:
        self.hasMore = false
        self.rows = .failed("Sites could not be loaded. Check the connection and try again.")
      }
    }
  }
}

/// The create-site route's answer, or its refusal with the addresses it suggests instead.
public enum CreateSiteResult: Equatable, Sendable {
  case created(hostID: String, subdomain: String)
  case refused(message: String, suggestions: [String])
}

/// The site-address rule the create route holds (`SUBDOMAIN_PATTERN`).
public func isValidSubdomain(_ subdomain: String) -> Bool {
  subdomain.range(of: "^[a-z0-9][a-z0-9-]{2,29}$", options: .regularExpression) != nil
}

/// A starting address from a site's name, as the create dialog fills it:
/// lower case, every run of other characters one hyphen, at most 30
/// characters. The route is the judge; a taken or reserved address comes back
/// with suggestions.
public func suggestSubdomain(_ name: String) -> String {
  var slug = name.lowercased()
    .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
    .replacingOccurrences(of: "-{2,}", with: "-", options: .regularExpression)
    .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
  slug = String(slug.prefix(30))
  while slug.hasSuffix("-") { slug.removeLast() }
  return slug
}

/// What a person may type into the address field: lower-case letters, digits and hyphens, 30 at most.
public func cleanSubdomainInput(_ text: String) -> String {
  String(text.lowercased().filter { ($0.isLetter && $0.isASCII) || ($0.isNumber && $0.isASCII) || $0 == "-" }.prefix(30))
}

/// `POST /api/hosts/create`, the console's own Create site.
public func createSite(_ api: ConsoleAPIClient, orgID: String, name: String, subdomain: String) async throws
  -> CreateSiteResult
{
  do {
    let answer = try await api.request(
      "/api/hosts/create", method: .post,
      body: .from([
        "displayName": name.trimmingCharacters(in: .whitespacesAndNewlines),
        "subdomain": subdomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
        "orgId": orgID,
      ]))
    return .created(hostID: answer.field("hostId") ?? "", subdomain: answer.field("subdomain") ?? subdomain)
  } catch let error as ConsoleAPIError where error.status != 0 {
    let suggestions = error.body?["suggestions"]?.arrayValue?.compactMap(\.stringValue) ?? []
    return .refused(message: error.message, suggestions: suggestions)
  }
}
