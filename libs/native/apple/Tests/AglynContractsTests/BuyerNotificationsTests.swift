// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays buyerNotificationEnabled's cases in function-cases.generated.json.
final class BuyerNotificationsTests: XCTestCase {
  func testOnUnlessExplicitlyFalse() throws {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    let function = (root["functions"] as! [String: Any])["buyerNotificationEnabled"] as! [String: Any]
    let cases = function["cases"] as! [[String: Any]]
    XCTAssertFalse(cases.isEmpty)
    for c in cases {
      let args = c["args"] as! [Any]
      let settings: Any? = args[0] is NSNull ? nil : args[0]
      XCTAssertEqual(buyerNotificationEnabled(settings, args[1] as! String), c["result"] as? Bool, "\(args)")
    }
  }
}
