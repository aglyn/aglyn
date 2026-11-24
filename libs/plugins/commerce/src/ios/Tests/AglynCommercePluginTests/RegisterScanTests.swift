// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

/// The register's code lookup, which the camera sheet, the typed code and a USB scanner share (AGL-4238). The words
/// are Android's `RegisterModel.lookUp`.
@MainActor
final class RegisterScanTests: XCTestCase {
  /// Answers each code query from a table keyed by the field it looks in (`barcodes`, `skus`), a moment later.
  private final class Catalog: FirestoreReader, @unchecked Sendable {
    private final class Nothing: FirestoreListening { func remove() {} }
    var byField: [String: [FirestoreDocument]] = [:]
    var fails = false
    private(set) var asked: [String] = []

    @MainActor
    func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void)
      -> FirestoreListening
    {
      let described = String(describing: query.filters)
      guard let field = ["barcodes", "skus"].first(where: { described.contains("\"\($0)\"") || described.contains($0) })
      else { return Nothing() }
      asked.append(field)
      let docs = byField[field] ?? []
      let fails = fails
      Task { @MainActor in onChange(fails ? .failure(URLError(.notConnectedToInternet)) : .success(docs)) }
      return Nothing()
    }

    @MainActor
    func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void)
      -> FirestoreListening
    { Nothing() }
    func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
    func deleteDocument(_ path: [String]) async throws {}
  }

  private let catalog = Catalog()

  private func register() -> RegisterModel {
    let api = ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "token" }, sleep: { _ in }, maxAttempts: 1)
    let model = RegisterModel(
      hostID: "h1", reader: catalog, api: api, collector: nil, defaults: UserDefaults(suiteName: "scan-\(UUID().uuidString)")!)
    model.selectRegister(PosRegister(id: "r1", name: "Front", locationID: nil))
    return model
  }

  private func scan(_ model: RegisterModel, _ code: String) async -> ScanAnswer? {
    var heard: ScanAnswer?
    model.lookUp(code) { heard = $0 }
    for _ in 0..<100 where heard == nil { try? await Task.sleep(for: .milliseconds(5)) }
    return heard
  }

  private let coldBrew = FirestoreDocument(id: "p1", data: ["name": "Cold brew", "priceUsd": 4.5, "inventory": 10])

  func testAFoundProductGoesInTheBasketAndTheSheetSaysSo() async {
    catalog.byField["barcodes"] = [coldBrew]
    let model = register()
    let answer = await scan(model, "0 12345 67890 5")
    XCTAssertEqual(answer, ScanAnswer(words: "Added Cold brew"))
    XCTAssertEqual(model.cart.count, 1)
    XCTAssertEqual(catalog.asked, ["barcodes"])
    // A second of the same item is a second scan.
    _ = await scan(model, "012345678905")
    XCTAssertEqual(model.cart.count, 2)
  }

  func testASkuIsLookedUpAfterTheBarcodesAndAddsTheVariantItNames() async {
    catalog.byField["skus"] = [
      FirestoreDocument(
        id: "p2",
        data: [
          "name": "Tee",
          "variants": [
            ["id": "s", "options": ["size": "S"], "priceUsd": 20, "sku": "TEE-S"],
            ["id": "m", "options": ["size": "M"], "priceUsd": 22, "sku": "TEE-M"],
          ],
        ])
    ]
    let model = register()
    let answer = await scan(model, "TEE-M")
    XCTAssertEqual(answer, ScanAnswer(words: "Added Tee"))
    XCTAssertEqual(catalog.asked, ["barcodes", "skus"])
    XCTAssertEqual(model.cart.lines.first?.variantID, "m")
    XCTAssertEqual(model.cart.lines.first?.unitCents, 2200)
    XCTAssertNil(model.sheet, "a code that names one variant needs no sheet")
  }

  func testAProductWithModifiersOpensItsSheetForTheCameraToMakeWayFor() async {
    catalog.byField["barcodes"] = [
      FirestoreDocument(
        id: "p3",
        data: [
          "name": "Latte", "priceUsd": 4,
          "modifierGroups": [
            ["id": "milk", "name": "Milk", "min": 1, "max": 1, "options": [["id": "oat", "name": "Oat", "priceCents": 75]]]
          ],
        ])
    ]
    let model = register()
    let answer = await scan(model, "4006381333931")
    XCTAssertEqual(answer, ScanAnswer(words: "Choose options for Latte", needsSheet: true))
    XCTAssertEqual(model.sheet?.item.name, "Latte")
    XCTAssertTrue(model.cart.isEmpty)
  }

  func testNoMatchSaysTheCodeAndAddsNothing() async {
    let model = register()
    let answer = await scan(model, "SKU 999")
    XCTAssertEqual(answer, ScanAnswer(words: "No product has the code sku999."))
    XCTAssertTrue(model.cart.isEmpty)
    XCTAssertNil(model.toast, "the camera sheet says it; no toast behind it")
  }

  func testASoldOutProductIsStillAddedWithTheWarning() async {
    catalog.byField["barcodes"] = [FirestoreDocument(id: "p4", data: ["name": "Muffin", "priceUsd": 3, "inventory": 0])]
    let model = register()
    let answer = await scan(model, "5000112637922")
    XCTAssertEqual(answer, ScanAnswer(words: "Added Muffin"))
    XCTAssertEqual(model.cart.count, 1)
    XCTAssertEqual(model.toast?.message, "Muffin shows as sold out. The sale may refuse it.")
  }

  func testAProductWithoutAPriceIsNotAddedAndTheSheetSaysWhy() async {
    catalog.byField["barcodes"] = [
      FirestoreDocument(id: "p5", data: ["name": "Gift box", "variants": [["id": "v1", "barcode": "77777"]]])
    ]
    let model = register()
    let answer = await scan(model, "77777")
    XCTAssertEqual(answer, ScanAnswer(words: "Set a price for Gift box before selling it."))
    XCTAssertTrue(model.cart.isEmpty)
  }

  func testAnUnreadableCodeAndAFailedLookup() async {
    let model = register()
    let unreadable = await scan(model, "   ")
    XCTAssertEqual(unreadable, ScanAnswer(words: "That code could not be read. Try again."))
    catalog.fails = true
    let failed = await scan(model, "012345678905")
    XCTAssertEqual(failed, ScanAnswer(words: "The lookup did not work. Check the connection and try again."))
  }

  func testATypedOrUsbCodeAnswersInTheToast() async {
    let model = register()
    model.lookUp("ABC-123")
    for _ in 0..<100 where model.toast == nil { try? await Task.sleep(for: .milliseconds(5)) }
    XCTAssertEqual(model.toast, CheckoutNotice(tone: .warning, message: "No product has the code abc-123."))

    catalog.byField["barcodes"] = [coldBrew]
    model.toast = nil
    model.lookUp("012345678905")
    for _ in 0..<100 where model.cart.isEmpty { try? await Task.sleep(for: .milliseconds(5)) }
    XCTAssertEqual(model.cart.count, 1)
    XCTAssertNil(model.toast)
  }
}
