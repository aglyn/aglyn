// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynCore

/// App Check tokens from a list: each call takes the next, recording whether it was forced.
final class FakeAppCheck: AppCheckTokenProvider, @unchecked Sendable {
  private let lock = NSLock()
  private var tokens: [String?]
  private(set) var calls: [Bool] = []
  var fails = false

  init(_ tokens: [String?]) { self.tokens = tokens }

  func token(forceRefresh: Bool) async throws -> String? {
    try lock.withLock {
      calls.append(forceRefresh)
      if fails { throw URLError(.notConnectedToInternet) }
      return tokens.isEmpty ? nil : tokens.removeFirst()
    }
  }
}

final class AppCheckTests: XCTestCase {
  private let appCheckRefusal = #"{"error":{"code":401,"message":"Firebase App Check token is invalid.","status":"UNAUTHENTICATED"}}"#
  private let signedIn = #"{"localId":"u1","email":"a@example.test","idToken":"id1","refreshToken":"r1","expiresIn":"3600"}"#

  private func request(_ url: String) -> URLRequest { URLRequest(url: URL(string: url)!) }

  func testAppAttestWhereOfferedDeviceCheckOnAMacAndNothingOnASimulator() {
    XCTAssertEqual(AppCheckAttestation.choose(appAttestSupported: true, deviceCheckSupported: true), .appAttest)
    XCTAssertEqual(AppCheckAttestation.choose(appAttestSupported: false, deviceCheckSupported: true), .deviceCheck)
    XCTAssertNil(AppCheckAttestation.choose(appAttestSupported: false, deviceCheckSupported: false))
  }

  func testOnlyFirebaseAPIsGetTheHeader() {
    XCTAssertTrue(AppCheckTransport.isFirebase(URL(string: "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword")))
    XCTAssertTrue(AppCheckTransport.isFirebase(URL(string: "https://securetoken.googleapis.com/v1/token")))
    XCTAssertTrue(AppCheckTransport.isFirebase(URL(string: "https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/a/b")))
    XCTAssertTrue(AppCheckTransport.isFirebase(URL(string: "https://us-central1-p.cloudfunctions.net/fn")))
    XCTAssertFalse(AppCheckTransport.isFirebase(URL(string: "https://app.aglyn.com/api/me")))
    XCTAssertFalse(AppCheckTransport.isFirebase(URL(string: "https://oauth2.googleapis.com/token")))
    XCTAssertFalse(AppCheckTransport.isFirebase(URL(string: "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/x")))
  }

  func testTheTokenRidesFirebaseCallsAndNothingElse() async throws {
    let base = RecordingTransport([])
    let transport = AppCheckTransport(base: base, appCheck: FakeAppCheck(["t1"]))
    _ = try await transport.send(request("https://app.aglyn.com/api/me"))
    _ = try await transport.send(request("https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/a/b"))
    XCTAssertNil(base.requests[0].value(forHTTPHeaderField: AppCheckTransport.header))
    XCTAssertEqual(base.requests[1].value(forHTTPHeaderField: AppCheckTransport.header), "t1")
  }

  func testARefusedTokenIsReplacedOnceWithAFreshOne() async throws {
    let base = RecordingTransport([(401, appCheckRefusal), (200, "{}")])
    let appCheck = FakeAppCheck(["stale", "fresh"])
    let (_, response) = try await AppCheckTransport(base: base, appCheck: appCheck)
      .send(request("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=k"))
    XCTAssertEqual(response.statusCode, 200)
    XCTAssertEqual(appCheck.calls, [false, true])
    XCTAssertEqual(base.requests.map { $0.value(forHTTPHeaderField: AppCheckTransport.header) }, ["stale", "fresh"])
  }

  func testNoTokenSendsTheRequestBareAndDoesNotRetry() async throws {
    let base = RecordingTransport([(401, appCheckRefusal)])
    let appCheck = FakeAppCheck([])
    appCheck.fails = true
    let (_, response) = try await AppCheckTransport(base: base, appCheck: appCheck)
      .send(request("https://securetoken.googleapis.com/v1/token?key=k"))
    XCTAssertEqual(response.statusCode, 401)
    XCTAssertEqual(base.requests.count, 1)
    XCTAssertNil(base.requests[0].value(forHTTPHeaderField: AppCheckTransport.header))
  }

