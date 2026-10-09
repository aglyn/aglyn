// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the funnels rules' cases in function-cases.generated.json.
final class FunnelRulesTests: XCTestCase {
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

  private func decode<T: Decodable>(_ type: T.Type, _ value: Any) -> T {
    try! JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]))
  }

  private func string(_ value: Any) -> String? { value as? String }

  private func input(_ value: Any) -> FunnelStepInput {
    let object = value as? [String: Any] ?? [:]
    return FunnelStepInput(type: object["type"] as? String, key: object["key"] as? String, match: object["match"] as? String, label: object["label"] as? String)
  }

  func testStepTitles() {
    for c in cases("funnelStepTitle") {
      XCTAssertEqual(funnelStepTitle(decode(FunnelStep.self, c.args[0])), c.result as? String, "\(c.args)")
    }
  }

  func testWaitsAndFigures() {
    for c in cases("waitLabel") {
      XCTAssertEqual(waitLabel((c.args[0] as! NSNumber).intValue), c.result as? String, "\(c.args)")
    }
    for c in cases("formatShare") {
      XCTAssertEqual(formatShare((c.args[0] as? NSNumber)?.doubleValue), c.result as? String, "\(c.args)")
    }
    for c in cases("formatDuration") {
      XCTAssertEqual(formatDuration((c.args[0] as? NSNumber)?.doubleValue), c.result as? String, "\(c.args)")
    }
  }

  func testDefinitionChecks() {
    for c in cases("normalizeFunnelDefinition") {
      let raw = c.args[0] as! [String: Any]
      let steps = (raw["steps"] as? [Any] ?? []).map(input)
      let check = normalizeFunnelDefinition(name: raw["name"] as? String, steps: steps)
      let expected = c.result as! [String: Any]
      if let error = expected["error"] as? String {
        XCTAssertEqual(check.error, error, "\(c.args)")
      } else {
        XCTAssertNil(check.error, "\(c.args)")
        XCTAssertEqual(check.funnel, decode(FunnelDefinition.self, expected["funnel"]!), "\(c.args)")
      }
    }
  }

  func testInventoryChecks() {
    for c in cases("stepInventoryProblem") {
      XCTAssertEqual(stepInventoryProblem(decode(FunnelStep.self, c.args[0]), decode(FunnelInventory.self, c.args[1])), string(c.result), "\(c.args)")
    }
    for c in cases("labelStepFromInventory") {
      XCTAssertEqual(labelStepFromInventory(decode(FunnelStep.self, c.args[0]), decode(FunnelInventory.self, c.args[1])), decode(FunnelStep.self, c.result), "\(c.args)")
    }
  }
}
