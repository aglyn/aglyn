// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// An `HTTPTransport` that answers by path, and holds the token refreshes (`/v1/token`) until the test lets them go.
private final class HeldRefreshTransport: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private var answers: [String: [(Int, String)]]
  private var held: [CheckedContinuation<Void, Never>] = []
  private(set) var heldCount = 0

  init(_ answers: [String: [(Int, String)]]) { self.answers = answers }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let path = request.url?.path ?? ""
    if path.hasSuffix("/v1/token") {
      await withCheckedContinuation { continuation in
        lock.withLock {
          held.append(continuation)
          heldCount += 1
        }
      }
    }
    let (status, body): (Int, String) = lock.withLock {
      let key = answers.keys.first { path.hasSuffix($0) } ?? ""
      guard var queue = answers[key], !queue.isEmpty else { return (200, "{}") }
      let answer = queue.removeFirst()
      answers[key] = queue
      return answer
    }
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }

  func release() {
    let waiting = lock.withLock {
      let all = held
      held = []
      return all
    }
    for continuation in waiting { continuation.resume() }
  }
}

/// The claims a screen reads (the Staff console row, the staff section) belong to the person in use, read off their own
/// ID token as the console's `getIdTokenResult()` reads them (AGL-3667).
@MainActor
final class CurrentClaimsTests: XCTestCase {
  private static func token(_ claims: [String: Any]) -> String {
    func encode(_ object: [String: Any]) -> String {
      let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
      return data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    }
    return "\(encode(["alg": "none"])).\(encode(claims)).sig"
  }

  private let owner = token(["user_id": "u0", "sub": "u0"])
  private let staffMember = token(["user_id": "u1", "sub": "u1", "staff": true, "staffRole": "super"])

  /// The app's own account (not staff) is signed in with a token about to expire, and a staff account is added beside it.
  /// A read of the owner's claims that is still waiting on its refresh when the person in use becomes the staff account
  /// must not land over the staff account's: it is the owner's.
  func testAReadForThePersonBeforeASwitchDoesNotLandAfterIt() async throws {
    let transport = HeldRefreshTransport([
      "accounts:signInWithPassword": [
        (200, #"{"localId":"u0","email":"owner@example.test","idToken":"\#(owner)","refreshToken":"r0","expiresIn":"0"}"#),
        (200, #"{"localId":"u1","email":"staff@example.test","idToken":"\#(staffMember)","refreshToken":"r1","expiresIn":"3600"}"#),
      ],
      "/v1/token": [(200, #"{"id_token":"\#(owner)","refresh_token":"r0b","expires_in":"3600"}"#)],
    ])
    let defaults = UserDefaults(suiteName: "CurrentClaimsTests-\(UUID().uuidString)")!
    let session = AuthSession(
      rest: IdentityToolkitAuth(apiKey: "key", emulatorHost: "127.0.0.1:9399", transport: transport, store: MemoryCredentialStore()),
      accountAuth: { _ in
        IdentityToolkitAuth(apiKey: "key", emulatorHost: "127.0.0.1:9399", transport: transport, store: MemoryCredentialStore())
      },
      roster: AccountRosterStorage(projectID: "p-\(UUID().uuidString)", defaults: defaults))
    for _ in 0..<100 where !session.ready { try await Task.sleep(nanoseconds: 10_000_000) }

    // The owner signs in; their token is already due, so the next read refreshes it first, and that refresh is held.
    let ownerSignIn = Task { try await session.signIn(email: "owner@example.test", password: "pw") }
    for _ in 0..<200 where transport.heldCount < 1 { try await Task.sleep(nanoseconds: 5_000_000) }
    XCTAssertEqual(transport.heldCount, 1, "the owner's claims read is waiting on its refresh")
    XCTAssertEqual(session.user?.uid, "u0")

    // A staff account is added beside it and is now the person in use.
    session.addingAccount = true
    try await session.signIn(email: "staff@example.test", password: "pw")
    XCTAssertEqual(session.user?.uid, "u1")
    XCTAssertEqual(session.staff?.role, "super", "the staff account reads its own claims")
    let staffRead = await session.currentClaims(forceRefresh: false)
    XCTAssertEqual(staffRead?.isStaff, true)

    // The owner's read answers last.
    transport.release()
    _ = try await ownerSignIn.value
    XCTAssertEqual(session.user?.uid, "u1")
    XCTAssertEqual(session.staff?.role, "super", "the owner's late answer does not land over the staff account's claims")
  }

  /// A token whose subject is not the person in use is never read as theirs.
  func testATokenForSomeoneElseIsNotThePersonsClaims() {
    XCTAssertTrue(currentClaimsBelong(TokenClaims(idToken: staffMember), to: "u1"))
    XCTAssertFalse(currentClaimsBelong(TokenClaims(idToken: staffMember), to: "u0"))
    XCTAssertTrue(currentClaimsBelong(TokenClaims(idToken: "unreadable"), to: "u0"), "a token that names no one is not refused")
  }
}
