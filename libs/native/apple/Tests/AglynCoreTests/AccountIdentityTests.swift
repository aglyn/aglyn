// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// The person's own photo and name (AGL-4010): read off their profile the way the console reads them.
@MainActor
final class AccountIdentityTests: XCTestCase {
  func testTheProfilePhotoAndNameWinOverTheSignInRecord() {
    let store = AccountPreferencesStore(uid: "u1", reader: FakeReader())
    XCTAssertNil(store.photo(authPhotoURL: nil), "no photo anywhere draws initials")
    XCTAssertEqual(store.photo(authPhotoURL: "https://a.example.com/p.jpg"), "https://a.example.com/p.jpg")
    XCTAssertEqual(store.name(authDisplayName: nil, email: "jordan@example.com"), "jordan@example.com")

    store.apply([
      "photoUrl": " /api/media/cdn/org:o1/m1 ", "firstName": "Jordan", "lastName": "Lee",
      "notificationSound": "xylophone", "pinnedOrgs": ["o1"],
    ])
    XCTAssertEqual(store.photo(authPhotoURL: "https://a.example.com/p.jpg"), "/api/media/cdn/org:o1/m1")
    XCTAssertEqual(store.name(authDisplayName: "J. Lee", email: "jordan@example.com"), "Jordan Lee")
    XCTAssertEqual(store.identity["notificationSound"], "xylophone")

    store.apply(["photoUrl": "  "])
    XCTAssertEqual(store.photo(authPhotoURL: "https://a.example.com/p.jpg"), "https://a.example.com/p.jpg")
  }

  func testTheTokenCarriesThePicture() {
    // {"email_verified":true,"picture":"https://a.example.com/p.jpg"}
    let payload = Data(#"{"email_verified":true,"picture":"https://a.example.com/p.jpg"}"#.utf8).base64EncodedString()
      .replacingOccurrences(of: "=", with: "")
    let user = AglynUser(uid: "u1", email: "a@example.com", displayName: nil).fromToken(TokenClaims(idToken: "h.\(payload).s"))
    XCTAssertEqual(user.photoURL, "https://a.example.com/p.jpg")
    XCTAssertTrue(user.emailVerified)
    let kept = user.fromToken(TokenClaims(idToken: nil))
    XCTAssertEqual(kept.photoURL, "https://a.example.com/p.jpg", "a token without a picture keeps the one known")
  }
}
