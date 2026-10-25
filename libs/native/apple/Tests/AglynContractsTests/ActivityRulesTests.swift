// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// An activity row's words and a page's traffic figures: the function cases the console's own code produced, and the
/// row rules over the contracts' nouns and AI words.
final class ActivityRulesTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    let list = ((Self.functions[name] as? [String: Any])?["cases"] as? [[String: Any]]) ?? []
    XCTAssertFalse(list.isEmpty, name)
    return list.map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  func testAutomationRunWords() {
    for c in cases("describeAutomationRunAction") {
      XCTAssertEqual(describeAutomationRunAction(c.args[0] as! String), c.result as? String, "\(c.args)")
    }
  }

  func testPageTrafficSummary() {
    for c in cases("summarizeScreenTraffic") {
      let days = (c.args[0] as! [[String: Any]]).map { ScreenTrafficDay(data: $0) }
      let expected = try! JSONDecoder().decode(
        ScreenTrafficSummary.self, from: JSONSerialization.data(withJSONObject: c.result))
      XCTAssertEqual(summarizeScreenTraffic(days), expected, "\(c.args)")
    }
  }

  func testRowText() {
    XCTAssertEqual(activityRowText(.init(action: "Published version", targetType: "screen", targetName: "Home")), "Published version — Home")
    XCTAssertEqual(activityRowText(.init(action: "Saved the theme")), "Saved the theme")
    XCTAssertEqual(activityRowText(.init(targetType: "screen")), "Page")
    XCTAssertEqual(activityRowText(.init(targetName: "Fall menu")), "Fall menu")
    let brand = ContractValues.shared.platformBrandName
    XCTAssertEqual(
      activityRowText(.init(action: "ai.job.output", targetType: "screen", targetName: "Home")), "Created page Home with \(brand) AI")
    XCTAssertEqual(activityRowText(.init(action: "ai.job.created", targetType: "screen", targetName: "Home")), "Started an AI generation — Home")
    XCTAssertEqual(activityRowText(.init(action: "Action ran on order.created")), "Automation ran: Order created")
    XCTAssertEqual(activityTypeLabel("outreach:mailbox"), "Mailbox")
    XCTAssertEqual(activityTypeLabel("gizmo"), "Gizmo")
    XCTAssertEqual(activityTargetPhrase(type: nil, name: nil), "item")
  }

  func testActor() {
    XCTAssertEqual(activityActorLabel(.init(actorId: "u1", actorEmail: "jordan@example.com")), "jordan@example.com")
    XCTAssertEqual(activityActorLabel(.init(apiKeyName: "Zapier")), "API key Zapier")
    XCTAssertEqual(activityActorLabel(.init(actorId: "api")), "API key")
    XCTAssertEqual(activityActorLabel(.init(actorId: "u1")), "Account u1")
    XCTAssertEqual(activityActorLabel(.init(actorId: "u1", actorEmailNow: "lee@example.com")), "lee@example.com")
    XCTAssertEqual(activityActorLabel(.init(targetType: "workflow", targetName: "Follow-up", actorId: "system:engine")), "Workflow Follow-up")
    let brand = ContractValues.shared.platformBrandName
    XCTAssertEqual(activityActorLabel(.init(actorId: nil)), brand)
    XCTAssertEqual(activityActorLabel(.init(staffActorEmail: "staff@example.com")), "\(brand) staff (staff@example.com)")
  }
}
