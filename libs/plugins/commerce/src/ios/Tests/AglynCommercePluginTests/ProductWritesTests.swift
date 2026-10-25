// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import XCTest

@testable import AglynCommercePlugin

/// Records what the product routes were asked, and answers with `failure` when set.
private final class FakeProductWrites: ProductWriteAPI, @unchecked Sendable {
  var keys: [String] = []
  var bodies: [JSONValue] = []
  var failure: Error?

  func save(hostID: String, productID: String, create: Bool, product: JSONValue, attemptKey: String) async throws {
    keys.append(attemptKey)
    bodies.append(product)
    if let failure { throw failure }
  }

  func adjustStock(
    hostID: String, productID: String, variantID: String, delta: Int, reason: String, attemptKey: String
  ) async throws {
    keys.append(attemptKey)
    if let failure { throw failure }
  }
}

final class ProductWritesTests: XCTestCase {
  private let stored = FirestoreDocument(
    id: "p1",
    data: [
      "name": "Mug", "description": "Blue", "status": "active", "type": "physical", "priceUsd": 12.5,
      "createdAt": Date(timeIntervalSince1970: 1_700_000_000), "tags": ["kitchen"], "customField": ["keep": true],
      "variants": [
        ["id": "v1", "options": ["size": "Small"], "priceUsd": 12.5, "sku": "MUG-S", "inventory": 4],
        ["id": "v2", "options": ["size": "Large"], "priceUsd": 15, "compareAtPriceUsd": 18, "barcode": "123"],
      ],
    ])

  func testAnEditOpensOnTheStoredProduct() {
    let draft = productDraft(stored)
    XCTAssertFalse(draft.create)
    XCTAssertEqual(draft.name, "Mug")
    XCTAssertEqual(draft.status, .active)
    XCTAssertEqual(draft.variants.map(\.label), ["Small", "Large"])
    XCTAssertEqual(draft.variants.map(\.price), ["12.50", "15.00"])
    XCTAssertEqual(draft.variants[1].compareAt, "18.00")
    XCTAssertEqual(draft.variants[0].sku, "MUG-S")
  }

  func testAnEditSendsTheWholeStoredProductWithItsEditsOnTop() {
    var draft = productDraft(stored)
    draft.name = "Big mug"
    draft.variants[0].price = "13"
    draft.variants[0].sku = ""
    draft.variants[1].compareAt = ""
    let body = productSaveJSON(draft, stored: stored.data)
    XCTAssertEqual(body["name"], "Big mug")
    XCTAssertEqual(body["customField"], .object(["keep": true]))
    XCTAssertEqual(body["tags"], .array(["kitchen"]))
    XCTAssertNil(body["createdAt"], "a stored timestamp stays as stored on the server")
    XCTAssertNil(body["slug"], "an edit keeps the stored slug")
    guard case .array(let variants)? = body["variants"] else { return XCTFail("no variants") }
    XCTAssertEqual(variants[0]["priceUsd"], .number(13))
    XCTAssertNil(variants[0]["sku"])
    XCTAssertEqual(variants[0]["inventory"], .number(4), "an edit never writes stock")
    XCTAssertEqual(variants[0]["options"], .object(["size": "Small"]))
    XCTAssertNil(variants[1]["compareAtPriceUsd"])
    XCTAssertEqual(variants[1]["barcode"], "123")
  }

