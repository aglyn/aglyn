// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// An `HTTPTransport` that records each request and answers from a queue.
final class RecordingTransport: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private var answers: [(Int, String)]
  private(set) var requests: [URLRequest] = []
  var failNext = false

  init(_ answers: [(Int, String)]) { self.answers = answers }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (status, body): (Int, String) = try lock.withLock {
      requests.append(request)
      if failNext {
        failNext = false
        throw URLError(.notConnectedToInternet)
      }
      return answers.isEmpty ? (200, "{}") : answers.removeFirst()
    }
    let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    return (Data(body.utf8), response)
  }

  func json(_ index: Int) -> [String: Any] {
    let body = lock.withLock { requests[index].httpBody } ?? Data()
    return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
  }
}

final class Clock: @unchecked Sendable {
  var now = Date(timeIntervalSince1970: 1_800_000_000)
}

final class IdentityToolkitAuthTests: XCTestCase {
  private let signedIn = #"{"localId":"u1","email":"a@example.test","displayName":"","idToken":"id1","refreshToken":"r1","expiresIn":"3600"}"#

  private func auth(_ transport: RecordingTransport, store: AuthCredentialStore = MemoryCredentialStore(), clock: Clock = Clock())
    -> IdentityToolkitAuth
  {
    IdentityToolkitAuth(apiKey: "key", emulatorHost: "127.0.0.1:9399", transport: transport, store: store, now: { clock.now })
  }

  func testSignsInWithPasswordAndKeepsTheRefreshToken() async throws {
    let transport = RecordingTransport([(200, signedIn)])
    let store = MemoryCredentialStore()
    let user = try await auth(transport, store: store).signIn(email: "  a@example.test ", password: "pw")
    XCTAssertEqual(user, AglynUser(uid: "u1", email: "a@example.test", displayName: nil))
    XCTAssertEqual(
      transport.requests[0].url?.absoluteString,
      "http://127.0.0.1:9399/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=key")
    XCTAssertEqual(transport.json(0)["email"] as? String, "a@example.test")
    XCTAssertEqual(transport.json(0)["returnSecureToken"] as? Bool, true)
    XCTAssertEqual(store.load()?.refreshToken, "r1")
    XCTAssertEqual(store.load()?.uid, "u1")
  }

