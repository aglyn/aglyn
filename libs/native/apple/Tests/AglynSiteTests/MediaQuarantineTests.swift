// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import XCTest

@testable import AglynSite

/// The Disabled notice on a library file (AGL-1612): what `/api/media/quarantine` answers, and what is asked.
/// The Kotlin `MediaQuarantineTest` holds the same cases.
final class MediaQuarantineTests: XCTestCase {
  private func api(_ transport: FontsTransport) -> MediaAPI {
    MediaAPI(
      api: ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in }, maxAttempts: 1),
      scope: .org(orgID: "o1", forHostID: "h1"))
  }

  func testReadsTheNoticeTheRouteAnswersAndNothingFromAHealthyPlatform() throws {
    let answer = JSONValue.decode(
      Data(
        #"{"quarantined":{"m1":{"reason":"dmca","title":"Taken down","body":"This file was disabled after a notice.","contact":"support@aglyn.com"},"m2":{"reason":"abuse","body":"Disabled.","contact":null}},"readAtMs":1}"#
          .utf8))
    let notices = parseMediaQuarantine(answer)
    XCTAssertEqual(Set(notices.keys), ["m1", "m2"])
    XCTAssertEqual(
      notices["m1"],
      MediaQuarantineNotice(reason: "dmca", title: "Taken down", body: "This file was disabled after a notice.", contact: "support@aglyn.com"))
    XCTAssertEqual(notices["m1"]?.message, "This file was disabled after a notice. (support@aglyn.com)")
    // A missing title reads "Disabled" and no contact leaves the body alone, as the console's chip and tooltip do.
    XCTAssertEqual(notices["m2"]?.title, "Disabled")
    XCTAssertEqual(notices["m2"]?.message, "Disabled.")
    XCTAssertTrue(parseMediaQuarantine(JSONValue.decode(Data(#"{"quarantined":{},"readAtMs":1}"#.utf8))).isEmpty)
    XCTAssertTrue(parseMediaQuarantine(nil).isEmpty)
  }

  func testAsksInBatchesOfTheRoutesLimitWithTheScopeInTheBodyAndStaysSilentWhenItFails() async {
    let transport = FontsTransport()
    transport.answers["/api/media/quarantine"] = (
      200, #"{"quarantined":{"m001":{"reason":"dmca","title":"Taken down","body":"Disabled.","contact":null}}}"#
    )
    let ids = (1...(mediaQuarantineProbeMax + 5)).map { "m" + String(format: "%03d", $0) } + ["m001", " "]
    let found = await api(transport).quarantine(ids)
    // 105 distinct ids go in two calls, the first at the route's limit; a repeat or a blank id is not asked.
    let bodies = transport.sent.compactMap { $0.httpBody.flatMap { JSONValue.decode($0) } }
    XCTAssertEqual(bodies.map { $0["mediaIds"]?.arrayValue?.count }, [mediaQuarantineProbeMax, 5])
    XCTAssertEqual(bodies[0]["orgId"]?.stringValue, "o1")
    XCTAssertEqual(bodies[0]["forHostId"]?.stringValue, "h1")
    XCTAssertEqual(Set(found.keys), ["m001"])
    transport.answers["/api/media/quarantine"] = (500, "{}")
    let failed = await api(transport).quarantine(["m001"])
    XCTAssertTrue(failed.isEmpty)
  }

  func testADisabledFileOutranksThePrivateAdvisoryOnItsTile() {
    XCTAssertEqual(mediaTileBadge(private: true, disabled: true)?.text, "Disabled")
    XCTAssertEqual(mediaTileBadge(private: true, disabled: false)?.text, "Private")
    XCTAssertEqual(mediaTileBadge(private: false, disabled: true)?.text, "Disabled")
    XCTAssertNil(mediaTileBadge(private: false, disabled: false))
  }
}
