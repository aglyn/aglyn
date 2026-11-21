// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

final class ConfigTests: XCTestCase {
  private let base = [
    "AGLYN_FIREBASE_API_KEY": "key", "AGLYN_FIREBASE_AUTH_DOMAIN": "x.firebaseapp.com",
    "AGLYN_FIREBASE_PROJECT_ID": "demo-x", "AGLYN_FIREBASE_APP_ID": "1:1:ios:1",
  ]

  func testTheConsoleOriginDefaultsAndNormalizes() throws {
    XCTAssertEqual(try AglynConfig.normalizeConsoleOrigin(nil), "https://app.aglyn.com")
    XCTAssertEqual(try AglynConfig.normalizeConsoleOrigin(" https://App.Example.com/// "), "https://app.example.com")
    XCTAssertEqual(try AglynConfig.normalizeConsoleOrigin("http://localhost:4200"), "http://localhost:4200")
    XCTAssertEqual(try AglynConfig.normalizeConsoleOrigin("http://console.localhost"), "http://console.localhost")
  }

  func testHTTPIsOnlyForALocalStackAndAnOriginHasNoPath() {
    XCTAssertThrowsError(try AglynConfig.normalizeConsoleOrigin("http://app.aglyn.com")) {
      XCTAssertEqual($0 as? AglynConfigError, .insecureOrigin)
    }
    XCTAssertThrowsError(try AglynConfig.normalizeConsoleOrigin("https://app.aglyn.com/console"))
    XCTAssertThrowsError(try AglynConfig.normalizeConsoleOrigin("ftp://app.aglyn.com"))
  }

  /// A physical iPhone reaches the Mac's local stack over Wi-Fi: a DEBUG build takes a private-network console and
  /// emulator hosts (the Mac's `.local` name or an RFC 1918 address) as a local stack. A Release build never compiles that
  /// in, so plain http to a private address is refused there exactly as before.
  func testAPrivateNetworkConsoleIsALocalStackInADebugBuildOnly() throws {
    for host in ["192.168.1.20", "10.0.0.7", "172.16.4.2", "172.31.255.1", "studio-mac.local"] {
      XCTAssertTrue(AglynConfig.isPrivateNetworkHost(host), host)
    }
    for host in ["172.32.0.1", "11.0.0.1", "8.8.8.8", "app.aglyn.com", "aglyn.local.example.com", "192.168.1", "999.168.1.1"] {
      XCTAssertFalse(AglynConfig.isPrivateNetworkHost(host), host)
    }
    var env = base
    env["AGLYN_CONSOLE_URL"] = "http://studio-mac.local:4610"
    env["AGLYN_AUTH_EMULATOR_HOST"] = "studio-mac.local:26099"
    env["AGLYN_FIRESTORE_EMULATOR_HOST"] = "studio-mac.local:26082"
    #if DEBUG
      XCTAssertTrue(AglynConfig.acceptsPrivateNetworkHosts)
      let config = try AglynConfig.read(env, app: .pos)
      XCTAssertEqual(config.consoleOrigin, "http://studio-mac.local:4610")
      XCTAssertTrue(config.isLocalConsole)
      XCTAssertEqual(config.problems, [], "the emulators go with a local console")
      XCTAssertFalse(config.appCheck)
      XCTAssertFalse(config.telemetry)
      XCTAssertEqual(try AglynConfig.normalizeConsoleOrigin("http://192.168.1.20:4610"), "http://192.168.1.20:4610")
    #else
      XCTAssertFalse(AglynConfig.acceptsPrivateNetworkHosts)
      XCTAssertThrowsError(try AglynConfig.read(env, app: .pos)) {
        XCTAssertEqual($0 as? AglynConfigError, .insecureOrigin)
      }
    #endif
    // Production is never a private-network host, in any build: http to it is refused.
    XCTAssertThrowsError(try AglynConfig.normalizeConsoleOrigin("http://app.aglyn.com")) {
      XCTAssertEqual($0 as? AglynConfigError, .insecureOrigin)
    }
  }

