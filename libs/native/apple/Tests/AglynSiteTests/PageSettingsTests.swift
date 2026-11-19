// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

private final class SettingsTransport: HTTPTransport, @unchecked Sendable {
  var sent: [(path: String, body: [String: Any])] = []

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    sent.append((request.url?.path ?? "", body))
    let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    return (Data(#"{"reason":"ok"}"#.utf8), response)
  }
}

private final class SettingsReader: FirestoreReader, @unchecked Sendable {
  var staged: [[String]] = []
  var deleted: [[String]] = []
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening {
    onChange(.success([]))
    return NoListener()
  }
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening {
    onChange(.success(nil))
    return NoListener()
  }
  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws { staged.append(path) }
  func deleteDocument(_ path: [String]) async throws { deleted.append(path) }
}

private final class SettingsWriter: FirestoreWriter, @unchecked Sendable {
  var merges: [(path: [String], data: [String: Any])] = []
  var updates: [(path: [String], data: [String: Any])] = []
  func merge(_ path: [String], _ data: [String: Any]) async throws { merges.append((path, data)) }
  func update(_ path: [String], _ data: [String: Any]) async throws { updates.append((path, data)) }
}

private func isDelete(_ value: Any?) -> Bool {
  if case FirestoreSentinel.delete? = value as? FirestoreSentinel { return true }
  return false
}

@MainActor
final class PageSettingsTests: XCTestCase {
  private func api() -> (PageSettingsAPI, SettingsTransport, SettingsWriter, SettingsReader) {
    let transport = SettingsTransport()
    let writer = SettingsWriter()
    let reader = SettingsReader()
    let client = ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
    return (PageSettingsAPI(api: client, writer: writer, reader: reader, hostID: "h"), transport, writer, reader)
  }

  func testVisibilityValuesAreTheConsolesHostScreenVisibility() {
    // PUBLIC = 1<<1, UNLISTED = PUBLIC | 1<<2, PASSWORD = PRIVATE(1<<3) | 1<<4, AUTHENTICATED = PRIVATE | 1<<5.
    XCTAssertEqual(PageVisibility.allCases.map(\.rawValue), [2, 6, 24, 40])
    XCTAssertEqual(PageVisibility.allCases.map(\.label), ["Public", "Unlisted", "Password protected", "Members only"])
  }

  func testReadsAccessAndScheduleFromTheScreenDocument() {
    let none = PageSettings(nil)
    XCTAssertEqual(none.visibility, .everyone)
    XCTAssertFalse(none.hasPassword)
    XCTAssertNil(none.pending)

    let at = Date(timeIntervalSince1970: 1_800_000_000)
    let doc = FirestoreDocument(
      id: "p1",
      data: [
        "visibility": 24, "protection": ["passwordHash": "abc"],
        "publishSchedule": ["action": "publish", "versionId": "v2", "publishAt": at, "status": "pending"],
      ])
    let settings = PageSettings(doc)
    XCTAssertEqual(settings.visibility, .password)
    XCTAssertTrue(settings.hasPassword)
    XCTAssertEqual(settings.pending?.versionID, "v2")
    XCTAssertNil(settings.skippedLabel)
    XCTAssertEqual(pageScheduleLabel(settings.pending!, format: { _ in "then" }), "Publishes then")

    // A stored value the card does not offer reads as none of its choices.
    XCTAssertNil(PageSettings(FirestoreDocument(id: "p", data: ["visibility": 8])).visibility)
  }

  func testASkippedScheduleIsShownWithTheConsolesWords() {
    let unentitled = PageSettings(
      FirestoreDocument(id: "p", data: ["publishSchedule": ["action": "unpublish", "status": "skipped-unentitled"]]))
    XCTAssertNil(unentitled.pending)
    XCTAssertEqual(unentitled.skippedLabel, "Did not unpublish — plan does not include scheduling")
    XCTAssertTrue(unentitled.skippedHelp?.hasPrefix("Scheduled publishing is a Pro feature.") == true)
    let unroutable = PageSettings(
      FirestoreDocument(id: "p", data: ["publishSchedule": ["action": "publish", "status": "skipped-unroutable"]]))
    XCTAssertEqual(unroutable.skippedLabel, "Did not publish — no available address")
  }

