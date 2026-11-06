// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynMarketplacePlugin

/// The publisher's connection credentials (AGL-4196): the console's `listing-connection-credentials-card.spec.tsx`.
final class ListingConnectionCredentialsTests: XCTestCase {
  func testRedirectURIIsTheConsoleCallback() {
    XCTAssertEqual(pluginConnectionRedirectURI(origin: "https://app.aglyn.com/"), "https://app.aglyn.com/api/plugin-connections/connect/callback")
    XCTAssertEqual(pluginConnectionRedirectURI(origin: "http://localhost:4200"), "http://localhost:4200/api/plugin-connections/connect/callback")
  }

  func testTheAnswerSaysSetOrNotSetAndNeverAValue() {
    let answer = PluginConnectionCredentialsAnswer(
      .object([
        "configured": .bool(true),
        "credentials": .array([
          .object(["connectionId": "google", "label": "Google Business Profile", "set": .bool(true), "updatedAtMs": .number(1_793_958_000_000)]),
          .object(["connectionId": "other", "label": "Other", "set": .bool(false), "updatedAtMs": .null]),
          .object(["label": "No id"]),
        ]),
      ]))
    XCTAssertTrue(answer.configured)
    XCTAssertEqual(answer.credentials.map(\.connectionID), ["google", "other"])
    XCTAssertEqual(answer.credentials[0].set, true)
    XCTAssertEqual(answer.credentials[0].updatedAtMs, 1_793_958_000_000)
    XCTAssertEqual(answer.credentials[1].set, false)
    XCTAssertNil(answer.credentials[1].updatedAtMs)
    XCTAssertEqual(PluginConnectionCredentialsAnswer(nil).credentials, [])
    XCTAssertFalse(PluginConnectionCredentialsAnswer(nil).configured)
  }

  func testTheKeyAndRouteAreTheConsoles() {
    XCTAssertEqual(pluginConnectionCredentialsKey, "marketplace.connectionCredentials")
    XCTAssertEqual(pluginConnectionCredentialsRoute, "/api/plugin-connections/credentials")
  }
}
