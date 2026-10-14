// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import Foundation
import XCTest

@testable import AglynCommercePlugin

private func item(
  _ id: String = "p1", name: String = "Mug", variants: [PosVariant]? = nil, groups: [ProductModifierGroup] = []
) -> PosItem {
  let variants = variants ?? [PosVariant(id: "default", label: nil, unitCents: 2400, sku: nil, barcode: nil, inventory: 5)]
  return PosItem(
    id: id, name: name, imageURL: nil, variants: variants, categoryIDs: [], modifierGroups: groups, quickKey: false,
    fromCents: variants.compactMap(\.unitCents).min(), toCents: variants.compactMap(\.unitCents).max())
}

private let milk = ProductModifierGroup(
  id: "milk", max: 1, min: 1, name: "Milk",
  options: [
    ProductModifierOption(id: "oat", name: "Oat", priceCents: 75), ProductModifierOption(id: "whole", name: "Whole", priceCents: 0),
  ])

final class CartTests: XCTestCase {
  func testTheSameItemWithTheSameChoicesGrowsOneLine() {
    guard case .ok(let pick) = pick(item(), item().variants[0]) else { return XCTFail("no pick") }
    let cart = Cart.empty.adding(pick).adding(pick, quantity: 2)
    XCTAssertEqual(cart.lines.count, 1)
    XCTAssertEqual(cart.count, 3)
    XCTAssertEqual(cart.subtotalCents, 7200)
    XCTAssertNil(cart.lines[0].variantID, "the default variant is sent as no variant")
  }

  func testAQuantityIsClampedAndZeroRemovesTheLine() {
    guard case .ok(let pick) = pick(item(), item().variants[0]) else { return XCTFail("no pick") }
    var cart = Cart.empty.adding(pick, quantity: 500)
    XCTAssertEqual(cart.lines[0].quantity, posLineMaxQuantity)
    cart = cart.settingQuantity(cart.lines[0].key, 0)
    XCTAssertTrue(cart.isEmpty)
  }

  func testTheDiscountIsTakenOffEachLineAsTheServerDoes() {
    guard case .ok(let pick) = pick(item(), item().variants[0]) else { return XCTFail("no pick") }
    let cart = Cart.empty.adding(pick, quantity: 3).withDiscount(12.6)
    XCTAssertEqual(cart.discountPct, 13)
    XCTAssertEqual(cart.discountCents, jsRound(7200 * 13 / 100.0))
  }

  func testSaleLinesCarryPicksAndCountsNeverPrices() {
    let coffee = item("p2", name: "Latte", groups: [milk])
    guard case .ok(let pick) = pick(coffee, coffee.variants[0], modifiers: [ModifierSelection(groupId: "milk", optionId: "oat")])
    else { return XCTFail("no pick") }
    XCTAssertEqual(pick.unitCents, 2475)
    XCTAssertEqual(pick.variantLabel, "Oat")
    let line = Cart.empty.adding(pick).saleLines.arrayValue.first?.objectValue
    XCTAssertEqual(line?["productId"], .string("p2"))
    XCTAssertEqual(line?["quantity"], .number(1))
    XCTAssertNil(line?["unitCents"])
    XCTAssertEqual(line?["modifiers"]?.arrayValue.count, 1)
  }

  func testAKeptBasketRoundTripsAndIsRebuiltThroughAdd() {
    guard case .ok(let pick) = pick(item(), item().variants[0]) else { return XCTFail("no pick") }
    let cart = Cart.empty.adding(pick, quantity: 2).withDiscount(10).withCustomerEmail(" ada@example.test ")
    let read = Cart.read(cart.encoded())
    XCTAssertEqual(read, cart)
    XCTAssertEqual(Cart.read(Data("not json".utf8)), .empty)
  }
}

final class CatalogTests: XCTestCase {
  func testARequiredModifierMustBeChosen() {
    let coffee = item("p2", name: "Latte", groups: [milk])
    XCTAssertEqual(pick(coffee, coffee.variants[0]), .problem("Choose milk for Latte."))
    XCTAssertTrue(coffee.needsSheet)
  }

