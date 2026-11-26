// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

/// Write-ins: the gear set builder, held to the same cases as `product-modifiers.spec.ts`
/// ("write-ins: the gear set builder").
final class WriteInsTests: XCTestCase {
  private func size(_ id: String, _ name: String, _ values: [String]) -> ProductModifierGroup {
    ProductModifierGroup(
      id: id, max: 1, min: 1, name: name, nameOnOrder: true, online: true,
      options: values.map { ProductModifierOption(id: "\(id)-\($0)", name: $0, priceCents: 0) })
  }
  private let nameField = ProductModifierGroup(
    id: "name", kind: "text", max: 1, maxLength: 14, min: 1, name: "Name on jersey", online: true,
    options: [ProductModifierOption(id: "name-o", name: "Name on jersey", priceCents: 0)])
  private let numberField = ProductModifierGroup(
    digitsOnly: true, id: "number", kind: "text", max: 1, maxLength: 3, min: 1, name: "Number", online: true,
    options: [ProductModifierOption(id: "number-o", name: "Number", priceCents: 500)])
  private var gearSet: [ProductModifierGroup] {
    [
      size("jersey", "Jersey size", ["S", "M", "L", "XL", "2XL", "3XL"]),
      size("pants", "Pant size", ["28", "30", "32", "34", "36", "38", "40"]),
      size("gloves", "Glove size", ["S", "M", "L", "XL", "2XL"]),
      nameField, numberField,
    ]
  }
  private func picks(_ rider: String, _ race: String) -> [ModifierSelection] {
    [
      ModifierSelection(groupId: "jersey", optionId: "jersey-L"),
      ModifierSelection(groupId: "pants", optionId: "pants-32"),
      ModifierSelection(groupId: "gloves", optionId: "gloves-M"),
      ModifierSelection(groupId: "name", optionId: "name-o", text: rider),
      ModifierSelection(groupId: "number", optionId: "number-o", text: race),
    ]
  }

  func testSavesOneFieldPerWriteInRequiredOrNotAndAnyNumberOfSizeGroups() {
    XCTAssertNil(modifierGroupsProblem(gearSet))
    var two = nameField
    two.options.append(ProductModifierOption(id: "x", name: "x", priceCents: 0))
    XCTAssertEqual(modifierGroupsProblem([two]), "“Name on jersey” is a write-in and holds one field")
    var many = nameField
    many.min = 2
    many.max = 2
    XCTAssertEqual(modifierGroupsProblem([many]), "“Name on jersey” is a write-in: required or not, one answer")
    var long = nameField
    long.maxLength = 41
    XCTAssertEqual(modifierGroupsProblem([long]), "“Name on jersey” takes 1 to 40 characters")
    var photo = nameField
    photo.kind = "photo"
    XCTAssertEqual(modifierGroupsProblem([photo]), "“Name on jersey” is a list of choices or a write-in")
  }

  func testPricesEveryPieceAndKeepsTheNameAndNumberOnTheLine() {
    guard case .ok(let modifiers, let extra) = resolveLineModifiers("Summit Race Set", gearSet, picks("  SMITH \n", "27")) else {
      return XCTFail("refused")
    }
    XCTAssertEqual(extra, 500)
    XCTAssertEqual(modifiers.map { $0.text ?? $0.name }, ["L", "32", "M", "SMITH", "27"])
    XCTAssertEqual(
      lineLabelWithModifiers(nil, modifiers.map(\.lineText)),
      "Jersey size: L, Pant size: 32, Glove size: M, Name on jersey: SMITH, Number: 27")
  }

  func testAsksForARequiredWriteInAndRefusesAnAnswerThatDoesNotFit() {
    XCTAssertEqual(resolveLineModifiers("Summit Race Set", gearSet, picks("", "27")), .refused("Fill in name on jersey for Summit Race Set."))
    XCTAssertEqual(
      resolveLineModifiers("Summit Race Set", gearSet, picks("SMITH", "2a")), .refused("Number takes numbers only. (Summit Race Set)"))
    XCTAssertEqual(
      resolveLineModifiers("Summit Race Set", gearSet, picks("A VERY LONG NAME HERE", "27")),
      .refused("Name on jersey takes up to 14 characters. (Summit Race Set)"))
    let optional = gearSet.map { group -> ProductModifierGroup in
      var copy = group
      if copy.id == "name" { copy.min = 0 }
      return copy
    }
    guard case .ok(let modifiers, _) = resolveLineModifiers("Summit Race Set", optional, picks("", "27")) else {
      return XCTFail("refused")
    }
    XCTAssertFalse(modifiers.contains { $0.groupID == "name" })
  }

