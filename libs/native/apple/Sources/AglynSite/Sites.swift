// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
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

/// The Created filter (the console's Created range, `SITE_FILTER_FIELDS`): one condition on the site's own `createdAt`
/// and one day (`yyyy-MM-dd`). A range orders the list by the field it ranges over, so under it the sites run newest
/// first; otherwise by name.
public struct SiteCreatedFilter: Equatable, Sendable {
  public var op: String
  public var day: String

  public init(op: String, day: String) {
    self.op = op
    self.day = day
  }

  /// The conditions the declaration offers on Created, in its order.
  public static var operators: [String] {
    ContractValues.shared.siteListDeclaration.fields.first { $0.column == "createdAt" }?.operators ?? []
  }

  public var clause: ListFilterRequest { ListFilterRequest(field: "createdAt", op: op, value: day) }

  /// "Created after Nov 1, 2026", as the console's chip says it.
  public var label: String {
    let header = ContractValues.shared.siteFilterHeaders["createdAt"] ?? "Created"
    return "\(header) \(listFilterOperatorLabel(op)) \(shownDay)"
  }

  private var shownDay: String {
    let parse = DateFormatter()
    parse.calendar = Calendar(identifier: .gregorian)
    parse.locale = Locale(identifier: "en_US_POSIX")
    parse.dateFormat = "yyyy-MM-dd"
    guard let date = parse.date(from: day) else { return day }
    return date.formatted(date: .abbreviated, time: .omitted)
  }
}

public func sitesRequest(
  orgID: String, search: String, domain: SiteDomainFilter, created: SiteCreatedFilter? = nil
) -> ListQueryRequest {
  let typed = search.trimmingCharacters(in: .whitespacesAndNewlines)
  var clauses = domain.value.map { [ListFilterRequest(field: "hasCustomDomain", op: "is", value: $0)] } ?? []
  if let created { clauses.append(created.clause) }
  return ListQueryRequest(
    base: [ListQueryFilter(op: .equal, path: "orgId", value: .string(orgID))], clauses: clauses,
    search: typed.isEmpty ? nil : [typed])
}

/// The sites list's reader query: the plan over the member's own rows, one row past the window.
public func sitesQuery(
  uid: String, orgID: String, search: String, domain: SiteDomainFilter, created: SiteCreatedFilter? = nil, limit: Int
) -> FirestoreQuery {
  sitesPlan(orgID: orgID, search: search, domain: domain, created: created)
    .firestoreQuery(["users", uid, "hostMemberships"], limit: limit)
}

/// The plan the list runs, with what it refused and why.
public func sitesPlan(orgID: String, search: String, domain: SiteDomainFilter, created: SiteCreatedFilter?)
  -> ListQueryPlan
{
  planListQuery(
    ContractValues.shared.siteListDeclaration,
    sitesRequest(orgID: orgID, search: search, domain: domain, created: created))
}

