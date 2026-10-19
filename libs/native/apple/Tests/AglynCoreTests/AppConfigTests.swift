// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

/// Both apps keep Firebase's app-delegate proxy off (AGL-3835): with it on, Firebase Auth's swizzler takes the APNs
/// device token before SwiftUI's delegate hands it to `PushCenter`. Read from the checkout here, where `swift test` runs
/// unsandboxed, rather than from a hosted app test, whose read of ~/Documents asks the system for permission.
final class AppConfigTests: XCTestCase {
  func testBothAppsKeepFirebasesAppDelegateProxyOff() throws {
    let config = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // AglynCoreTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // apple
      .deletingLastPathComponent()  // native
      .deletingLastPathComponent()  // libs
      .deletingLastPathComponent()  // repo
      .appendingPathComponent("apps/ios/Config")
    for name in ["Aglyn-Info.plist", "AglynPOS-Info.plist"] {
      let data = try Data(contentsOf: config.appendingPathComponent(name))
      let plist = try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
      XCTAssertEqual(plist["FirebaseAppDelegateProxyEnabled"] as? Bool, false, name)
    }
  }
}
