// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import XCTest

@testable import AglynCommercePlugin

/// The product editor's check-in fields (AGL-4063) read and write what the console's `ProductCheckInFields` does.
final class ProductCheckInTests: XCTestCase {
  private let pass = FirestoreDocument(
    id: "p1",
    data: [
      "name": "Day pass", "status": "active", "type": "service", "priceUsd": 20,
      "checkIn": ["enabled": true, "headcount": 2, "askUseDate": true],
      "options": [["name": "Kind", "values": ["Adult", "Spectator", "Family"]]],
      "variants": [
        ["id": "v1", "options": ["Kind": "Adult"], "priceUsd": 20],
        ["id": "v2", "options": ["Kind": "Spectator"], "priceUsd": 5, "checkIn": ["enabled": false]],
        ["id": "v3", "options": ["Kind": "Family"], "priceUsd": 50, "checkIn": ["enabled": true, "headcount": 4]],
      ],
    ])

  func testAnEditReadsTheProductsAndEachVariantsSetting() {
    let draft = productDraft(pass)
    XCTAssertEqual(draft.checkIn, ProductCheckIn(askUseDate: true, enabled: true, headcount: 2))
    XCTAssertNil(draft.variants[0].checkIn, "no setting of its own follows the product")
    XCTAssertEqual(draft.variants[1].checkIn, ProductCheckIn(enabled: false))
    XCTAssertEqual(draft.variants[2].checkIn, ProductCheckIn(enabled: true, headcount: 4))
    XCTAssertEqual(draft.variants.map { variantCheckInChoice($0.checkIn) }, [.product, .off, .on])
  }

  func testAProductThatNeverHadItReadsAsOff() {
    let draft = productDraft(FirestoreDocument(id: "p2", data: ["name": "Mug", "priceUsd": 10]))
    XCTAssertNil(draft.checkIn)
    XCTAssertFalse(productNeedsCheckIn(draft.checkIn))
    XCTAssertEqual(productCheckInHeadcount(draft.checkIn), 1)
  }

  func testAnUntouchedSettingIsSentAsStored() {
    let raw: [String: Any] = ["name": "Day pass", "checkIn": ["enabled": true, "headcount": 70]]
    let body = productSaveJSON(productDraft(FirestoreDocument(id: "p3", data: raw)), stored: raw)
    XCTAssertEqual(body["checkIn"], .object(["enabled": true, "headcount": 70]), "the console writes only what the fields change")
  }

  func testNothingIsWrittenForAProductLeftOff() {
    var draft = ProductDraft(productID: "p4", create: true)
    draft.name = "Mug"
    draft.variants[0].price = "10"
    XCTAssertNil(productSaveJSON(draft, stored: nil)["checkIn"])
  }

  func testSwitchingItOnStartsAtOnePersonAndOffWritesOnlyOff() {
    let on = productCheckInSwitched(nil, on: true)
    XCTAssertEqual(on, ProductCheckIn(enabled: true, headcount: 1))
    let typed = productCheckInHeadcountTyped(on, "3")
    XCTAssertEqual(typed, ProductCheckIn(enabled: true, headcount: 3))
    XCTAssertEqual(productCheckInSwitched(typed, on: false), ProductCheckIn(enabled: false))
    XCTAssertEqual(productCheckInJSON(ProductCheckIn(enabled: false)), .object(["enabled": false]))
  }

  func testPeoplePerItemIsAWholeNumberFromOneToFifty() {
    let on = ProductCheckIn(enabled: true, headcount: 2)
    XCTAssertEqual(productCheckInHeadcountTyped(on, "").headcount, 1)
    XCTAssertEqual(productCheckInHeadcountTyped(on, "x").headcount, 1)
    XCTAssertEqual(productCheckInHeadcountTyped(on, "120").headcount, 50)
    XCTAssertEqual(productCheckInHeadcountHelp(on), "Buying 3 makes 6 check-ins")
    XCTAssertEqual(productCheckInHeadcountHelp(ProductCheckIn(enabled: true, headcount: 1)), "Buying 3 makes 3 check-ins")
  }