/// The list as it is drawn (the console's `SitesCards`): the sites the person pinned in this workspace lead it, in the
/// order pinned, then the query's own rows. A search or a filter is the query's answer and keeps its order; its pinned
/// sites show their pin where they fall. A pinned site the window has not reached yet still leads, from `pinnedRows`.
public func sitesShown(
  _ rows: [SiteRow], pinned: [String], pinnedRows: [SiteRow], filtering: Bool
) -> [SiteRow] {
  if filtering || rows.isEmpty || pinned.isEmpty { return rows }
  let lead = pinned.compactMap { id in rows.first { $0.id == id } ?? pinnedRows.first { $0.id == id } }
  let leading = Set(lead.map(\.id))
  return lead + rows.filter { !leading.contains($0.id) }
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
  /// The site's custom domain, as the membership row mirrors it (`cname`); older rows lack it.
  public let cname: String?

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
    cname = doc.string("cname").flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
  }

  /// The address a list shows under the name, as the console's Sites list does: the custom domain, else the platform
  /// address.
  public var shownAddress: String? { cname ?? HostStatus.siteAddress(subdomain) }

  /// The same, once the host document is read: its own custom domain wins, so a membership row written before the
  /// mirror carried `cname` still shows the address the live site answers on.
  public func shownAddress(hostCname: String?) -> String? {
    hostCname.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } ?? shownAddress
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
  public var created: SiteCreatedFilter? { didSet { if oldValue != created { restart() } } }
  /// The pinned sites' own rows, read beside the window so a pin the window has not reached yet still leads.
  public private(set) var pinnedRows: [SiteRow] = []

  /// A search or a filter is on: the list is the query's answer, in its order.
  public var filtering: Bool {
    !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || domain != .all || created != nil
  }

  /// What the query could not take, in the planner's words (a Created day that is not a day).
  public var refused: [ListQueryRefusal] {
    sitesPlan(orgID: orgID, search: search, domain: domain, created: created).refused
  }

  @ObservationIgnored private var reader: FirestoreReader?
  @ObservationIgnored private var uid = ""
  @ObservationIgnored private var orgID = ""
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var pinnedListeners: [FirestoreListening] = []
  @ObservationIgnored private var pinnedFor: [String] = []
  @ObservationIgnored private var pinnedAnswers: [Int: [SiteRow]] = [:]
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
    pinnedListeners.forEach { $0.remove() }
    pinnedListeners = []
    pinnedFor = []
  }

  /// Reads the pinned sites' own membership rows (thirty to a query, Firestore's `in` limit), each kept only while it
  /// is still in this workspace.
  public func watchPinned(_ ids: [String]) {
    guard ids != pinnedFor else { return }
    pinnedFor = ids
    pinnedListeners.forEach { $0.remove() }
    pinnedListeners = []
    guard let reader, !uid.isEmpty, !ids.isEmpty else {
      pinnedRows = []
      return
    }
    pinnedAnswers = [:]
    let chunks = stride(from: 0, to: ids.count, by: 30).map { Array(ids[$0..<min($0 + 30, ids.count)]) }
    for (index, chunk) in chunks.enumerated() {
      let query = FirestoreQuery(
        ["users", uid, "hostMemberships"],
        filters: [ListQueryConstraint(path: ContractValues.shared.listQueryIdPath, op: .in, value: chunk)])
      pinnedListeners.append(
        reader.listen(query) { [weak self] result in
          guard let self, self.pinnedFor == ids, case .success(let docs) = result else { return }
          self.pinnedAnswers[index] = docs.filter { $0.string("orgId") == self.orgID }.map(SiteRow.init)
          self.pinnedRows = self.pinnedAnswers.keys.sorted().flatMap { self.pinnedAnswers[$0] ?? [] }
        })
    }
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
    let query = sitesQuery(uid: uid, orgID: orgID, search: search, domain: domain, created: created, limit: window + 1)
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

/// The create-site route's answer, or its refusal with the addresses it suggests instead, or its refusal of the starter
/// picked, which is about the pick and not the name.
public enum CreateSiteResult: Equatable, Sendable {
  case created(hostID: String, subdomain: String)
  case refused(message: String, suggestions: [String])
  case pickRefused(SiteStarterPickRefused)
}

/// What a site starts from: a style, or a starter from the marketplace. Nothing in Create site is chosen for anyone, so a
/// create names one of the two.
public enum SiteStart: Equatable, Sendable {
  case style(String)
  case starter(listingID: String)
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

/// Whether Create site can go ahead: a name, an address the route's pattern takes, and a style the person picked.
/// Nothing in Create site is chosen for anyone (AGL-4049), so until a style is picked the button stays off. The starter
/// site has no "Pick for me": that card is the AI start's, and the route refuses it here.
public func canCreateSite(name: String, subdomain: String, style: String?) -> Bool {
  !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && isValidSubdomain(subdomain)
    && SiteStyles.all.contains { $0.id == style }
}

/// Whether Create site can go ahead from a starter: a name, an address the route's pattern takes, and a starter the site
/// can be created from here. A price not paid waits to be bought, and an AI starter goes on to its questions, which the
/// app does not ask: the console's Create site does both.
public func canCreateSite(name: String, subdomain: String, pick: SiteStarterSummary?, owned: Bool? = nil) -> Bool {
  !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && isValidSubdomain(subdomain)
    && siteStarterPickBlock(pick, owned: owned) == nil && pick?.mode == .base
}

/// What Create site sends. `start: "starter"` is the console's own "Create the
/// starter site" answer: the site is born with the starter website in the same
/// request. Without it the server may create the site empty to offer the guided
/// AI start (`guidedStart` in its answer), and the app has no such start to land
/// on, which would leave an empty site. `style` is the one the person chose: the
/// site starts in its look, and the route records it on the site.
public func createSiteBody(orgID: String, name: String, subdomain: String, style: String, preview: Bool = false) -> JSONValue {
  [
    "displayName": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
    "subdomain": .string(subdomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()),
    "orgId": .string(orgID),
    "start": "starter",
    "style": .string(style),
    "preview": .bool(preview),
  ]
}

/// What Create site sends for a starter from the marketplace, as the console's own "Choose your starter" does: the
/// listing, with no style, since the starter brings its own look.
public func createSiteBody(
  orgID: String, name: String, subdomain: String, starter listingID: String, preview: Bool = false
) -> JSONValue {
  [
    "displayName": .string(name.trimmingCharacters(in: .whitespacesAndNewlines)),
    "subdomain": .string(subdomain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()),
    "orgId": .string(orgID),
    "start": "starter",
    "starter": ["listingId": .string(listingID)],
    "preview": .bool(preview),
  ]
}

/// "Start in preview" (AGL-4086)'s default for how a site starts, as the console's `sitePreviewStartsOn`: on for a site
/// brought in from somewhere else, off for everything else. The app's Create site always starts a starter site, so off
/// until the person turns it on.
public func sitePreviewStartsOn(_ start: String?) -> Bool { start == "import" }

/// What "Start in preview" says under it (the console's `StartInPreviewSwitch`).
public func startInPreviewCaption(_ on: Bool) -> String {
  on
    ? "Only you and your team can see the site until you make it public in Admin → Error pages. Visitors see \"Coming soon\"."
    : "Visitors can see the site as soon as it has a page."
}

/// `6 of 10 sites · Pro plan` beside Create site (the console's `describeSiteAllowance`, AGL-2166): nil while the plan or
/// the sites are still being read, so a placeholder count never reads as a measurement. `limit` nil is no known cap
/// ("6 sites"); an infinite or negative one is Unlimited.
public func describeSiteAllowance(used: Int, limit: Double?, planLabel: String?, ready: Bool) -> String? {
  guard ready, let planLabel, !planLabel.isEmpty else { return nil }
  let cap: String? = limit.map { !$0.isFinite || $0 < 0 ? "Unlimited" : String(Int($0)) }
  let sites = cap.map { "\(used) of \($0) site\($0 == "1" ? "" : "s")" } ?? "\(used) site\(used == 1 ? "" : "s")"
  return "\(sites) · \(planLabel) plan"
}

/// The plan and its site cap, as `/api/orgs/entitlements` answers for a workspace: the effective plan's label, and
/// `quotas.hostLimit` (a null there is the route's JSON for an unlimited cap).
public struct SiteAllowancePlan: Equatable, Sendable {
  public let planLabel: String
  public let hostLimit: Double?

  public init(planLabel: String, hostLimit: Double?) {
    self.planLabel = planLabel
    self.hostLimit = hostLimit
  }

  public init?(_ body: JSONValue) {
    guard let plan = body["plan"]?.stringValue else { return nil }
    planLabel = BundleWords.planLabels[plan] ?? plan.capitalized
    let quotas = body["quotas"]
    if let limit = quotas?["hostLimit"]?.numberValue {
      hostLimit = limit
    } else if quotas?["hostLimit"] != nil {
      hostLimit = .infinity
    } else {
      hostLimit = nil
    }
  }
}

/// `POST /api/hosts/create`, the console's own Create site.
public func createSite(
  _ api: ConsoleAPIClient, orgID: String, name: String, subdomain: String, start: SiteStart, preview: Bool = false
) async throws -> CreateSiteResult {
  let body: JSONValue
  var listing = ""
  switch start {
  case .style(let style): body = createSiteBody(orgID: orgID, name: name, subdomain: subdomain, style: style, preview: preview)
  case .starter(let listingID):
    body = createSiteBody(orgID: orgID, name: name, subdomain: subdomain, starter: listingID, preview: preview)
    listing = listingID
  }
  do {
    let answer = try await api.request("/api/hosts/create", method: .post, body: body)
    return .created(hostID: answer.field("hostId") ?? "", subdomain: answer.field("subdomain") ?? subdomain)
  } catch let error as ConsoleAPIError where error.status != 0 {
    if let refused = readSiteStarterPickRefusal(status: error.status, payload: error.body, listingID: listing) {
      return .pickRefused(refused)
    }
    let suggestions = error.body?["suggestions"]?.arrayValue?.compactMap(\.stringValue) ?? []
    return .refused(message: error.message, suggestions: suggestions)
  }
}

/// `POST /api/hosts/create` in the style the person chose.
public func createSite(_ api: ConsoleAPIClient, orgID: String, name: String, subdomain: String, style: String)
  async throws -> CreateSiteResult
{
  try await createSite(api, orgID: orgID, name: name, subdomain: subdomain, start: .style(style))
}
