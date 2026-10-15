// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the page-address and template-token cases in libs/native/contracts/function-cases.generated.json:
/// the TypeScript's own answers.
final class TemplateRulesTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // AglynContractsTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // apple
      .deletingLastPathComponent()  // native
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    let entry = Self.functions[name] as! [String: Any]
    return (entry["cases"] as! [[String: Any]]).map { (args: $0["args"] as! [Any], result: $0["result"] as Any) }
  }

  private func text(_ value: Any?) -> String? { value as? String }

  func testSlugsAreNormalizedAndCheckedAsTheConsoleDoes() {
    for item in cases("normalizeScreenSlug") { XCTAssertEqual(normalizeScreenSlug(text(item.args[0])), text(item.result), "\(item.args)") }
    for item in cases("reservedScreenRouteSegment") {
      XCTAssertEqual(reservedScreenRouteSegment(text(item.args[0])), text(item.result), "\(item.args)")
    }
    for item in cases("reservedScreenRouteMessage") {
      XCTAssertEqual(reservedScreenRouteMessage(text(item.args[0])!), text(item.result), "\(item.args)")
    }
    for item in cases("screenSlugHasPathSeparator") {
      XCTAssertEqual(screenSlugHasPathSeparator(text(item.args[0])), item.result as? Bool, "\(item.args)")
    }
    XCTAssertEqual(screenRootPath, "/")
  }

  func testATemplatePageLandsWhereTheConsolePutsIt() {
    let refusals = cases("templateScreenAddressRefusal")
    XCTAssertGreaterThanOrEqual(refusals.count, 6)
    for item in refusals {
      let input = item.args[0] as! [String: Any]
      XCTAssertEqual(
        templateScreenAddressRefusal(slug: text(input["slug"]), displayName: text(input["displayName"])), text(item.result),
        "\(item.args)")
    }
    let among = cases("resolveTemplateSlugAmong")
    XCTAssertGreaterThanOrEqual(among.count, 8)
    for item in among {
      let input = item.args[0] as! [String: Any]
      var taken = Set(input["taken"] as! [String])
      let answer = resolveTemplateSlug(slug: text(input["slug"]), displayName: text(input["displayName"]) ?? "", taken: &taken)
      let expected = item.result as! [String: Any]
      XCTAssertEqual(answer.slug, text(expected["slug"]), "\(item.args)")
      XCTAssertEqual(answer.requestedSlug, text(expected["requestedSlug"]), "\(item.args)")
      XCTAssertEqual(taken, Set(expected["taken"] as! [String]), "\(item.args)")
    }
  }

  func testABundleWithoutAHomePageGivesItsFirstPageTheRoot() {
    let all = cases("withBundleRootScreen")
    XCTAssertGreaterThanOrEqual(all.count, 5)
    for item in all {
      typealias Page = [String: String]
      let pages = (item.args[0] as! [[String: Any]]).map { $0.compactMapValues { $0 as? String } }
      let taken = item.args[1] as! [String]
      let actual = withBundleRootScreen(pages, taken: taken, slug: { $0["slug"] }, setting: { page, slug in
        var next = page
        next["slug"] = slug
        return next
      })
      let expected = (item.result as! [[String: Any]]).map { $0.compactMapValues { $0 as? String } }
      XCTAssertEqual(actual, expected, "\(item.args)")
    }
  }

  func testPlaceholdersAreFilledInEveryNodesProps() {
    let all = cases("resolveNamedTokens")
    XCTAssertGreaterThanOrEqual(all.count, 8)
    for item in all {
      let nodes = item.args[0] as! [String: Any]
      let tokens = (item.args[1] as? [String: Any])?.compactMapValues { $0 as? String }
      XCTAssertTrue((resolveNamedTokens(nodes, tokens: tokens) as NSDictionary).isEqual(item.result), "\(item.args)")
    }
  }

  func testASavedTemplateAsksForTheBareNamesItsContentUses() {
    let all = cases("detectTemplatePlaceholders")
    XCTAssertGreaterThanOrEqual(all.count, 6)
    for item in all {
      XCTAssertEqual(detectTemplatePlaceholders(item.args[0] as! [String: Any]), item.result as? [String], "\(item.args)")
    }
  }
}
