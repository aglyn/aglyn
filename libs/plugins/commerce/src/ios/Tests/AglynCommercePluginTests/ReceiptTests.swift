// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynHardware
import XCTest

@testable import AglynCommercePlugin

/// The console's own receipt spec fixture (`printing.spec.ts`), as the Kotlin app's `ReceiptTest` holds it.
private let receipt = ReceiptData(
  createdAtMs: 1_791_317_040_000, currency: "usd", footer: "Thank you — returns within 30 days.",
  lines: [
    ReceiptLine(detail: "Oat milk", name: "Latte", quantity: 2, totalCents: 900, unitCents: 450),
    ReceiptLine(name: "Crème brûlée with a very long name that wraps", quantity: 1, totalCents: 725, unitCents: 725),
  ], orderId: "order1", orderNumber: "1042", registerName: "Front counter", storeLines: ["12 Main St, Springfield"],
  storeName: "Corner Café", subtotalCents: 1625, taxCents: 126, tenders: [ReceiptTender(amountCents: 2000, label: "Cash")],
  timeZone: "America/Chicago", totalCents: 1651)

private func fixture() -> ReceiptData {
  var data = receipt
  data.discountCents = 100
  data.changeCents = 349
  data.barcode = "1042"
  return data
}

final class ReceiptTests: XCTestCase {
  func testLaysTheReceiptOutAsTheConsoleDoesOn80mmPaper() {
    let text = renderText(layoutReceipt(fixture(), ReceiptLayoutOptions(columns: 48)))
    let expected = [
      "                  Corner Cafe",
      "            12 Main St, Springfield",
      "",
      "Order #1042                 Oct 6, 2026, 3:04 PM",
      "Front counter",
      "------------------------------------------------",
      "2 x Latte                                  $9.00",
      "  Oat milk",
      "  @ $4.50 each",
      "Creme brulee with a very long name that",
      "wraps                                      $7.25",
      "------------------------------------------------",
      "Subtotal                                  $16.25",
      "Discount                                  -$1.00",
      "Tax                                        $1.26",
      "TOTAL             $16.51",
      "",
      "Cash                                      $20.00",
      "Change                                     $3.49",
      "",
      "                     [1042]",
      "",
      "      Thank you - returns within 30 days.",
      "",
      "",
      "",
    ].joined(separator: "\n")
    XCTAssertEqual(text, expected)
    XCTAssertTrue(text.split(separator: "\n", omittingEmptySubsequences: false).allSatisfy { $0.count <= 48 })
  }

  func testFits58mmPaperToo() {
    let text = renderText(layoutReceipt(fixture(), ReceiptLayoutOptions(columns: 32)))
    XCTAssertTrue(text.split(separator: "\n", omittingEmptySubsequences: false).allSatisfy { $0.count <= 32 })
    XCTAssertTrue(text.contains("TOTAL     $16.51"))
  }

  func testAGiftReceiptKeepsTheItemsAndTheBarcodeAndDropsEveryPrice() {
    let text = renderText(layoutReceipt(fixture(), ReceiptLayoutOptions(columns: 48, gift: true)))
    XCTAssertTrue(text.contains("2 x Latte"))
    XCTAssertTrue(text.contains("[1042]"))
    for forbidden in ["$", "Subtotal", "TOTAL", "Cash", "Change"] { XCTAssertFalse(text.contains(forbidden), forbidden) }
  }

  func testOpensTheDrawerFirstOnACashReceipt() {
    let ops = layoutReceipt(fixture(), ReceiptLayoutOptions(columns: 48, logo: true, openDrawer: true)).ops
    XCTAssertEqual(ops[0], .drawer)
    XCTAssertEqual(ops[1], .logo)
    XCTAssertEqual(ops.last, .cut)
  }

  func testReadsTheReceiptFromTheOrderAsStored() {
    let order: [String: Any] = [
      "number": 1042, "createdAtMs": 1_791_317_040_000, "currency": "usd", "channel": "pos",
      "lineItems": [
        ["name": "Latte", "variantLabel": "Large / Oat milk", "quantity": 2, "unitAmountCents": 600],
        ["name": "Croissant", "quantity": 1, "unitAmountCents": 395],
      ],
      "totals": ["itemsCents": 1595, "discountCents": 0, "taxCents": 128, "tipCents": 239, "totalCents": 1962],
      "payments": [
        ["method": "cash", "status": "succeeded", "amountCents": 1000, "cashTenderedCents": 2000, "changeCents": 1000],
        ["method": "card_present", "status": "succeeded", "amountCents": 723, "tipCents": 239, "cardBrand": "Visa", "last4": "4242"],
        ["method": "card_present", "status": "failed", "amountCents": 723],
      ],
    ]
    let data = receiptDataFromOrder(
      orderID: "o1", order: order, context: ReceiptContext(storeName: "Corner Café", registerName: "Front counter"), nowMs: 0)
    XCTAssertEqual(data.orderNumber, "1042")
    XCTAssertEqual(data.lines.map(\.totalCents), [1200, 395])
    XCTAssertEqual(data.lines[0].detail, "Large / Oat milk")
    XCTAssertEqual(data.tenders, [ReceiptTender(amountCents: 2000, label: "Cash"), ReceiptTender(amountCents: 962, label: "Visa **** 4242")])
    XCTAssertEqual(data.changeCents, 1000)
    XCTAssertEqual(data.tipCents, 239)
    XCTAssertNil(data.discountCents)
    XCTAssertEqual(data.totalCents, 1962)
  }

  func testReadsASingleTenderFromAnOrderWithoutALedger() {
    let order: [String: Any] = ["channel": "pos", "totals": ["totalCents": 1500], "changeCents": 500]
    let tenders = receiptTendersFromOrder(order)
    XCTAssertEqual(tenders.tenders, [ReceiptTender(amountCents: 2000, label: "Cash")])
    XCTAssertEqual(tenders.changeCents, 500)
    XCTAssertEqual(receiptDataFromOrder(orderID: "abcdefgh123", order: [:], context: ReceiptContext(storeName: "Store"), nowMs: 5).orderNumber, "ABCDEFGH")
  }

  func testAFirestoreNullIsNotACheckoutSession() {
    let order: [String: Any] = ["channel": "pos", "totals": ["totalCents": 1500], "checkoutSessionId": NSNull(), "paymentIntentId": NSNull()]
    XCTAssertEqual(receiptTendersFromOrder(order).tenders.map(\.label), ["Cash"], "a null field is an absent one")
  }
}
