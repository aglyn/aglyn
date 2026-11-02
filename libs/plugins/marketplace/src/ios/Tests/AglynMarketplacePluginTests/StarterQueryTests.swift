// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynMarketplacePlugin

/// Replays derived-values.generated.json's `siteStarters`: the search as the console asks it and reads it. The Kotlin
/// `StarterQueryTest` replays the same.
final class StarterQueryTests: XCTestCase {
  private func list(_ value: JSONValue?) -> [JSONValue] { value?.arrayValue ?? [] }

  private func starters() throws -> JSONValue {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<7 { url.deleteLastPathComponent() }
    url.appendPathComponent("native/contracts/derived-values.generated.json")
    return try XCTUnwrap(JSONValue.decode(try Data(contentsOf: url))?["siteStarters"])
  }

  func testAsksInTheConsolesOrder() throws {
    for entry in list(try starters()["paramCases"]) {
      let input = try XCTUnwrap(entry["input"])
      // The apps name no facet and restore no pick, so their search is the console's with neither.
      if input["filter"] != nil || input["include"] != nil { continue }
      let params = StarterQuery.params(
        orgID: input["orgId"]?.stringValue ?? "", mode: input["mode"] == "ai" ? .ai : .base, word: input["word"]?.stringValue ?? "",
        limit: input["limit"]?.numberValue.map { Int($0) } ?? 50)
      let expected = list(entry["params"]).map { pair in list(pair).compactMap { $0.stringValue } }
      XCTAssertEqual(params.map { [$0.0, $0.1] }, expected, "\(input)")
    }
  }

  func testReadsAStarterAsTheConsole() throws {
    let cases = list(try starters()["summaryCases"])
    XCTAssertFalse(cases.isEmpty)
    for entry in cases {
      let read = StarterQuery.readSummary(entry["value"])
      guard let expected = entry["summary"], expected != JSONValue.null else {
        XCTAssertNil(read, "\(entry)")
        continue
      }
      XCTAssertEqual(
        read,
        SiteStarterSummary(
          listingID: expected["listingId"]?.stringValue ?? "", displayName: expected["displayName"]?.stringValue ?? "",
          description: expected["description"]?.stringValue ?? "", authorName: expected["authorName"]?.stringValue ?? "",
          official: expected["official"] == JSONValue.bool(true), priceUsd: expected["priceUsd"]?.numberValue ?? 0,
          previewImageURL: expected["previewImageUrl"]?.stringValue, kind: expected["facets"]?["kind"]?.stringValue,
          pages: Int(expected["facets"]?["pages"]?.numberValue ?? 0), mode: expected["facets"]?["mode"] == "ai" ? .ai : .base,
          owned: { if case .bool(let owned)? = expected["owned"] { owned } else { nil } }()),
        "\(entry)")
    }
  }

  func testReadsAnAnswerAsTheConsole() throws {
    for entry in list(try starters()["answerCases"]) {
      XCTAssertEqual(StarterQuery.parseAnswer(entry["json"]).map(\.listingID), list(entry["rows"]).compactMap { $0.stringValue })
    }
  }

  func testWordsAPriceAndAPageCountAsTheConsole() throws {
    let starters = try starters()
    for entry in list(starters["priceCases"]) {
      XCTAssertEqual(siteStarterPriceLabel(entry["usd"]?.numberValue ?? .nan), entry["label"]?.stringValue)
    }
    for entry in list(starters["pagesCases"]) {
      XCTAssertEqual(StarterQuery.pagesLabel(entry["pages"]?.numberValue ?? 0), entry["label"]?.stringValue)
    }
  }

  func testAStylePictureComesFromThePathAnAppCanRead() {
    let row = SiteStarterSummary(listingID: "l", displayName: "Trades", previewImageURL: "https://app.aglyn.com/_static/starter/styles/trades.webp")
    // `/_static` answers URLSession with a challenge (AGL-4127).
    XCTAssertEqual(
      starterPicture(row, origin: "https://app.aglyn.com", width: 240)?.absoluteString,
      "https://app.aglyn.com/api/media/cdn/site-styles/trades.webp?w=240")
    let own = SiteStarterSummary(listingID: "l", displayName: "Mine", previewImageURL: "https://cdn.test/mine.png")
    XCTAssertEqual(starterPicture(own, origin: "https://app.aglyn.com", width: 240)?.absoluteString, "https://cdn.test/mine.png")
    XCTAssertNil(starterPicture(SiteStarterSummary(listingID: "l", displayName: "None"), origin: "https://app.aglyn.com", width: 240))
  }
}
