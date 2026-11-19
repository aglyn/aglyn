// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import XCTest

@testable import AglynSite

private final class EmptyReader: FirestoreReader, @unchecked Sendable {
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening {
    onChange(.success([]))
    return NoListener()
  }
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening {
    onChange(.success(nil))
    return NoListener()
  }
  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}
}

private final class NoTransport: HTTPTransport, @unchecked Sendable {
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    (Data("{}".utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }
}

/// The keys the person holds, as the app's member store learns them: empty until it has read them.
@MainActor
private final class HeldKeys {
  var keys: Set<String> = []
}

/// A page or an entry pushed on a phone holds its view's value from the moment it is pushed. The permissions it shows
/// are read when it is drawn, so a permission that arrives after the push (a cold start from a link) enables its
/// controls without reopening it.
@MainActor
final class LivePermissionsTests: XCTestCase {
  private func context(_ held: HeldKeys) -> NativePluginContext {
    let client = ConsoleAPIClient(
      origin: "https://console.test", getIDToken: { _ in "t" }, transport: NoTransport(), sleep: { _ in }, maxAttempts: 1)
    return NativePluginContext(
      uid: "u", orgID: "o", hostID: "h", orgSlug: "org", hostSlug: "site", firestore: EmptyReader(), api: client,
      navigate: { _, _ in }, openBesigner: { _ in },
      permission: { key, _ in held.keys.contains(key) })
  }

  func testAPushedPageEnablesItsControlsWhenThePermissionArrivesAfterIt() {
    let held = HeldKeys()
    let context = context(held)
    let page = PageDetail(
      context: context, hostID: "h", pageID: "page-about", model: SitePagesModel(),
      api: PagesAPI(api: context.api, writer: context.writer, hostID: "h"), runner: ActionRunner(), pushed: true)
    XCTAssertFalse(page.canEdit)
    XCTAssertFalse(page.canPublish)

    held.keys = ["site.edit", "site.publish"]

    XCTAssertTrue(page.canEdit)
    XCTAssertTrue(page.canPublish)
  }

  func testAPushedEntryEnablesItsControlsWhenThePermissionArrivesAfterIt() {
    let held = HeldKeys()
    let context = context(held)
    let env = ContentEnv(
      context: context, hostID: "h",
      api: ContentAPI(api: context.api, writer: context.writer, reader: context.firestore, hostID: "h"),
      runner: ActionRunner(), host: LiveDocument(), open: { _ in })
    XCTAssertFalse(env.canWrite)
    XCTAssertFalse(env.canPublish)

    held.keys = ["site.edit"]
    XCTAssertTrue(env.canWrite)
    XCTAssertFalse(env.canPublish)

    held.keys = ["site.edit", "site.publish"]
    XCTAssertTrue(env.canPublish)
  }
}