  func testAVariantWithoutAPriceIsRefused() {
    let free = item(variants: [PosVariant(id: "v1", label: "Large", unitCents: nil, sku: nil, barcode: nil, inventory: nil)])
    XCTAssertEqual(pick(free, free.variants[0]), .problem("Set a price for Mug before selling it."))
  }

  func testAProductDocumentReadsItsVariantsAndPrices() {
    let doc = FirestoreDocument(
      id: "p9",
      data: [
        "name": "Tote", "posQuickKey": true,
        "variants": [
          ["id": "v1", "priceUsd": 19.0, "options": ["color": "Blue"], "barcode": "0850098765432"],
          ["id": "v2", "priceUsd": 21.5, "options": ["color": "Red"], "sku": "TOTE-R"],
        ],
      ])
    let parsed = posItem(doc)
    XCTAssertEqual(parsed.variants.map(\.unitCents), [1900, 2150])
    XCTAssertEqual(parsed.variants[0].label, "Blue")
    XCTAssertEqual(parsed.fromCents, 1900)
    XCTAssertEqual(parsed.toCents, 2150)
    XCTAssertTrue(parsed.quickKey)
    XCTAssertEqual(variantForCode(parsed, "tote-r")?.id, "v2")
    XCTAssertEqual(variantForCode(parsed, "0850098765432")?.id, "v1")
  }

  func testAScannedCodeLosesSeparatorsAndCase() {
    XCTAssertEqual(scannedProductCode(" AB 12\u{1d}CD "), "ab12cd")
    XCTAssertNil(scannedProductCode("   "))
  }

  func testTopLevelCategoriesIncludeOrphansInTheMerchantsOrder() {
    let categories = [
      PosCategory(id: "b", name: "Beans", parentID: nil, order: 2),
      PosCategory(id: "a", name: "Apparel", parentID: nil, order: 1),
      PosCategory(id: "c", name: "Cups", parentID: "missing", order: 3),
      PosCategory(id: "d", name: "Decaf", parentID: "b", order: 1),
    ]
    XCTAssertEqual(categoryLevel(categories, parentID: nil).map(\.id), ["a", "b", "c"])
    XCTAssertEqual(categoryLevel(categories, parentID: "b").map(\.id), ["d"])
  }

  func testTheGridPlanNarrowsByCategoryOnlyWithoutASearch() {
    let byCategory = posGridPlan(PosGridArgs(categoryID: "c1"))
    XCTAssertTrue(byCategory.filters.contains { $0.path == "categoryIds" && $0.op == .arrayContains })
    let searched = posGridPlan(PosGridArgs(search: "mug", categoryID: "c1"))
    XCTAssertFalse(searched.filters.contains { $0.path == "categoryIds" })
    XCTAssertTrue(searched.filters.contains { $0.path == "status" && $0.value == .string("active") })
  }
}

final class MoneyTests: XCTestCase {
  func testAmountsReadAndPrintInWholeCents() {
    XCTAssertEqual(centsFromText("$12.5"), 1250)
    XCTAssertEqual(centsFromText("1,000"), 100_000)
    XCTAssertNil(centsFromText("12.345"))
    XCTAssertEqual(amountText(1205), "12.05")
    XCTAssertEqual(jsRound(-0.5), 0)
    XCTAssertEqual(jsRound(2.5), 3)
  }

  func testTipsAndCashQuickAmounts() {
    XCTAssertEqual(tipChoices(2000, [15, 20]).map(\.cents), [0, 300, 400])
    XCTAssertEqual(tipChoices(2000, [12.5]).last?.label, "12.5%")
    XCTAssertEqual(cashQuickAmounts(1234), [1234, 1500, 2000, 5000, 10000])
    XCTAssertEqual(cashQuickAmounts(0), [])
  }

