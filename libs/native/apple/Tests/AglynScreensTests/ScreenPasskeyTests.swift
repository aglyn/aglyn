// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AuthenticationServices
import Foundation
import XCTest

@testable import AglynScreens

/// Setting up a passkey from the account screen: the console's `registerPasskey`, with the platform's prompt
/// replaced by a fake that returns what a device would. Kotlin replays the same cases (ScreenPasskeyTest).
@MainActor
final class ScreenPasskeyTests: XCTestCase {
  private let options: JSONValue = [
    "rp": ["name": "Aglyn", "id": "aglyn.com"],
    "user": ["id": "dWlkLTE", "name": "member@example.com", "displayName": "member@example.com"],
    "challenge": "Y2hhbGxlbmdl",
    "authenticatorSelection": ["residentKey": "preferred", "userVerification": "preferred"],
    "excludeCredentials": [["id": "AQID", "type": "public-key"]],
  ]

  /// A registration whose client data names the origin the platform signed.
  private nonisolated static func registration(origin: String) -> JSONValue {
    let client = try? JSONValue.object(["type": "webauthn.create", "origin": .string(origin)]).encoded()
    return [
      "id": "AQID", "rawId": "AQID", "type": "public-key",
      "response": ["clientDataJSON": .string(ScreenPasskeys.base64URL(client ?? Data())), "attestationObject": "o2M"],
    ]
  }

  private func api(_ transport: RecordingTransport) -> ConsoleAPIClient {
    ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
  }

  private func addPasskey() throws -> (ScreenSpec, ActionSpec) {
    let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.account.security" })
    let block = try XCTUnwrap(spec.blocks.first { $0.type == "actions" && $0["when"]?.stringValue == "user.canAddPasskey" })
    return (spec, try XCTUnwrap(block["items"].array.first.flatMap(ActionSpec.init)))
  }

  private let scope: JSONValue = ["app": ["passkeyRp": "aglyn.com"], "user": ["uid": "u1"]]

  func testTheEncodingsAndTheSignedOriginAreRead() throws {
    XCTAssertEqual(ScreenPasskeys.base64URL(Data([0xfb, 0xff, 0xfe])), "-__-")
    XCTAssertEqual(ScreenPasskeys.data(fromBase64URL: "-__-"), Data([0xfb, 0xff, 0xfe]))
    XCTAssertEqual(ScreenPasskeys.data(fromBase64URL: "Y2hhbGxlbmdl"), Data("challenge".utf8))
    XCTAssertEqual(ScreenPasskeys.clientDataOrigin(of: Self.registration(origin: "https://aglyn.com")), "https://aglyn.com")
    XCTAssertEqual(
      ScreenPasskeys.clientDataOrigin(of: Self.registration(origin: "android:apk-key-hash:abc")), "android:apk-key-hash:abc")
    XCTAssertNil(ScreenPasskeys.clientDataOrigin(of: ["response": ["clientDataJSON": "not json"]]))
  }

  func testThePlatformRequestCarriesTheServersChallengeUserAndRelyingParty() throws {
    let request = try SystemPasskeys.request(for: options)
    XCTAssertEqual(request.relyingPartyIdentifier, "aglyn.com")
    XCTAssertEqual(request.challenge, Data("challenge".utf8))
    XCTAssertEqual(request.userID, Data("uid-1".utf8))
    XCTAssertEqual(request.name, "member@example.com")
    XCTAssertEqual(request.userVerificationPreference, .preferred)
    // An options answer without a challenge is not something to ask the system about.
    XCTAssertThrowsError(try SystemPasskeys.request(for: ["rp": ["id": "aglyn.com"], "user": ["id": "dWlk"]])) {
      XCTAssertEqual($0 as? SystemPasskeys.OptionsError, .init(field: "challenge"))
    }
  }

