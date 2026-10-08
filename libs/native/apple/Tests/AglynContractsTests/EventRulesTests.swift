// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the event rule's cases in function-cases.generated.json.
final class EventRulesTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    (((Self.functions[name] as? [String: Any])?["cases"] as? [[String: Any]]) ?? []).map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  private func decode<T: Decodable>(_ type: T.Type, _ value: Any) -> T {
    try! JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value))
  }

  func testEventWrite() {
    let all = cases("eventWrite")
    XCTAssertFalse(all.isEmpty)
    for c in all {
      let clear = (c.args.count > 1 ? (c.args[1] as? [String: Any])?["clearBlank"] as? Bool : nil) ?? false
      XCTAssertEqual(eventWrite(decode(EventWriteInput.self, c.args[0]), clearBlank: clear), decode(EventWrite.self, c.result), "\(c.args)")
    }
  }

  func testProblemsEndsAndStatuses() {
    for c in cases("eventWriteProblem") {
      let input = c.args[0] as! [String: Any]
      XCTAssertEqual(eventWriteProblem(title: input["title"] as! String, startsAtMs: (input["startsAtMs"] as! NSNumber).intValue), c.result as? String)
    }
    for c in cases("eventEndsAtMs") {
      XCTAssertEqual(eventEndsAtMs(startsAtMs: (c.args[0] as! NSNumber).intValue, endsAtMs: (c.args[1] as? NSNumber)?.intValue), (c.result as! NSNumber).intValue)
    }
    for c in cases("eventStatusOf") {
      XCTAssertEqual(eventStatusOf(c.args[0])?.rawValue, c.result as? String, "\(c.args)")
    }
  }
}