  func testAPasswordChangeProvesTheCurrentOneThenReplacesTheTokens() async throws {
    let transport = RecordingTransport([
      (200, signedIn),
      (200, #"{"idToken":"id2","refreshToken":"r2","expiresIn":"3600"}"#),
    ])
    let store = MemoryCredentialStore()
    let session = auth(transport, store: store)
    try await session.changePassword(email: "a@example.test", current: "old", new: "a-much-longer-new-one")
    XCTAssertEqual(transport.requests[0].url?.path.hasSuffix("accounts:signInWithPassword"), true)
    XCTAssertEqual(transport.json(0)["password"] as? String, "old")
    XCTAssertEqual(transport.requests[1].url?.path.hasSuffix("accounts:update"), true)
    XCTAssertEqual(transport.json(1)["idToken"] as? String, "id1")
    XCTAssertEqual(transport.json(1)["password"] as? String, "a-much-longer-new-one")
    XCTAssertEqual(store.load()?.refreshToken, "r2")
    let token = try await session.idToken(forceRefresh: false)
    XCTAssertEqual(token, "id2")
  }

  func testAWrongCurrentPasswordStopsTheChangeBeforeTheUpdate() async {
    let transport = RecordingTransport([(400, #"{"error":{"message":"INVALID_LOGIN_CREDENTIALS"}}"#)])
    do {
      try await auth(transport).changePassword(email: "a@example.test", current: "bad", new: "whatever-long-enough")
      XCTFail("expected a refusal")
    } catch {
      XCTAssertEqual(passwordChangeMessage(error), "Your current password is not right.")
    }
    XCTAssertEqual(transport.requests.count, 1)
  }

  func testTheDisplayNameIsSetOnTheAccountAndKept() async throws {
    let transport = RecordingTransport([(200, signedIn), (200, #"{"idToken":"id1","refreshToken":"r1"}"#)])
    let store = MemoryCredentialStore()
    let session = auth(transport, store: store)
    try await session.signIn(email: "a@example.test", password: "pw")
    let user = try await session.updateDisplayName("Ada Lovelace")
    XCTAssertEqual(user.displayName, "Ada Lovelace")
    XCTAssertEqual(transport.json(1)["displayName"] as? String, "Ada Lovelace")
    XCTAssertEqual(store.load()?.displayName, "Ada Lovelace")
  }

  func testARefusedSignInCarriesTheCode() async {
    let transport = RecordingTransport([(400, #"{"error":{"message":"INVALID_LOGIN_CREDENTIALS"}}"#)])
    do {
      try await auth(transport).signIn(email: "a@example.test", password: "bad")
      XCTFail("expected a refusal")
    } catch {
      XCTAssertEqual(error as? IdentityToolkitError, IdentityToolkitError(code: "INVALID_LOGIN_CREDENTIALS", status: 400))
      XCTAssertEqual(signInErrorMessage(error), "That email and password do not match an Aglyn account.")
    }
  }

  func testACodeWithADetailIsReadAsTheCode() async {
    let transport = RecordingTransport([(400, #"{"error":{"message":"TOO_MANY_ATTEMPTS_TRY_LATER : Access disabled"}}"#)])
    do {
      try await auth(transport).signIn(email: "a@example.test", password: "bad")
      XCTFail("expected a refusal")
    } catch {
      XCTAssertEqual(signInErrorMessage(error), "Too many attempts. Wait a few minutes, then try again.")
    }
  }

  func testNoAnswerReadsAsUnreachable() async {
    let transport = RecordingTransport([])
    transport.failNext = true
    do {
      try await auth(transport).signIn(email: "a@example.test", password: "pw")
      XCTFail("expected a refusal")
    } catch {
      XCTAssertEqual(signInErrorMessage(error), "Aglyn could not be reached. Check the connection and try again.")
    }
  }

  func testATokenIsReusedUntilAMinuteBeforeItExpires() async throws {
    let clock = Clock()
    let transport = RecordingTransport([
      (200, signedIn), (200, #"{"id_token":"id2","refresh_token":"r2","expires_in":"3600"}"#),
    ])
    let auth = self.auth(transport, clock: clock)
    try await auth.signIn(email: "a@example.test", password: "pw")
    let first = try await auth.idToken(forceRefresh: false)
    XCTAssertEqual(first, "id1")
    clock.now = clock.now.addingTimeInterval(3550)
    let second = try await auth.idToken(forceRefresh: false)
    XCTAssertEqual(second, "id2")
    XCTAssertEqual(
      transport.requests[1].url?.absoluteString, "http://127.0.0.1:9399/securetoken.googleapis.com/v1/token?key=key")
    XCTAssertEqual(
      String(data: transport.requests[1].httpBody ?? Data(), encoding: .utf8), "grant_type=refresh_token&refresh_token=r1")
  }

  func testARefusedRefreshSignsOut() async throws {
    let store = MemoryCredentialStore()
    let transport = RecordingTransport([(200, signedIn), (400, #"{"error":{"message":"TOKEN_EXPIRED"}}"#)])
    let auth = self.auth(transport, store: store)
    try await auth.signIn(email: "a@example.test", password: "pw")
    let token = try await auth.idToken(forceRefresh: true)
    XCTAssertNil(token)
    let user = await auth.user
    XCTAssertNil(user)
    XCTAssertNil(store.load())
  }

  func testRestoresTheKeptSession() async {
    let store = MemoryCredentialStore(StoredAuthSession(uid: "u1", email: "a@example.test", displayName: "Ada", refreshToken: "r1"))
    let transport = RecordingTransport([(200, #"{"id_token":"id9","refresh_token":"r9","expires_in":"3600"}"#)])
    let auth = self.auth(transport, store: store)
    let user = await auth.restore()
    XCTAssertEqual(user, AglynUser(uid: "u1", email: "a@example.test", displayName: "Ada"))
    let token = try? await auth.idToken(forceRefresh: false)
    XCTAssertEqual(token, "id9")
    XCTAssertEqual(store.load()?.refreshToken, "r9")
  }

  func testARevokedKeptSessionIsDropped() async {
    let store = MemoryCredentialStore(StoredAuthSession(uid: "u1", email: nil, displayName: nil, refreshToken: "r1"))
    let auth = self.auth(RecordingTransport([(400, #"{"error":{"message":"USER_DISABLED"}}"#)]), store: store)
    let user = await auth.restore()
    XCTAssertNil(user)
    XCTAssertNil(store.load())
  }

  func testAnOfflineRestoreKeepsTheSessionForNextTime() async {
    let store = MemoryCredentialStore(StoredAuthSession(uid: "u1", email: nil, displayName: nil, refreshToken: "r1"))
    let transport = RecordingTransport([])
    transport.failNext = true
    let user = await auth(transport, store: store).restore()
    XCTAssertNil(user)
    XCTAssertEqual(store.load()?.refreshToken, "r1")
  }

  func testSendsThePasswordReset() async throws {
    let transport = RecordingTransport([(200, "{}")])
    try await auth(transport).sendPasswordReset(email: "a@example.test")
    XCTAssertEqual(transport.json(0)["requestType"] as? String, "PASSWORD_RESET")
  }

  func testAnUnknownOverrideFallsBackToTheSignature() {
    XCTAssertEqual(AuthTransport.resolve(override: "rest"), .rest)
    XCTAssertEqual(AuthTransport.resolve(override: "sdk"), .sdk)
  }
}

final class RestFirestoreReaderTests: XCTestCase {
  private func reader(_ transport: RecordingTransport) -> RestFirestoreReader {
    RestFirestoreReader(projectID: "demo", emulatorHost: "127.0.0.1:8389", transport: transport) { "tok" }
  }

  func testQueriesTheParentWithAStructuredQuery() {
    let query = FirestoreQuery(
      ["users", "u1", "orgs"], equals: [("orgId", "o1"), ("archived", false)],
      order: [.init("createdAt", descending: true)], limit: 20)
    let reader = self.reader(RecordingTransport([]))
    XCTAssertEqual(
      reader.runQueryURL(query),
      "http://127.0.0.1:8389/v1/projects/demo/databases/(default)/documents/users/u1:runQuery")
    let body = reader.runQueryBody(query)["structuredQuery"] as? [String: Any]
    XCTAssertEqual((body?["from"] as? [[String: Any]])?.first?["collectionId"] as? String, "orgs")
    XCTAssertEqual(body?["limit"] as? Int, 20)
    let filters = ((body?["where"] as? [String: Any])?["compositeFilter"] as? [String: Any])?["filters"] as? [[String: Any]]
    XCTAssertEqual(filters?.count, 2)
    let second = filters?[1]["fieldFilter"] as? [String: Any]
    XCTAssertEqual((second?["value"] as? [String: Any])?["booleanValue"] as? Bool, false)
    let order = (body?["orderBy"] as? [[String: Any]])?.first
    XCTAssertEqual(order?["direction"] as? String, "DESCENDING")
  }

  func testAPlanFilterTravelsAsItsRESTOperator() {
    let reader = self.reader(RecordingTransport([]))
    let query = FirestoreQuery(
      ["hosts", "h1", "products"],
      filters: [
        ListQueryConstraint(path: "categoryIds", op: .arrayContains, value: "c1"),
        ListQueryConstraint(path: "__name__", op: .in, value: ["p1", "p2"]),
      ],
      order: [.init("nameLower")])
    let body = reader.runQueryBody(query)["structuredQuery"] as? [String: Any]
    let filters = ((body?["where"] as? [String: Any])?["compositeFilter"] as? [String: Any])?["filters"] as? [[String: Any]]
    let array = filters?[0]["fieldFilter"] as? [String: Any]
    XCTAssertEqual(array?["op"] as? String, "ARRAY_CONTAINS")
    let ids = filters?[1]["fieldFilter"] as? [String: Any]
    XCTAssertEqual(ids?["op"] as? String, "IN")
    let values = ((ids?["value"] as? [String: Any])?["arrayValue"] as? [String: Any])?["values"] as? [[String: Any]]
    XCTAssertEqual(
      values?.first?["referenceValue"] as? String, "projects/demo/databases/(default)/documents/hosts/h1/products/p1")
  }

  func testATopLevelCollectionQueriesTheDatabaseRoot() {
    XCTAssertEqual(
      reader(RecordingTransport([])).runQueryURL(FirestoreQuery(["hosts"])),
      "http://127.0.0.1:8389/v1/projects/demo/databases/(default)/documents:runQuery")
  }

  func testDecodesValuesAsTheSDKReaderHandsThemOut() {
    let decoded = RestFirestoreReader.decodeValue([
      "mapValue": [
        "fields": [
          "n": ["integerValue": "42"],
          "d": ["doubleValue": 1.5],
          "b": ["booleanValue": true],
          "t": ["timestampValue": "2026-10-07T12:00:00.123456Z"],
          "r": ["referenceValue": "projects/demo/databases/(default)/documents/hosts/h1"],
          "a": ["arrayValue": ["values": [["stringValue": "x"]]]],
          "z": ["nullValue": NSNull()],
        ]
      ]
    ]) as? [String: Any]
    XCTAssertEqual((decoded?["n"] as? NSNumber)?.intValue, 42)
    XCTAssertEqual((decoded?["d"] as? NSNumber)?.doubleValue, 1.5)
    XCTAssertEqual(decoded?["b"] as? Bool, true)
    XCTAssertEqual((decoded?["t"] as? Date)?.timeIntervalSince1970 ?? 0, 1_791_374_400.123, accuracy: 0.001)
    XCTAssertEqual(decoded?["r"] as? String, "hosts/h1")
    XCTAssertEqual(decoded?["a"] as? [String], ["x"])
    XCTAssertTrue(decoded?["z"] is NSNull)
  }

  func testEncodesBooleansIntegersAndDoublesApart() {
    XCTAssertEqual(RestFirestoreReader.encodeValue(true)["booleanValue"] as? Bool, true)
    XCTAssertEqual(RestFirestoreReader.encodeValue(7)["integerValue"] as? String, "7")
    XCTAssertEqual(RestFirestoreReader.encodeValue(2.5)["doubleValue"] as? Double, 2.5)
  }

  func testAMergeWritesLeavesAndMovesServerTimestampsToTransforms() async throws {
    let transport = RecordingTransport([(200, "{}")])
    try await reader(transport).setDocument(
      ["users", "u1", "devices", "d1"],
      ["token": "abc", "lastSeen": FirestoreSentinel.serverTimestamp, "prefs": ["order-paid": true]],
      merge: true)
    XCTAssertEqual(
      transport.requests[0].url?.absoluteString,
      "http://127.0.0.1:8389/v1/projects/demo/databases/(default)/documents:commit")
    XCTAssertEqual(transport.requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer tok")
    let write = (transport.json(0)["writes"] as? [[String: Any]])?.first
    XCTAssertEqual(
      (write?["update"] as? [String: Any])?["name"] as? String,
      "projects/demo/databases/(default)/documents/users/u1/devices/d1")
    XCTAssertEqual((write?["updateMask"] as? [String: Any])?["fieldPaths"] as? [String], ["prefs.`order-paid`", "token"])
    let transform = (write?["updateTransforms"] as? [[String: Any]])?.first
    XCTAssertEqual(transform?["fieldPath"] as? String, "lastSeen")
    XCTAssertEqual(transform?["setToServerValue"] as? String, "REQUEST_TIME")
  }

  func testAMissingDocumentIsNil() async throws {
    let document = try await reader(RecordingTransport([(404, "{}")])).get(["hosts", "nope"])
    XCTAssertNil(document)
  }

  func testARefusedReadSaysPermission() async {
    do {
      _ = try await reader(RecordingTransport([(403, #"{"error":{"message":"Missing or insufficient permissions."}}"#)]))
        .get(["hosts", "h1"])
      XCTFail("expected a refusal")
    } catch {
      XCTAssertEqual((error as? ConsoleAPIError)?.message, "You do not have permission to do that.")
    }
  }

  func testAMergeDeletesAFieldByNamingItWithNoValue() {
    var transforms: [[String: Any]] = []
    let fields: [String: Any] = ["approvedBy": FirestoreSentinel.delete, "enabled": true]
    let encoded = RestFirestoreReader.encodeFields(fields, prefix: [], transforms: &transforms)
    XCTAssertNil(encoded["approvedBy"])
    XCTAssertNotNil(encoded["enabled"])
    XCTAssertEqual(RestFirestoreReader.leafPaths(fields, prefix: []), ["approvedBy", "enabled"])
  }
}
