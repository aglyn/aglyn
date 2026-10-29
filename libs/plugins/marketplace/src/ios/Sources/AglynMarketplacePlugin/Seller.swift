// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynSite
import Foundation

/*
 * The seller side of the marketplace as a publisher meets it on the console's Marketplace page: the public profile (a handle, a
 * name, a logo, a bio and the ways to reach the publisher), the listings they sell and what can be done to each, payouts through
 * Stripe Connect, and the sales ledger. A publisher is a workspace, so everything is keyed by the org. The Kotlin plugin's Seller.kt.
 */

let marketplaceSellScreen = "marketplace.sell"

/// The listings a workspace publishes: `marketplaceListings` filtered by `profileId`, which is the org id (not a uid).
func sellerListingsQuery(orgID: String) -> FirestoreQuery { FirestoreQuery([listingsCollection], equals: [(field: "profileId", value: orgID)]) }

/// The workspace's sales: `marketplacePurchases` filtered by `sellerOrgId`, which the rules read the query for.
func sellerSalesQuery(orgID: String) -> FirestoreQuery { FirestoreQuery(["marketplacePurchases"], equals: [(field: "sellerOrgId", value: orgID)]) }

/// The publisher profile document: `publisherProfiles/{orgId}`.
func publisherProfilePath(orgID: String) -> [String] { ["publisherProfiles", orgID] }

/// The entity that holds the sales-tax registration marketplace sales are remitted under (`PLATFORM_BRAND_LEGAL_NAME`'s default).
let platformLegalName = "Aglyn LLC"

/// One of the workspace's listings, as the Your listings card lists it.
struct SellerListing: Identifiable, Equatable {
  let id: String
  let displayName: String
  let latestVersion: String?
  let priceUsd: Double
  let visibility: String?
  let unpublished: Bool
  let hasPreview: Bool
  /// `plugin`, `component`, `layout`, `template`…: a plugin has a bundle and a private audience; the rest do not.
  let artifactType: String
  let source: [String: Any]

  var isPrivate: Bool { visibility == "private" }
  var isPlugin: Bool { artifactType == "plugin" }

  /// "v3 · $5 · has preview · unpublished".
  var subtitle: String {
    var text = "v\(latestVersion ?? "")"
    text += priceUsd > 0 ? " · $" + jsNumberString(priceUsd) : " · free"
    if hasPreview { text += " · has preview" }
    if unpublished { text += " · unpublished" }
    return text
  }

  init(_ doc: FirestoreDocument) {
    id = doc.id
    displayName = doc.string("displayName") ?? ""
    latestVersion = (doc.data["latestVersion"] as? NSNumber).map { jsNumberString($0.doubleValue) } ?? doc.string("latestVersion")
    priceUsd = (doc.data["priceUsd"] as? NSNumber)?.doubleValue ?? 0
    visibility = doc.string("visibility")
    unpublished = doc.data["deletedAt"] != nil && !(doc.data["deletedAt"] is NSNull)
    hasPreview = !(doc.string("previewImageUrl") ?? "").isEmpty
    artifactType = listingArtifactType(artifactType: doc.string("artifactType"), type: doc.string("type"), kind: doc.string("kind"))
    source = doc.data
  }

  static func == (lhs: SellerListing, rhs: SellerListing) -> Bool { lhs.id == rhs.id && lhs.subtitle == rhs.subtitle && lhs.displayName == rhs.displayName }

  /// The text of a field, or empty: the editors read a stored URL or word the way the console's inputs do.
  func text(_ key: String) -> String { source[key] as? String ?? "" }

  /// The listing's first category: `categories[0]` of a listing, or the older single `category`.
  var category: String { (source["categories"] as? [Any])?.first as? String ?? text("category") }
  /// The gallery under the listing's body, in order.
  var screenshots: [String] { (source["screenshots"] as? [Any])?.compactMap { $0 as? String } ?? [] }
}

/// How many screenshots a listing's gallery holds (the console editor's `MAX_SCREENSHOTS`).
let maxListingScreenshots = 6

/// What the console says a listing's logo should be (`LISTING_LOGO_HINT`).
let listingLogoHint = "Recommended: a square PNG or SVG, at least 256×256 — listings are shown as square tiles."

/// What a picture chosen for a listing stores, as the console's picker hands it back: the path the CDN serves the file from,
/// else its address.
func listingMediaValue(_ chosen: ChosenMedia) -> String { chosen.item.cdnPath ?? chosen.item.url ?? "" }

/// The gallery after adding `picked`: a file already in it, or one past the cap, changes nothing (the console's own rule).
func addingScreenshot(_ picked: String, to current: [String]) -> [String] {
  current.count >= maxListingScreenshots || current.contains(picked) ? current : current + [picked]
}

/// "$12.34" from cents (`$${(cents / 100).toFixed(2)}`).
func dollars(_ cents: Double) -> String {
  let whole = Int64((cents.isFinite ? cents : 0).rounded())
  let sign = whole < 0 ? "-" : ""
  let magnitude = abs(whole)
  let remainder = String(magnitude % 100)
  return "\(sign)$\(magnitude / 100).\(String(repeating: "0", count: 2 - remainder.count))\(remainder)"
}

