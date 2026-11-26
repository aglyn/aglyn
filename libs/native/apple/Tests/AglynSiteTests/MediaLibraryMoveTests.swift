// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

/// Answers each request with the next of `answers` and records every body sent.
private final class SequenceTransport: HTTPTransport, @unchecked Sendable {
  var answers: [(Int, String)]
  var sent: [[String: Any]] = []

  init(_ answers: [(Int, String)]) { self.answers = answers }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    sent.append(request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:])
    let (status, body) = answers.isEmpty ? (200, "{}") : answers.removeFirst()
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}

/// Moving files between a site's library and the organization library (AGL-4254): where the action shows, what the
/// route is sent, how the rounds are summed, and the console's words (`media-library-move-copy.ts`).
final class MediaLibraryMoveTests: XCTestCase {
  private let toOrg = MediaLibraryMoveTarget(orgID: "o1", hostID: "h1", direction: .toOrg)
  private let toSite = MediaLibraryMoveTarget(orgID: "o1", hostID: "h1", direction: .toSite)

  private func api(_ transport: SequenceTransport, scope: MediaScope = .site(hostID: "h1")) -> MediaAPI {
    MediaAPI(
      api: ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in }, maxAttempts: 1),
      scope: scope)
  }

  func testTheActionShowsOnlyOnASitesMediaScreen() {
    XCTAssertEqual(MediaScope.site(hostID: "h1").libraryMove(orgID: "o1"), toOrg)
    XCTAssertEqual(MediaScope.org(orgID: "o1", forHostID: "h1").libraryMove(orgID: "o1"), toSite)
    // The workspace's own media page has no site to move to or from.
    XCTAssertNil(MediaScope.org(orgID: "o1", forHostID: nil).libraryMove(orgID: "o1"))
    XCTAssertNil(MediaScope.site(hostID: "h1").libraryMove(orgID: nil))
  }

  func testThePreviewSendsBothLibrariesTheDirectionAndPreview() async throws {
    let transport = SequenceTransport([
      (200, #"{"ok":true,"movable":["a"],"refused":[{"mediaId":"b","name":"b.png","reason":"Stays in the organization library: used by Shop"}],"unknownIds":["z"],"documents":3}"#)
    ])
    // The org library seen from the site: the body names both ids itself, not the scope's `forHostId`.
    let preview = try await api(transport, scope: .org(orgID: "o1", forHostID: "h1")).previewLibraryMove(["a", "b", "z"], to: toSite)
    XCTAssertEqual(preview.movable, ["a"])
    XCTAssertEqual(preview.refused, [MediaLibraryRefusal(mediaID: "b", name: "b.png", reason: "Stays in the organization library: used by Shop")])
    XCTAssertEqual(preview.unknownIDs, ["z"])
    XCTAssertEqual(preview.documents, 3)
    let body = try XCTUnwrap(transport.sent.first)
    XCTAssertEqual(body["orgId"] as? String, "o1")
    XCTAssertEqual(body["hostId"] as? String, "h1")
    XCTAssertEqual(body["direction"] as? String, "to-site")
    XCTAssertEqual(body["mediaIds"] as? [String], ["a", "b", "z"])
    XCTAssertEqual(body["preview"] as? Bool, true)
    XCTAssertNil(body["forHostId"])
  }

  func testTheMoveAsksAgainForWhatRemainsAndSumsTheUses() async throws {
    let transport = SequenceTransport([
      (200, #"{"ok":true,"moved":2,"movedIds":["a","b"],"failed":[],"refused":[],"remainingIds":["c","d"],"done":false,"rewrote":{"uses":5,"documents":2,"failed":0}}"#),
      (200, #"{"ok":true,"moved":1,"movedIds":["c"],"failed":[{"mediaId":"d","name":"d.png","reason":"Could not be moved"}],"refused":[],"remainingIds":[],"done":true,"rewrote":{"uses":4,"documents":1,"failed":0}}"#),
    ])
    let preview = MediaLibraryMovePreview(
      movable: ["a", "b", "c", "d"], refused: [MediaLibraryRefusal(mediaID: "e", name: "e.png", reason: "used by Shop")],
      documents: 3)
    let outcome = await api(transport).moveToOtherLibrary(preview, to: toOrg)
    XCTAssertEqual(outcome.movedIDs, ["a", "b", "c"])
    XCTAssertEqual(outcome.uses, 9)
    XCTAssertEqual(outcome.notMoved.map(\.mediaID), ["e", "d"])
    XCTAssertEqual(transport.sent.count, 2)
    XCTAssertEqual(transport.sent[0]["mediaIds"] as? [String], ["a", "b", "c", "d"])
    XCTAssertEqual(transport.sent[1]["mediaIds"] as? [String], ["c", "d"])
    XCTAssertEqual(transport.sent[0]["direction"] as? String, "to-org")
    XCTAssertNil(transport.sent[0]["preview"])
    XCTAssertEqual(
      MediaLibraryMoveReport(outcome, direction: .toOrg, total: 5),
      .partial(
        #"Moved 3 of 5 to the organization library and updated 9 uses — 2 could not be moved: "e.png" (used by Shop), "d.png" (Could not be moved), and are still selected"#
      ))
  }

  func testARoundThatMovesNothingStopsAndWhatWasNotHeardAboutStaysSelected() async {
    let transport = SequenceTransport([
      (200, #"{"movedIds":["a"],"failed":[],"remainingIds":["b"],"done":false,"rewrote":{"uses":1}}"#),
      (200, #"{"movedIds":[],"failed":[],"remainingIds":["b"],"done":false,"rewrote":{"uses":0}}"#),
      (200, #"{"movedIds":["b"],"remainingIds":[],"done":true}"#),
    ])
    let preview = MediaLibraryMovePreview(movable: ["a", "b"], refused: [], documents: 0)
    let outcome = await api(transport).moveToOtherLibrary(preview, to: toOrg, names: ["b": "b.jpg"])
    XCTAssertEqual(transport.sent.count, 2)
    XCTAssertEqual(outcome.movedIDs, ["a"])
    XCTAssertEqual(outcome.notMoved, [MediaLibraryRefusal(mediaID: "b", name: "b.jpg", reason: nil)])
  }

  func testTheRoundsAreCapped() async {
    let round = (200, #"{"movedIds":["x"],"failed":[],"remainingIds":["a"],"done":false,"rewrote":{"uses":1}}"#)
    let transport = SequenceTransport(Array(repeating: round, count: 30))
    let outcome = await api(transport).moveToOtherLibrary(MediaLibraryMovePreview(movable: ["a"], refused: [], documents: 0), to: toOrg)
    XCTAssertEqual(transport.sent.count, mediaLibraryMoveMaxRounds)
    XCTAssertEqual(outcome.uses, mediaLibraryMoveMaxRounds)
  }

  func testARefusedFirstRoundReportsTheRoutesWords() async {
    let transport = SequenceTransport([(422, #"{"error":"This workspace has too many pages and records to check in one move."}"#)])
    let outcome = await api(transport).moveToOtherLibrary(MediaLibraryMovePreview(movable: ["a"], refused: [], documents: 0), to: toOrg, names: ["a": "a.png"])
    XCTAssertTrue(outcome.movedIDs.isEmpty)
    XCTAssertEqual(outcome.notMoved.map(\.mediaID), ["a"])
    let report = MediaLibraryMoveReport(outcome, direction: .toOrg, total: 1)
    guard case .failed = report else { return XCTFail("expected a failure, got \(report)") }
    XCTAssertEqual(report.message, outcome.transportError)
    XCTAssertNotNil(outcome.transportError)
  }

  func testTheCopyIsTheConsoles() {
    XCTAssertEqual(mediaLibraryMoveLabel(.toSite), "Move to this site's library")
    XCTAssertEqual(mediaLibraryMoveLabel(.toOrg), "Move to organization library")
    XCTAssertEqual(
      mediaLibraryMoveIntro(.toSite, movable: 3, documents: 2),
      "3 files will move to this site's library. Only this site will be able to use them. 2 pages, products or settings that use them will be updated to the new address, and the old address keeps working.")
    XCTAssertEqual(
      mediaLibraryMoveIntro(.toOrg, movable: 1, documents: 1),
      "1 file will move to the organization library. Every site in the workspace will be able to use them. 1 page, product or setting that uses them will be updated to the new address, and the old address keeps working.")
    XCTAssertEqual(
      mediaLibraryMoveIntro(.toOrg, movable: 2, documents: 0),
      "2 files will move to the organization library. Every site in the workspace will be able to use them. Nothing uses them yet.")
    XCTAssertEqual(mediaLibraryMoveButton(4), "Move 4 files")
    XCTAssertEqual(mediaLibraryMoveButton(1), "Move 1 file")
    XCTAssertEqual(mediaLibraryMoveButton(0), "Move")
    XCTAssertEqual(mediaLibraryStaysHeading(1), "1 file will stay where it is:")
    XCTAssertEqual(mediaLibraryStaysHeading(2), "2 files will stay where they are:")
    XCTAssertEqual(
      mediaLibraryRefusalLine(MediaLibraryRefusal(mediaID: "b", name: "b.png", reason: "Stays in the organization library: used by Shop")),
      "b.png: used by Shop")
    XCTAssertEqual(mediaLibraryNothingMoves(.toSite), "None of these files can move to this site's library.")
    XCTAssertEqual(
      MediaLibraryMoveReport(MediaLibraryMoveOutcome(movedIDs: ["a", "b"], notMoved: [], uses: 1), direction: .toSite, total: 2),
      .success("Moved 2 files to this site's library and updated 1 use"))
    let four = (1...4).map { MediaLibraryRefusal(mediaID: "\($0)", name: "\($0).png", reason: nil) }
    XCTAssertEqual(
      mediaLibraryPartialMessage(.toSite, moved: 0, total: 4, uses: 0, notMoved: four),
      #"Could not move 4 files to this site's library — 4 are where they were: "1.png", "2.png", "3.png" and 1 more, and are still selected"#)
    XCTAssertEqual(
      mediaLibraryPartialMessage(.toOrg, moved: 1, total: 2, uses: 0, notMoved: [four[0]]),
      #"Moved 1 of 2 to the organization library and updated 0 uses — 1 could not be moved: "1.png", and is still selected"#)
  }
}
