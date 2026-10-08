// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

/// Replays the console's own answers for the media library's search and type
/// helpers (libs/native/contracts/function-cases.generated.json), as the
/// Kotlin `MediaSearchTest` does.
final class MediaSearchTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // AglynSiteTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // apple
      .deletingLastPathComponent()  // native
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(arg: String?, result: String)] {
    let entry = Self.functions[name] as? [String: Any]
    let list = entry?["cases"] as? [[String: Any]] ?? []
    XCTAssertFalse(list.isEmpty, "\(name) has no cases")
    return list.map { (($0["args"] as? [Any])?.first as? String, $0["result"] as? String ?? "") }
  }

  func testMediaSearchTokenCases() {
    for item in cases("mediaSearchToken") {
      XCTAssertEqual(mediaSearchToken(item.arg), item.result, item.arg ?? "nil")
    }
  }

  func testMediaKindOfCases() {
    for item in cases("mediaKindOf") {
      XCTAssertEqual(mediaKindOf(item.arg), item.result, item.arg ?? "nil")
    }
  }

  func testAFileNamesPunctuationIsAWordBreak() {
    XCTAssertEqual(mediaNameWords("hero-banner_2024.jpg"), "hero banner 2024 jpg")
    XCTAssertEqual(MediaNameNormalizers().token("Hero-banner"), "hero")
  }
}