  /// Check-in at the window (AGL-4063): the product's setting and each variant's own, written as the console writes them.
  func testCheckInIsWrittenOnTheProductAndEachVariantAsTheConsoleWritesIt() {
    var draft = productDraft(stored)
    XCTAssertFalse(draft.needsCheckIn)
    XCTAssertEqual(draft.variants.map(\.checkIn), [.product, .product])
    var body = productSaveJSON(draft, stored: stored.data)
    XCTAssertNil(body["checkIn"], "never turned on, never written")
    draft.needsCheckIn = true
    draft.headcount = "2"
    draft.variants[0].checkIn = .off
    draft.variants[1].checkIn = .on
    draft.variants[1].headcount = "80"
    body = productSaveJSON(draft, stored: stored.data)
    XCTAssertEqual(body["checkIn"], ["enabled": true, "headcount": 2])
    guard case .array(let variants)? = body["variants"] else { return XCTFail("no variants") }
    XCTAssertEqual(variants[0]["checkIn"], ["enabled": false])
    XCTAssertEqual(variants[1]["checkIn"], ["enabled": true, "headcount": 50], "a headcount is capped at the ceiling")
    // Opened again, the editor shows what was stored; turning the product off keeps an explicit off.
    var data = stored.data
    data["checkIn"] = ["enabled": true, "headcount": 2]
    data["variants"] = [
      ["id": "v1", "options": ["size": "Small"], "priceUsd": 12.5, "checkIn": ["enabled": false]],
      ["id": "v2", "options": ["size": "Large"], "priceUsd": 15, "checkIn": ["enabled": true, "headcount": 3]],
    ]
    var reopened = productDraft(FirestoreDocument(id: "p1", data: data))
    XCTAssertTrue(reopened.needsCheckIn)
    XCTAssertEqual(reopened.headcount, "2")
    XCTAssertEqual(reopened.variants.map(\.checkIn), [.off, .on])
    XCTAssertEqual(reopened.variants[1].headcount, "3")
    reopened.needsCheckIn = false
    reopened.variants[0].checkIn = .product
    body = productSaveJSON(reopened, stored: data)
    XCTAssertEqual(body["checkIn"], ["enabled": false])
    guard case .array(let after)? = body["variants"] else { return XCTFail("no variants") }
    XCTAssertNil(after[0]["checkIn"], "same as the product removes the variant's own")
  }

  func testANewProductIsTheConsolesBlankOneWithASlugAndStartingStock() {
    var draft = ProductDraft(productID: newProductID(), create: true)
    draft.name = "Café Latte"
    draft.variants[0].price = "$4.50"
    draft.variants[0].stock = "20"
    XCTAssertNil(checkProductDraft(draft))
    let body = productSaveJSON(draft, stored: nil)
    XCTAssertEqual(body["slug"], "cafe-latte")
    XCTAssertEqual(body["status"], "draft")
    guard case .array(let variants)? = body["variants"] else { return XCTFail("no variants") }
    XCTAssertEqual(variants[0]["id"], "default")
    XCTAssertEqual(variants[0]["priceUsd"], .number(4.5))
    XCTAssertEqual(variants[0]["inventory"], .number(20))
    draft.variants[0].stock = ""
    guard case .array(let untracked)? = productSaveJSON(draft, stored: nil)["variants"] else { return XCTFail() }
    XCTAssertEqual(untracked[0]["inventory"], .null)
  }

  func testNewProductIDsAreValidRouteIDs() {
    let id = newProductID()
    XCTAssertEqual(id.count, 20)
    XCTAssertNotNil(id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression))
    XCTAssertNotEqual(id, newProductID())
  }

  func testADraftIsCheckedBeforeItIsSent() {
    var draft = ProductDraft(productID: "p", create: true)
    XCTAssertEqual(checkProductDraft(draft), "Product name is required")
    draft.name = "Mug"
    XCTAssertEqual(checkProductDraft(draft), "Enter a price")
    draft.variants[0].price = "5"
    draft.variants[0].compareAt = "five"
    XCTAssertNotNil(checkProductDraft(draft))
    draft.variants[0].compareAt = ""
    draft.variants[0].stock = "-1"
    XCTAssertNotNil(checkProductDraft(draft))
    draft.variants[0].stock = "3"
    XCTAssertNil(checkProductDraft(draft))
  }

  func testStockDeltas() {
    XCTAssertEqual(stockDelta("+5"), 5)
    XCTAssertEqual(stockDelta("-2"), -2)
    XCTAssertEqual(stockDelta(" 7 "), 7)
    XCTAssertNil(stockDelta("0"))
    XCTAssertNil(stockDelta("2.5"))
    XCTAssertNil(stockDelta(""))
  }

  @MainActor
  func testTheAttemptKeyIsKeptUntilTheRouteAnswersDefinitively() async {
    let api = FakeProductWrites()
    let model = StockAdjustModel(productID: "p1", variantID: "v1")
    model.draft.change = "+3"
    api.failure = ConsoleAPIError(status: 0, message: "offline")
    do {
      try await model.apply(api, hostID: "h")
      XCTFail("expected a failure")
    } catch {
      XCTAssertTrue(error.localizedDescription.contains("not known"))
    }
    api.failure = ConsoleAPIError(status: 403, message: "Editing requires the editor role")
    do {
      try await model.apply(api, hostID: "h")
      XCTFail("expected a refusal")
    } catch {
      XCTAssertEqual(error.localizedDescription, "Editing requires the editor role")
    }
    api.failure = nil
    try? await model.apply(api, hostID: "h")
    XCTAssertEqual(api.keys.count, 3)
    XCTAssertEqual(api.keys[0], api.keys[1], "a lost answer retries under the same key")
    XCTAssertNotEqual(api.keys[1], api.keys[2], "a refusal ends the attempt")
  }
}