  func testEmulatorHostsAreHostPortOrNothing() throws {
    var env = base
    env["AGLYN_CONSOLE_URL"] = "http://localhost:4200"
    env["AGLYN_AUTH_EMULATOR_HOST"] = "http://127.0.0.1:9099"
    env["AGLYN_FIRESTORE_EMULATOR_HOST"] = "not a host"
    let config = try AglynConfig.read(env, app: .aglyn)
    XCTAssertEqual(config.authEmulatorHost, "127.0.0.1:9099")
    XCTAssertNil(config.firestoreEmulatorHost)
    XCTAssertEqual(config.problems, [])
    XCTAssertEqual(config.brandName, "Aglyn")
    XCTAssertNil(config.google)
  }

  func testGoogleSignInNeedsBothClientIDs() throws {
    var env = base
    env["AGLYN_GOOGLE_IOS_CLIENT_ID"] = "ios"
    XCTAssertNil(try AglynConfig.read(env, app: .aglyn).google)
    env["AGLYN_GOOGLE_WEB_CLIENT_ID"] = "web"
    XCTAssertEqual(try AglynConfig.read(env, app: .aglyn).google, AglynGoogleClient(iosClientID: "ios", webClientID: "web"))
  }

  func testPasskeysNeedALinkedDomainNotAnAddress() throws {
    var env = base
    XCTAssertNil(try AglynConfig.read(env, app: .aglyn).passkeyRelyingParty)
    env["AGLYN_PASSKEY_RP_ID"] = " Aglyn.com "
    XCTAssertEqual(try AglynConfig.read(env, app: .aglyn).passkeyRelyingParty, "aglyn.com")
    // An origin, a port, a path or a local host is not a relying party.
    for wrong in ["https://aglyn.com", "aglyn.com:443", "aglyn.com/app", "localhost", "127.0.0.1", "aglyn"] {
      env["AGLYN_PASSKEY_RP_ID"] = wrong
      XCTAssertNil(try AglynConfig.read(env, app: .aglyn).passkeyRelyingParty, wrong)
    }
  }

  func testTheDocsAndLegalOriginsAreHTTPSOriginsOrTheDefaults() throws {
    var env = base
    XCTAssertEqual(try AglynConfig.read(env, app: .aglyn).docsOrigin, "https://docs.aglyn.com")
    XCTAssertEqual(try AglynConfig.read(env, app: .aglyn).legalOrigin, "https://aglyn.com")
    env["AGLYN_DOCS_ORIGIN"] = " https://Docs.Example.com/ "
    env["AGLYN_LEGAL_ORIGIN"] = "https://example.com"
    XCTAssertEqual(try AglynConfig.read(env, app: .aglyn).docsOrigin, "https://docs.example.com")
    XCTAssertEqual(try AglynConfig.read(env, app: .aglyn).legalOrigin, "https://example.com")
    // A plain-http address, a path or an unset build setting falls back.
    for wrong in ["http://docs.example.com", "https://docs.example.com/help", "$(AGLYN_DOCS_ORIGIN)", ""] {
      env["AGLYN_DOCS_ORIGIN"] = wrong
      XCTAssertEqual(try AglynConfig.read(env, app: .aglyn).docsOrigin, "https://docs.aglyn.com", wrong)
    }
  }

  func testProblemsNameWhatIsMissingAndAnEmulatorOnALiveConsole() throws {
    let empty = try AglynConfig.read([:], app: .pos)
    XCTAssertEqual(
      empty.problems,
      [
        "AGLYN_FIREBASE_API_KEY is not set.", "AGLYN_FIREBASE_PROJECT_ID is not set.",
        "AGLYN_FIREBASE_APP_ID is not set.", "AGLYN_FIREBASE_AUTH_DOMAIN is not set.",
      ])
    var env = base
    env["AGLYN_AUTH_EMULATOR_HOST"] = "127.0.0.1:9099"
    env["AGLYN_FIRESTORE_EMULATOR_HOST"] = "127.0.0.1:8082"
    XCTAssertEqual(
      try AglynConfig.read(env, app: .aglyn).problems,
      ["The Auth emulator is set for a non-local console.", "The Firestore emulator is set for a non-local console."])
  }
}
