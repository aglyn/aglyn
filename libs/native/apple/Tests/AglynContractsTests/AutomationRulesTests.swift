// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays every case in libs/native/contracts/automation-cases.generated.json:
/// the console's own automation rules, run by native-automation-cases.spec.ts.
final class AutomationRulesTests: XCTestCase {
  private static let root: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/automation-cases.generated.json")
    return try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
  }()

  private var values: [String: Any] { Self.root["values"] as! [String: Any] }

  private func cases(_ name: String, file: StaticString = #filePath, line: UInt = #line) -> [(args: [Any], result: Any)] {
    let functions = Self.root["functions"] as! [String: Any]
    guard let list = functions[name] as? [[String: Any]] else {
      XCTFail("no cases for \(name)", file: file, line: line)
      return []
    }
    XCTAssertFalse(list.isEmpty, "\(name) has no cases", file: file, line: line)
    return list.map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  /// Canonical JSON text, so a dictionary compares by content.
  private func json(_ value: Any?) -> String {
    let wrapped: Any = value ?? NSNull()
    let data = try! JSONSerialization.data(withJSONObject: [wrapped], options: [.sortedKeys, .fragmentsAllowed])
    return String(decoding: data, as: UTF8.self)
  }

  private func label(_ args: [Any]) -> String { json(args) }

  func testTheVocabularyMatchesTheConsole() {
    let labels = values["HOST_ACTION_STEP_LABELS"] as! [String: String]
    XCTAssertEqual(Dictionary(uniqueKeysWithValues: hostActionStepLabels.map { ($0.type, $0.label) }), labels)
    XCTAssertEqual(workflowActionStepTypes, values["WORKFLOW_ACTION_STEP_TYPES"] as! [String])
    XCTAssertEqual(clientActionStepTypes.sorted(), values["CLIENT_ACTION_STEP_TYPES"] as! [String])
    XCTAssertEqual(siteEventTypes, values["SITE_EVENT_TYPES"] as! [String])
    XCTAssertEqual(elementScopedSiteEvents, values["ELEMENT_SCOPED_SITE_EVENTS"] as! [String])
    XCTAssertEqual(orgAutomationTriggerEvents, values["ORG_AUTOMATION_TRIGGER_EVENTS"] as! [String])
    XCTAssertEqual(orgAutomationStepTypes, values["ORG_AUTOMATION_STEP_TYPES"] as! [String])
    XCTAssertEqual(sendEmailReplyIneligibleReasons, values["SEND_EMAIL_REPLY_INELIGIBLE_REASONS"] as! [String: String])
  }

  func testActionsValidateAsTheActionsBuilderDoes() {
    let all = cases("validateHostAction")
    XCTAssertEqual(all.count, 77)
    for item in all {
      XCTAssertEqual(validateHostAction(item.args[0] as! [String: Any]), item.result as? String, label(item.args))
    }
  }

  func testWorkflowStepsValidateAsTheWorkflowEditorDoes() {
    for item in cases("validateWorkflowSteps") {
      XCTAssertEqual(validateWorkflowSteps(item.args[0]), item.result as? String, label(item.args))
    }
  }

  func testOrgAutomationsReadAsTheSaveRouteReadsThem() {
    for item in cases("readOrgAutomation") {
      let expected = item.result as! [String: Any]
      switch readOrgAutomation(item.args[0]) {
      case .ok(let value):
        XCTAssertEqual(expected["ok"] as? Bool, true, label(item.args))
        XCTAssertEqual(json(value), json(expected["value"]), label(item.args))
      case .problem(let problem):
        XCTAssertEqual(expected["ok"] as? Bool, false, label(item.args))
        XCTAssertEqual(problem, expected["problem"] as? String, label(item.args))
      }
    }
  }

  func testFiltersThatCanNeverRunAreRefused() {
    for item in cases("triggerFilterProblem") {
      let options = item.args[1] as? [String: Any]
      XCTAssertEqual(
        triggerFilterProblem(item.args[0] as? String, remedy: options?["remedy"] as? String), item.result as? String,
        label(item.args))
    }
  }

  func testTheStoredShapeWritesEveryTriggerKeyOut() {
    for item in cases("siteInteractionDocument") {
      XCTAssertEqual(json(siteInteractionDocument(item.args[0] as! [String: Any])), json(item.result), label(item.args))
    }
  }

  func testTransactionalRepliesQualifyAsTheConsoleSays() {
    for item in cases("sendEmailReplyIneligibility") {
      let context = item.args[1] as! [String: Any]
      XCTAssertEqual(
        sendEmailReplyIneligibility(
          item.args[0] as! [String: Any], event: context["event"] as? String, afterWait: context["afterWait"] as! Bool),
        item.result as? String, label(item.args))
    }
    for item in cases("stepRunsAfterWait") {
      XCTAssertEqual(
        stepRunsAfterWait(item.args[0] as! [[String: Any]], (item.args[1] as! NSNumber).intValue), item.result as? Bool,
        label(item.args))
    }
  }

  func testATestRunTakesOnlyTheFunctionCalls() {
    for item in cases("workflowFunctionCalls") {
      XCTAssertEqual(json(workflowFunctionCalls(item.args[0] as! [String: Any])), json(item.result), label(item.args))
    }
  }

  func testPlaceholdersAreFoundAndDescribed() {
    for item in cases("interactionPlaceholders") {
      let found = interactionPlaceholders(item.args[0] as? [String: Any]).map { placeholder -> [String: Any] in
        ["step": placeholder.step.map { $0 as Any } ?? NSNull(), "field": placeholder.field, "names": placeholder.names, "text": placeholder.text]
      }
      XCTAssertEqual(json(found), json(item.result), label(item.args))
    }
    for item in cases("describeInteractionPlaceholder") {
      let placeholder = item.args[0] as! [String: Any]
      XCTAssertEqual(
        describeInteractionPlaceholder(
          step: (placeholder["step"] as? NSNumber)?.intValue, names: placeholder["names"] as! String,
          text: placeholder["text"] as! String),
        item.result as? String)
    }
  }

  func testRunRowsReadAsTheRunHistoryShowsThem() {
    for item in cases("runTriggeredByLabel") {
      XCTAssertEqual(runTriggeredByLabel(item.args[0] as! [String: Any]), item.result as? String, label(item.args))
    }
    for item in cases("actionRunResult") {
      XCTAssertEqual(actionRunResult(item.args[0] as! [String: Any]), item.result as? String, label(item.args))
    }
    for item in cases("actionRunSummary") {
      XCTAssertEqual(actionRunSummary(item.args[0] as! [String: Any]), item.result as? String, label(item.args))
    }
  }

  func testOrgAutomationsRunWhereTheyArePlacedAndUnpaused() {
    for item in cases("orgAutomationRunsOnHost") {
      XCTAssertEqual(
        orgAutomationRunsOnHost(item.args[0] as? [String: Any], hostID: item.args[1] as! String), item.result as? Bool,
        label(item.args))
    }
    for item in cases("orgAutomationStopReason") {
      XCTAssertEqual(
        orgAutomationStopReason(item.args[0] as? [String: Any], hostID: item.args[1] as! String),
        item.result as? String, label(item.args))
    }
  }

  func testDefaultStepsPassOrNameTheirOwnGap() {
    for (type, _) in hostActionStepLabels {
      XCTAssertEqual(defaultAutomationStep(type)["type"] as? String, type)
    }
    XCTAssertTrue(isElementInteraction(["trigger": ["selector": "[data-aglyn=\"leaf:abc\"]"]]))
    XCTAssertFalse(isElementInteraction(["trigger": ["selector": "#buy"]]))
  }
}