  func testAnAttemptKeyIsKeptUntilItsAnswer() {
    var count = 0
    var keys = AttemptKeys { count += 1; return "k\(count)" }
    XCTAssertEqual(keys.key(for: "cash:100"), "k1")
    XCTAssertEqual(keys.key(for: "cash:100"), "k1")
    keys.answered()
    XCTAssertEqual(keys.key(for: "cash:100"), "k2")
  }
}

/// A sale API answering from a script.
final class ScriptedSaleAPI: PosSaleAPI, @unchecked Sendable {
  let hostID = "h1"
  var answers: [Result<PosPaymentAnswer, Error>] = []
  private(set) var steps: [(SaleStep, String?)] = []

  func context() async throws -> PosContext {
    PosContext(settings: PosRegisterSettings(), terminalAvailable: true, testMode: true, readers: [], smsReceipts: false)
  }
  func openSale(registerID: String, locationID: String?, cart: Cart, attemptKey: String) async throws -> PosOpenedSale {
    PosOpenedSale(orderID: "o1", subtotalCents: 1000, discountCents: 0, taxCents: 80, totalCents: 1080, dueCents: 1080, stockWarnings: [])
  }
  func payment(orderID: String, step: SaleStep, attemptKey: String?) async throws -> PosPaymentAnswer {
    steps.append((step, attemptKey))
    return try answers.removeFirst().get()
  }
  func giftCardBalance(code: String) async throws -> GiftCardBalance {
    GiftCardBalance(availableCents: 500, frozen: false, voided: false, last4: "1234")
  }
}

private func answer(due: Int, payment: PosSalePayment?, completed: Bool = false, secret: String? = nil, intent: String? = nil)
  -> PosPaymentAnswer
{
  PosPaymentAnswer(
    sale: PosSale(
      orderID: "o1", status: due == 0 ? "paid" : "pending", totalCents: 1080, paidCents: 1080 - due, dueCents: due,
      tenderableCents: due, tipCents: 0, payments: payment.map { [$0] } ?? []),
    paymentID: payment?.id, completed: completed, clientSecret: secret, paymentIntentID: intent)
}

private func payment(_ id: String, _ status: String, amount: Int = 1080, change: Int = 0) -> PosSalePayment {
  PosSalePayment(
    id: id, method: "cash", amountCents: amount, tipCents: 0, status: status, cardBrand: nil, last4: nil,
    changeCents: change, readerID: nil, failureMessage: nil)
}

private let opened = PosOpenedSale(
  orderID: "o1", subtotalCents: 1000, discountCents: 0, taxCents: 80, totalCents: 1080, dueCents: 1080, stockWarnings: [])

@MainActor
final class CheckoutTests: XCTestCase {
  func testCashSettlesTheSaleAndShowsTheChange() async {
    let api = ScriptedSaleAPI()
    api.answers = [.success(answer(due: 0, payment: payment("pay1", "succeeded", change: 920), completed: true))]
    let checkout = Checkout(api: api, opened: opened, settings: PosRegisterSettings(), sleep: { _ in })
    await checkout.payCash(tenderedCents: 2000)
    XCTAssertEqual(checkout.step, .receipt(changeCents: 920))
    XCTAssertEqual(api.steps.first?.0, .cash(tenderedCents: 2000, tipCents: 0, amountCents: nil))
    XCTAssertNotNil(api.steps.first?.1, "a payment carries its attempt key")
  }

  func testTooLittleCashIsRefusedBeforeAnyCall() async {
    let api = ScriptedSaleAPI()
    let checkout = Checkout(api: api, opened: opened, settings: PosRegisterSettings(), sleep: { _ in })
    await checkout.payCash(tenderedCents: 500)
    XCTAssertEqual(checkout.notice?.tone, .error)
    XCTAssertTrue(api.steps.isEmpty)
  }

