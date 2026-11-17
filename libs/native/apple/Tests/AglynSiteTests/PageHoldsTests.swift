// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

private final class HoldsTransport: HTTPTransport, @unchecked Sendable {
  var urls: [URL] = []
  let answer: String

  init(_ answer: String) { self.answer = answer }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    urls.append(request.url!)
    return (Data(answer.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}

final class PageHoldsTests: XCTestCase {
  private let answer = #"""
    {"holds":[
      {"noticeId":"n1","kind":"page-held","status":"held","chip":{"label":"Held for review","color":"warning"},
       "label":"the \"About\" page (/about)","details":["Seen on /about."],"visitorSentence":"Visitors see the previous version.",
       "targets":[{"type":"screen","id":"about"},{"type":"layout","id":"main"}],"reference":"HS-1","occurredAtMs":1,
       "reviewable":true,"reviewRequestedAtMs":null},
      {"noticeId":"n2","kind":"page-flagged","status":"in-review","chip":{"label":"Flagged","color":"info"},
       "label":"the \"Menu\" page","details":[],"visitorSentence":"Visitors still see this page while it is reviewed.",
       "targets":[{"type":"screen","id":"menu"}],"reference":null,"occurredAtMs":2,"reviewable":false,"reviewRequestedAtMs":null},
      {"noticeId":"n3","kind":"page-held","status":"held","chip":{"label":"Held for review","color":"warning"},
       "label":"the \"About\" page","details":[],"visitorSentence":"Second.","targets":[{"type":"screen","id":"about"}],
       "reference":null,"occurredAtMs":3,"reviewable":true,"reviewRequestedAtMs":null}
    ],"orgId":"o","canRequestReview":true}
    """#

  func testReadsTheSitesHoldsAndPutsThemOnTheirPages() async throws {
    let transport = HoldsTransport(answer)
    let client = ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
    let read = try await fetchPageHolds(api: client, hostID: "h 1")
    XCTAssertEqual(transport.urls.first?.path, "/api/hosts/page-holds")
    XCTAssertEqual(URLComponents(url: transport.urls[0], resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "h 1")
    XCTAssertTrue(read.canRequestReview)
    XCTAssertEqual(read.orgID, "o")
    let about = holdsForTarget(read.holds, HeldPageTarget(type: "screen", id: "about"))
    XCTAssertEqual(about.map(\.noticeID), ["n1", "n3"])
    XCTAssertEqual(pageHoldChips(about).map(\.chipLabel), ["Held for review"])
    XCTAssertEqual(holdsForTarget(read.holds, HeldPageTarget(type: "layout", id: "main")).map(\.noticeID), ["n1"])
    XCTAssertEqual(read.holds[1].tone, .info)
  }

  func testBannerSaysWhatHappenedAndWhatVisitorsSee() {
    let held = PageHold(
      noticeID: "n1", kind: "page-held", status: "held", chipLabel: "Held for review", chipColor: "warning",
      label: "the \"About\" page", details: ["Seen on /about."], visitorSentence: "Visitors see the previous version.",
      targets: [HeldPageTarget(type: "screen", id: "about")], reference: "HS-1", reviewable: true)
    let onPage = pageHoldBannerCopy(held, target: HeldPageTarget(type: "screen", id: "about"))
    XCTAssertEqual(onPage.title, "The \"About\" page is held for review by our automated safety review.")
    XCTAssertEqual(onPage.lines, ["Seen on /about.", "Visitors see the previous version.", "Reference HS-1."])
    let onLayout = pageHoldBannerCopy(held, target: HeldPageTarget(type: "layout", id: "main"))
    XCTAssertEqual(onLayout.title, "The \"About\" page, which uses this layout, is held for review by our automated safety review.")
    let flagged = PageHold(
      noticeID: "n2", kind: "page-flagged", status: "in-review", chipLabel: "Flagged", chipColor: "info", label: "the page",
      visitorSentence: "", targets: [])
    XCTAssertTrue(pageHoldBannerCopy(flagged, target: HeldPageTarget(type: "screen", id: "x")).title.contains("flagged by our automated"))
    let rejected = PageHold(
      noticeID: "n4", kind: "page-held", status: "rejected", chipLabel: "Not approved", chipColor: "error", label: "the page",
      visitorSentence: "", targets: [], reviewRequestedAt: Date(timeIntervalSince1970: 0))
    let copy = pageHoldBannerCopy(rejected, target: HeldPageTarget(type: "screen", id: "x"), timeZone: TimeZone(identifier: "UTC")!)
    XCTAssertEqual(copy.title, "The page was not approved after review, and is not being served.")
    XCTAssertTrue(copy.lines.first?.hasPrefix("A review was requested on ") ?? false)
    XCTAssertEqual(pageHoldDetailsLink(orgSlug: "acme"), "/acme/settings/holds")
    XCTAssertEqual(pageHoldReviewLink(orgSlug: "acme", noticeID: "n1"), "/acme/settings/holds?notice=n1")
  }
}
