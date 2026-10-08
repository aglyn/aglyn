// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays every site-functions case in function-cases.generated.json: the
/// console's own answers from libs/aglyn/src/lib/app-utils/functions.ts,
/// runWorkflow and host-events.ts.
final class SiteFunctionsTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String, file: StaticString = #filePath, line: UInt = #line) -> [(args: [Any], result: Any)] {
    guard let entry = Self.functions[name] as? [String: Any], let list = entry["cases"] as? [[String: Any]] else {
      XCTFail("no cases for \(name)", file: file, line: line)
      return []
    }
    XCTAssertFalse(list.isEmpty, "\(name) has no cases", file: file, line: line)
    return list.map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  private func value(_ any: Any) -> SiteValue? { SiteValue(plain: any) }

  private func scope(_ any: Any?) -> SiteScope {
    (any as? [String: Any] ?? [:]).compactMapValues { SiteValue(plain: $0) }
  }

  private func functionMap(_ any: Any?) -> [String: HostFunctionDefinition] {
    (any as? [String: Any] ?? [:]).compactMapValues { ($0 as? [String: Any]).map(HostFunctionDefinition.init) }
  }

  func testExpressionsEvaluateAsTheConsoleDoes() {
    for item in cases("evaluateExpression") {
      let text = item.args[0] as! String
      XCTAssertEqual(try evaluateExpression(text, scope(item.args[1])), value(item.result), text)
    }
  }

  func testSyntaxErrorsNameWhatTheTextGetsWrong() {
    for item in cases("expressionSyntaxError") {
      let text = item.args[0] as! String
      XCTAssertEqual(expressionSyntaxError(text), item.result as? String, text)
    }
  }

  func testFunctionsRunWithParametersLocalsAndGlobals() {
    for item in cases("evaluateHostFunction") {
      let definition = HostFunctionDefinition(item.args[0] as! [String: Any])
      let options = item.args.count > 2 ? item.args[2] as? [String: Any] : nil
      let run = evaluateHostFunction(definition, scope(item.args[1]), globals: scope(options?["globals"]))
      let expected = item.result as! [String: Any]
      if expected["ok"] as? Bool == true {
        XCTAssertEqual(run, .ok(value: value(expected["value"]!)!, scope: scope(expected["scope"])), "\(item.args)")
      } else {
        XCTAssertEqual(run, .failed(expected["error"] as! String), "\(item.args)")
      }
    }
  }

  func testWorkflowsChainFunctionCalls() {
    for item in cases("runWorkflow") {
      let workflow = WorkflowDefinition(item.args[0] as! [String: Any])
      let variables = (item.args.count > 2 ? item.args[2] as? [String: Any] : nil) ?? [:]
      let ordered = variables.keys.sorted().map { ($0, HostVariableValue(variables[$0] as! [String: Any])) }
      let extra = item.args.count > 3 ? scope(item.args[3]) : [:]
      let run = runWorkflow(workflow, functions: functionMap(item.args[1]), variables: ordered, extraScope: extra)
      let expected = item.result as! [String: Any]
      if expected["ok"] as? Bool == true {
        guard case .ok(let got, let results) = run else {
          XCTFail("\(item.args) → \(run)")
          continue
        }
        XCTAssertEqual(got, value(expected["value"]!), "\(item.args)")
        XCTAssertEqual(
          Dictionary(uniqueKeysWithValues: results.map { ($0.name, $0.value) }), scope(expected["results"]), "\(item.args)")
      } else {
        XCTAssertEqual(
          run, .failed(error: expected["error"] as! String, step: (expected["step"] as? NSNumber)?.intValue), "\(item.args)")
      }
    }
  }

  func testHostEventsReadFromTheirDeclarations() {
    for item in cases("hostEventLabel") {
      XCTAssertEqual(hostEventLabel(item.args[0] as? String), item.result as? String)
    }
    for item in cases("hostEventPayloadHint") {
      XCTAssertEqual(hostEventPayloadHint(item.args[0] as? String), item.result as? String)
    }
    for item in cases("hostEventRecipientActed") {
      XCTAssertEqual(hostEventRecipientActed(item.args[0] as? String), item.result as? Bool)
    }
  }

  func testGeneratedLanguageValuesDecode() {
    XCTAssertEqual(functionBuiltinNames, ["min", "max", "round", "floor", "ceil", "abs", "format"])
    XCTAssertEqual(functionMaxOperations, 1000)
    XCTAssertEqual(workflowMaxSteps, 25)
    XCTAssertEqual(crossMaxDepth, 3)
    XCTAssertEqual(hostEvents.first?.type, "formSubmission")
  }

  func testNumbersPrintAsJavaScriptPrintsThem() {
    XCTAssertEqual(jsNumberString(2.5), "2.5")
    XCTAssertEqual(jsNumberString(10), "10")
    XCTAssertEqual(jsNumberString(-0.0), "0")
    XCTAssertEqual(jsNumberString(1e21), "1e+21")
    XCTAssertEqual(jsNumberString(123456789012345680000), "123456789012345680000")
    XCTAssertEqual(jsNumberString(0.000001), "0.000001")
    XCTAssertEqual(jsNumberString(1e-7), "1e-7")
    XCTAssertEqual(jsNumberString(0.1 + 0.2), "0.30000000000000004")
  }

  func testWorkflowCallsReachOtherWorkflowsWithinTheDepthGuard() {
    let double = HostFunctionDefinition([
      "name": "double", "parameters": [["name": "x", "type": "number", "required": true]],
      "variables": [["name": "out", "type": "number"]],
      "operations": [
        ["if": ["left": "1", "comparator": "==", "right": "1"], "then": [["set": "out", "workflow": "inner"]], "otherwise": []]
      ],
      "returnValue": "out",
    ])
    let inner = WorkflowDefinition(name: "inner", steps: [], returnValue: "x")
    let outer = WorkflowDefinition(name: "outer", steps: [WorkflowFunctionCall(functionName: "double", args: ["4"])])
    let run = runWorkflow(outer, functions: ["double": double], workflows: ["inner": inner])
    guard case .ok(let value, _) = run else { return XCTFail("\(run)") }
    XCTAssertEqual(value, .number(4))
  }
}
