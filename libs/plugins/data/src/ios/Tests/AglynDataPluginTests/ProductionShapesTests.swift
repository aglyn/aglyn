// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynSite
import XCTest

@testable import AglynDataPlugin

/// The documents a long-lived production workspace holds, in its older shapes (libs/native/contracts/production-shapes.json,
/// which the native seed writes too): every list here shows each one where the console does (AGL-3993). The Kotlin
/// `ProductionShapesTest` reads the same file.
final class ProductionShapesTests: XCTestCase {
  private var shapes: ProductionShapes!

  override func setUpWithError() throws {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<7 { url.deleteLastPathComponent() }
    shapes = try ProductionShapes(url.appendingPathComponent("native/contracts/production-shapes.json"))
  }

  func testListsEveryDatasetInItsOldestShape() throws {
    let rows = shapes.documents(in: "orgs/{org}/datasets").map(DatasetRow.init)
    XCTAssertEqual(rows.map(\.name).sorted(), ["Classes", "FAQ", "Team"])
    let classes = try XCTUnwrap(rows.first { $0.id == "lk-ds-classes" })
    // No `names`: the plural is the display name, as the console's card says it.
    XCTAssertEqual(classes.plural, "Classes")
    XCTAssertEqual(classes.singular, "")
    XCTAssertEqual(classes.visibleTo, ["org"])
    XCTAssertEqual(classes.model.orderedFields.map(\.id), ["name", "level", "description"])
    XCTAssertEqual(classes.model.fields?["level"]?.type, .sorted)
    let records = shapes.documents(in: "orgs/{org}/datasets/lk-ds-classes/records").map(RecordRow.init)
    XCTAssertEqual(records.map { $0.title(classes.model) }, ["Wheel basics", "Hand building"])
  }

  func testListsEveryContentCollectionAndEntry() throws {
    let collections = sortedCollections(shapes.documents(in: "hosts/{site}/collections"))
    XCTAssertEqual(collections.map(\.name), ["Changelog", "Journal"])
    XCTAssertEqual(collections.first { $0.id == "journal" }?.listScreenID, "lk-classes")
    XCTAssertEqual(collections.first { $0.id == "changelog" }?.excludeFromSearch, true)
    let entries = shapes.documents(in: "hosts/{site}/collections/journal/entries").map(ContentEntry.init)
    XCTAssertEqual(entries.map(\.title), ["Glazing week", "The new kiln", "Spring schedule"])
    XCTAssertEqual(entries.map(\.status), ["published", "published", "draft"])
    // An entry saved without a category reads as uncategorized, never dropped.
    XCTAssertEqual(entries.map(\.categoryID), ["studio", nil, nil])
    XCTAssertEqual(shapes.documents(in: "hosts/{site}/collections/changelog/entries").map(ContentEntry.init).count, 2)
  }

  func testListsComponentsWhoseNodesAreAByteMapAndALayoutWithANullDelete() throws {
    let components = shapes.documents(in: "hosts/{site}/components").compactMap(ArtifactRow.init)
    XCTAssertEqual(components.map(\.name), ["Studio hero", "Class card", "Email footer"])
    XCTAssertEqual(components.map(\.kind), ["site", "site", "email"])
    XCTAssertEqual(components.map(\.versionID), ["lk-cmp-hero-v1", "lk-cmp-card-v1", "lk-cmp-footer-v1"])
    let layouts = shapes.documents(in: "hosts/{site}/layouts").compactMap(ArtifactRow.init)
    XCTAssertEqual(layouts.map(\.name), ["Studio layout"])
  }
}

/// The production-shaped fixture, its placeholders filled the way the seed fills them (`expandFixtureValue` in
/// tools/scripts/seed-native/legacy-workspace.mjs).
struct ProductionShapes {
  let documents: [(path: String, data: [String: Any])]

  init(_ url: URL, now: Date = Date()) throws {
    let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let ids = try XCTUnwrap(root["ids"] as? [String: String])
    func text(_ value: String) -> String {
      value.replacingOccurrences(of: "{org}", with: ids["org"] ?? "")
        .replacingOccurrences(of: "{secondSite}", with: ids["secondSite"] ?? "")
        .replacingOccurrences(of: "{site}", with: ids["site"] ?? "")
        .replacingOccurrences(of: "{uid}", with: "seed-member")
    }
    func expand(_ value: Any) -> Any {
      switch value {
      case let string as String: return text(string)
      case let array as [Any]: return array.map(expand)
      case let map as [String: Any]:
        if let days = map["$daysAgo"] as? Double { return now.addingTimeInterval(-days * 86_400) }
        if let days = map["$epochMsDaysAgo"] as? Double { return NSNumber(value: (now.timeIntervalSince1970 - days * 86_400) * 1000) }
        if let count = map["$bytes"] as? Int {
          return Dictionary(uniqueKeysWithValues: (0..<count).map { (String($0), NSNumber(value: ($0 * 37) % 256)) })
        }
        return Dictionary(uniqueKeysWithValues: map.map { (text($0.key), expand($0.value)) })
      default: return value
      }
    }
    let rows = try XCTUnwrap(root["documents"] as? [[String: Any]])
    documents = rows.compactMap { row in
      guard let path = row["path"] as? String, let data = row["data"] as? [String: Any] else { return nil }
      return (path, expand(data) as? [String: Any] ?? [:])
    }
  }

  /// The documents directly under a collection, as a list query returns them (in the fixture's order); the collection
  /// is written with the fixture's placeholders (`hosts/{site}/actions`).
  func documents(in collection: String) -> [FirestoreDocument] {
    documents.compactMap { row in
      var parts = row.path.split(separator: "/").map(String.init)
      guard parts.count % 2 == 0, let id = parts.popLast(), parts.joined(separator: "/") == collection else { return nil }
      return FirestoreDocument(id: id, data: row.data)
    }
  }
}
