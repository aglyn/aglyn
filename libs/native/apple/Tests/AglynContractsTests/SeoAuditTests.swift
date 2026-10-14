// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the SEO check's cases in function-cases.generated.json.
final class SeoAuditTests: XCTestCase {
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

  func testPathsAndKeywords() {
    for item in cases("seoNormalizePath") { XCTAssertEqual(seoNormalizePath(item.args[0] as? String ?? ""), item.result as? String, "\(item.args)") }
    for item in cases("seoKeywordSplit") {
      let split = (item.args[0] as? [Any]).map { seoKeywordSplit($0.compactMap { $0 as? String }) } ?? seoKeywordSplit(item.args[0] as? String)
      let expected = item.result as? [String: Any] ?? [:]
      XCTAssertEqual(split.keywords, expected["keywords"] as? [String], "\(item.args)")
      XCTAssertEqual(split.unchecked, expected["unchecked"] as? [String], "\(item.args)")
    }
    for item in cases("readSeoKeywordLines") {
      let read = readSeoKeywordLines(item.args[0] as? String)
      let expected = item.result as? [String: Any] ?? [:]
      XCTAssertEqual(read.keywords, expected["keywords"] as? [String: [String]], "\(item.args)")
      XCTAssertEqual(read.unchecked, expected["unchecked"] as? [String: [String]], "\(item.args)")
    }
  }

  func testRowsRoundTripTheLinesInTheirOrder() {
    let rows = seoKeywordRows(fromLines: "/b: two, three\n/a: one, two, three, four, five, six")
    XCTAssertEqual(rows.map(\.path), ["/b", "/a"])
    XCTAssertEqual(rows[1].keywords, ["one", "two", "three", "four", "five", "six"])
    XCTAssertEqual(seoKeywordLines(fromRows: rows), "/b: two, three\n/a: one, two, three, four, five, six")
    XCTAssertEqual(
      seoKeywordLines(fromRows: [SeoTargetKeywordRow(path: "a", keywords: ["x"]), SeoTargetKeywordRow(path: "", keywords: ["y"]), SeoTargetKeywordRow(path: "/c", keywords: [])]),
      "/a: x")
  }

  func testFindingCountAndLabels() {
    for item in cases("seoAuditFindingCount") {
      let object = item.args[0] as? [String: Any] ?? [:]
      let pages = (object["pages"] as? [[String: Any]] ?? []).map { page in
        SeoPageReport(
          findings: (page["findings"] as? [Any] ?? []).map { _ in SeoFinding(code: .orphan, message: "", severity: .low) }, keywords: [], name: "", path: "", score: 0, screenId: "")
      }
      let site = (object["site"] as? [Any] ?? []).map { _ in SeoFinding(code: .searchDiscouraged, message: "", severity: .high) }
      XCTAssertEqual(seoAuditFindingCount(SeoAuditReport(notes: [], pages: pages, score: 0, site: site, skipped: 0)), (item.result as? NSNumber)?.intValue, "\(item.args)")
    }
    XCTAssertEqual(seoFindingLabel(SeoFinding(code: .keywordMissing, keyword: "pricing", message: "", severity: .low)), "Target keyword not covered: pricing")
    XCTAssertEqual(seoFindingLabel(SeoFinding(code: .titleMissing, message: "", severity: .high)), "No search title")
  }
}
