// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import Foundation

/*
 * The marketplace as a workspace member meets it on the console's Marketplace
 * page: browse (a category, the search and three orders, every one on the
 * query, over what the member's workspace may see), a listing's details,
 * versions and reviews, installing it (each artifact type through its own
 * route; a plugin on this site or the whole workspace), updating and removing
 * a plugin, the installed plugins, and the workspace's licenses. The Kotlin
 * plugin's Marketplace.kt.
 */

let browsePageSize = 24
let listingsCollection = "marketplaceListings"

let marketplaceBrowseScreen = "marketplace.browse"
let marketplaceListingScreen = "marketplace.listing"
let marketplaceInstalledScreen = "marketplace.installed"
let marketplaceLicencesScreen = "marketplace.licenses"
/// Publishing to the marketplace is a spec screen (marketplace.screens.json): what this site and the workspace can publish.
let marketplacePublishScreen = "marketplace.publish"
let marketplacePluginSettingsScreen = "marketplace.plugin-settings"

/// Workspace roles with `plugins.install` (`installPlugins`): the admin tier and editors.
let installRoles: Set<String> = ["owner", "admin", "editor"]

/// Site roles every host install route admits.
let siteInstallRoles: Set<String> = ["admin", "editor"]

// MARK: Ports of the console's pure rules (MarketplaceTests replays their answers)

/// Everyone, as a browse audience scope (`BROWSE_EVERYONE`).
private let everyone = "*"

/// What a reader may see on browse (`browseBase`).
func browseBase(viewerOrgID: String?, publisherID: String? = nil) -> [ListQueryFilter] {
  let scopes = [everyone] + ((viewerOrgID?.isEmpty == false) ? [viewerOrgID!] : [])
  let value = publisherID.map { id in scopes.map { "\($0)|\(id)" } } ?? scopes
  return [ListQueryFilter(op: .arrayContainsAny, path: "browseAudience", value: .array(value.map { .string($0) }))]
}

/// A listing's artifact type, tolerating the legacy `type`/`kind` (`listingArtifactType`).
func listingArtifactType(artifactType: String?, type: String?, kind: String?) -> String {
  if let artifactType, !artifactType.isEmpty { return artifactType }
  if kind == "template" { return "template" }
  if type == "plugin" { return "plugin" }
  return "component"
}

/// Whether browse shows a listing to everyone (`isListingBrowsable`).
func isListingBrowsable(_ listing: ListingRow) -> Bool {
  if listing.hiddenAt || listing.workspaceLocked || listing.visibility == "private" { return false }
  if listing.artifactType != "plugin" { return true }
  return listing.reviewStatus == nil || listing.reviewStatus == "listed" || listing.reviewStatus == "verified"
}

/// A plugin's install state for a site from its two pins (`resolvePluginInstallState`).
struct PluginInstallState: Equatable {
  var scope: InstallTarget?
  var installedVersion: String?
  var shadowed: Bool
  var updateAvailable: Bool
}

func resolvePluginInstallState(latestVersion: String?, hostPinVersion: String?, hostPinned: Bool, orgPinVersion: String?, orgPinned: Bool) -> PluginInstallState {
  let installedVersion = hostPinned ? hostPinVersion : (orgPinned ? orgPinVersion : nil)
  return PluginInstallState(
    scope: hostPinned ? .host : (orgPinned ? .org : nil), installedVersion: installedVersion, shadowed: hostPinned && orgPinned,
    updateAvailable: installedVersion != nil && latestVersion != nil && latestVersion != installedVersion)
}

/// The route that installs an artifact type (`marketplaceInstallEndpoint`).
func marketplaceInstallEndpoint(_ artifactType: String) -> String {
  switch artifactType {
  case "template": "marketplace/install-template"
  case "layout": "marketplace/install-layout"
  case "plugin": "marketplace/install-plugin"
  case "datasetSchema": "marketplace/install-dataset-schema"
  case "emailTemplate": "marketplace/install-email-template"
  case "emailStarter": "marketplace/install-email-starter"
  case "theme": "marketplace/install-theme"
  default: "marketplace/install"
  }
}