/// The options and variant matrix, replaying the Kotlin kit's VariantMatrixTest.
final class VariantMatrixTests: XCTestCase {
  private func counter() -> () -> String {
    var n = 0
    return {
      n += 1
      return "n\(n)"
    }
  }

  private let storedTee = FirestoreDocument(
    id: "p",
    data: [
      "name": "Tee", "slug": "tee", "status": "active", "type": "physical",
      "options": [["name": "Size", "values": ["S", "M"]]],
      "variants": [
        ["id": "vs", "options": ["Size": "S"], "priceUsd": 10.0, "inventory": 4, "sku": "TEE-S"],
        ["id": "vm", "options": ["Size": "M"], "priceUsd": 12.0, "inventory": 0],
      ],
    ])

  func testValuesAreSplitTrimmedAndDeduplicated() {
    XCTAssertEqual(parseOptionValues(" Small, ,Large,\nSmall "), ["Small", "Large"])
    XCTAssertEqual(parseOptionValues(" , "), [])
  }

  func testAnOptionWithValuesMakesOneVariantEachStartingFromTheFirstOnesPriceAndStock() {
    let start = ProductDraft(
      productID: "p", create: true, name: "Tee", variants: [VariantDraft(id: "default", label: "Default", price: "9.50", stock: "7")])
    let mint = counter()
    let made = start.withOptionAdded().withOptionName(0, "Size", mintID: mint).withOptionValues(0, "S, M, L", mintID: mint)
    XCTAssertEqual(made.variants.map(\.label), ["S", "M", "L"])
    XCTAssertEqual(made.variants.map(\.id), ["n1", "n2", "n3"])
    XCTAssertTrue(made.variants.allSatisfy { $0.fresh && $0.price == "9.50" && $0.stock == "7" })
    XCTAssertEqual(made.variants[1].selections, ["Size": "M"])
  }

  func testAnOptionWithNoNameYetJoinsTheMatrixWhenItIsNamed() {
    let start = ProductDraft(
      productID: "p", create: true, name: "Tee", variants: [VariantDraft(id: "default", label: "Default", price: "5")])
    let mint = counter()
    let valuesFirst = start.withOptionAdded().withOptionValues(0, "S, M", mintID: mint)
    XCTAssertEqual(valuesFirst.variants.count, 1, "an unnamed option is not in the matrix")
    XCTAssertEqual(valuesFirst.withOptionName(0, "Size", mintID: mint).variants.map(\.label), ["S", "M"])
  }

  func testChangingValuesKeepsTheVariantsThatSurvive() {
    var draft = productDraft(storedTee)
    draft.variants[0].price = "11"
    draft.variants[0].sku = "KEEP"
    let mint = counter()
    let more = draft.withOptionValues(0, "S, M, L", mintID: mint)
    XCTAssertEqual(more.variants.map(\.id), ["vs", "vm", "n1"])
    XCTAssertEqual(more.variants[0].sku, "KEEP")
    XCTAssertEqual(more.variants[0].price, "11")
    XCTAssertFalse(more.variants[0].fresh)
    XCTAssertTrue(more.variants[2].fresh)
    XCTAssertEqual(more.withOptionValues(0, "M", mintID: mint).variants.map(\.id), ["vm"])
  }

  func testRenamingAnOptionMovesTheSelectionsAndKeepsEveryVariant() {
    let renamed = productDraft(storedTee).withOptionName(0, "Fit", mintID: counter())
    XCTAssertEqual(renamed.variants.map(\.id), ["vs", "vm"])
    XCTAssertEqual(renamed.variants[0].selections, ["Fit": "S"])
    XCTAssertEqual(renamed.variants[0].sku, "TEE-S")
    XCTAssertTrue(renamed.variants.allSatisfy { !$0.fresh })
  }