  func testPreviewReadsOnlyAnExplicitTrue() {
    XCTAssertTrue(isPageInPreview(["previewScreens": ["p1": true]], pageID: "p1"))
    XCTAssertFalse(isPageInPreview(["previewScreens": ["p1": false]], pageID: "p1"))
    XCTAssertFalse(isPageInPreview(nil, pageID: "p1"))
    XCTAssertTrue(isSiteInPreview(["preview": true]))
    XCTAssertFalse(isSiteInPreview(["preview": "yes"]))
    XCTAssertEqual(
      pagePreviewCaption(siteInPreview: false, pageInPreview: true), "Visitors get your 404 page here until you switch this off.")
  }

  func testThePasswordIsStoredAsItsSha256Hex() {
    XCTAssertEqual(pagePasswordHash("secret"), "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b")
  }

  func testTheScheduleStartsAtTheNextWholeHour() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    // 1_800_000_000 is on the hour; twenty minutes past it, the first time offered is the next whole hour.
    let now = Date(timeIntervalSince1970: 1_800_000_000 + 1234)
    XCTAssertEqual(defaultScheduleTime(now: now, calendar: calendar).timeIntervalSince1970, 1_800_000_000 + 3600)
  }

  func testLeavingPasswordModeDropsTheHashAndAnnouncesALivePage() async throws {
    let (api, transport, writer, _) = api()
    try await api.setVisibility("p1", .unlisted, hadPassword: true, livePath: "/about")
    XCTAssertEqual(writer.updates.first?.path, ["hosts", "h", "screens", "p1"])
    XCTAssertEqual(writer.updates.first?.data["visibility"] as? Int, 6)
    XCTAssertTrue(isDelete(writer.updates.first?.data["protection"]))
    XCTAssertEqual(transport.sent.map(\.path), ["/api/screens/revalidate"])
    XCTAssertEqual(transport.sent.first?.body["screenId"] as? String, "p1")

    // A page with no address has no cached copy to drop; password mode keeps the hash.
    try await api.setVisibility("p2", .password, hadPassword: true, livePath: nil)
    XCTAssertNil(writer.updates.last?.data["protection"])
    XCTAssertEqual(transport.sent.count, 1)
  }

  func testSavesThePasswordHashOrRemovesProtection() async throws {
    let (api, _, writer, _) = api()
    try await api.setPassword("p1", "  secret ", livePath: nil)
    XCTAssertEqual(
      (writer.updates.first?.data["protection"] as? [String: Any])?["passwordHash"] as? String, pagePasswordHash("secret"))
    try await api.setPassword("p1", "   ", livePath: nil)
    XCTAssertTrue(isDelete(writer.updates.last?.data["protection"]))
  }

  func testSchedulesAndCancels() async throws {
    let (api, _, writer, _) = api()
    let at = Date(timeIntervalSince1970: 1_900_000_000)
    try await api.schedule("p1", unpublish: false, versionID: "v2", at: at)
    let publish = try XCTUnwrap(writer.updates.first?.data["publishSchedule"] as? [String: Any])
    XCTAssertEqual(publish["action"] as? String, "publish")
    XCTAssertEqual(publish["versionId"] as? String, "v2")
    XCTAssertEqual(publish["publishAt"] as? Date, at)
    XCTAssertEqual(publish["status"] as? String, "pending")
    XCTAssertNotNil(publish["createdAt"] as? Date)

    try await api.schedule("p1", unpublish: true, versionID: "v2", at: at)
    let unpublish = try XCTUnwrap(writer.updates.last?.data["publishSchedule"] as? [String: Any])
    XCTAssertEqual(unpublish["action"] as? String, "unpublish")
    XCTAssertNil(unpublish["versionId"])

    try await api.cancelSchedule("p1")
    XCTAssertTrue(isDelete(writer.updates.last?.data["publishSchedule"]))
  }

  func testThePreviewSwitchWritesTheHostAndAnnouncesTheWholeSite() async throws {
    let (api, transport, writer, reader) = api()
    try await api.setPreview("p1", true)
    XCTAssertEqual(writer.merges.first?.path, ["hosts", "h"])
    XCTAssertEqual((writer.merges.first?.data["previewScreens"] as? [String: Any])?["p1"] as? Bool, true)
    XCTAssertEqual(transport.sent.first?.body["entireHost"] as? Bool, true)
    XCTAssertEqual(reader.staged.first?.first, "publishOutbox")
    XCTAssertEqual(reader.deleted.count, 1)

    try await api.setPreview("p1", false)
    XCTAssertTrue(isDelete((writer.merges.last?.data["previewScreens"] as? [String: Any])?["p1"]))
  }
}
