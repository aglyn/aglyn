// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

private final class PhotoLinkTransport: HTTPTransport, @unchecked Sendable {
  var sent: [[String: Any]] = []
  var paths: [String] = []
  var answers: [(Int, String)]

  init(_ answers: [(Int, String)]) { self.answers = answers }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    sent.append(request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:])
    paths.append(request.url?.path ?? "")
    let (status, body) = answers.isEmpty ? (200, "{}") : answers.removeFirst()
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}

@MainActor
final class PhotoLinksTests: XCTestCase {
  private func api(_ transport: PhotoLinkTransport) -> PhotoLinksAPI {
    PhotoLinksAPI(
      api: ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in }, maxAttempts: 1),
      hostID: "h")
  }

  func testListsTheOpenLinksAsTheRouteAnswersThem() async throws {
    let transport = PhotoLinkTransport([
      (200, #"{"links":[{"linkId":"a","state":"live","createdAt":1763251200000,"expiresAt":1763856000000,"uploads":1,"bytes":9,"remainingUploads":39,"remainingBytes":1}]}"#)
    ])
    let rows = try await api(transport).list()
    XCTAssertEqual(transport.paths, ["/api/media/photo-links"])
    XCTAssertEqual(transport.sent.first?["action"] as? String, "list")
    XCTAssertEqual(transport.sent.first?["hostId"] as? String, "h")
    XCTAssertEqual(rows.map(\.id), ["a"])
    XCTAssertEqual(rows.first?.uploads, 1)
    XCTAssertEqual(rows.first?.remainingUploads, 39)
    XCTAssertEqual(rows.first?.createdAt, Date(timeIntervalSince1970: 1_763_251_200))
    XCTAssertTrue(rows.first?.title.hasSuffix("· 1 photo received") ?? false)
    XCTAssertTrue(rows.first?.until.hasPrefix("Works until ") ?? false)
  }

  func testMakesAndRevokesALink() async throws {
    let transport = PhotoLinkTransport([
      (200, #"{"linkId":"b","url":"https://app.test/p/b#s","expiresAt":1763856000000,"folderId":"f"}"#), (200, #"{"ok":true}"#),
    ])
    let fresh = try await api(transport).create()
    XCTAssertEqual(fresh, FreshPhotoLink(id: "b", url: "https://app.test/p/b#s", expiresAt: Date(timeIntervalSince1970: 1_763_856_000)))
    try await api(transport).revoke("b")
    XCTAssertEqual(transport.sent.map { $0["action"] as? String }, ["create", "revoke"])
    XCTAssertEqual(transport.sent.last?["linkId"] as? String, "b")
  }

  func testCaptionSaysHowLongAndHowManyOnceTheRowIsIn() {
    let now = Date(timeIntervalSince1970: 0)
    let fresh = FreshPhotoLink(id: "b", url: "u", expiresAt: now.addingTimeInterval(7 * 86_400))
    XCTAssertEqual(
      photoLinkCaption(fresh, row: nil, now: now), "Works for 7 days. Photos land in the folder “From the owner”.")
    let row = PhotoLinkRow(id: "b", createdAt: now, expiresAt: fresh.expiresAt, uploads: 0, remainingUploads: 40)
    XCTAssertEqual(
      photoLinkCaption(fresh, row: row, now: now),
      "Works for 7 days and takes up to 40 photos. Photos land in the folder “From the owner”.")
    let lastHour = FreshPhotoLink(id: "b", url: "u", expiresAt: now.addingTimeInterval(3600))
    XCTAssertTrue(photoLinkCaption(lastHour, row: nil, now: now).hasPrefix("Works for 1 day."))
    XCTAssertEqual(photoCount(1), "1 photo")
  }

  func testAMemberRefusedOutrightCannotMakeALinkEither() async {
    let model = PhotoLinksModel()
    await model.refresh(api(PhotoLinkTransport([(423, #"{"error":"This site is locked."}"#)])))
    XCTAssertEqual(model.list, .failed("This site is locked.", blocked: true))
    XCTAssertTrue(model.blocked)
    await model.refresh(api(PhotoLinkTransport([(500, #"{"error":"Photo link failed"}"#)])))
    XCTAssertEqual(model.list, .failed("The photo links could not be loaded.", blocked: false))
    XCTAssertFalse(model.blocked)
  }

  func testRevokingTheFreshLinkHidesItsCode() async {
    let transport = PhotoLinkTransport([
      (200, #"{"linkId":"b","url":"https://app.test/p/b#s","expiresAt":1763856000000}"#),
      (200, #"{"links":[{"linkId":"b","createdAt":1,"expiresAt":1763856000000,"uploads":0,"remainingUploads":40}]}"#),
      (200, #"{"ok":true}"#), (200, #"{"links":[]}"#),
    ])
    let model = PhotoLinksModel()
    await model.create(api(transport))
    XCTAssertEqual(model.fresh?.id, "b")
    XCTAssertEqual(model.freshRow?.remainingUploads, 40)
    await model.revoke(api(transport), model.freshRow!)
    XCTAssertNil(model.fresh)
    XCTAssertEqual(model.list, .ready([]))
    XCTAssertEqual(model.notice, "Link revoked")
  }
}
