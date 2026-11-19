// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

private final class PresenceTransport: HTTPTransport, @unchecked Sendable {
  var bodies: [[String: Any]] = []
  let status: Int
  let answer: String

  init(status: Int = 200, _ answer: String) {
    self.status = status
    self.answer = answer
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    bodies.append(request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:])
    return (Data(answer.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}

final class DocumentPresenceTests: XCTestCase {
  private func client(_ transport: PresenceTransport) -> ConsoleAPIClient {
    ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
  }

  func testReadsWhoIsInEachDocument() async {
    let transport = PresenceTransport(
      #"{"summary":{"screen":{"about":[{"uid":"u1","displayName":"Sam Lee"},{"uid":"u2","displayName":"Ana","photoURL":"https://x/p.png"}],"empty":[]},"layout":{"main":[{"uid":"u3","displayName":""}]}}}"#)
    let summary = await fetchPresenceSummary(api: client(transport), hostID: "h")
    XCTAssertEqual(transport.bodies.first?["hostId"] as? String, "h")
    XCTAssertEqual(summary.people("screen", "about").map(\.displayName), ["Sam Lee", "Ana"])
    XCTAssertEqual(summary.people("screen", "about").last?.photoURL, "https://x/p.png")
    XCTAssertEqual(summary.people("screen", "empty"), [])
    XCTAssertEqual(summary.people("layout", "main"), [], "a row without a name is not a person")
    XCTAssertEqual(summary.people("screen", "nobody"), [])
  }

  func testFailsToNothing() async {
    let refused = await fetchPresenceSummary(api: client(PresenceTransport(status: 403, #"{"error":"Not a member"}"#)), hostID: "h")
    XCTAssertEqual(refused, PresenceSummary())
  }

  func testTheSentenceIsHedgedAboutTheVersion() {
    XCTAssertEqual(presenceChipSentence(["Sam"]), "Sam is in this document right now — possibly in a different version.")
    XCTAssertEqual(
      presenceChipSentence(["Sam", "Ana", "Lee"]), "Sam, Ana and Lee are in this document right now — possibly in a different version.")
  }
}