  func testRestSignInCarriesTheTokenAndARefusalSaysSoPlainly() async throws {
    // A production-shaped client (no emulator), so its calls are https Firebase APIs.
    let base = RecordingTransport([(200, signedIn)])
    let auth = IdentityToolkitAuth(
      apiKey: "key", emulatorHost: nil, transport: AppCheckTransport(base: base, appCheck: FakeAppCheck(["t1"])),
      store: MemoryCredentialStore())
    _ = try await auth.signIn(email: "a@example.test", password: "pw")
    XCTAssertEqual(base.requests[0].value(forHTTPHeaderField: AppCheckTransport.header), "t1")

    let refusing = RecordingTransport([(401, appCheckRefusal), (401, appCheckRefusal)])
    let refused = IdentityToolkitAuth(
      apiKey: "key", emulatorHost: nil, transport: AppCheckTransport(base: refusing, appCheck: FakeAppCheck(["a", "b"])),
      store: MemoryCredentialStore())
    do {
      _ = try await refused.signIn(email: "a@example.test", password: "pw")
      XCTFail("signed in without App Check")
    } catch {
      XCTAssertEqual(error as? IdentityToolkitError, IdentityToolkitError(code: IdentityToolkitError.appCheckRefused, status: 401))
      XCTAssertEqual(signInErrorMessage(error), appCheckRefusalMessage)
    }
  }

  func testRestFirestoreCarriesTheToken() async throws {
    let base = RecordingTransport([(200, #"{"name":"projects/p/databases/(default)/documents/orgs/o1","fields":{}}"#)])
    let reader = RestFirestoreReader(
      projectID: "p", emulatorHost: nil, transport: AppCheckTransport(base: base, appCheck: FakeAppCheck(["t1"])),
      idToken: { "id1" })
    _ = try await reader.get(["orgs", "o1"])
    XCTAssertEqual(base.requests[0].value(forHTTPHeaderField: AppCheckTransport.header), "t1")
    XCTAssertEqual(base.requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer id1")
  }

  func testTheSDKsRefusalIsReadFromItsUnderlyingError() {
    let server = NSError(
      domain: "FIRAuthInternalErrorDomain", code: 3,
      userInfo: ["FIRAuthErrorUserInfoDeserializedResponseKey": ["message": "Firebase App Check token is invalid."]])
    let sdk = NSError(domain: "FIRAuthErrorDomain", code: 17999, userInfo: [NSUnderlyingErrorKey: server])
    XCTAssertTrue(isAppCheckRefusal(sdk))
    XCTAssertEqual(signInErrorMessage(sdk), appCheckRefusalMessage)
    XCTAssertFalse(isAppCheckRefusal(NSError(domain: "FIRAuthErrorDomain", code: 17999)))
    XCTAssertFalse(isAppCheckRefusal(IdentityToolkitError(code: "INVALID_LOGIN_CREDENTIALS", status: 400)))
  }

  func testAppCheckIsOnForProductionAndOffForTheEmulatorStack() throws {
    let production = [
      "AGLYN_FIREBASE_API_KEY": "key", "AGLYN_FIREBASE_AUTH_DOMAIN": "x.firebaseapp.com",
      "AGLYN_FIREBASE_PROJECT_ID": "x", "AGLYN_FIREBASE_APP_ID": "1:1:ios:1",
    ]
    XCTAssertTrue(try AglynConfig.read(production, app: .aglyn).appCheck)
    var emulator = production
    emulator["AGLYN_CONSOLE_URL"] = "http://localhost:4200"
    emulator["AGLYN_AUTH_EMULATOR_HOST"] = "127.0.0.1:9099"
    XCTAssertFalse(try AglynConfig.read(emulator, app: .aglyn).appCheck)
    emulator["AGLYN_APP_CHECK"] = "on"
    XCTAssertTrue(try AglynConfig.read(emulator, app: .aglyn).appCheck)
    var off = production
    off["AGLYN_APP_CHECK"] = " OFF "
    XCTAssertFalse(try AglynConfig.read(off, app: .aglyn).appCheck)
    off["AGLYN_APP_CHECK"] = "maybe"
    XCTAssertThrowsError(try AglynConfig.read(off, app: .aglyn)) {
      XCTAssertEqual($0 as? AglynConfigError, .appCheckSetting("maybe"))
    }
    XCTAssertTrue(AglynConfig.keys.contains("AGLYN_APP_CHECK"))
  }
}
