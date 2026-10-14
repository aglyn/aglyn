// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// A support session (AGL-3667): a staff member signed in as a customer through the custom token `/api/admin/impersonate`
/// mints. The customer's session lives in memory, the staff session is set aside untouched, and ending it returns to it.
@MainActor
final class ImpersonationTests: XCTestCase {
  /// An ID token whose claims are `claims` (unsigned: the app only reads them to show who is signed in).
  private func jwt(_ claims: [String: Any]) -> String {
    func encode(_ object: [String: Any]) -> String {
      let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
      return data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    }
    return "\(encode(["alg": "none"])).\(encode(claims)).sig"
  }

  private func staffAnswer() -> String {
    let token = jwt(["user_id": "staff-1", "email": "ops@example.test", "staff": true, "staffRole": "super"])
    return #"{"localId":"staff-1","email":"ops@example.test","displayName":"Ops","idToken":"\#(token)","refreshToken":"r-staff","expiresIn":"3600"}"#
  }

  private func customerAnswer() -> String {
    let token = jwt([
      "user_id": "cust-1", "email": "c@example.test", "name": "Cass", "impersonatedBy": "staff-1", "impersonatedByEmail": "ops@example.test",
    ])
    return #"{"idToken":"\#(token)","refreshToken":"r-cust","expiresIn":"3600"}"#
  }

  private struct Fixture {
    let session: AuthSession
    let staffTransport: RecordingTransport
    let customerTransport: RecordingTransport
    let staffStore: MemoryCredentialStore
    let customerStore: MemoryCredentialStore
  }

  private func fixture(customer: [(Int, String)]) async throws -> Fixture {
    let staffTransport = RecordingTransport([(200, staffAnswer())])
    let customerTransport = RecordingTransport(customer)
    let staffStore = MemoryCredentialStore()
    let customerStore = MemoryCredentialStore()
    let staff = IdentityToolkitAuth(apiKey: "key", emulatorHost: nil, transport: staffTransport, store: staffStore)
    let session = AuthSession(
      rest: staff,
      impersonationAuth: {
        IdentityToolkitAuth(apiKey: "key", emulatorHost: nil, transport: customerTransport, store: customerStore)
      })
    try await session.signIn(email: "ops@example.test", password: "pw")
    return Fixture(
      session: session, staffTransport: staffTransport, customerTransport: customerTransport, staffStore: staffStore,
      customerStore: customerStore)
  }

  func testASupportSessionSignsInAsTheCustomerAndSetsTheStaffSessionAside() async throws {
    let f = try await fixture(customer: [(200, customerAnswer())])
    XCTAssertTrue(f.session.staff != nil)
    try await f.session.beginImpersonation(token: "custom-token", tenantId: "tenant-9")

    // The custom token is exchanged in the pool it was minted in.
    let request = try XCTUnwrap(f.customerTransport.requests.first)
    XCTAssertEqual(request.url?.absoluteString, "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=key")
    let body = f.customerTransport.json(0)
    XCTAssertEqual(body["token"] as? String, "custom-token")
    XCTAssertEqual(body["tenantId"] as? String, "tenant-9")
    XCTAssertEqual(body["returnSecureToken"] as? Bool, true)

    // Everything the app asks now is the customer's: who is signed in, the token, the standing.
    XCTAssertEqual(f.session.user, AglynUser(uid: "cust-1", email: "c@example.test", displayName: "Cass"))
    XCTAssertEqual(f.session.impersonation, Impersonation(customer: f.session.user!, staffEmail: "ops@example.test"))
    XCTAssertTrue(f.session.impersonationFlag.isOn)
    XCTAssertNil(f.session.staff)
    let token = try await f.session.idToken(forceRefresh: false)
    let claims = TokenClaims(idToken: token)
    XCTAssertEqual(claims.impersonatedBy, "staff-1")
    XCTAssertEqual(claims.impersonatedByEmail, "ops@example.test")
    XCTAssertFalse(claims.isStaff)
    XCTAssertEqual(
      f.session.impersonation?.banner, "You are impersonating c@example.test (staff: ops@example.test). Actions are audited.")

    // The staff session was not touched: its refresh token is still kept, and it asked nothing more of the network.
    XCTAssertEqual(f.staffStore.load()?.uid, "staff-1")
    XCTAssertEqual(f.staffStore.load()?.refreshToken, "r-staff")
    XCTAssertEqual(f.staffTransport.requests.count, 1)
  }

