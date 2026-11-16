// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the business details cases in function-cases.generated.json: the console's own answers (AGL-4136).
final class BusinessDetailsTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    let list = ((Self.functions[name] as? [String: Any])?["cases"] as? [[String: Any]]) ?? []
    XCTAssertFalse(list.isEmpty, "no cases for \(name)")
    return list.map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  /// A value as JSON text with sorted keys, so two plain values compare by content.
  private func canonical(_ value: Any?) -> String {
    guard let value, !(value is NSNull) else { return "null" }
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])
    return String(data: data, encoding: .utf8)!
  }

  func testWrite() {
    for item in cases("businessDetailsWrite") {
      let written = businessDetailsWrite(item.args[0] as? [String: Any] ?? [:], stored: item.args[1] as? [String: Any])
      XCTAssertEqual(canonical(written), canonical(item.result), "\(item.args)")
    }
  }

  func testSeed() {
    for item in cases("businessDetailsSeed") {
      XCTAssertEqual(canonical(businessDetailsSeed(item.args[0] as? [String: Any])), canonical(item.result), "\(item.args)")
    }
  }

  func testValues() {
    let contracts = ContractValues.shared
    XCTAssertEqual(contracts.siteSloganMaxLength, 120)
    XCTAssertEqual(contracts.businessSocialLinksMax, 8)
    XCTAssertTrue(contracts.businessDetailsClearablePathList.contains("seo.entity.slogan"))
    XCTAssertTrue(contracts.businessDetailsClearablePathList.contains("business.supportEmail"))
  }
}
