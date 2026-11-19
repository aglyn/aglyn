// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// The title bar's Offline indicator (AGL-1056) reads this: online until the path says otherwise, in the console's words.
@MainActor
final class NetworkStatusTests: XCTestCase {
  func testTracksThePath() {
    let status = NetworkStatus()
    status.set(online: false)
    XCTAssertFalse(status.online)
    status.set(online: true)
    XCTAssertTrue(status.online)
    XCTAssertTrue(NetworkStatus.detail.hasPrefix("Your device has lost its network connection."))
  }
}