/// What an install says it did, for the types that do not change the running site (`marketplaceLandingMessage`).
func marketplaceLandingMessage(_ artifactType: String, _ displayName: String) -> String? {
  switch artifactType {
  case "template", "layout": "Saved \"\(displayName)\" to your Templates — nothing is live until you use it."
  case "emailTemplate": "Saved \"\(displayName)\" as a draft version — activate it in the email designer to start sending it."
  case "emailStarter": "Added \"\(displayName)\" to your Email templates as your own copy — edit it freely, nothing is sent until you send a campaign."
  case "datasetSchema": "Created \"\(displayName)\" as a new, empty dataset."
  case "theme": "Applied \"\(displayName)\" to this site. Setup → Theme has a way back to your previous theme."
  default: nil
  }
}

/// The type's label (`ARTIFACT_TYPE_LABELS`).
func artifactLabel(_ type: String) -> String { ContractValues.shared.artifactTypeLabels[type] ?? "Component" }

/// Where a type installs (`INSTALL_TARGETS`), host-only by default.
func installTargets(_ type: String) -> [InstallTarget] { ContractValues.shared.installTargets[type] ?? [.host] }

// MARK: Rows

private extension FirestoreDocument {
  func text(_ key: String) -> String? {
    guard let value = (data[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
    return value
  }

  func version(_ key: String) -> String? {
    guard let value = data[key], !(value is NSNull) else { return nil }
    if let text = value as? String { return text.isEmpty ? nil : text }
    if let number = value as? NSNumber { return jsNumberString(number.doubleValue) }
    return nil
  }

  func number(_ key: String) -> Double? { (data[key] as? NSNumber)?.doubleValue }

  func present(_ key: String) -> Bool { data[key] != nil && !(data[key] is NSNull) }
}

/// A listing as browse and its page read it.
struct ListingRow: Identifiable, Equatable {
  let id: String
  let name: String
  let description: String
  let artifactType: String
  let category: String?
  let categories: [String]
  let priceUSD: Double
  let latestVersion: String?
  let latestApprovedVersion: String?
  let reviewStatus: String?
  let latestVersionReviewState: String?
  let installCount: Int
  let activeInstalls: Int?
  let ratingAverage: Double?
  let ratingCount: Int
  let profileID: String?
  let imageURL: String?
  let readme: String?
  let homepageURL: String?
  let repositoryURL: String?
  let license: String?
  let visibility: String?
  let hiddenAt: Bool
  let workspaceLocked: Bool
  let deleted: Bool

  var verified: Bool { reviewStatus == "verified" }
  var reviewed: Bool { latestVersionReviewState == "approved" }
  var paid: Bool { priceUSD > 0 }

  /// The version an install gets: a plugin's newest reviewed one, anything else's newest.
  var offeredVersion: String? { artifactType == "plugin" ? latestApprovedVersion : latestVersion }

  init(_ doc: FirestoreDocument) {
    func image(_ key: String) -> String? {
      doc.text(key).flatMap { $0.hasPrefix("https://") || $0.hasPrefix("http://") ? $0 : nil }
    }
    id = doc.id
    name = doc.text("displayName") ?? doc.id
    description = doc.text("description") ?? ""
    artifactType = listingArtifactType(artifactType: doc.text("artifactType"), type: doc.text("type"), kind: doc.text("kind"))
    category = doc.text("category")
    categories = (doc.data["categories"] as? [Any])?.compactMap { $0 as? String } ?? []
    priceUSD = doc.number("priceUsd") ?? 0
    latestVersion = doc.version("latestVersion")
    latestApprovedVersion = doc.version("latestApprovedVersion")
    reviewStatus = doc.text("reviewStatus")
    latestVersionReviewState = doc.text("latestVersionReviewState")
    installCount = Int(doc.number("installCount") ?? 0)
    activeInstalls = doc.number("activeInstalls").map { Int($0) }
    ratingAverage = doc.number("ratingAverage")
    ratingCount = Int(doc.number("ratingCount") ?? 0)
    profileID = doc.text("profileId")
    imageURL = image("previewImageUrl") ?? image("logoUrl")
    readme = doc.text("readme")
    homepageURL = doc.text("homepageUrl")
    repositoryURL = doc.text("repositoryUrl")
    license = doc.text("license")
    visibility = doc.text("visibility")
    hiddenAt = doc.present("hiddenAt")
    workspaceLocked = doc.present("workspaceLockedAt")
    deleted = doc.present("deletedAt")
  }
}

/// "Free" or "$12".
func priceLabel(_ priceUSD: Double) -> String { priceUSD <= 0 ? "Free" : "$" + jsNumberString(priceUSD) }

/// "4.5 ★ (12)" or "Not yet rated".
func ratingLabel(_ listing: ListingRow) -> String {
  guard listing.ratingCount > 0, let average = listing.ratingAverage else { return "Not yet rated" }
  return "\(jsNumberString(average)) ★ (\(listing.ratingCount))"
}

/// One of the three browse orders (`BROWSE_SORTS`).
enum BrowseSort: String, CaseIterable, Identifiable {
  case newest, installed, rated

  var id: String { rawValue }

  var label: String {
    switch self {
    case .newest: "Newest"
    case .installed: "Most installed"
    case .rated: "Highest rated"
    }
  }
}

func browseRequest(viewerOrgID: String?, category: String?, search: String, sort: BrowseSort) -> ListQueryRequest {
  let words = search.split(whereSeparator: { $0.isWhitespace }).map(String.init)
  return ListQueryRequest(
    base: browseBase(viewerOrgID: viewerOrgID),
    clauses: category.map { [ListFilterRequest(field: "category", op: "equals", value: $0)] } ?? [],
    search: words.isEmpty ? nil : words,
    sort: ContractValues.shared.browseSorts[sort.rawValue])
}

func browseQuery(viewerOrgID: String?, category: String?, search: String, sort: BrowseSort, limit: Int = browsePageSize) -> FirestoreQuery {
  planListQuery(ContractValues.shared.marketplaceBrowseQuery, browseRequest(viewerOrgID: viewerOrgID, category: category, search: search, sort: sort))
    .firestoreQuery([listingsCollection], limit: limit)
}

/// One published version, as the listing's version history reads it.
struct ListingVersion: Identifiable, Equatable {
  let version: String
  let changelog: String?
  let publishedAtMs: Double?
  let activeInstalls: Int?
  var id: String { version }
}

/// One review: who, the stars and the words.
struct ReviewRow: Identifiable, Equatable {
  let uid: String
  let name: String
  let rating: Int?
  let comment: String?
  let verifiedInstaller: Bool
  let updatedAtMs: Double?
  var id: String { uid }

  init?(_ doc: FirestoreDocument) {
    if doc.data["hidden"] as? Bool == true { return nil }
    uid = doc.string("uid") ?? doc.id
    name = doc.string("displayName").flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } ?? "A member"
    rating = doc.number("rating").map { Int($0) }
    comment = doc.string("comment").flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
    verifiedInstaller = doc.data["verifiedInstaller"] as? Bool == true
    updatedAtMs = doc.number("updatedAtMs")
  }
}

/// A plugin pin (`hosts/{h}/installs/{id}` or `orgs/{o}/installs/{id}`).
struct InstallPinRow: Identifiable, Equatable {
  let listingID: String
  let name: String
  let version: String?
  let scope: InstallTarget
  var id: String { "\(scope.rawValue)-\(listingID)" }

