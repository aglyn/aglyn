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
