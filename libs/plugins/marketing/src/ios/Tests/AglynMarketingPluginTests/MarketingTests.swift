// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import XCTest

@testable import AglynMarketingPlugin

/// The console's own answers, recorded by `generate-native-contracts.mjs`.
private func functionCases(_ name: String) throws -> [(args: [Any], result: Any)] {
  var url = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { url.deleteLastPathComponent() }
  url.appendPathComponent("native/contracts/function-cases.generated.json")
  let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
  let function = (root?["functions"] as? [String: Any])?[name] as? [String: Any]
  let cases = try XCTUnwrap(function?["cases"] as? [[String: Any]], "no cases for \(name)")
  return cases.map { ($0["args"] as? [Any] ?? [], $0["result"] ?? NSNull()) }
}

private func variants(_ raw: Any?) -> [VariantRow] {
  (raw as? [[String: Any]] ?? []).map { VariantRow(id: $0["id"] as! String, name: $0["name"] as? String, weight: ($0["weight"] as? NSNumber)?.doubleValue) }
}

final class MarketingTests: XCTestCase {
  func testExperimentValidationIsTheConsoles() throws {
    for (index, item) in try functionCases("validateExperiment").enumerated() {
      let e = item.args[0] as! [String: Any]
      let auto = e["autoWinner"] as? [String: Any]
      let got = validateExperiment(
        name: e["name"] as? String ?? "", target: e["target"] as? String ?? "", screenID: e["screenId"] as? String, nodeID: e["nodeId"] as? String,
        variantIDs: variants(e["variants"]).map(\.id),
        autoWinner: auto.map { (($0["minExposures"] as! NSNumber).doubleValue, ($0["confidence"] as! NSNumber).doubleValue) })
      XCTAssertEqual(got, item.result as? String, "case \(index)")
    }
  }

  func testResultRowsAreTheConsoles() throws {
    for (index, item) in try functionCases("experimentResultRows").enumerated() {
      let e = item.args[0] as! [String: Any]
      let stats = item.args[1] as? [String: [String: Any]] ?? [:]
      let got = experimentResultRows(variants: variants(e["variants"]), winnerVariantID: e["winnerVariantId"] as? String, stats: stats)
      let want = item.result as! [[String: Any]]
      XCTAssertEqual(got.count, want.count, "case \(index)")
      for (row, expected) in zip(got, want) {
        XCTAssertEqual(row.leader, expected["leader"] as? Bool, "case \(index)")
        XCTAssertEqual(row.winner, expected["winner"] as? Bool, "case \(index)")
        let summary = expected["summary"] as! [String: Any]
        XCTAssertEqual(row.summary.rate, (summary["rate"] as! NSNumber).doubleValue, accuracy: 1e-12, "case \(index)")
        let comparison = expected["comparison"] as? [String: Any]
        XCTAssertEqual(row.comparison == nil, comparison == nil, "case \(index)")
        if let comparison, let got = row.comparison {
          XCTAssertEqual(got.lift ?? -9, (comparison["lift"] as? NSNumber)?.doubleValue ?? -9, accuracy: 1e-9, "case \(index)")
          XCTAssertEqual(got.confidence ?? -9, (comparison["confidence"] as? NSNumber)?.doubleValue ?? -9, accuracy: 1e-9, "case \(index)")
        }
      }
    }
  }

  func testComparisonWordsAreTheConsoles() throws {
    for (index, item) in try functionCases("describeVariantComparison").enumerated() {
      let raw = item.args.first as? [String: Any]
      let comparison = raw.map { VariantComparison(lift: ($0["lift"] as? NSNumber)?.doubleValue, confidence: ($0["confidence"] as? NSNumber)?.doubleValue) }
      XCTAssertEqual(describeVariantComparison(comparison), item.result as? String, "case \(index)")
    }
  }

  func testWindowAndOverlayStatusFollowTheConsole() {
    XCTAssertEqual(campaignWindowState(startAtMs: nil, endAtMs: nil, nowMs: 5), .undated)
    XCTAssertEqual(campaignWindowState(startAtMs: 10, endAtMs: nil, nowMs: 5), .upcoming)
    XCTAssertEqual(campaignWindowState(startAtMs: 1, endAtMs: 4, nowMs: 5), .ended)
    XCTAssertEqual(campaignWindowState(startAtMs: 1, endAtMs: 9, nowMs: 5), .running)
    XCTAssertEqual(overlayStatus(enabled: false, startAtMs: nil, endAtMs: nil, nowMs: 5), "off")
    XCTAssertEqual(overlayStatus(enabled: true, startAtMs: nil, endAtMs: nil, nowMs: 5), "live")
    XCTAssertEqual(overlayStatus(enabled: true, startAtMs: 9, endAtMs: nil, nowMs: 5), "scheduled")
    XCTAssertEqual(overlayStatus(enabled: true, startAtMs: nil, endAtMs: 4, nowMs: 5), "scheduled")
  }
}