  init(_ doc: FirestoreDocument, scope: InstallTarget) {
    listingID = doc.string("listingId") ?? doc.id
    name = doc.string("displayName").flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 } ?? (doc.data["manifest"] as? [String: Any])?["name"] as? String ?? doc.id
    version = doc.data["version"].flatMap { value in
      if let text = value as? String { return text }
      if let number = value as? NSNumber { return jsNumberString(number.doubleValue) }
      return nil
    }
    self.scope = scope
  }
}

/// A purchase the workspace holds (`marketplacePurchases`).
struct LicenceRow: Identifiable, Equatable {
  let id: String
  let listingID: String
  let buyerUID: String?
  /// The workspace the license landed in; none (before AGL-2331) licenses every workspace the buyer belongs to.
  let buyerOrgID: String?
  let paidCents: Int
  let createdAt: Date?

  init(_ doc: FirestoreDocument) {
    id = doc.id
    listingID = doc.string("listingId") ?? ""
    buyerUID = doc.string("buyerUid")
    buyerOrgID = doc.string("buyerOrgId").flatMap { $0.isEmpty ? nil : $0 }
    paidCents = Int(doc.number("amountCents") ?? 0) - Int(doc.number("taxCents") ?? 0)
    createdAt = doc.date("createdAt")
  }
}

