// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

private final class MetadataTransport: HTTPTransport, @unchecked Sendable {
  var sent: [[String: Any]] = []
  let answer: String

  init(_ answer: String) { self.answer = answer }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    sent.append(request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:])
    return (Data(answer.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}

final class MediaEmbeddedTests: XCTestCase {
  private let stored: [String: Any] = [
    "version": 1, "format": "jpeg", "writable": true, "contentSha256": "abc",
    "fields": [
      ["key": "make", "label": "Camera make", "group": "capture", "value": "Canon", "editable": true],
      ["key": "gps", "label": "Location", "group": "location", "value": "41.8781,-87.6298", "editable": true],
      ["key": "keywords", "label": "Keywords", "group": "description", "values": ["cake", "wedding"], "editable": true],
    ],
  ]

  func testReadsTheStoredRecordAndGroupsItInTheConsolesOrder() throws {
    let record = try XCTUnwrap(MediaEmbeddedRecord(stored))
    XCTAssertEqual(record.groups.map(\.label), ["Description", "Location", "Camera"])
    XCTAssertEqual(record.gps?.value, "41.8781,-87.6298")
    XCTAssertTrue(record.isCurrent(contentSha256: "abc"))
    XCTAssertFalse(record.isCurrent(contentSha256: "replaced"))
    var older = stored
    older["version"] = 0
    XCTAssertFalse(try XCTUnwrap(MediaEmbeddedRecord(older)).isCurrent(contentSha256: "abc"))
    XCTAssertNil(MediaEmbeddedRecord(["version": 1]))
  }

  func testDressesValuesAsTheConsoleDoes() {
    let gps = MediaEmbeddedField(key: "gps", label: "Location", group: "location", value: "41.8781,-87.6298")
    XCTAssertEqual(embeddedFieldDisplay(gps), "41.87810° N, 87.62980° W")
    XCTAssertEqual(embeddedFieldDisplay(.init(key: "rating", label: "Rating", group: "description", value: "3")), "★★★☆☆")
    XCTAssertEqual(embeddedFieldDisplay(.init(key: "rating", label: "Rating", group: "description", value: "-1")), "Rejected")
    XCTAssertEqual(embeddedFieldDisplay(.init(key: "keywords", label: "Keywords", group: "description", values: ["a", "b"])), "a, b")
    let utc = TimeZone(identifier: "UTC")!
    let taken = MediaEmbeddedField(key: "createdAt", label: "Taken", group: "capture", value: "2026-05-01")
    XCTAssertEqual(embeddedFieldDisplay(taken, locale: Locale(identifier: "en_US"), timeZone: utc), "May 1, 2026")
    let stamped = MediaEmbeddedField(key: "createdAt", label: "Taken", group: "capture", value: "2026-05-01T14:30:00Z")
    XCTAssertTrue(embeddedFieldDisplay(stamped, locale: Locale(identifier: "en_US"), timeZone: utc).hasPrefix("May 1, 2026"))
    XCTAssertEqual(embeddedFieldDisplay(.init(key: "createdAt", label: "Taken", group: "capture", value: "soon")), "soon")
  }

  func testOnlyFormatsWithAReaderAreRead() {
    XCTAssertTrue(embeddedMetadataReadable("image/jpeg"))
    XCTAssertTrue(embeddedMetadataReadable("IMAGE/PNG; charset=binary"))
    XCTAssertFalse(embeddedMetadataReadable("audio/mpeg"))
  }

  func testRemoveLocationWritesANullGpsNamingTheDigestItWasShown() async throws {
    let transport = MetadataTransport(#"{"embeddedMetadata":{"version":1,"format":"jpeg","writable":true,"fields":[]},"contentSha256":"def"}"#)
    let client = ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
    let api = MediaAPI(api: client, scope: .site(hostID: "h"))
    let answer = try await api.removeLocation("m", expectedSha256: "abc")
    XCTAssertFalse(answer.unchanged)
    XCTAssertEqual(answer.record?.fields, [])
    let body = try XCTUnwrap(transport.sent.first)
    XCTAssertEqual(body["hostId"] as? String, "h")
    XCTAssertEqual(body["mediaId"] as? String, "m")
    XCTAssertEqual(body["action"] as? String, "write")
    XCTAssertEqual(body["expectedSha256"] as? String, "abc")
    XCTAssertTrue((body["patch"] as? [String: Any])?["gps"] is NSNull)
  }
}
