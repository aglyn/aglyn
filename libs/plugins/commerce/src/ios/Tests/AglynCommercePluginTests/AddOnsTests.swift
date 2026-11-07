// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynCommercePlugin

/// The product editor's add-ons (AGL-4100), held to the same cases as the Kotlin kit's AddOnsTest.
final class AddOnsTests: XCTestCase {
  private let stored: [String: Any] = [
    "name": "Canopy",
    "variants": [
      ["id": "v10", "priceUsd": 300.0, "options": ["Size": "10x10"]],
      ["id": "v20", "priceUsd": 500.0, "options": ["Size": "10x20"]],
    ],
    "options": [["name": "Size", "values": ["10x10", "10x20"]]],
    "modifierGroups": [
      [
        "id": "walls", "name": "Walls", "min": 0, "max": 2, "online": true,
        "options": [
          [
            "id": "full", "name": "Full wall", "priceCents": 4500, "priceCentsByVariant": ["v20": 7500],
            "imageUrl": "https://cdn.example/wall.jpg", "note": "Blocks wind on one side",
          ],
          ["id": "kit", "name": "Weekend kit", "priceCents": 12000, "includes": ["Full wall ×2", "Roller bag"]],
        ],
      ]
    ],
  ]

  func testAStoredProductsAddOnsReadAsDraftsWithPricesInDollars() {
    let draft = productDraft(FirestoreDocument(id: "p1", data: stored))
    let walls = draft.addOns[0]
    XCTAssertEqual(walls.name, "Walls")
    XCTAssertEqual(walls.online, true)
    XCTAssertEqual(walls.max, 2)
    XCTAssertEqual(walls.choices[0].price, "45.00")
    XCTAssertEqual(walls.choices[0].byVariant, ["v20": "75.00"])
  }

  func testASaveKeepsWhatTheAppsDoNotEditPicturesNotesAndCombos() throws {
    var draft = productDraft(FirestoreDocument(id: "p1", data: stored))
    draft.addOns[0].name = "Side walls"
    draft.addOns[0].choices[0].price = "50"
    let saved = productSaveJSON(draft, stored: stored)
    let group = try XCTUnwrap(saved["modifierGroups"]?.arrayValue?.first)
    XCTAssertEqual(group["name"]?.stringValue, "Side walls")
    let options = try XCTUnwrap(group["options"]?.arrayValue)
    let full = options[0]
    XCTAssertEqual(full["priceCents"], JSONValue.number(5000))
    XCTAssertEqual(full["imageUrl"]?.stringValue, "https://cdn.example/wall.jpg")
    XCTAssertEqual(full["note"]?.stringValue, "Blocks wind on one side")
    XCTAssertEqual(full["priceCentsByVariant"], JSONValue.object(["v20": .number(7500)]))
    XCTAssertEqual(options[1]["includes"]?.arrayValue?.compactMap(\.stringValue), ["Full wall ×2", "Roller bag"])
  }

  func testANewGroupIsOptionalPickOneAndShownOnTheWebsite() {
    var n = 0
    let group = newAddOnGroup { prefix in
      n += 1
      return "\(prefix)\(n)"
    }
    XCTAssertEqual(group.min, 0)
    XCTAssertEqual(group.max, 1)
    XCTAssertEqual(group.online, true)
    XCTAssertEqual(group.choices.map(\.id), ["o2"])
  }

  func testAPerSizePriceLeftEmptyFallsBackToTheChoicesOwnPrice() {
    let choice = AddOnChoiceDraft(id: "full", name: "Full wall", price: "45", byVariant: ["v20": "75"])
    XCTAssertEqual(choice.withVariantPrice("v20", "").byVariant, [:])
    XCTAssertEqual(choice.withVariantPrice("v10", "40").byVariant, ["v20": "75", "v10": "40"])
  }

  func testTheChecksSpeakTheConsolesWords() {
    let group = AddOnGroupDraft(id: "g", name: "Walls", choices: [AddOnChoiceDraft(id: "o", name: "Full wall", price: "1500")])
    XCTAssertEqual(checkAddOns([group]), "“Full wall” needs a price of $0 to $1,000")
    var unnamed = group
    unnamed.name = " "
    unnamed.choices[0].price = "45"
    XCTAssertEqual(checkAddOns([unnamed]), "Name every modifier group")
    var demanding = group
    demanding.min = 2
    demanding.choices[0].price = "45"
    XCTAssertEqual(checkAddOns([demanding]), "“Walls” requires more choices than it allows")
    var free = group
    free.choices[0].price = ""
    XCTAssertNil(checkAddOns([free]))
  }

  func testRemovingAChoiceNeverLeavesAtMostAboveWhatIsLeft() {
    let group = AddOnGroupDraft(
      id: "g", name: "Walls", min: 2, max: 2, choices: [AddOnChoiceDraft(id: "a", name: "A"), AddOnChoiceDraft(id: "b", name: "B")])
    let left = group.withChoiceRemoved(0)
    XCTAssertEqual(left.max, 1)
    XCTAssertEqual(left.min, 1)
  }

  func testPriceByNamesTheOneOptionAProductVariesBy() {
    XCTAssertEqual(priceByLabel([OptionDraft(name: "Size", valuesText: "S, M")]), "Price by size")
    XCTAssertEqual(
      priceByLabel([OptionDraft(name: "Size", valuesText: "S, M"), OptionDraft(name: "Color", valuesText: "Red")]), "Price by variant")
  }

  func testMoreCombinationsThanAProductHoldsSaysTheCountAndTheWayOut() throws {
    let options = [
      OptionDraft(name: "Size", valuesText: (1...10).map { "S\($0)" }.joined(separator: ", ")),
      OptionDraft(name: "Color", valuesText: (1...11).map { "C\($0)" }.joined(separator: ", ")),
    ]
    let problem = try XCTUnwrap(checkOptions(options))
    XCTAssertTrue(problem.hasPrefix("These options make 110 combinations, and a product holds at most 100."), problem)
    XCTAssertTrue(problem.contains("Add-ons"))
    XCTAssertNil(variantMatrixProblem(Array(options.prefix(1))))
  }

  func testAProductWithNoAddOnsSavesNone() {
    var plain = stored
    plain.removeValue(forKey: "modifierGroups")
    XCTAssertNil(productSaveJSON(productDraft(FirestoreDocument(id: "p2", data: plain)), stored: plain)["modifierGroups"])
  }
}
