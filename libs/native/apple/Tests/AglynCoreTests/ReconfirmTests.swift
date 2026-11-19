// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// "Confirm it is you" before Close account (AGL-1140): the account in use signs in again its own way, so its next token
/// carries a fresh `auth_time`; an answer for anyone else is refused before it replaces the account in use.
@MainActor
final class ReconfirmTests: XCTestCase {
  private func jwt(_ claims: [String: Any]) -> String {
    func encode(_ object: [String: Any]) -> String {
      let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
      return data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    }
    return "\(encode(["alg": "none"])).\(encode(claims)).sig"
  }

  private func answer(uid: String, authTime: Int, refresh: String) -> String {
    let token = jwt(["user_id": uid, "email": "\(uid)@example.test", "auth_time": authTime])
    return #"{"localId":"\#(uid)","email":"\#(uid)@example.test","idToken":"\#(token)","refreshToken":"\#(refresh)","expiresIn":"3600"}"#
  }

  private func signedIn(then answers: [(Int, String)]) async throws -> (AuthSession, RecordingTransport) {
    let transport = RecordingTransport([(200, answer(uid: "u1", authTime: 100, refresh: "r1"))] + answers)
    let rest = IdentityToolkitAuth(apiKey: "key", emulatorHost: nil, transport: transport, store: MemoryCredentialStore())
    let session = AuthSession(rest: rest)
    try await session.signIn(email: "u1@example.test", password: "pw")
    return (session, transport)
  }

  private func authTime(_ session: AuthSession) async throws -> Int? {
    TokenClaims(idToken: try await session.idToken(forceRefresh: false)).values["auth_time"]?.numberValue.map { Int($0) }
  }

  func testThePasswordSignsTheSameAccountInAgainWithAFreshSignInTime() async throws {
    let (session, transport) = try await signedIn(then: [(200, answer(uid: "u1", authTime: 900, refresh: "r2"))])
    try await session.reconfirm(.password("pw"))
    XCTAssertEqual(transport.requests.last?.url?.path, "/v1/accounts:signInWithPassword")
    XCTAssertEqual(transport.json(1)["email"] as? String, "u1@example.test")
    XCTAssertEqual(session.user?.uid, "u1")
    let fresh = try await authTime(session)
    XCTAssertEqual(fresh, 900)
  }

  func testGoogleAndAppleSignInAgainThroughTheirOwnProvider() async throws {
    let (session, transport) = try await signedIn(then: [
      (200, answer(uid: "u1", authTime: 900, refresh: "r2")), (200, answer(uid: "u1", authTime: 950, refresh: "r3")),
    ])
    try await session.reconfirm(.google(idToken: "g-token"))
    XCTAssertEqual(transport.requests[1].url?.path, "/v1/accounts:signInWithIdp")
    XCTAssertEqual(transport.json(1)["postBody"] as? String, "id_token=g-token&providerId=google.com")
    try await session.reconfirm(.apple(idToken: "a-token", rawNonce: "n1"))
    XCTAssertEqual(transport.json(2)["postBody"] as? String, "id_token=a-token&providerId=apple.com&nonce=n1")
    let fresh = try await authTime(session)
    XCTAssertEqual(fresh, 950)
  }

  func testAnAnswerForAnotherAccountIsRefusedAndTheAccountInUseStays() async throws {
    let (session, _) = try await signedIn(then: [
      (200, answer(uid: "someone-else", authTime: 900, refresh: "r2")),
      (200, #"{"idToken":"\#(jwt(["user_id": "someone-else", "auth_time": 900]))","refreshToken":"r3","expiresIn":"3600"}"#),
    ])
    do {
      try await session.reconfirm(.google(idToken: "g-token"))
      XCTFail("another account must be refused")
    } catch let error as IdentityToolkitError {
      XCTAssertEqual(error.code, IdentityToolkitAuth.userMismatch)
      XCTAssertEqual(signInErrorMessage(error), "That is a different account. Confirm it is you with the account signed in here.")
    }
    do {
      try await session.reconfirm(.customToken("passkey-token", tenantID: nil))
      XCTFail("another account must be refused")
    } catch let error as IdentityToolkitError {
      XCTAssertEqual(error.code, IdentityToolkitAuth.userMismatch)
    }
    XCTAssertEqual(session.user?.uid, "u1")
    let kept = try await authTime(session)
    XCTAssertEqual(kept, 100)
  }

  func testASupportSessionCannotConfirmForTheCustomer() async throws {
    let customer = RecordingTransport([(200, #"{"idToken":"\#(jwt(["user_id": "c1", "impersonatedBy": "u1"]))","refreshToken":"rc","expiresIn":"3600"}"#)])
    let transport = RecordingTransport([(200, answer(uid: "u1", authTime: 100, refresh: "r1"))])
    let session = AuthSession(
      rest: IdentityToolkitAuth(apiKey: "key", emulatorHost: nil, transport: transport, store: MemoryCredentialStore()),
      impersonationAuth: { IdentityToolkitAuth(apiKey: "key", emulatorHost: nil, transport: customer, store: MemoryCredentialStore()) })
    try await session.signIn(email: "u1@example.test", password: "pw")
    try await session.beginImpersonation(token: "t", tenantId: nil)
    do {
      try await session.reconfirm(.password("pw"))
      XCTFail("a support session must not confirm")
    } catch {}
    XCTAssertEqual(transport.requests.count, 1)
  }
}
