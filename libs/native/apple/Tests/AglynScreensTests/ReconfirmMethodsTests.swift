// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynScreens

/// Which ways "Confirm it is you" offers (AGL-1140): the console's close-account card's rule, read off the account's own
/// sign-in methods, limited to what the build can run.
final class ReconfirmMethodsTests: XCTestCase {
  private let everything = Reconfirm.Offers(apple: true, google: true, singleSignOn: true, passkey: true)

  func testAPasswordAccountIsAskedForItsPassword() {
    XCTAssertEqual(Reconfirm.methods(providers: ["password"], offers: everything), [.password])
    XCTAssertEqual(Reconfirm.methods(providers: ["password", "google.com"], offers: everything), [.password, .google])
  }

  func testAnAccountWithNoPasswordSignsInAgainWithItsOwnProvider() {
    XCTAssertEqual(Reconfirm.methods(providers: ["apple.com"], offers: everything), [.apple])
    XCTAssertEqual(Reconfirm.methods(providers: ["google.com"], offers: everything), [.google])
    XCTAssertEqual(Reconfirm.methods(providers: ["saml.acme"], offers: everything), [.singleSignOn])
    XCTAssertEqual(Reconfirm.methods(providers: ["oidc.acme"], offers: everything), [.singleSignOn])
    XCTAssertEqual(Reconfirm.singleSignOnProvider(["oidc.b", "saml.a"]), "saml.a")
  }

  func testAProviderThisBuildCannotRunFallsBackToAPasskeyOutsideSingleSignOn() {
    let noApple = Reconfirm.Offers(google: true, singleSignOn: true, passkey: true)
    XCTAssertEqual(Reconfirm.methods(providers: ["apple.com"], offers: noApple), [.passkey])
    XCTAssertEqual(Reconfirm.methods(providers: ["saml.acme"], offers: Reconfirm.Offers(passkey: true)), [])
    XCTAssertEqual(Reconfirm.methods(providers: ["apple.com"], offers: Reconfirm.Offers()), [])
    // A passkey is not offered beside the account's own way.
    XCTAssertEqual(Reconfirm.methods(providers: ["google.com"], offers: everything), [.google])
  }
}
