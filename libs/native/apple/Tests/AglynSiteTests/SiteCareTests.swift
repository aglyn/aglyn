// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

/// Site Care's Request a change asks the console's route as its button does (AGL-3959).
final class SiteCareTests: XCTestCase {
  func testStatusAndRequestUseTheConsolesRoute() async throws {
    let transport = FontsTransport()
    transport.answers["/api/site-care/requests"] = (200, #"{"siteCare":true,"ticketId":"t1","dueAt":"Wednesday, November 18"}"#)
    let api = ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
    let care = SiteCareAPI(api: api, orgID: "o1")
    let has = await care.hasSiteCare()
    XCTAssertEqual(has, true)
    let due = try await care.request(hostID: "h1", subject: "Hours", body: "Closed on the 25th")
    XCTAssertEqual(due, "Wednesday, November 18")
    XCTAssertEqual(transport.sent.first?.url?.query?.contains("view=status"), true)
    XCTAssertEqual(transport.sent.last?.httpMethod, "POST")
    let body = try XCTUnwrap(transport.sent.last?.httpBody.flatMap { JSONValue.decode($0) })
    XCTAssertEqual(body["orgId"]?.stringValue, "o1")
    XCTAssertEqual(body["hostId"]?.stringValue, "h1")
    XCTAssertEqual(body["subject"]?.stringValue, "Hours")
    XCTAssertEqual(body["body"]?.stringValue, "Closed on the 25th")
    XCTAssertEqual(
      siteCareSentText(""), "We have your request and will have it done by two business days from now. We will email you when it is done.")
    transport.answers["/api/site-care/requests"] = (200, #"{"siteCare":false}"#)
    let without = await care.hasSiteCare()
    XCTAssertEqual(without, false)
  }
}
