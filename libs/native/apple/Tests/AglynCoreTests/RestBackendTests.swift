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

  func testTheKeychainItemIsNamedPerBuild() {
    XCTAssertEqual(
      restAuthKeychainService(bundleID: "com.aglyn.pos", buildHash: "0123456789abcdef0123456789abcdef01234567"),
      "com.aglyn.pos.rest-auth.0123456789abcdef")
    XCTAssertEqual(restAuthKeychainService(bundleID: "com.aglyn.app", buildHash: nil), "com.aglyn.app.rest-auth")
    XCTAssertEqual(restAuthKeychainService(bundleID: "com.aglyn.app", buildHash: ""), "com.aglyn.app.rest-auth")
  }

  #if os(macOS)
    func testThisBuildHasACodeHash() {
      XCTAssertNotNil(CodeSignature.currentUniqueHash())
    }
  #endif

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

  /// A custom token (a passkey's, or a support session's) is exchanged once, and the person is read off the ID token it answers.
  func testSignsInWithACustomTokenAndReadsWhoItIsOffTheToken() async throws {
    func encode(_ object: [String: Any]) -> String {
      let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
      return data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    }
    let idToken = "\(encode(["alg": "none"])).\(encode(["user_id": "u9", "email": "p@example.test", "name": "Pat"])).sig"
    let transport = RecordingTransport([
      (200, #"{"idToken":"\#(idToken)","refreshToken":"r9","expiresIn":"3600","isNewUser":false}"#)
    ])
    let store = MemoryCredentialStore()
    let user = try await auth(transport, store: store).signIn(customToken: "minted")
    XCTAssertEqual(user, AglynUser(uid: "u9", email: "p@example.test", displayName: "Pat"))
    XCTAssertEqual(transport.requests.map { $0.url?.lastPathComponent }, ["accounts:signInWithCustomToken"])
    XCTAssertEqual(transport.json(0)["token"] as? String, "minted")
    XCTAssertEqual(transport.json(0)["returnSecureToken"] as? Bool, true)
    XCTAssertNil(transport.json(0)["tenantId"], "no pool named, none sent")
    XCTAssertEqual(store.load()?.refreshToken, "r9")
    XCTAssertEqual(store.load()?.uid, "u9")
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

  func testDisconnectingAProviderAsksForItsDeletionAndKeepsTheFreshTokens() async throws {
    let transport = RecordingTransport([(200, signedIn), (200, #"{"idToken":"id2","refreshToken":"r2","expiresIn":"3600"}"#)])
    let store = MemoryCredentialStore()
    let session = auth(transport, store: store)
    try await session.signIn(email: "a@example.test", password: "pw")
    try await session.deleteProvider("google.com")
    XCTAssertTrue(transport.requests[1].url?.absoluteString.contains("accounts:update") == true)
    XCTAssertEqual(transport.json(1)["deleteProvider"] as? [String], ["google.com"])
    let token = try await session.idToken(forceRefresh: false)
    XCTAssertEqual(token, "id2")
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

  private func jwt(_ claims: [String: Any]) -> String {
    let data = try! JSONSerialization.data(withJSONObject: claims)
    let payload = data.base64EncodedString().replacingOccurrences(of: "=", with: "")
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
    return "h.\(payload).s"
  }

  /// Sign-up is the console's `createUserWithEmailAndPassword`: `accounts:signUp`, unverified on arrival.
  func testSignsUpWithEmailAndPassword() async throws {
    let token = jwt(["user_id": "u9", "email": "new@example.test", "email_verified": false])
    let transport = RecordingTransport([
      (200, #"{"localId":"u9","email":"new@example.test","idToken":"\#(token)","refreshToken":"r9","expiresIn":"3600"}"#)
    ])
    let store = MemoryCredentialStore()
    let user = try await auth(transport, store: store).signUp(email: " new@example.test ", password: "Pw1!pw")
    XCTAssertEqual(user, AglynUser(uid: "u9", email: "new@example.test", displayName: nil, emailVerified: false))
    XCTAssertEqual(
      transport.requests[0].url?.absoluteString,
      "http://127.0.0.1:9399/identitytoolkit.googleapis.com/v1/accounts:signUp?key=key")
    XCTAssertEqual(transport.json(0)["email"] as? String, "new@example.test")
    XCTAssertEqual(transport.json(0)["password"] as? String, "Pw1!pw")
    XCTAssertEqual(store.load()?.refreshToken, "r9")
  }

  /// A provider credential signs in, and says whether it signed somebody up.
  func testSignsInWithAnIdentityProviderAndSaysWhetherItWasNew() async throws {
    let token = jwt(["user_id": "g1", "email": "g@example.test", "email_verified": true])
    let transport = RecordingTransport([
      (200, #"{"localId":"g1","email":"g@example.test","displayName":"Grace","idToken":"\#(token)","refreshToken":"rg","isNewUser":true}"#)
    ])
    let (user, isNew) = try await auth(transport).signIn(idpPostBody: "id_token=abc&providerId=google.com")
    XCTAssertTrue(isNew)
    XCTAssertEqual(user, AglynUser(uid: "g1", email: "g@example.test", displayName: "Grace", emailVerified: true))
    XCTAssertTrue(transport.requests[0].url!.absoluteString.hasSuffix("/v1/accounts:signInWithIdp?key=key"))
    XCTAssertEqual(transport.json(0)["postBody"] as? String, "id_token=abc&providerId=google.com")
    XCTAssertEqual(transport.json(0)["requestUri"] as? String, "http://localhost")
  }

  /// The emailed links' codes: a verification applied, a reset code checked, then used.
  func testRedeemsTheEmailedActionCodes() async throws {
    let transport = RecordingTransport([(200, "{}"), (200, #"{"email":"a@example.test"}"#), (200, "{}")])
    let session = auth(transport)
    try await session.applyActionCode("v-code")
    let email = try await session.verifyPasswordResetCode("r-code")
    try await session.confirmPasswordReset(code: "r-code", newPassword: "New1!pw")
    XCTAssertEqual(email, "a@example.test")
    XCTAssertTrue(transport.requests[0].url!.absoluteString.contains("/v1/accounts:update?"))
    XCTAssertEqual(transport.json(0)["oobCode"] as? String, "v-code")
    XCTAssertTrue(transport.requests[1].url!.absoluteString.contains("/v1/accounts:resetPassword?"))
    XCTAssertNil(transport.json(1)["newPassword"])
    XCTAssertEqual(transport.json(2)["newPassword"] as? String, "New1!pw")
  }

  /// Whether the address is confirmed is read off each fresh token.
  func testAReloadReadsTheConfirmedAddressOffTheFreshToken() async throws {
    let before = jwt(["user_id": "u1", "email_verified": false])
    let after = jwt(["user_id": "u1", "email_verified": true])
    let transport = RecordingTransport([
      (200, #"{"localId":"u1","email":"a@example.test","idToken":"\#(before)","refreshToken":"r1"}"#),
      (200, #"{"id_token":"\#(after)","refresh_token":"r2","expires_in":"3600"}"#),
    ])
    let session = auth(transport)
    let signedIn = try await session.signIn(email: "a@example.test", password: "pw")
    XCTAssertFalse(signedIn.emailVerified)
    let reloaded = try await session.reload()
    XCTAssertEqual(reloaded?.emailVerified, true)
  }

  /// The providers the account holds, from `accounts:lookup`, for the held workspace name's binding.
  func testReadsTheAccountsProviders() async throws {
    let transport = RecordingTransport([
      (200, signedIn),
      (200, #"{"users":[{"localId":"u1","providerUserInfo":[{"providerId":"password"},{"providerId":"google.com"}]}]}"#),
    ])
    let session = auth(transport)
    try await session.signIn(email: "a@example.test", password: "pw")
    let providers = try await session.providerIDs()
    XCTAssertEqual(providers, ["password", "google.com"])
    XCTAssertEqual(transport.json(1)["idToken"] as? String, "id1")
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

  func testCountsWithOneAggregationQuery() async throws {
    let transport = RecordingTransport([
      (200, #"[{"result":{"aggregateFields":{"n":{"integerValue":"19"}}},"readTime":"2026-10-16T00:00:00Z"}]"#)
    ])
    let query = FirestoreQuery(["hosts", "h1", "products"], order: [.init("nameLower")])
    let n = try await reader(transport).count(query)
    XCTAssertEqual(n, 19)
    XCTAssertEqual(
      transport.requests[0].url?.absoluteString,
      "http://127.0.0.1:8389/v1/projects/demo/databases/(default)/documents/hosts/h1:runAggregationQuery")
    let body = transport.json(0)["structuredAggregationQuery"] as? [String: Any]
    XCTAssertNotNil(body?["aggregations"])
    XCTAssertNil((body?["structuredQuery"] as? [String: Any])?["orderBy"], "a count needs no order")
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
