// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import XCTest

@testable import AglynLogicPlugin

/// The console's own answers (function-cases.generated.json) for the Logic page's helpers: the Kotlin `LogicCasesTest`.
private func functionCases(_ name: String) throws -> [(args: [Any], result: Any)] {
  var url = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { url.deleteLastPathComponent() }
  url.appendPathComponent("native/contracts/function-cases.generated.json")
  let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
  let function = (root?["functions"] as? [String: Any])?[name] as? [String: Any]
  let cases = try XCTUnwrap(function?["cases"] as? [[String: Any]], "no cases for \(name)")
  XCTAssertFalse(cases.isEmpty, name)
  return cases.map { ($0["args"] as? [Any] ?? [], $0["result"] ?? NSNull()) }
}

private func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
  try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed))
}

private func string(_ value: Any?) -> String? { value is NSNull ? nil : value as? String }

final class LogicTests: XCTestCase {
  func testFormatVariableValue() throws {
    for item in try functionCases("formatVariableValue") {
      let variable = try XCTUnwrap(item.args[0] as? [String: Any])
      let type = HostVariableType(rawValue: variable["type"] as? String ?? "") ?? .text
      XCTAssertEqual(formatVariableValue(type, variable["value"] as? String ?? ""), item.result as? String, "\(item.args)")
    }
  }

  func testIsVariableName() throws {
    for item in try functionCases("isVariableName") {
      XCTAssertEqual(isVariableName(item.args[0] as? String ?? ""), item.result as? Bool, "\(item.args)")
    }
  }

  func testParameterOptions() throws {
    for item in try functionCases("parseFunctionParameterOptions") {
      XCTAssertEqual(parseFunctionParameterOptions(string(item.args[0])), try decode([HostFunctionParameterOption].self, item.result), "\(item.args)")
    }
    for item in try functionCases("formatFunctionParameterOptions") {
      let list = try (item.args[0] as? [Any]).map { try decode([HostFunctionParameterOption].self, $0) }
      XCTAssertEqual(formatFunctionParameterOptions(list), item.result as? String, "\(item.args)")
    }
  }

  func testSummarizeDependents() throws {
    for item in try functionCases("summarizeDependents") {
      XCTAssertEqual(summarizeDependents(try decode(WhereUsedResult.self, item.args[0])), item.result as? String, "\(item.args)")
    }
  }

  // MARK: The no-code editors

  private func rowOf(_ element: Any) throws -> StructuredRow {
    let row = try XCTUnwrap(element as? [String: Any])
    let kept = row["kept"].flatMap { OrderedJSON.parse(String(data: try! JSONSerialization.data(withJSONObject: $0, options: .fragmentsAllowed), encoding: .utf8) ?? "") }
    return StructuredRow(key: row["key"] as? String ?? "", kind: StructuredKind(rawValue: row["kind"] as? String ?? "") ?? .text, value: row["value"] as? String ?? "", kept: kept)
  }

  private func shape(_ value: Any) -> StructuredShape { (value as? String) == "collection" ? .collection : .dictionary }

  func testStructuredValues() throws {
    for item in try functionCases("parseStructuredValue") {
      let parsed = parseStructuredValue(string(item.args[0]), shape(item.args[1]))
      let expected = try XCTUnwrap(item.result as? [String: Any])
      XCTAssertEqual(parsed.unreadable, expected["unreadable"] as? Bool, "\(item.args)")
      let rows = try (expected["rows"] as? [Any] ?? []).map(rowOf)
      XCTAssertEqual(parsed.rows, rows, "\(item.args)")
    }
    for item in try functionCases("serializeStructuredValue") {
      let rows = try (item.args[0] as? [Any] ?? []).map(rowOf)
      XCTAssertEqual(serializeStructuredValue(rows, shape(item.args[1])), item.result as? String, "\(item.args)")
    }
  }

  private func operand(_ element: Any) -> FormulaOperand {
    let operand = element as? [String: Any] ?? [:]
    switch operand["source"] as? String {
    case "name": return .name(operand["name"] as? String ?? "")
    case "number": return .number(operand["value"] as? String ?? "")
    case "text": return .text(operand["value"] as? String ?? "")
    default: return .current
    }
  }

  private func json(_ operand: FormulaOperand) -> [String: Any] {
    switch operand {
    case .name(let name): ["source": "name", "name": name]
    case .number(let value): ["source": "number", "value": value]
    case .text(let value): ["source": "text", "value": value]
    case .current: ["source": "current"]
    }
  }

  private func draft(_ element: Any) -> FormulaDraft? {
    guard let draft = element as? [String: Any] else { return nil }
    return FormulaDraft(
      operation: FormulaOperation(rawValue: draft["operation"] as? String ?? "") ?? .value, operands: (draft["operands"] as? [Any] ?? []).map(operand),
      places: (draft["places"] as? NSNumber)?.intValue, symbol: draft["symbol"] as? String, separator: draft["separator"] as? String)
  }

