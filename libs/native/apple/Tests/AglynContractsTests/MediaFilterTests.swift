// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the media-filter cases in libs/native/contracts/function-cases.generated.json:
/// the TypeScript's own answers.
final class MediaFilterTests: XCTestCase {
  private func clause(_ value: Any?) throws -> ListFilterRequest {
    let data = try JSONSerialization.data(withJSONObject: try XCTUnwrap(value))
    return try JSONDecoder().decode(ListFilterRequest.self, from: data)
  }

  func testEveryCaseMatchesTheConsole() throws {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // AglynContractsTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // apple
      .deletingLastPathComponent()  // native
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let functions = try XCTUnwrap(root["functions"] as? [String: Any])
    let entry = try XCTUnwrap(functions["mediaQueryRequest"] as? [String: Any])
    let cases = try XCTUnwrap(entry["cases"] as? [[String: Any]])
    XCTAssertGreaterThanOrEqual(cases.count, 8)
    for item in cases {
      let args = try XCTUnwrap(item["args"] as? [Any])
      XCTAssertEqual(mediaQueryRequest(try clause(args[0])), try clause(item["result"]), "\(args)")
    }
  }
}
