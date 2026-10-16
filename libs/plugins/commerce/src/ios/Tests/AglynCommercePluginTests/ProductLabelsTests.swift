// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import Foundation
import XCTest

@testable import AglynCommercePlugin

/// Product labels and their barcodes replay the console's own answers (`product-labels.ts`, `barcode-encode.ts`) from
/// `functionCases` in libs/native/contracts/function-cases.generated.json; the Kotlin plugin replays the same file.
final class ProductLabelsTests: XCTestCase {
  private func cases(_ name: String) throws -> [JSONValue] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<7 { url.deleteLastPathComponent() }
    let file = url.appendingPathComponent("native/contracts/function-cases.generated.json")
    let all = try XCTUnwrap(JSONValue.decode(Data(contentsOf: file)))
    let list = try XCTUnwrap(arr(all["functions"]?[name]?["cases"]))
    XCTAssertFalse(list.isEmpty, name)
    return list
  }

  private func num(_ value: JSONValue?) -> Double? {
    if case .number(let number)? = value { return number }
    return nil
  }

  private func arr(_ value: JSONValue?) -> [JSONValue]? {
    if case .array(let values)? = value { return values }
    return nil
  }

  private func label(_ json: JSONValue) -> ProductLabel {
    ProductLabel(
      code: json["code"]?.stringValue ?? "", copies: Int(num(json["copies"]) ?? 0), currency: json["currency"]?.stringValue,
      detail: json["detail"]?.stringValue, name: json["name"]?.stringValue ?? "",
      priceCents: num(json["priceCents"]).map { Int($0) })
  }

  private func text(_ value: JSONValue?) -> String? {
    switch value {
    case .string(let text): text
    case .number(let number): String(Int(number))
    default: nil
    }
  }

  func testEncodesEachBarcodeAsTheConsoleDoes() throws {
    for item in try cases("encodeBarcode") {
      let arg = arr(item["args"])?.first
      let encoded = encodeBarcode(text(arg))
      if case .null? = item["result"] {
        XCTAssertNil(encoded, "\(String(describing: arg))")
        continue
      }
      XCTAssertEqual(encoded?.format.rawValue, item["result"]?["format"]?.stringValue, "\(String(describing: arg))")
      XCTAssertEqual(encoded?.text, item["result"]?["text"]?.stringValue, "\(String(describing: arg))")
      XCTAssertEqual(encoded?.modules, item["result"]?["modules"]?.stringValue, "\(String(describing: arg))")
    }
  }

  func testBuildsAProductsLabelRows() throws {
    for item in try cases("productLabelRows") {
      let rows = productLabelRows(try XCTUnwrap(arr(item["args"])?.first))
      let expected = try XCTUnwrap(arr(item["result"]))
      XCTAssertEqual(rows.map(\.variantID), expected.map { $0["variantId"]?.stringValue ?? "" })
      XCTAssertEqual(rows.map(\.label), expected.map(label))
    }
  }

  func testWritesTheZplAZebraPrints() throws {
    for item in try cases("productLabelsZpl") {
      let args = try XCTUnwrap(arr(item["args"]))
      let labels = (arr(args[0]) ?? []).map(label)
      let zpl = productLabelsZpl(
        labels, sizeID: args.count > 1 ? args[1].stringValue : nil, dpi: args.count > 2 ? Int(num(args[2]) ?? 203) : 203)
      XCTAssertEqual(zpl, item["result"]?.stringValue, "\(args.count)")
    }
  }

  func testCountsCopiesAndPricesAsTheDialogDoes() throws {
    for item in try cases("labelCopiesFromInput") {
      let arg = arr(item["args"])?.first
      let copies: Int
      switch arg {
      case .string(let typed): copies = labelCopiesFromInput(typed)
      case .number(let number): copies = labelCopiesFromInput(number)
      default: copies = labelCopiesFromInput(0)
      }
      XCTAssertEqual(copies, num(item["result"]).map { Int($0) }, "\(String(describing: arg))")
    }
    for item in try cases("labelCopiesTotal") {
      let labels = (arr(arr(item["args"])?.first) ?? []).map(label)
      XCTAssertEqual(labelCopiesTotal(labels), num(item["result"]).map { Int($0) })
    }
    for item in try cases("labelPriceText") {
      let arg = arr(item["args"])?.first
      XCTAssertEqual(
        labelPriceText(priceCents: num(arg?["priceCents"]), currency: arg?["currency"]?.stringValue),
        item["result"]?.stringValue, "\(String(describing: arg))")
    }
    for item in try cases("labelSize") {
      XCTAssertEqual(labelSize(arr(item["args"])?.first?.stringValue).id, item["result"]?["id"]?.stringValue)
    }
    for item in try cases("labelsZplFileName") {
      XCTAssertEqual(labelsZplFileName(arr(item["args"])?.first?.stringValue), item["result"]?.stringValue)
    }
  }

  func testTheSheetPrintsEachCopyOnItsOwnPageAtTheLabelsSize() {
    let labels = [
      ProductLabel(code: "4006381333931", copies: 2, currency: "usd", detail: "Blue", name: "Mug", priceCents: 1250),
      ProductLabel(code: "", copies: 3, name: "No code"),
      ProductLabel(code: "SKU-1", copies: 0, name: "None"),
    ]
    let sheet = labelSheet(labels, sizeID: "2x1")
    XCTAssertEqual(sheet.widthPoints, 144)
    XCTAssertEqual(sheet.heightPoints, 72)
    XCTAssertEqual(sheet.labels.count, 2)
    XCTAssertEqual(sheet.labels[0].price, "$12.50")
    XCTAssertEqual(sheet.labels[0].code, "4006381333931")
    XCTAssertEqual(sheet.labels[0].bars, encodeBarcode("4006381333931")?.modules)
  }

  func testOnlyAPdfGoesToThePrintSheet() {
    XCTAssertTrue(isPDF(Data("%PDF-1.7\n".utf8)))
    XCTAssertFalse(isPDF(Data([0x89, 0x50, 0x4E, 0x47])))
    XCTAssertFalse(isPDF(Data()))
  }

  func testTheImportOpensTheHubForThisSitesProducts() {
    XCTAssertEqual(
      productsImportParams(hostID: "h1"), ["resource": "commerce.products", "title": "Import products", "hostId": "h1"])
    XCTAssertEqual(coreDataImportScreen, "core.settings.data.import")
  }
}