  func testEndingItReturnsToTheStaffSessionWithoutSigningInAgain() async throws {
    let f = try await fixture(customer: [(200, customerAnswer())])
    try await f.session.beginImpersonation(token: "custom-token", tenantId: nil)
    await f.session.endImpersonation()

    XCTAssertEqual(f.session.user?.uid, "staff-1")
    XCTAssertNil(f.session.impersonation)
    XCTAssertFalse(f.session.impersonationFlag.isOn)
    XCTAssertNotNil(f.session.staff)
    // The staff member's own token is back, from the session that was kept: no password, no second sign-in.
    let claims = TokenClaims(idToken: try await f.session.idToken(forceRefresh: false))
    XCTAssertTrue(claims.isStaff)
    XCTAssertNil(claims.impersonatedBy)
    XCTAssertEqual(f.staffTransport.requests.count, 1)
    // The customer's session is gone from memory.
    XCTAssertNil(f.customerStore.load())
  }

  func testAMissingTenantIsLeftOutOfTheExchange() async throws {
    let f = try await fixture(customer: [(200, customerAnswer())])
    try await f.session.beginImpersonation(token: "custom-token", tenantId: nil)
    XCTAssertNil(f.customerTransport.json(0)["tenantId"])
  }

  func testARefusedTokenChangesNothing() async throws {
    let f = try await fixture(customer: [(400, #"{"error":{"message":"INVALID_CUSTOM_TOKEN"}}"#)])
    do {
      try await f.session.beginImpersonation(token: "bad", tenantId: nil)
      XCTFail("expected a refusal")
    } catch {
      XCTAssertEqual((error as? IdentityToolkitError)?.code, "INVALID_CUSTOM_TOKEN")
    }
    XCTAssertEqual(f.session.user?.uid, "staff-1")
    XCTAssertNil(f.session.impersonation)
    XCTAssertFalse(f.session.impersonationFlag.isOn)
    XCTAssertNotNil(f.session.staff)
  }

  func testASupportSessionTheServerRevokesEndsAndTheStaffSessionReturns() async throws {
    // The customer's token is refreshed when forced, and the refresh is refused.
    let f = try await fixture(customer: [(200, customerAnswer()), (400, #"{"error":{"message":"TOKEN_EXPIRED"}}"#)])
    try await f.session.beginImpersonation(token: "custom-token", tenantId: nil)
    let token = try await f.session.idToken(forceRefresh: true)
    XCTAssertNil(token)
    XCTAssertNil(f.session.impersonation)
    XCTAssertEqual(f.session.user?.uid, "staff-1")
    XCTAssertFalse(f.session.impersonationFlag.isOn)
  }

  func testSigningOutFromASupportSessionSignsTheStaffMemberOutToo() async throws {
    let f = try await fixture(customer: [(200, customerAnswer())])
    var ran = 0
    f.session.onBeforeSignOut { ran += 1 }
    try await f.session.beginImpersonation(token: "custom-token", tenantId: nil)
    await f.session.signOut()
    XCTAssertNil(f.session.user)
    XCTAssertNil(f.session.impersonation)
    XCTAssertEqual(ran, 1)
    XCTAssertNil(f.staffStore.load())
  }

  func testASecondSupportSessionReplacesTheFirstWithoutLosingTheStaffSession() async throws {
    let f = try await fixture(customer: [(200, customerAnswer()), (200, customerAnswer())])
    try await f.session.beginImpersonation(token: "one", tenantId: nil)
    try await f.session.beginImpersonation(token: "two", tenantId: nil)
    await f.session.endImpersonation()
    XCTAssertEqual(f.session.user?.uid, "staff-1")
    XCTAssertEqual(f.staffTransport.requests.count, 1)
  }

  private final class FakeReader: FirestoreReader, @unchecked Sendable {
    let name: String
    private(set) var sets: [String] = []
    init(_ name: String) { self.name = name }
    func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening {
      onChange(.success([FirestoreDocument(id: name, data: [:], fromCache: false)]))
      return NoListener()
    }
    func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening {
      onChange(.success(FirestoreDocument(id: name, data: [:], fromCache: false)))
      return NoListener()
    }
    func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws { sets.append(path.joined(separator: "/")) }
    func deleteDocument(_ path: [String]) async throws {}
  }

  func testReadsAndWritesGoThroughTheCustomersTokenWhileASupportSessionIsOn() async throws {
    let normal = FakeReader("staff-reader")
    let customer = FakeReader("customer-reader")
    let flag = ImpersonationFlag()
    let reader = SwitchingFirestoreReader(normal: normal, impersonated: customer, flag: flag)
    func who() -> String {
      var seen = ""
      _ = reader.listenDocument(["orgs", "o1"]) { result in
        if case .success(let document) = result { seen = document?.id ?? "" }
      }
      return seen
    }
    XCTAssertEqual(who(), "staff-reader")
    flag.set(true)
    XCTAssertEqual(who(), "customer-reader")
    try await reader.setDocument(["orgs", "o1"], ["name": "x"], merge: true)
    XCTAssertEqual(customer.sets, ["orgs/o1"])
    XCTAssertTrue(normal.sets.isEmpty)
    flag.set(false)
    XCTAssertEqual(who(), "staff-reader")
  }
}