  func testSettingUpAPasskeySendsEachRouteTheOriginItChecks() async throws {
    let transport = RecordingTransport(responses: [
      (200, #"{"challengeId":"c1","options":{"challenge":"x"}}"#), (200, #"{"ok":true,"credentialId":"AQID","label":"Passkey"}"#),
    ])
    let (spec, action) = try addPasskey()
    let model = ScreenModel(spec: spec, context: [:], api: api(transport))
    var received: JSONValue?
    model.createPasskey = { options in
      received = options
      return Self.registration(origin: "https://aglyn.com")
    }
    let outcome = await model.run(action, in: scope)
    XCTAssertEqual(outcome, .done(message: "Passkey \"Passkey\" added", response: ["ok": true, "credentialId": "AQID", "label": "Passkey"]))
    XCTAssertEqual(received?["challenge"], "x")
    XCTAssertEqual(transport.requests.count, 2)
    XCTAssertEqual(transport.requests[0].url?.path, "/api/auth/passkeys/register/options")
    XCTAssertEqual(transport.requests[0].value(forHTTPHeaderField: "Origin"), "https://aglyn.com")
    XCTAssertEqual(transport.requests[1].url?.path, "/api/auth/passkeys/register/verify")
    XCTAssertEqual(transport.requests[1].value(forHTTPHeaderField: "Origin"), "https://aglyn.com")
    let body = try XCTUnwrap(transport.requests[1].httpBody.flatMap(JSONValue.decode))
    XCTAssertEqual(body["challengeId"], "c1")
    XCTAssertEqual(body["response"]?["id"], "AQID")
    XCTAssertNil(body["label"])

    // An Android credential is verified against the origin the platform signed, not the web one.
    let android = RecordingTransport(responses: [(200, #"{"challengeId":"c2","options":{}}"#), (200, #"{"ok":true,"label":"Pixel"}"#)])
    let other = ScreenModel(spec: spec, context: [:], api: self.api(android))
    other.createPasskey = { _ in Self.registration(origin: "android:apk-key-hash:abc") }
    _ = await other.run(action, in: scope)
    XCTAssertEqual(android.requests[0].value(forHTTPHeaderField: "Origin"), "https://aglyn.com")
    XCTAssertEqual(android.requests[1].value(forHTTPHeaderField: "Origin"), "android:apk-key-hash:abc")
  }

  func testClosingThePromptIsQuietAndTheRoutesReasonsAreSaidInTheConsolesWords() async throws {
    let (spec, action) = try addPasskey()
    // The person closes the system prompt: nothing is verified, nothing is said.
    let cancelled = RecordingTransport(responses: [(200, #"{"challengeId":"c1","options":{}}"#)])
    let model = ScreenModel(spec: spec, context: [:], api: api(cancelled))
    model.createPasskey = { _ in throw PasskeyCancelled() }
    let quiet = await model.run(action, in: scope)
    XCTAssertEqual(quiet, .done(message: nil, response: nil))
    XCTAssertEqual(cancelled.requests.count, 1)
    // Ten passkeys is the most an account holds.
    let full = RecordingTransport(responses: [(400, #"{"error":"limit-reached"}"#)])
    let limited = ScreenModel(spec: spec, context: [:], api: api(full))
    limited.createPasskey = { _ in XCTFail("no ceremony once the server refused"); return [:] }
    let atLimit = await limited.run(action, in: scope)
    XCTAssertEqual(atLimit, .failed("Passkey limit reached \u{2014} remove one first."))
    // Anything else, including the verify route refusing what the device made.
    let refused = RecordingTransport(responses: [(200, #"{"challengeId":"c1","options":{}}"#), (400, #"{"error":"verification-failed"}"#)])
    let failing = ScreenModel(spec: spec, context: [:], api: api(refused))
    failing.createPasskey = { _ in Self.registration(origin: "https://aglyn.com") }
    let broken = await failing.run(action, in: scope)
    XCTAssertEqual(broken, .failed("Adding the passkey failed. Try again."))
    // A device that cannot make one says so.
    let bare = ScreenModel(spec: spec, context: [:], api: api(RecordingTransport(responses: [])))
    let unavailable = await bare.run(action, in: scope)
    XCTAssertEqual(unavailable, .failed("Passkeys are not available on this device."))
  }

  func testThePasskeyIsOfferedOnlyWhereThisBuildCanMakeOne() throws {
    func canAdd(_ session: ScreenSession) -> JSONValue? {
      session.context(nil, params: [:])["user"]?["canAddPasskey"]
    }
    let verified = TokenClaims(["email_verified": true])
    XCTAssertEqual(canAdd(ScreenSession(claims: verified, passkeyRelyingParty: "aglyn.com")), true)
    XCTAssertEqual(canAdd(ScreenSession(claims: verified)), false)  // not configured for this build
    XCTAssertEqual(canAdd(ScreenSession(claims: TokenClaims([:]), passkeyRelyingParty: "aglyn.com")), false)  // email unverified
    let company = TokenClaims(["email_verified": true, "firebase": ["tenant": "acme"]])
    XCTAssertEqual(canAdd(ScreenSession(claims: company, passkeyRelyingParty: "aglyn.com")), false)  // a company login
    XCTAssertEqual(ScreenSession(passkeyRelyingParty: "aglyn.com").context(nil, params: [:])["app"]?["passkeyRp"], "aglyn.com")
  }
}