/// The longest reason a report keeps (the console's and the route's `MAX_REASON_LENGTH`).
let maxReportReasonLength = 1000

/// The Licensed-to choice that means a purchase naming no workspace (`EVERY_WORKSPACE`).
let everyWorkspace = "every"

/// "Bought by you": the signed-in person's own live purchases across every workspace (`MINE_LICENCE_QUERY` over
/// `licenceBase`), narrowed to the workspace each landed in when one is chosen; `everyWorkspace` asks for those that name
/// none, as `mineLicenceClauses` reads it.
func boughtByYouQuery(uid: String, licensedTo: String?) -> FirestoreQuery {
  let clauses: [ListFilterRequest] =
    switch licensedTo {
    case nil: []
    case everyWorkspace?: [ListFilterRequest(field: "buyerOrgId", op: "isEmpty", value: "")]
    case let orgID?: [ListFilterRequest(field: "buyerOrgId", op: "equals", value: orgID)]
    }
  return planListQuery(
    ContractValues.shared.mineLicenceQuery,
    ListQueryRequest(
      base: [ListQueryFilter(op: .equal, path: "buyerUid", value: .string(uid)), ListQueryFilter(op: .equal, path: "refundedAt", value: .null)],
      clauses: clauses)
  ).firestoreQuery(["marketplacePurchases"], limit: 100)
}

/// Who bought a license the workspace holds, as the console's table says it.
func boughtByLabel(_ licence: LicenceRow, uid: String) -> String { licence.buyerUID == uid ? "You" : "A colleague" }

/// Which workspace one of your purchases licenses, as the console's table says it.
func licensedToLabel(_ licence: LicenceRow, orgID: String?, names: [String: String]) -> String {
  guard let licensed = licence.buyerOrgID else { return "Every workspace you belong to" }
  return licensed == orgID ? "This workspace" : names[licensed] ?? licensed
}

/// "This workspace": its live purchases, by document id (`HELD_LICENCE_QUERY` over `licenceBase`).
func licencesQuery(orgID: String) -> FirestoreQuery {
  planListQuery(
    ContractValues.shared.heldLicenceQuery,
    ListQueryRequest(
      base: [ListQueryFilter(op: .equal, path: "buyerOrgId", value: .string(orgID)), ListQueryFilter(op: .equal, path: "refundedAt", value: .null)],
      clauses: [])
  ).firestoreQuery(["marketplacePurchases"], limit: 100)
}

// MARK: Writes

/// What an install answered, in a person's words.
struct InstallOutcome: Equatable {
  let message: String
  let warning: String?
}

struct MarketplaceAPI {
  let api: ConsoleAPIClient

