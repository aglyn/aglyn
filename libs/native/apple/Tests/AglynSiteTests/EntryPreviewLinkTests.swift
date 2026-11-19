// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

private final class LinkTransport: HTTPTransport, @unchecked Sendable {
  var sent: [(path: String, body: [String: Any])] = []

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    sent.append((request.url?.path ?? "", body))
    let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    return (Data(#"{"url":"https://shop.aglyn.app/blog/hello?aglyn_preview=sig","expiresAtMs":1}"#.utf8), response)
  }
}

private final class NoReader: FirestoreReader, @unchecked Sendable {
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening {
    NoListener()
  }
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening {
    NoListener()
  }
  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}
}

@MainActor
final class EntryPreviewLinkTests: XCTestCase {
  func testAsksTheConsoleToSignAPreviewLinkForTheEntry() async throws {
    let transport = LinkTransport()
    let client = ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
    let api = ContentAPI(api: client, writer: NoFirestoreWrites(), reader: NoReader(), hostID: "h")
    let url = try await api.previewLink(collectionSlug: "blog", entrySlug: "hello")
    XCTAssertEqual(url?.absoluteString, "https://shop.aglyn.app/blog/hello?aglyn_preview=sig")
    XCTAssertEqual(transport.sent.map(\.path), ["/api/content/preview-link"])
    XCTAssertEqual(transport.sent.first?.body["collectionSlug"] as? String, "blog")
    XCTAssertEqual(transport.sent.first?.body["entrySlug"] as? String, "hello")
    XCTAssertEqual(transport.sent.first?.body["hostId"] as? String, "h")
  }
}
