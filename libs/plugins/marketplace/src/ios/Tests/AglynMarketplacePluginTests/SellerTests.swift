// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import XCTest

@testable import AglynMarketplacePlugin

private final class SellerTransport: HTTPTransport, @unchecked Sendable {
  var seen: [(path: String, body: [String: Any])] = []
  var methods: [String] = []
  var answer = "{}"
  var status = 200

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    seen.append((request.url?.path ?? "", body))
    methods.append(request.httpMethod ?? "")
    return (Data(answer.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}

final class SellerTests: XCTestCase {
  private func client(_ transport: SellerTransport) -> ConsoleAPIClient {
    ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
  }

  func testTheSellerReadsItsListingsAndSalesByTheOrganization() {
    XCTAssertEqual(sellerListingsQuery(orgID: "o1").collection, ["marketplaceListings"])
    XCTAssertEqual(sellerListingsQuery(orgID: "o1").equals.map { "\($0.field)=\($0.value)" }, ["profileId=o1"])
    XCTAssertEqual(sellerSalesQuery(orgID: "o1").collection, ["marketplacePurchases"])
    XCTAssertEqual(sellerSalesQuery(orgID: "o1").equals.map { "\($0.field)=\($0.value)" }, ["sellerOrgId=o1"])
    XCTAssertEqual(publisherProfilePath(orgID: "o1"), ["publisherProfiles", "o1"])
  }

  func testAListingRowSaysWhatTheConsoleSays() {
    let paid = SellerListing(
      FirestoreDocument(
        id: "l1",
        data: [
          "displayName": "Hero", "latestVersion": "3", "priceUsd": 5, "previewImageUrl": "https://x/y.png", "visibility": "private", "type": "plugin",
          "categories": ["Marketing"],
        ]))
    XCTAssertEqual(paid.subtitle, "v3 · $5 · has preview")
    XCTAssertTrue(paid.isPrivate)
    XCTAssertTrue(paid.isPlugin)
    XCTAssertEqual(paid.category, "Marketing")
    let free = SellerListing(FirestoreDocument(id: "l2", data: ["displayName": "Footer", "latestVersion": 2, "deletedAt": 1, "category": "Docs"]))
    XCTAssertEqual(free.subtitle, "v2 · free · unpublished")
    XCTAssertFalse(free.isPlugin)
    XCTAssertEqual(free.artifactType, "component")
    XCTAssertEqual(free.category, "Docs")
  }

  func testMoneyIsWrittenInDollarsAndCents() {
    XCTAssertEqual(dollars(1234), "$12.34")
    XCTAssertEqual(dollars(5), "$0.05")
    XCTAssertEqual(dollars(0), "$0.00")
    XCTAssertEqual(dollars(-150), "-$1.50")
    XCTAssertEqual(dollars(.nan), "$0.00")
    XCTAssertEqual(dollars(8825), "$88.25")
  }

  func testThePayoutsCardSaysWhereTheArrangementStands() {
    XCTAssertEqual(payoutsButton(.disconnected), "Set up payouts")
    XCTAssertEqual(payoutsButton(.ready), "Payouts enabled — recheck status")
    XCTAssertEqual(payoutsButton(.blocked), "Finish payout setup in Stripe")
    XCTAssertEqual(payoutsButton(.unverified), "Reconnect Stripe to verify")
    XCTAssertEqual(payoutsButton(.unknown), "Recheck payout status")
    XCTAssertTrue(payoutsSentence(.ready).hasPrefix("Payouts are enabled"))
    XCTAssertTrue(payoutsSentence(.unknown).contains("recheck to confirm"))
    XCTAssertTrue(payoutsSentence(.disconnected).hasPrefix("Connect a Stripe account"))
  }

  /// The publisher agreement a save agrees to (AGL-4105), as each seller save sends it.
  private let agreed = PublisherAgreementConsent(version: "2026-08-24.1")

  private func assertAgreed(_ body: [String: Any], file: StaticString = #filePath, line: UInt = #line) {
    let agreement = body["agreement"] as? [String: Any]
    XCTAssertEqual(agreement?["version"] as? String, "2026-08-24.1", file: file, line: line)
    XCTAssertEqual(agreement?["accepted"] as? Bool, true, file: file, line: line)
  }

  func testEverySellerSaveAgreesToTheVersionTheContractsCarry() {
    XCTAssertEqual(PublisherAgreementConsent.current.version, ContractValues.shared.publisherAgreementVersion)
    XCTAssertEqual(PublisherAgreementConsent.current.body["accepted"] as? Bool, true)
  }

  func testTheProfileIsSavedThroughTheRouteWithTheOrganization() async throws {
    let transport = SellerTransport()
    try await SellerAPI(api: client(transport), orgID: "o1").saveProfile(["handle": "studio", "displayName": "Studio", "bio": ""], agreement: agreed)
    XCTAssertEqual(transport.seen.first?.path, "/api/marketplace/publisher-profile")
    let body = try XCTUnwrap(transport.seen.first?.body)
    XCTAssertEqual(body["orgId"] as? String, "o1")
    XCTAssertEqual(body["handle"] as? String, "studio")
    XCTAssertEqual(body["bio"] as? String, "")
    assertAgreed(body)
  }

  func testPayoutsStartThroughConnectAndADeploymentWithoutItAnswers501() async throws {
    let transport = SellerTransport()
    transport.answer = #"{"chargesEnabled":true,"payoutsEnabled":false,"url":"https://stripe.test/onboard"}"#
    let answer = try await SellerAPI(api: client(transport), orgID: "o1").connect()
    XCTAssertEqual(transport.seen.first?.path, "/api/marketplace/connect")
    XCTAssertEqual(transport.seen.first?.body["orgId"] as? String, "o1")
    XCTAssertEqual(answer, ConnectAnswer(chargesEnabled: true, payoutsEnabled: false, url: "https://stripe.test/onboard", dashboardURL: nil))
    let refused = SellerTransport()
    refused.status = 501
    refused.answer = #"{"error":"not configured"}"#
    do {
      _ = try await SellerAPI(api: client(refused), orgID: "o1").connect()
      XCTFail("a deployment without Connect should refuse")
    } catch let error as ConsoleAPIError {
      XCTAssertEqual(error.status, 501)
    }
  }

  func testAListingIsChangedThroughThePublishRouteOneActionAtATime() async throws {
    let transport = SellerTransport()
    let api = SellerAPI(api: client(transport), orgID: "o1")
    try await api.setVisibility("l1", "private", agreement: agreed)
    try await api.setPublished("l1", published: false, agreement: agreed)
    try await api.updateListing(
      "l1", fields: ["displayName": "Hero", "description": "A hero", "readme": "About it", "homepageUrl": "https://x.test"], category: "Marketing",
      screenshots: ["/api/media/cdn/org:o1/a", "/api/media/cdn/org:o1/b"], agreement: agreed)
    try await api.updateListing("l1", fields: ["displayName": "Hero"], category: "", screenshots: [], agreement: agreed)
    XCTAssertEqual(transport.seen.map(\.path), Array(repeating: "/api/marketplace/publish-plugin", count: 4))
    XCTAssertEqual(transport.seen[0].body["action"] as? String, "set-visibility")
    XCTAssertEqual(transport.seen[0].body["visibility"] as? String, "private")
    XCTAssertEqual(transport.seen[1].body["action"] as? String, "set-published")
    XCTAssertEqual(transport.seen[1].body["published"] as? Bool, false)
    let update = transport.seen[2].body
    XCTAssertEqual(update["action"] as? String, "update-listing")
    XCTAssertEqual(update["categories"] as? [String], ["Marketing"])
    // The gallery is sent whole, in order, as the console's editor sends it; the preview is not a content field.
    XCTAssertEqual(update["screenshots"] as? [String], ["/api/media/cdn/org:o1/a", "/api/media/cdn/org:o1/b"])
    XCTAssertNil(update["previewImageUrl"])
    XCTAssertEqual(transport.seen[3].body["categories"] as? [String], [])
    XCTAssertEqual(transport.seen[3].body["screenshots"] as? [String], [])
    // Each one agrees to the publisher agreement on its own (AGL-4105).
    for seen in transport.seen { assertAgreed(seen.body) }
  }

  func testThePreviewImageIsSetAndRemovedThroughItsOwnRoute() async throws {
    let transport = SellerTransport()
    let api = SellerAPI(api: client(transport), orgID: "o1")
    try await api.setPreviewImage("l1", url: "/api/media/cdn/org:o1/m1", agreement: agreed)
    try await api.setPreviewImage("l1", url: "", agreement: agreed)
    XCTAssertEqual(transport.seen.map(\.path), ["/api/marketplace/preview-image", "/api/marketplace/preview-image"])
    XCTAssertEqual(transport.methods, ["POST", "DELETE"])
    XCTAssertEqual(transport.seen[0].body["listingId"] as? String, "l1")
    XCTAssertEqual(transport.seen[0].body["url"] as? String, "/api/media/cdn/org:o1/m1")
    XCTAssertEqual(transport.seen[1].body["listingId"] as? String, "l1")
    XCTAssertNil(transport.seen[1].body["url"])
    for seen in transport.seen { assertAgreed(seen.body) }
  }

  func testTheGalleryHoldsSixDistinctScreenshotsAndAListingReadsItsOwn() {
    var gallery: [String] = []
    for index in 0..<8 { gallery = addingScreenshot("/s/\(index)", to: gallery) }
    XCTAssertEqual(gallery, (0..<6).map { "/s/\($0)" })
    XCTAssertEqual(addingScreenshot("/s/1", to: ["/s/1"]), ["/s/1"])
    let listing = SellerListing(FirestoreDocument(id: "l1", data: ["displayName": "Hero", "screenshots": ["/a", "/b", 3]]))
    XCTAssertEqual(listing.screenshots, ["/a", "/b"])
  }

  func testAListingOrSomeoneElsesReviewIsReportedThroughTheReportRoute() async throws {
    let transport = SellerTransport()
    let api = MarketplaceAPI(api: client(transport))
    try await api.report(listingID: "l1", reason: "  Spam  ")
    try await api.report(listingID: "l1", reason: "Abusive", reviewUID: "u2")
    XCTAssertEqual(transport.seen.map(\.path), ["/api/marketplace/report", "/api/marketplace/report"])
    XCTAssertEqual(transport.seen[0].body as? [String: String], ["listingId": "l1", "reason": "Spam"])
    XCTAssertEqual(transport.seen[1].body as? [String: String], ["listingId": "l1", "reason": "Abusive", "reviewUid": "u2"])
    XCTAssertEqual(maxReportReasonLength, 1000)
  }
}