  /// Installs `listing` on `hostID` (or, for a plugin with `scope` org, every site of the workspace).
  func install(_ listing: ListingRow, hostID: String, scope: InstallTarget?) async throws -> InstallOutcome {
    var body: [String: Any?] = ["listingId": listing.id, "hostId": hostID]
    if scope == .org { body["scope"] = "org" }
    if listing.artifactType == "plugin" { body["version"] = listing.latestApprovedVersion }
    let answer = try await api.request("/api/" + marketplaceInstallEndpoint(listing.artifactType), method: .post, body: JSONValue.from(body))
    let upgraded = answer?["upgraded"]?.boolValue == true || answer?["updated"]?.boolValue == true
    let version = answer?["version"].flatMap { value -> String? in
      if let text = value.stringValue { return text }
      if case .number(let number) = value { return jsNumberString(number) }
      return nil
    }
    let message =
      marketplaceLandingMessage(listing.artifactType, listing.name)
      ?? ((upgraded ? "Updated \"\(listing.name)\"" : "Installed \"\(listing.name)\"") + (version.map { " (v\($0))" } ?? "") + ".")
    return InstallOutcome(message: message, warning: answer?["hostAbiWarning"]?.stringValue)
  }

  /// Installs (or moves to the newest approved version) a plugin's pin: on `hostID` (`scope` host), or for the whole
  /// workspace through that site (`scope` org). The console's plugin pages send no version; the route picks the newest.
  func installPlugin(listingID: String, hostID: String, scope: InstallTarget) async throws -> InstallOutcome {
    var body: [String: Any?] = ["listingId": listingID, "hostId": hostID]
    if scope == .org { body["scope"] = "org" }
    let answer = try await api.request("/api/marketplace/install-plugin", method: .post, body: JSONValue.from(body))
    return InstallOutcome(message: "", warning: answer?["hostAbiWarning"]?.stringValue)
  }

  /// Removes a plugin's pin from `hostID`, or from the workspace with `scope` org.
  func uninstall(listingID: String, hostID: String, scope: InstallTarget) async throws {
    var body: [String: Any?] = ["listingId": listingID, "hostId": hostID, "action": "uninstall"]
    if scope == .org { body["scope"] = "org" }
    try await api.request("/api/marketplace/install-plugin", method: .post, body: JSONValue.from(body))
  }

  /// The listing's published versions, newest first (`/api/marketplace/listing-versions`).
  func versions(listingID: String) async -> [ListingVersion] {
    guard let answer = try? await api.request("/api/marketplace/listing-versions", query: [("listingId", listingID)]), case .array(let entries)? = answer["versions"] else {
      return []
    }
    return entries.compactMap { entry in
      guard case .object(let row) = entry, let version = row["version"]?.stringValue else { return nil }
      func number(_ key: String) -> Double? { if case .number(let value)? = row[key] { return value } else { return nil } }
      let changelog = row["changelog"]?.stringValue.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
      return ListingVersion(version: version, changelog: changelog, publishedAtMs: number("publishedAtMs"), activeInstalls: number("activeInstalls").map { Int($0) })
    }
  }

  /// Rates and reviews a listing (1–5, or only words).
  func review(listingID: String, rating: Int?, comment: String) async throws {
    let words = comment.trimmingCharacters(in: .whitespacesAndNewlines)
    try await api.request(
      "/api/marketplace/reviews", method: .post,
      body: JSONValue.from(["listingId": listingID, "rating": rating, "comment": words.isEmpty ? nil : words] as [String: Any?]))
  }

  func deleteReview(listingID: String) async throws {
    try await api.request("/api/marketplace/reviews", method: .delete, body: JSONValue.from(["listingId": listingID]))
  }

  /// Reports a listing, or one of its reviews (`reviewUID`, the reviewer's uid), to staff. Reporting again updates the report.
  func report(listingID: String, reason: String, reviewUID: String? = nil) async throws {
    var body: [String: Any?] = ["listingId": listingID, "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines)]
    if let reviewUID { body["reviewUid"] = reviewUID }
    try await api.request("/api/marketplace/report", method: .post, body: JSONValue.from(body))
  }
}
