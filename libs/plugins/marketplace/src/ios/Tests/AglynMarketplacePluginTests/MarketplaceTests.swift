// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynScreens
import XCTest

@testable import AglynMarketplacePlugin

/// The console's own answers (function-cases.generated.json) for the marketplace's rules: the Kotlin `MarketplaceCasesTest`.
private func functionCases(_ name: String) throws -> [(args: [Any], result: Any)] {
  var url = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { url.deleteLastPathComponent() }
  url.appendPathComponent("native/contracts/function-cases.generated.json")
  let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
  let function = (root?["functions"] as? [String: Any])?[name] as? [String: Any]
  let cases = try XCTUnwrap(function?["cases"] as? [[String: Any]], "no cases for \(name)")
  XCTAssertFalse(cases.isEmpty, name)
  return cases.map { ($0["args"] as? [Any] ?? [], $0["result"] ?? NSNull()) }
}

private func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
  try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed))
}

private func string(_ value: Any?) -> String? { value is NSNull ? nil : value as? String }

final class MarketplaceTests: XCTestCase {
  func testBrowseBase() throws {
    for item in try functionCases("browseBase") {
      let expected = try decode([ListQueryFilter].self, item.result)
      XCTAssertEqual(browseBase(viewerOrgID: string(item.args[0]), publisherID: item.args.count > 1 ? string(item.args[1]) : nil), expected, "\(item.args)")
    }
  }

  func testArtifactTypeAndBrowsable() throws {
    for item in try functionCases("listingArtifactType") {
      let listing = try XCTUnwrap(item.args[0] as? [String: Any])
      XCTAssertEqual(
        listingArtifactType(artifactType: string(listing["artifactType"]), type: string(listing["type"]), kind: string(listing["kind"])), item.result as? String,
        "\(item.args)")
    }
    for item in try functionCases("isListingBrowsable") {
      let listing = ListingRow(FirestoreDocument(id: "l", data: item.args[0] as? [String: Any] ?? [:]))
      XCTAssertEqual(isListingBrowsable(listing), item.result as? Bool, "\(item.args)")
    }
  }

  func testInstallState() throws {
    for item in try functionCases("resolvePluginInstallState") {
      func pin(_ value: Any) -> String? {
        guard let version = (value as? [String: Any])?["version"] else { return nil }
        return (version as? String) ?? (version as? NSNumber).map { jsNumberString($0.doubleValue) }
      }
      let state = resolvePluginInstallState(
        latestVersion: string(item.args[0]), hostPinVersion: pin(item.args[1]), hostPinned: item.args[1] is [String: Any], orgPinVersion: pin(item.args[2]),
        orgPinned: item.args[2] is [String: Any])
      let expected = try XCTUnwrap(item.result as? [String: Any])
      XCTAssertEqual(state.installedVersion, string(expected["installedVersion"]), "\(item.args)")
      XCTAssertEqual(state.scope?.rawValue, string(expected["scope"]), "\(item.args)")
      XCTAssertEqual(state.shadowed, expected["shadowed"] as? Bool, "\(item.args)")
      XCTAssertEqual(state.updateAvailable, expected["updateAvailable"] as? Bool, "\(item.args)")
    }
  }

  func testInstallRoutes() throws {
    for item in try functionCases("marketplaceInstallEndpoint") { XCTAssertEqual(marketplaceInstallEndpoint(item.args[0] as? String ?? ""), item.result as? String, "\(item.args)") }
    for item in try functionCases("marketplaceLandingMessage") {
      XCTAssertEqual(marketplaceLandingMessage(item.args[0] as? String ?? "", item.args[1] as? String ?? ""), string(item.result), "\(item.args)")
    }
  }

  func testBrowseAsksWhatTheWorkspaceMaySeeWithTheSearchFolded() throws {
    let plain = browseQuery(viewerOrgID: "org1", category: nil, search: "", sort: .newest)
    XCTAssertEqual(plain.collection, ["marketplaceListings"])
    XCTAssertEqual(plain.filters.map(\.path), ["browseAudience"])
    XCTAssertEqual(plain.filters.first?.value as? [String], ["*", "org1"])
    XCTAssertEqual(plain.order.map(\.field), ["createdAt"])
    XCTAssertEqual(plain.order.map(\.descending), [true])
    let searched = browseQuery(viewerOrgID: "org1", category: "seo", search: "count", sort: .installed)
    XCTAssertTrue(searched.filters.contains { $0.path == "browseTokens" && ($0.value as? [String]) == ["*~count", "org1~count"] }, "\(searched.filters)")
    XCTAssertTrue(searched.filters.contains { $0.path == "category" && ($0.value as? String) == "seo" })
    XCTAssertEqual(searched.order.map(\.field), ["installCount"])
    XCTAssertEqual(searched.order.map(\.descending), [true])
  }

  func testReadsAListingAsBrowseShowsIt() {
    let row = ListingRow(
      FirestoreDocument(
        id: "l1",
        data: [
          "displayName": "Promo Countdown", "type": "plugin", "priceUsd": 12, "latestVersion": "1.1.0", "latestApprovedVersion": "1.0.0", "ratingAverage": 4.5,
          "ratingCount": 2,
        ]))
    XCTAssertEqual(row.artifactType, "plugin")
    XCTAssertEqual(row.offeredVersion, "1.0.0")
    XCTAssertEqual(priceLabel(row.priceUSD), "$12")
    XCTAssertEqual(ratingLabel(row), "4.5 ★ (2)")
    XCTAssertEqual(installTargets("plugin"), [.org, .host])
    XCTAssertEqual(installTargets("template"), [.host])
  }

  func testLicencesAreTheWorkspacesLivePurchases() {
    let query = licencesQuery(orgID: "org1")
    XCTAssertEqual(query.collection, ["marketplacePurchases"])
    XCTAssertTrue(query.filters.contains { $0.path == "buyerOrgId" && ($0.value as? String) == "org1" })
    XCTAssertTrue(query.filters.contains { $0.path == "refundedAt" && $0.value is NSNull })
  }

  /// Publishing the site as a template is the spec screens its Kotlin module reads too: bundled here, they are the ones the
  /// manifest declares, and the template one fills the `siteTemplate` zone of Backup & restore.
  @MainActor
  func testThePublishScreensAreBundledAndFillTheSiteTemplateZone() throws {
    let specs = ScreenCatalog.load(from: .module)
    let ids = [
      "marketplace.publish", "marketplace.publishComponent", "marketplace.publishDatasetSchema", "marketplace.publishEmailStarter", "marketplace.publishEmailTemplate",
      "marketplace.publishLayout", "marketplace.publishTemplate", "marketplace.publishTheme", "marketplace.publisherAgreement",
    ]
    XCTAssertEqual(specs.map(\.id).sorted(), ids)
    XCTAssertEqual(specs.first { $0.id == "marketplace.publishTemplate" }?.zones, ["siteTemplate"])
    let declared = SpecScreens.declaration(specs).screens
    XCTAssertEqual(declared.sorted(), ids)
  }
}
