// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynWorkflowsPlugin

/// A long-lived production site's automation in its older shapes (libs/native/contracts/production-shapes.json, which
/// the native seed writes too): the hub lists each one where the console does (AGL-3993). The Kotlin
/// `ProductionShapesTest` reads the same file.
final class ProductionShapesTests: XCTestCase {
  private var documents: [(path: String, data: [String: Any])] = []

  override func setUpWithError() throws {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<7 { url.deleteLastPathComponent() }
    let root = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: url.appendingPathComponent("native/contracts/production-shapes.json")))
        as? [String: Any])
    let now = Date()
    // The markers as the seed fills them: a `$daysAgo` is a date; nothing here reads the other markers' values.
    func expand(_ value: Any) -> Any {
      switch value {
      case let array as [Any]: return array.map(expand)
      case let map as [String: Any]:
        if let days = map["$daysAgo"] as? Double { return now.addingTimeInterval(-days * 86_400) }
        return map.mapValues(expand)
      default: return value
      }
    }
    documents = try XCTUnwrap(root["documents"] as? [[String: Any]]).compactMap { row in
      guard let path = row["path"] as? String, let data = row["data"] as? [String: Any] else { return nil }
      return (path, expand(data) as? [String: Any] ?? [:])
    }
  }

  /// The documents directly under a collection named with the fixture's placeholders (`hosts/{site}/actions`).
  private func documents(in collection: String) -> [FirestoreDocument] {
    documents.compactMap { row in
      var parts = row.path.split(separator: "/").map(String.init)
      guard parts.count % 2 == 0, let id = parts.popLast(), parts.joined(separator: "/") == collection else { return nil }
      return FirestoreDocument(id: id, data: row.data)
    }
  }

  func testListsTheWorkflowThatPostsToAWebhook() {
    let rows = visibleWorkflows(documents(in: "hosts/{site}/workflows"))
    XCTAssertEqual(rows.map(\.name), ["Post enrollments"])
    XCTAssertEqual(rows.first?.triggerEvent, "formSubmission")
    XCTAssertEqual(rows.first?.caption.hasPrefix("1 step · on "), true)
  }

  func testListsTheLiveActionsAndLeavesTheRetiredInteractionsOut() {
    let (rows, elementInteractions) = visibleActions(documents(in: "hosts/{site}/actions"))
    // Seven live form and CRM actions; the three deleted element interactions (two `migratedToNode`) are not listed,
    // nor counted as interactions still on their elements.
    XCTAssertEqual(rows.count, 7)
    XCTAssertEqual(elementInteractions, 0)
    XCTAssertTrue(rows.allSatisfy(\.enabled))
    XCTAssertEqual(
      Set(rows.map(\.event)), ["formSubmission", "dealWon", "contactCreated"])
  }

  func testListsTheOutboundWebhook() {
    let rows = visibleWebhooks(documents(in: "hosts/{site}/webhooks"))
    XCTAssertEqual(rows.map(\.name), ["Send enrollments to the studio sheet"])
    XCTAssertEqual(rows.first?.inbound, false)
  }
}
