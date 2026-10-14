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
    XCTAssertEqual(checkProductDraft(draft), "Enter a price for Default")
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
