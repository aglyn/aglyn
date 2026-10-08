// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the Analytics page's figures in function-cases.generated.json.
final class AnalyticsRulesTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    let list = ((Self.functions[name] as? [String: Any])?["cases"] as? [[String: Any]]) ?? []
    XCTAssertFalse(list.isEmpty, name)
    return list.map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  private func decode<T: Decodable>(_ type: T.Type, _ value: Any) -> T {
    try! JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value))
  }

  private func counts(_ value: Any?) -> [String: Double] { (value as? [String: NSNumber] ?? [:]).mapValues(\.doubleValue) }

  func testWindowAndSplit() {
    for c in cases("trafficDeltaPct") {
      XCTAssertEqual(trafficDeltaPct(current: (c.args[0] as! NSNumber).doubleValue, prior: (c.args[1] as! NSNumber).doubleValue), (c.result as? NSNumber)?.doubleValue, "\(c.args)")
    }
    for c in cases("deviceSplit") {
      XCTAssertEqual(deviceSplit(counts(c.args[0])), decode([DeviceSplitEntry].self, c.result), "\(c.args)")
    }
    for c in cases("deviceSplitLabel") { XCTAssertEqual(deviceSplitLabel(decode([DeviceSplitEntry].self, c.args[0])), c.result as? String) }
    for c in cases("deviceSplitValue") { XCTAssertEqual(deviceSplitValue(decode([DeviceSplitEntry].self, c.args[0])), c.result as? String) }
    for c in cases("rollUp") {
      let field = c.args[1] as! String
      let days = (c.args[0] as! [[String: Any]]).map { counts($0[field]) }
      let expected = (c.result as! [[Any]]).map { "\($0[0]):\(($0[1] as! NSNumber).doubleValue)" }
      XCTAssertEqual(rollUp(days).map { "\($0.key):\($0.value)" }, expected, "\(c.args)")
    }
    for c in cases("formatDwell") { XCTAssertEqual(formatDwell((c.args[0] as! NSNumber).doubleValue), c.result as? String) }
  }

  func testPagesTable() {
    for c in cases("aggregateScreenDays") {
      XCTAssertEqual(aggregateScreenDays(c.args[0] as! [[String: Any]]), decode([ScreenTrafficRow].self, c.result), "\(c.args)")
    }
    for c in cases("topDevice") { XCTAssertEqual(topDevice(decode(ScreenTrafficRow.self, c.args[0])), c.result as? String) }
    for c in cases("topReferrer") { XCTAssertEqual(topReferrer(decode(ScreenTrafficRow.self, c.args[0])), c.result as? String) }
  }
}