  func testFormulas() throws {
    for item in try functionCases("buildFormula") {
      let value = try XCTUnwrap(draft(item.args[0]))
      XCTAssertEqual(buildFormula(value, current: item.args[1] as? String ?? ""), string(item.result), "\(item.args)")
    }
    for item in try functionCases("formulaDraftFor") {
      let operation = try XCTUnwrap(FormulaOperation(rawValue: item.args[0] as? String ?? ""))
      let made = formulaDraftFor(operation, previous: draft(item.args[1]), current: item.args[2] as? String ?? "")
      let expected = try XCTUnwrap(item.result as? [String: Any])
      XCTAssertEqual(made.operation.rawValue, expected["operation"] as? String, "\(item.args)")
      XCTAssertEqual(made.operands, (expected["operands"] as? [Any] ?? []).map(operand), "\(item.args)")
      XCTAssertEqual(made.places, (expected["places"] as? NSNumber)?.intValue, "\(item.args)")
      XCTAssertEqual(made.symbol, expected["symbol"] as? String, "\(item.args)")
      XCTAssertEqual(made.separator, expected["separator"] as? String, "\(item.args)")
    }
    for item in try functionCases("formulaOperandLabel") {
      let operation = try XCTUnwrap(FormulaOperation(rawValue: item.args[0] as? String ?? ""))
      XCTAssertEqual(formulaOperandLabel(operation, (item.args[1] as? NSNumber)?.intValue ?? 0), item.result as? String, "\(item.args)")
    }
  }

  private func siteVariables(_ value: Any?) -> [SiteVariableName] {
    (value as? [Any] ?? []).compactMap { $0 as? [String: Any] }.map { SiteVariableName(name: $0["name"] as? String, type: $0["type"] as? String, value: $0["value"] as? String) }
  }

