// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// An action that names a stored document sends it back with the person's edits on top, without its timestamps. The Kotlin
/// renderer's `CommerceProductDetailsTest` holds the same cases for the product screen.
final class OverlayTests: XCTestCase {
  private final class Stored: FirestoreReader, @unchecked Sendable {
    let data: [String: Any]?
    var asked: [[String]] = []
    init(_ data: [String: Any]?) { self.data = data }

    @MainActor
    func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening {
      onChange(.success([]))
      return NoListener()
    }

    @MainActor
    func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening {
      asked.append(path)
      onChange(.success(data.map { FirestoreDocument(id: path.last ?? "", data: $0) }))
      return NoListener()
    }

    func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
    func deleteDocument(_ path: [String]) async throws {}
  }

  private func sent(_ transport: RecordingTransport) throws -> [String: Any] {
    let request = try XCTUnwrap(transport.requests.first)
    return try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
  }

  @MainActor
  func testTheStoredDocumentGoesBackWithTheEditsOnTopAndNoTimestamps() async throws {
    let stored: [String: Any] = [
      "name": "Mug", "slug": "mug", "supplierId": "s1", "tags": ["gift"], "createdAt": Date(timeIntervalSince1970: 1_700_000_000),
      "seo": ["title": "A mug", "imageUrl": "https://x/og.png", "publishedAt": Date()], "variants": [["id": "default", "priceUsd": 12]],
    ]
    let transport = RecordingTransport(responses: [])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    let reader = Stored(stored)
    let model = ScreenModel(
      spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: ["site": ["id": "h1"], "params": ["productId": "p1"]],
      api: api, reader: reader)
    let action = try XCTUnwrap(
      ActionSpec([
        "label": "Save", "url": "/api/commerce/products/save", "overlay": "hosts/{site.id}/products/{params.productId}",
        "body": [
          "hostId": "{site.id}", "productId": "{params.productId}",
          "product": [
            "$overlay": [
              "base": "{overlay}",
              "set": [
                "slug": ["$slug": "{form.slug}"], "supplierId": ["$orNull": "{form.supplierId}"], "tags": ["$split": "{form.tags}"],
                "seo": ["$overlay": ["base": "{overlay.seo}", "set": ["title": ["$orNull": "{form.seoTitle}"]]]],
              ],
            ]
          ],
        ],
      ]))
    let scope = ScreenContext.with(
      model.context, "form", ["slug": "Coffee Mug", "supplierId": "", "tags": "gift, Kitchen ,", "seoTitle": "Best mug"])
    let outcome = await model.run(action, in: scope)
    guard case .done = outcome else { return XCTFail("\(outcome)") }
    XCTAssertEqual(reader.asked, [["hosts", "h1", "products", "p1"]])
    let body = try sent(transport)
    XCTAssertEqual(body["productId"] as? String, "p1")
    let product = try XCTUnwrap(body["product"] as? [String: Any])
    XCTAssertEqual(product["name"] as? String, "Mug")
    XCTAssertEqual(product["slug"] as? String, "coffee-mug")
    XCTAssertEqual(product["tags"] as? [String], ["gift", "Kitchen"])
    XCTAssertNil(product["supplierId"], "an emptied field is taken off")
    XCTAssertNil(product["createdAt"], "a timestamp is the route's to keep")
    let seo = try XCTUnwrap(product["seo"] as? [String: Any])
    XCTAssertEqual(seo["title"] as? String, "Best mug")
    XCTAssertEqual(seo["imageUrl"] as? String, "https://x/og.png")
    XCTAssertNil(seo["publishedAt"], "nor one deeper in")
    XCTAssertEqual((product["variants"] as? [[String: Any]])?.first?["id"] as? String, "default")
  }

  @MainActor
  func testADocumentThatCannotBeReadIsSaidAndNothingIsSent() async throws {
    let transport = RecordingTransport(responses: [])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: ["site": ["id": "h1"]], api: api, reader: Stored(nil))
    let action = try XCTUnwrap(ActionSpec(["label": "Save", "url": "/api/x", "overlay": "hosts/{site.id}/products/p1", "body": ["a": "{overlay.name}"]]))
    let outcome = await model.run(action, in: model.context)
    XCTAssertEqual(outcome, .failed("That could not be read. Try again."))
    XCTAssertTrue(transport.requests.isEmpty)
  }
}
