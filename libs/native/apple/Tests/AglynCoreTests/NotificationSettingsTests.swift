// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

@testable import AglynCore
import Foundation
import XCTest

/// Replays libs/native/contracts/notification-settings-cases.generated.json:
/// the console settings page's own answers.
final class NotificationSettingsTests: XCTestCase {
  private var cases: [[String: Any]] {
    get throws {
      let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("contracts/notification-settings-cases.generated.json")
      let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
      return root?["cases"] as? [[String: Any]] ?? []
    }
  }

  func testEveryCaseReplays() throws {
    let catalog = NotificationCatalog.shared
    let all = try cases
    XCTAssertGreaterThanOrEqual(all.count, 4)
    for item in all {
      let name = item["name"] as? String ?? ""
      let settings = item["settings"] as? [String: Any]
      let legacy = item["legacy"] as? [String: Any]
      for (key, value) in item["categoryValues"] as? [String: Bool] ?? [:] {
        let parts = key.split(separator: ":").map(String.init)
        let ours = NotificationSettings.categoryValue(
          catalog, settings, legacy: legacy, category: parts[0], NotificationChannel(rawValue: parts[1])!)
        XCTAssertEqual(ours, value, "\(name) \(key)")
      }
      for (key, value) in item["typeValues"] as? [String: Bool] ?? [:] {
        let channel = String(key[key.index(after: key.lastIndex(of: ":")!)...])
        let type = String(key[..<key.lastIndex(of: ":")!])
        let ours = NotificationSettings.typeValue(catalog, settings, legacy: legacy, type: type, NotificationChannel(rawValue: channel)!)
        XCTAssertEqual(ours, value, "\(name) \(key)")
      }
      let overridden = item["overridden"] as? [String: [String]] ?? [:]
      let ours = NotificationSettings.overriddenScopes(settings)
      XCTAssertEqual(ours.orgIDs, overridden["orgIds"] ?? [], name)
      XCTAssertEqual(ours.hostIDs, overridden["hostIds"] ?? [], name)
    }
  }

  func testCatalogCarriesTheSettingsPage() {
    let catalog = NotificationCatalog.shared
    XCTAssertFalse(catalog.digests?.isEmpty ?? true)
    XCTAssertEqual(catalog.entry("content.order")?.emailDefault, true)
    XCTAssertNotNil(catalog.entry("content.taskReminder")?.selfSentEmail)
  }

  func testClearingAnAnswerDeletesItsKeyOrItsEmptiedCell() {
    let settings: [String: Any] = [
      "orgs": ["o1": ["content": ["console": false, "email": true]]],
      "hostTypes": ["h1": ["content.order": ["email": true]]],
    ]
    let clearOne = NotificationSettings.answerWrite(settings, .org("o1"), key: "content", types: false, .console, nil)
    let cell = (((clearOne["notificationSettings"] as? [String: Any])?["orgs"] as? [String: Any])?["o1"] as? [String: Any])?["content"] as? [String: Any]
    XCTAssertTrue(cell?["console"] is FirestoreSentinel)
    let clearCell = NotificationSettings.answerWrite(settings, .host("h1"), key: "content.order", types: true, .email, nil)
    let hostLayer = ((clearCell["notificationSettings"] as? [String: Any])?["hostTypes"] as? [String: Any])?["h1"] as? [String: Any]
    XCTAssertTrue(hostLayer?["content.order"] is FirestoreSentinel)
    let set = NotificationSettings.answerWrite(settings, .account, key: "billing", types: false, .email, true)
    XCTAssertEqual(
      (((set["notificationSettings"] as? [String: Any])?["account"] as? [String: Any])?["billing"] as? [String: Bool]),
      ["email": true])
  }
}