  func testFormulaNames() throws {
    for item in try functionCases("formulaNames") {
      let input = try XCTUnwrap(item.args[0] as? [String: Any])
      let names = formulaNames(
        parameters: (input["parameters"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String },
        locals: (input["locals"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }, siteVariables: siteVariables(input["siteVariables"]))
      let expected = (item.result as? [[String: Any]] ?? []).map { FormulaName(value: $0["value"] as? String ?? "", label: $0["label"] as? String ?? "", group: $0["group"] as? String ?? "") }
      XCTAssertEqual(names, expected, "\(item.args)")
    }
  }

  func testChoiceRows() throws {
    for item in try functionCases("choiceRowsFromOptions") {
      let list = try (item.args[0] as? [Any]).map { try decode([HostFunctionParameterOption].self, $0) }
      XCTAssertEqual(
        choiceRowsFromOptions(list).map { [$0.value, $0.label] }, (item.result as? [[String: Any]] ?? []).map { [$0["value"] as? String ?? "", $0["label"] as? String ?? ""] }, "\(item.args)")
    }
    for item in try functionCases("optionsFromChoiceRows") {
      let rows = (item.args[0] as? [[String: Any]] ?? []).map { ParameterChoiceRow(value: $0["value"] as? String ?? "", label: $0["label"] as? String ?? "") }
      XCTAssertEqual(optionsFromChoiceRows(rows), try decode([HostFunctionParameterOption].self, item.result), "\(item.args)")
    }
  }

  func testTestRunScope() throws {
    for item in try functionCases("functionReferencedNames") {
      XCTAssertEqual(functionReferencedNames(try decode(HostFunction.self, item.args[0])), item.result as? [String], "\(item.args)")
    }
    for item in try functionCases("functionGlobals") {
      let definition = try decode(HostFunction.self, item.args[0])
      let variables = siteVariables(Array((item.args[1] as? [String: Any] ?? [:]).sorted { $0.key < $1.key }.map(\.value)))
      let expected = (item.result as? [String: Any] ?? [:]).compactMapValues { SiteValue(plain: $0) }
      XCTAssertEqual(functionGlobals(definition, variables), expected, "\(item.args)")
    }
  }

  func testOrderedJSONKeepsJavaScriptKeyOrder() {
    let parsed = OrderedJSON.parse(#"{"b":1,"2":"x","a":true,"1":null}"#)
    guard case .object(let entries)? = parsed else { return XCTFail("an object") }
    XCTAssertEqual(entries.map(\.key), ["1", "2", "b", "a"])
    XCTAssertEqual(parsed?.text, #"{"1":null,"2":"x","b":1,"a":true}"#)
    XCTAssertNil(OrderedJSON.parse("{bad"))
    XCTAssertNil(OrderedJSON.parse("[1,]"))
    XCTAssertEqual(OrderedJSON.parse(#"["a\né",1.5e3]"#)?.text, "[\"a\\n\u{e9}\",1500]")
  }

  // MARK: Reference health (reference-audit.spec.ts, replayed)

  private let known = KnownTargets(
    workflows: ["wf-1", "Welcome flow"], functions: ["fn-1"], datasets: ["ds-1"], lists: ["list-1"], campaigns: [], overlays: ["ov-1"], webhooks: ["hook-1"])

  private func action(_ id: String, _ name: String, _ steps: [[String: Any]]) -> FirestoreDocument {
    FirestoreDocument(id: id, data: ["name": name, "steps": steps])
  }

  func testAnIntactReferenceByIDOrNamePasses() {
    let issues = auditHostReferences(
      actions: [action("a1", "On signup", [["type": "runWorkflow", "workflowId": "wf-1"], ["type": "runWorkflow", "workflowName": "Welcome flow"], ["type": "enrollList", "listId": "list-1"]])],
      workflows: [], variables: [], known: known)
    XCTAssertEqual(issues, [])
  }

  func testADanglingIDIsFlaggedAcrossStepKinds() {
    let issues = auditHostReferences(
      actions: [action("a1", "Broken", [["type": "runWorkflow", "workflowId": "wf-gone"], ["type": "updateDataset", "datasetId": "ds-gone"], ["type": "showOverlay", "overlayId": "ov-gone"]])],
      workflows: [], variables: [], known: known)
    XCTAssertEqual(issues.map(\.refType), ["workflow", "dataset", "overlay"])
    XCTAssertEqual(issues[0], ReferenceIssue(source: "action", sourceID: "a1", sourceName: "Broken", refType: "workflow", missing: "wf-gone"))
  }

  func testWorkflowsAndComputedVariablesAreAudited() {
    let workflow = FirestoreDocument(id: "wf-1", data: ["name": "Welcome flow", "steps": [["functionId": "fn-1", "functionName": "greet"], ["functionId": "fn-gone", "functionName": ""]]])
    let variable = FirestoreDocument(id: "v1", data: ["name": "total", "workflowId": "wf-gone"])
    let issues = auditHostReferences(actions: [], workflows: [workflow], variables: [variable], known: known)
    XCTAssertEqual(issues.map(\.refType), ["function", "workflow"])
    XCTAssertEqual(issues.map(\.source), ["workflow", "variable"])
  }

  func testARedirectToADeletedScreenIsFlaggedAndAnUnloadedKindStaysQuiet() {
    let go = auditHostReferences(actions: [action("a1", "Go", [["type": "redirect", "screenId": "gone"]])], workflows: [], variables: [], known: KnownTargets(screens: ["home"]))
    XCTAssertEqual(go, [ReferenceIssue(source: "action", sourceID: "a1", sourceName: "Go", refType: "screen", missing: "gone")])
    let quiet = auditHostReferences(
      actions: [action("a1", "Unloaded", [["type": "runWorkflow", "workflowId": "anything"]])], workflows: [],
      variables: [FirestoreDocument(id: "v1", data: ["name": "plain"])], known: KnownTargets())
    XCTAssertEqual(quiet, [])
  }

  func testAKnownSetHoldsIDsAndTrimmedNamesOfLiveDocs() {
    let docs = [
      FirestoreDocument(id: "a", data: ["name": " Alpha "]), FirestoreDocument(id: "b", data: ["name": "Beta", "deletedAt": 1]),
      FirestoreDocument(id: "c", data: ["displayName": "Home"]),
    ]
    XCTAssertEqual(knownSet(docs), ["a", "Alpha", "c"])
    XCTAssertEqual(knownSet(docs, nameKey: "displayName"), ["a", "c", "Home"])
  }

  // MARK: Writes and the evaluator

  func testAFunctionSavesAsItsWholeDefinitionAndRuns() throws {
    var definition = emptyFunction()
    definition.name = "  Total  "
    definition.operations = [
      FunctionConditionalOperation(
        if: FunctionConditionalOperationIf(comparator: .lessThanOrEqual, left: "P1", right: "10"), otherwise: [FunctionSetOperation(expression: "P1 - 1", set: "P3")],
        then: [FunctionSetOperation(expression: "P1 * 2", set: "P3")])
    ]
    definition.returnValue = "P3"
    let saved = functionSaveFields(definition)
    XCTAssertEqual(saved["name"] as? String, "Total")
    XCTAssertEqual((saved["operations"] as? [Any])?.count, 1)
    if case .ok(let value, _) = evaluateHostFunction(runnableFunction(definition), ["P1": .text("4")]) {
      XCTAssertEqual(value, .number(8))
    } else {
      XCTFail("a run")
    }
    if case .ok(let value, _) = evaluateHostFunction(runnableFunction(definition), ["P1": .text("20")]) {
      XCTAssertEqual(value, .number(19))
    } else {
      XCTFail("a run")
    }
  }
}