/// The first line a Payouts card says about the arrangement, per where it stands.
func payoutsSentence(_ readiness: PayoutReadiness) -> String {
  switch readiness {
  case .ready: "Payouts are enabled — paid listings transfer to your Stripe account automatically (platform fee 20%, 30% on the Free plan)."
  case .unknown:
    "Your Stripe account is connected. We haven’t checked whether payouts are released yet — recheck to confirm. The platform fee is 20% per sale (30% on the Free plan)."
  case .blocked, .unverified: "The platform fee is 20% per sale (30% on the Free plan)."
  default: "Connect a Stripe account to sell components. The platform fee is 20% per sale (30% on the Free plan)."
  }
}

/// The button under it.
func payoutsButton(_ readiness: PayoutReadiness) -> String {
  switch readiness {
  case .ready: "Payouts enabled — recheck status"
  case .blocked: "Finish payout setup in Stripe"
  case .unverified: "Reconnect Stripe to verify"
  case .unknown: "Recheck payout status"
  default: "Set up payouts"
  }
}

/// The Marketplace Publisher Agreement a save agrees to (AGL-4105), sent as the console sends it, `{ version, accepted: true }`.
/// A seller screen makes one only once its box is ticked, and each save makes its own.
struct PublisherAgreementConsent: Equatable {
  let version: String

  /// The version in force, as the contracts carry the console's `PUBLISHER_AGREEMENT_VERSION`.
  static var current: PublisherAgreementConsent { PublisherAgreementConsent(version: ContractValues.shared.publisherAgreementVersion) }

  var body: [String: Any] { ["version": version, "accepted": true] }
}

/// What `/api/marketplace/connect` answers.
struct ConnectAnswer: Equatable {
  let chargesEnabled: Bool
  let payoutsEnabled: Bool?
  let url: String?
  let dashboardURL: String?
}

/// The routes the seller cards call: the console's own, each answering in the sentence the card shows.
struct SellerAPI {
  let api: ConsoleAPIClient
  let orgID: String

  /// Saves the public profile; the handle is claimed on the server, so two workspaces cannot both win it.
  func saveProfile(_ fields: [String: String], agreement: PublisherAgreementConsent) async throws {
    var body: [String: Any?] = ["orgId": orgID, "agreement": agreement.body]
    for (key, value) in fields { body[key] = value }
    try await api.request("/api/marketplace/publisher-profile", method: .post, body: JSONValue.from(body))
  }

  /// Starts, or rechecks, Stripe Connect onboarding.
  func connect() async throws -> ConnectAnswer {
    let answer = try await api.request("/api/marketplace/connect", method: .post, body: JSONValue.from(["orgId": orgID]))
    return ConnectAnswer(
      chargesEnabled: answer?["chargesEnabled"]?.boolValue == true, payoutsEnabled: answer?["payoutsEnabled"]?.boolValue,
      url: answer?["url"]?.stringValue, dashboardURL: answer?["dashboardUrl"]?.stringValue)
  }

  func setVisibility(_ listingID: String, _ visibility: String, agreement: PublisherAgreementConsent) async throws {
    try await api.request(
      "/api/marketplace/publish-plugin", method: .post,
      body: JSONValue.from([
        "action": "set-visibility", "listingId": listingID, "visibility": visibility, "agreement": agreement.body,
      ]))
  }

  /// Unpublishes, or republishes, a listing: server-side, because browse reads each listing's audience, which only the server derives.
  func setPublished(_ listingID: String, published: Bool, agreement: PublisherAgreementConsent) async throws {
    try await api.request(
      "/api/marketplace/publish-plugin", method: .post,
      body: JSONValue.from([
        "action": "set-published", "listingId": listingID, "published": published, "agreement": agreement.body,
      ]))
  }

  /// The listing's words, links and screenshots; a field left out is left as it is, and so is the preview.
  func updateListing(
    _ listingID: String, fields: [String: String], category: String, screenshots: [String], agreement: PublisherAgreementConsent
  ) async throws {
    var body: [String: Any?] = [
      "action": "update-listing", "listingId": listingID, "categories": category.isEmpty ? [String]() : [category], "screenshots": screenshots,
      "agreement": agreement.body,
    ]
    for (key, value) in fields { body[key] = value }
    try await api.request("/api/marketplace/publish-plugin", method: .post, body: JSONValue.from(body))
  }

  /// Sets the preview image to a file from the media library, or removes it when `url` is empty: the route of its own
  /// the console's editor calls, because the preview is not a content field.
  func setPreviewImage(_ listingID: String, url: String, agreement: PublisherAgreementConsent) async throws {
    if url.isEmpty {
      try await api.request(
        "/api/marketplace/preview-image", method: .delete, body: JSONValue.from(["listingId": listingID, "agreement": agreement.body]))
    } else {
      try await api.request(
        "/api/marketplace/preview-image", method: .post,
        body: JSONValue.from(["listingId": listingID, "url": url, "agreement": agreement.body]))
    }
  }
}