  func testTwoOptionsMakeTheCartesianProductInTheOptionsOrder() {
    let mint = counter()
    let two = ProductDraft(
      productID: "p", create: true, name: "Tee", variants: [VariantDraft(id: "default", label: "Default", price: "1")]
    )
    .withOptionAdded().withOptionName(0, "Size", mintID: mint).withOptionValues(0, "S, M", mintID: mint)
    .withOptionAdded().withOptionName(1, "Color", mintID: mint).withOptionValues(1, "Red, Blue, Green", mintID: mint)
    XCTAssertEqual(two.variants.count, 6)
    XCTAssertEqual(two.variants.first?.label, "S / Red", "labels read in the options' order, not the dictionary's")
    XCTAssertEqual(two.variants.last?.label, "M / Green")
    let back = two.withOptionRemoved(1, mintID: mint)
    XCTAssertEqual(back.variants.map(\.label), ["S", "M"])
    XCTAssertTrue(back.variants.allSatisfy { $0.fresh && $0.price == "1" }, "variants of a different shape are new, from the first one's price")
  }

  func testASaveWritesTheOptionsTheSelectionsAndTheStockOfOnlyTheNewVariants() {
    let draft = productDraft(storedTee).withOptionValues(0, "S, M, L", mintID: counter())
    let body = productSaveJSON(draft, stored: storedTee.data)
    guard case .array(let options)? = body["options"], case .array(let variants)? = body["variants"] else {
      return XCTFail("no options or variants")
    }
    XCTAssertEqual(options[0]["name"], "Size")
    XCTAssertEqual(options[0]["values"], .array(["S", "M", "L"]))
    XCTAssertEqual(variants[0]["options"], .object(["Size": "S"]))
    XCTAssertEqual(variants[0]["inventory"], .number(4), "an existing variant's stock is left as stored")
    XCTAssertEqual(variants[2]["id"], "n1")
    XCTAssertEqual(variants[2]["inventory"], .number(4), "a new variant starts from the first variant's stock")
    XCTAssertEqual(variants[2]["priceUsd"], .number(10))
  }

  func testANewProductWithoutOptionsWritesNone() {
    let draft = ProductDraft(
      productID: "p", create: true, name: "Mug", variants: [VariantDraft(id: "default", label: "Default", price: "4")])
    XCTAssertNil(productSaveJSON(draft, stored: nil)["options"])
  }

  func testTheOptionLimitsAreTheConsoles() {
    func option(_ name: String, _ count: Int) -> OptionDraft {
      OptionDraft(name: name, valuesText: (1...count).map { "v\($0)" }.joined(separator: ", "))
    }
    XCTAssertNil(checkOptions([option("A", 25), option("B", 4)]))
    XCTAssertEqual(checkOptions([OptionDraft(name: "", valuesText: "x")]), "Option names are required")
    XCTAssertEqual(checkOptions([OptionDraft(name: "Size", valuesText: " , ")]), "Option \"Size\" needs at least one value")
    XCTAssertEqual(checkOptions([option("A", 26)]), "Option \"A\" has too many values")
    XCTAssertEqual(checkOptions([option("A", 2), option("A ", 2)]), "Each option needs its own name")
    XCTAssertEqual(checkOptions([option("A", 1), option("B", 1), option("C", 1), option("D", 1)]), "At most 3 options per product")
    XCTAssertEqual(checkOptions([option("A", 25), option("B", 5)]), "At most 100 variants per product")
  }

  func testADraftChecksPricesAndCodesAcrossVariants() {
    func variant(_ id: String, _ price: String, compareAt: String = "", sku: String = "") -> VariantDraft {
      VariantDraft(id: id, label: id, price: price, compareAt: compareAt, sku: sku)
    }
    func draft(_ variants: VariantDraft...) -> ProductDraft {
      ProductDraft(productID: "p", create: true, name: "x", variants: variants)
    }
    XCTAssertEqual(checkProductDraft(draft(variant("a", "1", sku: "S"), variant("b", "1", sku: "S"))), "Variant SKUs must be unique")
    XCTAssertEqual(checkProductDraft(draft(variant("a", "5", compareAt: "5"))), "Compare-at price must exceed the price")
    XCTAssertEqual(checkProductDraft(draft(variant("a", "10000.01"))), "Prices are capped at $10000")
    XCTAssertNil(checkProductDraft(draft(variant("a", "5", compareAt: "6"), variant("b", "5"))))
  }
}