  func testASplitLeavesTheBalanceOpen() async {
    let api = ScriptedSaleAPI()
    api.answers = [.success(answer(due: 580, payment: payment("pay1", "succeeded", amount: 500)))]
    let checkout = Checkout(api: api, opened: opened, settings: PosRegisterSettings(), sleep: { _ in })
    checkout.setPart(500)
    XCTAssertTrue(checkout.isSplit)
    await checkout.payCash(tenderedCents: 500)
    XCTAssertEqual(checkout.step, .tender)
    XCTAssertEqual(checkout.dueCents, 580)
    XCTAssertEqual(checkout.notice?.tone, .success)
    XCTAssertEqual(api.steps.first?.0, .cash(tenderedCents: 500, tipCents: 0, amountCents: 500))
  }

  func testALostAnswerBlocksTendersUntilTheSaleIsReadAgain() async {
    let api = ScriptedSaleAPI()
    api.answers = [
      .failure(ConsoleAPIError(status: 0, message: "offline")),
      .failure(ConsoleAPIError(status: 0, message: "offline")),
    ]
    let checkout = Checkout(api: api, opened: opened, settings: PosRegisterSettings(), sleep: { _ in })
    await checkout.payCash(tenderedCents: 2000)
    XCTAssertTrue(checkout.lost)
    XCTAssertFalse(checkout.canTender)
  }

  func testTheSimulatedDeviceReaderCollectsTheServersIntent() async {
    let api = ScriptedSaleAPI()
    let card = PosSalePayment(
      id: "pay1", method: "card-present-sdk", amountCents: 1080, tipCents: 0, status: "pending", cardBrand: nil,
      last4: nil, changeCents: 0, readerID: nil, failureMessage: nil)
    let settled = PosSalePayment(
      id: "pay1", method: "card-present-sdk", amountCents: 1080, tipCents: 0, status: "succeeded", cardBrand: "visa",
      last4: "4242", changeCents: 0, readerID: nil, failureMessage: nil)
    api.answers = [
      .success(answer(due: 1080, payment: card, secret: "pi_12345678abc_secret_abcdefgh", intent: "pi_12345678abc")),
      .success(answer(due: 0, payment: settled, completed: true)),
    ]
    let collector = SimulatedCardCollector(delay: .zero)
    _ = await collector.connect(hostID: "h1", kind: .simulated, sessions: NoSessions())
    let checkout = Checkout(api: api, opened: opened, settings: PosRegisterSettings(), sleep: { _ in })
    await checkout.payCard(DeviceReaderService(collector))
    XCTAssertEqual(checkout.step, .receipt(changeCents: 0))
    XCTAssertEqual(api.steps.map { $0.0.action }, ["card-present-sdk", "status"])
  }

  func testAnIntentForAnotherAmountIsNeverCollected() async {
    let api = ScriptedSaleAPI()
    let card = PosSalePayment(
      id: "pay1", method: "card-present-sdk", amountCents: 9999, tipCents: 0, status: "pending", cardBrand: nil,
      last4: nil, changeCents: 0, readerID: nil, failureMessage: nil)
    api.answers = [
      .success(answer(due: 1080, payment: card, secret: "pi_12345678abc_secret_abcdefgh", intent: "pi_12345678abc")),
      .success(answer(due: 1080, payment: nil)),
    ]
    let collector = SimulatedCardCollector(delay: .zero)
    _ = await collector.connect(hostID: "h1", kind: .simulated, sessions: NoSessions())
    let checkout = Checkout(api: api, opened: opened, settings: PosRegisterSettings(), sleep: { _ in })
    await checkout.payCard(DeviceReaderService(collector))
    XCTAssertEqual(checkout.notice?.message, "The amount to charge does not match the register. Start the payment again.")
    XCTAssertEqual(api.steps.map { $0.0.action }, ["card-present-sdk", "cancel"])
  }
}

private struct NoSessions: CardReaderSessionSource {
  func session(hostID: String) async throws -> CardReaderSession {
    CardReaderSession(secret: "pst_test", locationID: "tml_test", merchantDisplayName: "Store", testMode: true)
  }
}