  func testCleansAnAnswerAsTheServerDoes() {
    XCTAssertEqual(cleanWriteIn("A\u{0}B"), "A B")
    XCTAssertEqual(cleanWriteIn("  SMITH   JR \n"), "SMITH JR")
    XCTAssertEqual(cleanWriteIn(String(repeating: "x", count: 30), maxLength: 14).count, 14)
    XCTAssertEqual(cleanWriteIn("abc", maxLength: nil as Double?), "abc", "a group without a length takes 20")
    XCTAssertEqual(cleanWriteIn(nil), "")
    XCTAssertEqual(modifierSelectionFrom([ModifierSelection(groupId: "name", optionId: "name-o", text: "A\u{0}B")])[0].text, "A B")
    XCTAssertNil(writeInProblem(numberField, "  "), "an empty answer is the minimum's business")
  }

  func testCarriesTheAnswerThroughTheBasketTheSaleAndTheKeptCopy() {
    let gear = PosItem(
      id: "summit", name: "Summit Race Set", imageURL: nil,
      variants: [PosVariant(id: "default", label: nil, unitCents: 25000, sku: nil, barcode: nil, inventory: nil)],
      categoryIDs: [], modifierGroups: gearSet, quickKey: false, fromCents: 25000, toCents: 25000)
    guard case .ok(let made) = pick(gear, gear.variants[0], modifiers: picks(" SMITH ", "27")) else { return XCTFail("refused") }
    XCTAssertEqual(made.unitCents, 25500)
    XCTAssertEqual(made.variantLabel, "Jersey size: L, Pant size: 32, Glove size: M, Name on jersey: SMITH, Number: 27")
    XCTAssertEqual(made.modifiers[3], ModifierSelection(groupId: "name", optionId: "name-o", text: "SMITH"))
    let cart = Cart.empty.adding(made)
    guard case .array(let lines) = cart.saleLines, case .object(let line)? = lines.first,
      case .array(let sent)? = line["modifiers"]
    else { return XCTFail("no modifiers sent") }
    XCTAssertEqual(sent[3], JSONValue.object(["groupId": .string("name"), "optionId": .string("name-o"), "text": .string("SMITH")]))
    XCTAssertEqual(sent[0], JSONValue.object(["groupId": .string("jersey"), "optionId": .string("jersey-L")]))
    XCTAssertEqual(Cart.read(cart.encoded()), cart)
    XCTAssertEqual(
      soldLineModifiers(gearSet, made.modifiers).first { $0.groupID == "number" },
      LineModifier(groupID: "number", optionID: "number-o", group: "Number", name: "Number", priceCents: 500, text: "27"))
  }

  func testMakesTwoRidersTwoLines() {
    XCTAssertNotEqual(modifierSelectionKey(picks("SMITH", "27")), modifierSelectionKey(picks("JONES", "27")))
    XCTAssertEqual(modifierSelectionKey(picks("SMITH", "27")), modifierSelectionKey(picks("SMITH", "27")))
  }

  func testLeavesAChoiceWithoutAGroupNameAsItAlwaysPrinted() {
    XCTAssertEqual(
      lineLabelWithModifiers("Large", [modifierLineText(name: "Oat milk", group: "Milk", text: nil, nameOnOrder: nil)]),
      "Large / Oat milk")
  }

  func testTheFieldSaysItsNotePriceAndCountOrWhatIsWrong() {
    var priced = numberField
    priced.options[0].note = "On the back"
    let money = { (cents: Int) in posMoney(cents, currency: "usd") }
    XCTAssertEqual(writeInHint(priced, text: "27", variantID: nil, money: money), "Required · On the back · Adds $5.00 · 2/3")
    XCTAssertEqual(writeInHint(priced, text: "2a", variantID: nil, money: money), "Number takes numbers only.")
    XCTAssertEqual(writeInTyped(priced, "1234"), "123")
    let typed = withWriteInAnswer(gearSet, [ModifierSelection(groupId: "number", optionId: "number-o", text: "2")], group: nameField, text: "SMI")
    XCTAssertEqual(typed.map(\.groupId), ["name", "number"], "kept in the product's group order")
    XCTAssertEqual(withWriteInAnswer(gearSet, typed, group: nameField, text: " ").map(\.groupId), ["number"])
  }

  func testAQuoteLineKeepsTheAnswerAndPrintsIt() throws {
    let stored = OrderLineItem(
      modifiers: [OrderLineModifier(group: "Number", groupId: "number", name: "Number", optionId: "number-o", priceCents: 500, text: "27")],
      name: "Summit Race Set", productId: "summit", productType: .physical, quantity: 1, unitAmountCents: 25500)
    guard case .catalog(_, _, _, let modifiers, _, _) = quoteLineRequestFromLine(stored) else { return XCTFail("not catalog") }
    XCTAssertEqual(modifiers, [ModifierSelection(groupId: "number", optionId: "number-o", text: "27")])
    XCTAssertEqual(stored.modifiers?.first?.lineText, "Number: 27")
  }
}
