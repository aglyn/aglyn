// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// Close account revokes the account's Apple token first (App Store Review Guideline 5.1.1(v)); a revoke that fails or
/// never gets an authorization is recorded and the close goes on.
@MainActor
final class AppleRevocationTests: XCTestCase {
  override func tearDown() {
    Telemetry.stop()
    super.tearDown()
  }

  private func collecting() -> RecordingSink {
    let sink = RecordingSink()
    Telemetry.start(collecting: true, sink: sink, app: .aglyn, info: [:])
    return sink
  }

  private func records(_ sink: RecordingSink) -> [String] { sink.calls.filter { $0.hasPrefix("record ") } }

  func testOnlyAnAccountHoldingTheAppleProviderOwesARevoke() {
    XCTAssertTrue(AppleRevocation.owed(providers: ["apple.com"]))
    XCTAssertTrue(AppleRevocation.owed(providers: ["password", "apple.com"]))
    XCTAssertFalse(AppleRevocation.owed(providers: ["password", "google.com"]))
    XCTAssertFalse(AppleRevocation.owed(providers: []))
  }

  func testTheRevokeRunsWithTheCodeBeforeTheClose() async {
    let sink = collecting()
    var calls: [String] = []
    let answer = await AppleRevocation.close(owed: true, code: "code-1", revoke: { calls.append("revoke \($0)") }) {
      calls.append("close")
      return "closed"
    }
    XCTAssertEqual(answer, "closed")
    XCTAssertEqual(calls, ["revoke code-1", "close"])
    XCTAssertEqual(records(sink), [])
  }

  func testARevokeThatThrowsStillClosesAndIsRecordedAsANonFatal() async {
    let sink = collecting()
    var calls: [String] = []
    await AppleRevocation.close(
      owed: true, code: "code-1",
      revoke: { _ in
        calls.append("revoke")
        throw IdentityToolkitError(code: "INVALID_IDP_RESPONSE", status: 400)
      }
    ) { calls.append("close") }
    XCTAssertEqual(calls, ["revoke", "close"])
    XCTAssertEqual(records(sink), ["record auth.apple_revoke 2"])
  }

  func testNoAuthorizationStillClosesAndIsRecorded() async {
    let sink = collecting()
    var calls: [String] = []
    await AppleRevocation.close(owed: true, code: nil, revoke: { _ in calls.append("revoke") }) { calls.append("close") }
    XCTAssertEqual(calls, ["close"])
    XCTAssertEqual(records(sink), ["record auth.apple_revoke 1"])
  }

  func testAnAccountWithoutAppleClosesAsBeforeWithNoRevokeAndNothingRecorded() async {
    let sink = collecting()
    var calls: [String] = []
    await AppleRevocation.close(owed: false, code: nil, revoke: { _ in calls.append("revoke") }) { calls.append("close") }
    XCTAssertEqual(calls, ["close"])
    XCTAssertEqual(records(sink), [])
  }

  func testTheRecordedFailureCarriesOnlyItsReasonDomainAndCode() {
    let rest = AppleRevocationFailure(reason: .revokeFailed, underlying: IdentityToolkitError(code: "X", status: 503))
    XCTAssertEqual(rest.errorUserInfo as? [String: AnyHashable], ["reason": "revoke_failed", "underlying_domain": "IdentityToolkit", "underlying_code": 503])
    let sdk = AppleRevocationFailure(
      reason: .revokeFailed,
      underlying: NSError(domain: "FIRAuthErrorDomain", code: 17020, userInfo: [NSLocalizedDescriptionKey: "a@example.test"]))
    XCTAssertEqual(sdk.errorUserInfo as? [String: AnyHashable], ["reason": "revoke_failed", "underlying_domain": "FIRAuthErrorDomain", "underlying_code": 17020])
    XCTAssertFalse((sdk as NSError).description.contains("example.test"))
  }

  func testTheRestRevokeSendsTheAppleCodeWithTheSignedInIDToken() async throws {
    let signedIn = #"{"localId":"u1","email":"u1@example.test","idToken":"id-1","refreshToken":"r1","expiresIn":"3600"}"#
    let transport = RecordingTransport([(200, signedIn), (200, "{}")])
    let session = AuthSession(
      rest: IdentityToolkitAuth(apiKey: "key", emulatorHost: nil, transport: transport, store: MemoryCredentialStore()))
    try await session.signIn(email: "u1@example.test", password: "pw")
    try await session.revokeAppleToken(authorizationCode: "apple-code")
    XCTAssertEqual(transport.requests.last?.url?.path, "/v1/accounts:revokeToken")
    XCTAssertEqual(transport.requests.last?.httpMethod, "POST")
    let body = transport.json(transport.requests.count - 1)
    XCTAssertEqual(body as? [String: String], ["providerId": "apple.com", "tokenType": "CODE", "token": "apple-code", "idToken": "id-1"])
  }

  func testARefusedRestRevokeThrowsSoItIsRecorded() async throws {
    let signedIn = #"{"localId":"u1","email":"u1@example.test","idToken":"id-1","refreshToken":"r1","expiresIn":"3600"}"#
    let transport = RecordingTransport([(200, signedIn), (400, #"{"error":{"message":"INVALID_IDP_RESPONSE"}}"#)])
    let session = AuthSession(
      rest: IdentityToolkitAuth(apiKey: "key", emulatorHost: nil, transport: transport, store: MemoryCredentialStore()))
    try await session.signIn(email: "u1@example.test", password: "pw")
    do {
      try await session.revokeAppleToken(authorizationCode: "apple-code")
      XCTFail("a refused revoke must throw")
    } catch let error as IdentityToolkitError {
      XCTAssertEqual(error.status, 400)
    }
  }

  func testSignedOutThereIsNothingToRevoke() async {
    let transport = RecordingTransport([])
    let session = AuthSession(
      rest: IdentityToolkitAuth(apiKey: "key", emulatorHost: nil, transport: transport, store: MemoryCredentialStore()))
    do {
      try await session.revokeAppleToken(authorizationCode: "apple-code")
      XCTFail("signed out must throw")
    } catch {}
    XCTAssertFalse(transport.requests.contains { $0.url?.path == "/v1/accounts:revokeToken" })
  }
}