  func testTheDayQuestionIsKeptAcrossChangesAndDroppedWhenOff() {
    let asks = productCheckInAskUseDateSwitched(ProductCheckIn(enabled: true, headcount: 2), on: true)
    XCTAssertEqual(asks, ProductCheckIn(askUseDate: true, enabled: true, headcount: 2))
    XCTAssertEqual(productCheckInHeadcountTyped(asks, "5"), ProductCheckIn(askUseDate: true, enabled: true, headcount: 5))
    XCTAssertEqual(productCheckInAskUseDateSwitched(asks, on: false), ProductCheckIn(enabled: true, headcount: 2))
    XCTAssertEqual(
      productCheckInJSON(asks), .object(["enabled": true, "headcount": 2, "askUseDate": true]))
    XCTAssertTrue(productCheckInUseDayHelp(asks).hasPrefix("Buyers online can pick the day"))
    XCTAssertTrue(productCheckInUseDayHelp(nil).hasPrefix("It is for the day it is bought."))
  }

  func testAVariantPickStartsFromTheProductsPeopleAndDayQuestion() {
    let product = ProductCheckIn(askUseDate: true, enabled: true, headcount: 2)
    XCTAssertNil(variantCheckInPicked(.product, own: ProductCheckIn(enabled: false), product: product))
    XCTAssertEqual(variantCheckInPicked(.off, own: nil, product: product), ProductCheckIn(enabled: false))
    XCTAssertEqual(variantCheckInPicked(.on, own: nil, product: product), ProductCheckIn(askUseDate: true, enabled: true, headcount: 2))
    XCTAssertEqual(
      variantCheckInPicked(.on, own: ProductCheckIn(enabled: true, headcount: 6), product: nil), ProductCheckIn(enabled: true, headcount: 6))
    XCTAssertEqual(variantCheckInProductLabel(productNeedsCheckIn: true), "Same as the product (needs check-in)")
    XCTAssertEqual(variantCheckInChoiceLabel(.product, productNeedsCheckIn: false), "Same as the product (no check-in)")
  }

  func testAVariantsOwnFieldsKeepEachOther() {
    let own = ProductCheckIn(askUseDate: true, enabled: true, headcount: 4)
    XCTAssertEqual(variantCheckInHeadcountTyped(own, "7"), ProductCheckIn(askUseDate: true, enabled: true, headcount: 7))
    XCTAssertEqual(variantCheckInAskUseDateSwitched(own, on: false), ProductCheckIn(enabled: true, headcount: 4))
  }

  func testASaveWritesTheProductsAndOnlyTheChangedVariantsSettings() {
    var draft = productDraft(pass)
    draft.checkIn = productCheckInHeadcountTyped(draft.checkIn, "3")
    draft.variants[0].checkIn = variantCheckInPicked(.off, own: nil, product: draft.checkIn)
    draft.variants[2].checkIn = variantCheckInPicked(.product, own: draft.variants[2].checkIn, product: draft.checkIn)
    let body = productSaveJSON(draft, stored: pass.data)
    XCTAssertEqual(body["checkIn"], .object(["enabled": true, "headcount": 3, "askUseDate": true]))
    guard case .array(let variants)? = body["variants"] else { return XCTFail("no variants") }
    XCTAssertEqual(variants[0]["checkIn"], .object(["enabled": false]))
    XCTAssertEqual(variants[1]["checkIn"], .object(["enabled": false]), "an untouched variant keeps its own")
    XCTAssertNil(variants[2]["checkIn"], "Same as the product removes the variant's own")
  }

  func testTheUpsellIsTheConsoles() {
    XCTAssertTrue(
      productCheckInUpsell().hasPrefix(
        "Register quick keys, check-in at the window and selling a product in person only come with the point of sale."))
  }
}
