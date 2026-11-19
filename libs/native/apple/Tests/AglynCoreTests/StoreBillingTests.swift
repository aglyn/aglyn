// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// A store build takes no payment to Aglyn and says so in one line (the owner's decision of 2026-11-19).
final class StoreBillingTests: XCTestCase {
  private func config(_ value: String?) throws -> AglynConfig {
    var env = ["AGLYN_CONSOLE_URL": "https://app.example.com"]
    if let value { env["AGLYN_IN_APP_BILLING"] = value }
    return try AglynConfig.read(env, app: .aglyn)
  }

  func testBuyingIsOnOnlyWhenTheBuildSaysSo() throws {
    XCTAssertTrue(try config("on").inAppBilling)
    XCTAssertTrue(try config("YES").inAppBilling)
    XCTAssertFalse(try config("off").inAppBilling)
    // Unset, empty or a typo: off, so a missing key never turns buying on.
    XCTAssertFalse(try config(nil).inAppBilling)
    XCTAssertFalse(try config("").inAppBilling)
    XCTAssertFalse(try config("onn").inAppBilling)
    XCTAssertTrue(AglynConfig.keys.contains("AGLYN_IN_APP_BILLING"))
  }

  func testTheStoreBuildOverrideOnlyTurnsBuyingOff() {
    XCTAssertTrue(StoreBilling.decide(configured: true, storeBuildOverride: false))
    XCTAssertFalse(StoreBilling.decide(configured: true, storeBuildOverride: true))
    XCTAssertFalse(StoreBilling.decide(configured: false, storeBuildOverride: false))
    XCTAssertFalse(StoreBilling.decide(configured: false, storeBuildOverride: true))
  }

  func testTheWebBillingLinkIsForTheUnitedStatesStorefrontOnly() {
    XCTAssertTrue(StoreBilling.linkAllowed(storefrontCountry: "USA"))
    XCTAssertTrue(StoreBilling.linkAllowed(storefrontCountry: "usa"))
    XCTAssertFalse(StoreBilling.linkAllowed(storefrontCountry: "CAN"))
    XCTAssertFalse(StoreBilling.linkAllowed(storefrontCountry: "GBR"))
    XCTAssertFalse(StoreBilling.linkAllowed(storefrontCountry: "US"))
    XCTAssertFalse(StoreBilling.linkAllowed(storefrontCountry: ""))
    XCTAssertFalse(StoreBilling.linkAllowed(storefrontCountry: nil))
  }

  func testTheLinkOpensTheWorkspaceBillingPageThroughSignIn() {
    XCTAssertEqual(
      StoreBilling.webBillingURL(consoleOrigin: "https://app.aglyn.com", orgSlug: "acme-inc")?.absoluteString,
      "https://app.aglyn.com/signin?continue=/acme-inc/billing")
    XCTAssertEqual(
      StoreBilling.webBillingURL(consoleOrigin: "http://localhost:4610/", orgSlug: "acme")?.absoluteString,
      "http://localhost:4610/signin?continue=/acme/billing")
    XCTAssertNil(StoreBilling.webBillingURL(consoleOrigin: "https://app.aglyn.com", orgSlug: ""))
    XCTAssertNil(StoreBilling.webBillingURL(consoleOrigin: "https://app.aglyn.com", orgSlug: "a/../b"))
  }

  func testBothLinesComeFromTheContracts() {
    XCTAssertEqual(StoreBilling.webBillingLinkLabel, "Manage billing on the web")
    XCTAssertEqual(StoreBilling.noBillingNote, "Plan and billing changes are not available in the app.")
    // The no-link sentence names no address and no other place to buy.
    for word in ["web", "http", "aglyn.com", "$", "browser", "site"] {
      XCTAssertFalse(StoreBilling.noBillingNote.lowercased().contains(word), word)
    }
  }

  @MainActor
  func testConfigureFollowsTheBuildAndTheDebugOverride() throws {
    let defaults = UserDefaults(suiteName: "StoreBillingTests")!
    defaults.removePersistentDomain(forName: "StoreBillingTests")
    defaults.set("USA", forKey: StoreBilling.storefrontArgument)
    StoreBilling.configure(try config("on"), defaults: defaults)
    XCTAssertTrue(StoreBilling.buying)
    XCTAssertTrue(StoreBilling.webBillingLink)
    StoreBilling.configure(try config("off"), defaults: defaults)
    XCTAssertFalse(StoreBilling.buying)
    // Tests build in Debug, where the override is read.
    defaults.set(true, forKey: StoreBilling.storeBuildArgument)
    defaults.set("CAN", forKey: StoreBilling.storefrontArgument)
    StoreBilling.configure(try config("on"), defaults: defaults)
    XCTAssertFalse(StoreBilling.buying)
    XCTAssertFalse(StoreBilling.webBillingLink)
    defaults.removePersistentDomain(forName: "StoreBillingTests")
    StoreBilling.set(buying: false, webBillingLink: false)
  }
}
