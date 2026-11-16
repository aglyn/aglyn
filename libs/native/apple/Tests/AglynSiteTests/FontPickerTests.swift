// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynSite

/// The fonts plugin's picker and its preview addresses (AGL-3668), replayed from the console's own answers; the Kotlin
/// kit's FontPickerCasesTest replays the same.
final class FontPickerTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    let list = (Self.functions[name] as? [String: Any])?["cases"] as? [[String: Any]] ?? []
    XCTAssertFalse(list.isEmpty, "\(name) has no cases")
    return list.map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  private func json(_ value: Any) -> JSONValue {
    let data = try! JSONSerialization.data(withJSONObject: [value], options: [.fragmentsAllowed])
    return (try! JSONDecoder().decode(JSONValue.self, from: data)).arrayValue![0]
  }

  private func ints(_ value: Any?) -> [Int] { (value as? [NSNumber])?.map(\.intValue) ?? [] }

  private func family(_ value: Any) -> GoogleFontFamily {
    let object = value as! [String: Any]
    return GoogleFontFamily(
      family: object["family"] as! String, category: object["category"] as! String, weights: ints(object["weights"]),
      italics: ints(object["italics"]), subsets: object["subsets"] as? [String] ?? [],
      popularity: (object["popularity"] as? NSNumber)?.intValue ?? 0)
  }

  private func role(_ value: Any) -> FontPickerRole { value as? String == "body" ? .body : .heading }

  func testPreviewAddressesAsTheConsoleMakesThem() {
    for item in cases("previewLetters") { XCTAssertEqual(fontPreviewLetters(item.args[0] as! String), item.result as? String) }
    for item in cases("previewSheetUrl") {
      XCTAssertEqual(
        fontPreviewSheetURL(
          family: item.args[0] as! String, weight: (item.args[1] as! NSNumber).intValue, italic: item.args[2] as? String == "italic",
          text: item.args[3] as! String),
        item.result as? String, "\(item.args)")
    }
    for item in cases("previewFileUrls") { XCTAssertEqual(fontPreviewFileURLs(item.args[0] as! String), item.result as? [String]) }
  }

  func testChoicesAndLabelsAsTheConsoleMakesThem() {
    for item in cases("weightLabel") { XCTAssertEqual(fontWeightLabel((item.args[0] as! NSNumber).intValue), item.result as? String) }
    for item in cases("categoryLabel") { XCTAssertEqual(fontCategoryLabel(item.args[0] as! String), item.result as? String) }
    for item in cases("nearestWeights") {
      XCTAssertEqual(nearestWeights(ints(item.args[0]), offered: ints(item.args[1])), ints(item.result), "\(item.args)")
    }
    for item in cases("defaultFontChoice") {
      XCTAssertEqual(defaultFontChoice(family(item.args[0]), role: role(item.args[1])), ThemeFontChoice(json(item.result)), "\(item.args)")
    }
    for item in cases("choiceStylesLabel") {
      XCTAssertEqual(fontChoiceStylesLabel(ThemeFontChoice(json(item.args[0]))!), item.result as? String)
    }
    for item in cases("expandCatalogRow") {
      let got = expandCatalogRow(json(item.args[0]))!
      let want = item.result as! [String: Any]
      XCTAssertEqual(got.family, want["family"] as? String)
      XCTAssertEqual(got.weights, ints(want["weights"]))
      XCTAssertEqual(got.italics, ints(want["italics"]))
      XCTAssertEqual(got.axes.map(\.tag), (want["axes"] as? [[String: Any]])?.compactMap { $0["tag"] as? String }, "\(item.args)")
      XCTAssertEqual(got.popularity, (want["popularity"] as? NSNumber)?.intValue)
    }
  }

  func testSearchAndPairingsAsTheConsoleFindsThem() {
    for item in cases("searchFontFamilies") {
      let catalog = (item.args[0] as! [Any]).map(family)
      XCTAssertEqual(
        searchFontFamilies(catalog, query: item.args[1] as! String, category: item.args[2] as! String).map(\.family),
        (item.result as! [[String: Any]]).map { $0["family"] as! String }, "\(item.args[1]) \(item.args[2])")
    }
    for item in cases("suggestFontPairings") {
      let catalog = (item.args[2] as! [Any]).map(family)
      let limit = item.args.count > 3 ? (item.args[3] as! NSNumber).intValue : 4
      let got = suggestFontPairings(family(item.args[0]), role: role(item.args[1]), catalog: catalog, limit: limit)
      let want = (item.result as! [[String: Any]]).map { (($0["family"] as! [String: Any])["family"] as! String, $0["reason"] as! String) }
      XCTAssertEqual(got.map(\.family.family), want.map(\.0), "\(item.args[1])")
      XCTAssertEqual(got.map(\.reason), want.map(\.1), "\(item.args[1])")
    }
  }

  func testTheEditorCarriesTheFontsBothWays() throws {
    let values = themeValues(
      of: try JSONDecoder().decode(
        JSONValue.self,
        from: Data(#"{"fonts":{"body":{"family":"Inter","category":"sans-serif","weights":[400,700],"italics":[400],"source":"google"},"heading":null}}"#.utf8)))
    XCTAssertEqual(values.fonts, ThemeFontSelection(body: ThemeFontChoice(family: "Inter", category: "sans-serif", weights: [400, 700], italics: [400])))
    let edit = ThemeEdit.fonts(values.fonts).body
    XCTAssertEqual(edit["control"] as? String, "fonts")
    let value = edit["value"] as? [String: Any]
    XCTAssertEqual((value?["body"] as? [String: Any])?["family"] as? String, "Inter")
    XCTAssertTrue(value?["heading"] is NSNull)
    XCTAssertEqual(fontCostLabel(FontCost(bytes: 38_912, files: 2, complete: true)), "38 KB · 2 files")
    XCTAssertEqual(fontCostLabel(FontCost(bytes: 1_258_291, files: 1, complete: false)), "≈ 1.2 MB · 1 file")
    XCTAssertEqual(fontCostLabel(FontCost(bytes: 0, files: 0, complete: true)), "0 KB")
  }

  func testSiteSampleAsTheConsoleMakesIt() {
    for item in cases("siteSampleFrom") {
      let want = item.result as! [String: Any]
      let got = siteSampleFrom(item.args[0] is NSNull ? nil : json(item.args[0]))
      XCTAssertEqual(got.title, want["title"] as? String, "\(item.args)")
      XCTAssertEqual(got.heading, want["heading"] as? String, "\(item.args)")
      XCTAssertEqual(got.paragraph, want["paragraph"] as? String, "\(item.args)")
    }
  }

  func testTheCostAnswerReadsEachFamilysShare() throws {
    let cost = FontCost(
      try JSONDecoder().decode(
        JSONValue.self,
        from: Data(
          #"{"bytes":51200,"files":3,"complete":false,"families":[{"family":"Inter","source":"google","bytes":30720,"complete":true,"files":[{"style":"normal","weight":"400","bytes":15360},{"style":"normal","weight":"700","bytes":15360}]},{"family":"Lora","source":"google","bytes":20480,"complete":false,"files":[{"style":"normal","weight":"600","bytes":null}]}]}"#
            .utf8)))
    XCTAssertEqual(cost.share(of: " inter "), FontFamilyCost(family: "Inter", bytes: 30720, files: 2, complete: true))
    XCTAssertEqual(cost.share(of: "Lora")?.complete, false)
    XCTAssertNil(cost.share(of: "Roboto"))
    XCTAssertEqual(fontCostLabel(cost), "≈ 50 KB · 3 files")
  }
}
